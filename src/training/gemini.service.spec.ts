import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from './gemini.service';

/** Um treinamento no formato exato que o prompt pede de volta. */
function treinamentoGerado(extra: Record<string, unknown> = {}) {
  return {
    title: 'A idade que o sistema não aceita',
    description:
      'Um cadastro aceita qualquer número no campo idade, inclusive negativos.',
    objective: 'O cadastro recusa idade fora da faixa e avisa o usuário.',
    hints: [
      'Precisamos de uma variável inteira para guardar a idade.',
      'Antes de aceitar, compare o valor com a faixa que faz sentido.',
    ],
    ...extra,
  };
}

/** Envelope da Gemini: o JSON pedido vem dentro de um bloco de texto. */
function respostaGemini(texto: string) {
  return { candidates: [{ content: { parts: [{ text: texto }] } }] };
}

// `null` e não `undefined` para "sem chave": passar `undefined` explicitamente
// aciona o valor padrão do parâmetro, e o teste da chave ausente passaria a
// testar a chave presente -- em silêncio, e verde.
function makeService(
  apiKey: string | null = 'AIza_x',
  // `null` para "sem GEMINI_MODEL no ambiente", que é o caso comum: a variável
  // é opcional e o padrão mora no serviço (spec 026).
  model: string | null = null,
): {
  service: GeminiService;
  fetchMock: jest.Mock;
} {
  // Este dublê **ignora o segundo argumento de `get`**, e é por isso que o
  // serviço usa `?? DEFAULT_GEMINI_MODEL` e nunca `get(chave, padrão)`: com a
  // forma de dois parâmetros o modelo chegaria `undefined` aqui, a URL viraria
  // `models/undefined:generateContent`, e a suíte passaria verde.
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'GEMINI_API_KEY') {
        return apiKey ?? undefined;
      }

      if (key === 'GEMINI_MODEL') {
        return model ?? undefined;
      }

      return undefined;
    }),
  } as unknown as ConfigService;

  const fetchMock = jest.fn();
  global.fetch = fetchMock;

  return { service: new GeminiService(config), fetchMock };
}

function okWithText(texto: string) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(respostaGemini(texto)),
  });
}

function okWith(payload: unknown) {
  return okWithText(JSON.stringify(payload));
}

/** O prompt que o `fetch` mockado recebeu, já desembrulhado do envelope. */
function promptEnviado(fetchMock: jest.Mock): string {
  const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
  const corpo = JSON.parse(init.body) as {
    contents: { parts: { text: string }[] }[];
  };

  return corpo.contents[0].parts[0].text;
}

const PEDIDO = {
  badgeTitle: 'Insígnia da Lógica',
  prompt: 'Desafios sobre laços de repetição, partindo de um problema real.',
  difficulty: 'medium' as const,
  count: 3,
};

describe('GeminiService (treinamentos)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * **Sem a chave o recurso não existe, e dizer isso é melhor do que um 500.**
   *
   * A chave é opcional no boot fora de produção de propósito: o resto da API
   * precisa servir numa máquina que nunca vai clicar neste botão -- e é assim
   * que a suíte e2e roda, o que faz deste 503 um contrato, e não um acidente.
   */
  describe('sem a chave', () => {
    it('responde 503 e não chega a chamar a Gemini', async () => {
      const { service, fetchMock } = makeService(null);

      await expect(service.generate(PEDIDO)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('o prompt', () => {
    it('leva tema, título da insígnia, nível e quantidade', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(okWith([treinamentoGerado()]));

      await service.generate(PEDIDO);
      const prompt = promptEnviado(fetchMock);

      expect(prompt).toContain('Insígnia da Lógica');
      expect(prompt).toContain('laços de repetição');
      expect(prompt).toContain('média');
      expect(prompt).toContain('3');
    });

    /**
     * **A dica é raciocínio, nunca a solução escrita** (spec 025).
     *
     * É a razão de existir desta geração: um modelo solto devolve o código
     * pronto, e aí a dica deixa de valer 1 XP porque entrega o desafio inteiro.
     * O prompt precisa dizer isso com todas as letras, e este teste é o que
     * impede a instrução de sumir numa reescrita.
     */
    it('proíbe a solução pronta e pede o caminho do pensamento', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(okWith([treinamentoGerado()]));

      await service.generate(PEDIDO);
      const prompt = promptEnviado(fetchMock).toLowerCase();

      expect(prompt).toContain('não escreva a solução');
      expect(prompt).toContain('variável inteira');
    });

    it('manda a chave no cabeçalho, e nunca na query', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(okWith([treinamentoGerado()]));

      await service.generate(PEDIDO);

      const [url, init] = fetchMock.mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];

      expect(url).not.toContain('AIza_x');
      expect(init.headers['x-goog-api-key']).toBe('AIza_x');
    });
  });

  describe('a leitura da resposta', () => {
    it('devolve os treinamentos propostos, sem descarte', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(okWith([treinamentoGerado()]));

      const resultado = await service.generate(PEDIDO);

      expect(resultado.discarded).toBe(0);
      expect(resultado.trainings).toEqual([
        {
          title: 'A idade que o sistema não aceita',
          description:
            'Um cadastro aceita qualquer número no campo idade, inclusive negativos.',
          objective: 'O cadastro recusa idade fora da faixa e avisa o usuário.',
          hints: [
            'Precisamos de uma variável inteira para guardar a idade.',
            'Antes de aceitar, compare o valor com a faixa que faz sentido.',
          ],
        },
      ]);
    });

    /**
     * O modelo devolve o JSON cercado de markdown com frequência, mesmo
     * instruído a não devolver. Recusar isso seria transformar um formato
     * previsível em falha.
     */
    it('tolera a cerca de markdown em volta do JSON', async () => {
      const { service, fetchMock } = makeService();
      const cerca = '```';
      fetchMock.mockReturnValue(
        okWithText(
          `${cerca}json\n${JSON.stringify([treinamentoGerado()])}\n${cerca}`,
        ),
      );

      const resultado = await service.generate(PEDIDO);

      expect(resultado.trainings).toHaveLength(1);
    });

    it('responde 503 quando não veio JSON nenhum', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(okWithText('Claro! Aqui estão os desafios:'));

      await expect(service.generate(PEDIDO)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    /**
     * **O descarte é silencioso e contado** (mesma resiliência da spec 022).
     *
     * Silencioso porque um treinamento malformado não é erro do admin nem algo
     * que ele possa corrigir; contado porque ele precisa saber que pediu 5 e
     * revisou 3 -- sem o número, o rascunho curto parece limite do produto em
     * vez de um modelo que errou o formato.
     */
    it('descarta o que não encaixa no formato e conta quantos foram', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(
        okWith([
          treinamentoGerado(),
          treinamentoGerado({ hints: [] }),
          treinamentoGerado({ objective: '' }),
          { title: 'Só o título' },
          'nem objeto é',
        ]),
      );

      const resultado = await service.generate(PEDIDO);

      expect(resultado.trainings).toHaveLength(1);
      expect(resultado.discarded).toBe(4);
    });

    /**
     * **Nunca mais do que o pedido.** Um modelo generoso que devolvesse vinte
     * faria o admin revisar vinte depois de ter pedido cinco.
     */
    it('não devolve mais treinamentos do que o admin pediu', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(
        okWith([
          treinamentoGerado({ title: 'Um' }),
          treinamentoGerado({ title: 'Dois' }),
          treinamentoGerado({ title: 'Três' }),
          treinamentoGerado({ title: 'Quatro' }),
        ]),
      );

      const resultado = await service.generate({ ...PEDIDO, count: 2 });

      expect(resultado.trainings).toHaveLength(2);
    });

    /**
     * O teto de 30 dicas é do `CreateTrainingDto`, e o rascunho existe para ser
     * salvo por ele. Cortar aqui é o que evita o pior desfecho da tela: o admin
     * revisa um treinamento inteiro e o salvar devolve 400 no fim.
     */
    it('corta a lista de dicas no teto que o DTO de criação aceita', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(
        okWith([
          treinamentoGerado({
            hints: Array.from({ length: 40 }, (_, i) => `Dica ${i}`),
          }),
        ]),
      );

      const resultado = await service.generate(PEDIDO);

      expect(resultado.trainings[0].hints).toHaveLength(30);
    });
  });

  describe('a Gemini fora do ar', () => {
    it('responde 503 quando o fetch estoura', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));

      await expect(service.generate(PEDIDO)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    /**
     * A mensagem do Google é útil no log e não deve chegar ao admin: ela fala
     * de cota e de projeto, e não do que ele pode fazer a respeito.
     */
    it('responde 503 quando a Gemini devolve erro', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: { message: 'quota' } }),
      });

      await expect(service.generate(PEDIDO)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('o modelo, vindo do ambiente (spec 026)', () => {
    it('sem GEMINI_MODEL, chama o padrão do código', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(okWith([treinamentoGerado()]));

      await service.generate(PEDIDO);

      const [url] = fetchMock.mock.calls[0] as [string];

      expect(url).toContain('models/gemini-2.0-flash:generateContent');
    });

    it('com GEMINI_MODEL, chama o modelo configurado', async () => {
      const { service, fetchMock } = makeService('AIza_x', 'gemini-2.5-pro');
      fetchMock.mockReturnValue(okWith([treinamentoGerado()]));

      await service.generate(PEDIDO);

      const [url] = fetchMock.mock.calls[0] as [string];

      expect(url).toContain('models/gemini-2.5-pro:generateContent');
    });

    it('teste-trava: a URL nunca carrega undefined', async () => {
      // Repetido de propósito no outro `gemini.service.spec.ts`, e não extraído
      // para um helper: são dois serviços de módulos diferentes, e um helper
      // compartilhado de teste acoplaria as duas suítes pela parte que menos
      // muda. O sintoma que ele evita é mudo -- 404 da Gemini virando 503 na
      // cara do admin, com a suíte verde.
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(okWith([treinamentoGerado()]));

      await service.generate(PEDIDO);

      const [url] = fetchMock.mock.calls[0] as [string];

      expect(url).not.toContain('undefined');
    });
  });
});
