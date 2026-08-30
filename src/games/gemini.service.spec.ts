import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from './gemini.service';

/** Uma questao no formato exato que o prompt pede de volta. */
function questaoGerada(extra: Record<string, unknown> = {}) {
  return {
    question: 'O que um laço `for` controla?',
    alternatives: ['A repetição', 'A memória', 'A ordem', 'O tipo'],
    correctIndex: 0,
    ...extra,
  };
}

/** Envelope da Gemini: o JSON pedido vem dentro de um bloco de texto. */
function respostaGemini(payload: unknown) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(payload) }],
        },
      },
    ],
  };
}

// `null` e nao `undefined` para "sem chave": passar `undefined` explicitamente
// aciona o valor padrao do parametro, e o teste da chave ausente passaria a
// testar a chave presente -- em silencio, e verde.
function makeService(apiKey: string | null = 'AIza_x'): {
  service: GeminiService;
  fetchMock: jest.Mock;
} {
  const config = {
    get: jest.fn((key: string) =>
      key === 'GEMINI_API_KEY' ? (apiKey ?? undefined) : undefined,
    ),
  } as unknown as ConfigService;

  const fetchMock = jest.fn();
  global.fetch = fetchMock;

  return { service: new GeminiService(config), fetchMock };
}

function okWith(payload: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(respostaGemini(payload)),
  });
}

describe('GeminiService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sem a chave', () => {
    it('responde 503 em vez de derrubar o boot', async () => {
      // A chave e opcional no boot de proposito (decisao 9 e adendo A.6):
      // exigi-la sempre derrubaria toda maquina de desenvolvimento por causa de
      // uma rota de admin que ninguem esta usando.
      const { service, fetchMock } = makeService(null);

      await expect(
        service.generate({
          badgeTitle: 'Insígnia da Lógica',
          prompt: 'laços e condicionais',
          difficulty: 'easy',
          count: 10,
        }),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('a resposta bem formada', () => {
    it('devolve as questoes geradas', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(
        okWith([questaoGerada(), questaoGerada({ correctIndex: 3 })]),
      );

      const resultado = await service.generate({
        badgeTitle: 'Insígnia da Lógica',
        prompt: 'laços e condicionais',
        difficulty: 'easy',
        count: 2,
      });

      expect(resultado.questions).toHaveLength(2);
      expect(resultado.questions[1].correctIndex).toBe(3);
      expect(resultado.discarded).toBe(0);
    });

    it('carimba a dificuldade pedida, e nao a que a IA achar', async () => {
      // A IA nao decide o nivel: o admin pediu "difícil" e e nisso que a questao
      // entra. Aceitar um `difficulty` vindo do modelo faria trinta questoes
      // pedidas como dificeis caírem em fácil e desequilibrarem a rodada 1.
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(
        okWith([questaoGerada({ difficulty: 'easy' })]),
      );

      const resultado = await service.generate({
        badgeTitle: 'Insígnia da Lógica',
        prompt: 'ponteiros',
        difficulty: 'hard',
        count: 1,
      });

      expect(resultado.questions[0].difficulty).toBe('hard');
    });

    it('nunca devolve mais do que o pedido', async () => {
      // O teto de 33 por nivel e do service de questoes, mas um modelo
      // generoso que devolvesse 50 faria o admin revisar 50 e o `bulk` recusar
      // o lote inteiro depois do trabalho todo.
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(
        okWith(Array.from({ length: 20 }, () => questaoGerada())),
      );

      const resultado = await service.generate({
        badgeTitle: 'Insígnia da Lógica',
        prompt: 'laços',
        difficulty: 'easy',
        count: 5,
      });

      expect(resultado.questions).toHaveLength(5);
    });
  });

  describe('o descarte silencioso', () => {
    it('descarta questao com menos de quatro alternativas', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(
        okWith([
          questaoGerada(),
          questaoGerada({ alternatives: ['a', 'b', 'c'] }),
        ]),
      );

      const resultado = await service.generate({
        badgeTitle: 'Insígnia da Lógica',
        prompt: 'laços',
        difficulty: 'easy',
        count: 2,
      });

      expect(resultado.questions).toHaveLength(1);
      expect(resultado.discarded).toBe(1);
    });

    it('descarta correctIndex fora de 0-3', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(
        okWith([questaoGerada({ correctIndex: 7 }), questaoGerada()]),
      );

      const resultado = await service.generate({
        badgeTitle: 'Insígnia da Lógica',
        prompt: 'laços',
        difficulty: 'easy',
        count: 2,
      });

      expect(resultado.questions).toHaveLength(1);
      expect(resultado.discarded).toBe(1);
    });

    it('descarta enunciado vazio e alternativa vazia', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(
        okWith([
          questaoGerada({ question: '   ' }),
          questaoGerada({ alternatives: ['a', '', 'c', 'd'] }),
          questaoGerada(),
        ]),
      );

      const resultado = await service.generate({
        badgeTitle: 'Insígnia da Lógica',
        prompt: 'laços',
        difficulty: 'easy',
        count: 3,
      });

      expect(resultado.questions).toHaveLength(1);
      expect(resultado.discarded).toBe(2);
    });

    it('conta o descarte para o admin ver quantas sobraram', async () => {
      // O admin precisa saber que pediu 10 e revisou 7. Sem o numero, o
      // rascunho curto parece um limite do produto em vez de um modelo que
      // errou o formato.
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(
        okWith([
          questaoGerada(),
          questaoGerada({ alternatives: [] }),
          questaoGerada({ correctIndex: -1 }),
        ]),
      );

      const resultado = await service.generate({
        badgeTitle: 'Insígnia da Lógica',
        prompt: 'laços',
        difficulty: 'easy',
        count: 3,
      });

      expect(resultado).toMatchObject({ discarded: 2 });
      expect(resultado.questions).toHaveLength(1);
    });
  });

  describe('a resposta malformada', () => {
    it('nao derruba a rota quando o corpo nao e JSON', async () => {
      // O modelo devolve texto. Um `JSON.parse` solto aqui viraria 500 na cara
      // do admin, e o que ele precisa saber e "a IA respondeu algo que nao
      // consigo ler", nao um stack trace.
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              candidates: [
                { content: { parts: [{ text: 'desculpe, nao consigo' }] } },
              ],
            }),
        }),
      );

      await expect(
        service.generate({
          badgeTitle: 'Insígnia da Lógica',
          prompt: 'laços',
          difficulty: 'easy',
          count: 3,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('aceita o JSON embrulhado em cerca de markdown', async () => {
      // O modelo devolve ```json ... ``` com frequencia, mesmo instruido a nao
      // devolver. Recusar isso seria transformar um formato previsivel em falha.
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text:
                          '```json\n' +
                          JSON.stringify([questaoGerada()]) +
                          '\n```',
                      },
                    ],
                  },
                },
              ],
            }),
        }),
      );

      const resultado = await service.generate({
        badgeTitle: 'Insígnia da Lógica',
        prompt: 'laços',
        difficulty: 'easy',
        count: 1,
      });

      expect(resultado.questions).toHaveLength(1);
    });

    it('traduz o erro HTTP da Gemini em 503', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(
        Promise.resolve({
          ok: false,
          status: 429,
          json: () =>
            Promise.resolve({ error: { message: 'RESOURCE_EXHAUSTED' } }),
        }),
      );

      await expect(
        service.generate({
          badgeTitle: 'Insígnia da Lógica',
          prompt: 'laços',
          difficulty: 'easy',
          count: 3,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('devolve rascunho vazio quando tudo foi descartado, sem estourar', async () => {
      // Zero questoes validas nao e erro: e um prompt que nao funcionou. O
      // admin reescreve e tenta de novo, e um 500 aqui o faria achar que o
      // recurso esta quebrado.
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(okWith([questaoGerada({ alternatives: [] })]));

      const resultado = await service.generate({
        badgeTitle: 'Insígnia da Lógica',
        prompt: 'laços',
        difficulty: 'easy',
        count: 1,
      });

      expect(resultado.questions).toEqual([]);
      expect(resultado.discarded).toBe(1);
    });
  });

  describe('o prompt', () => {
    it('leva o tema do admin, a dificuldade e a insignia', async () => {
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(okWith([questaoGerada()]));

      await service.generate({
        badgeTitle: 'Insígnia da POO',
        prompt: 'herança e polimorfismo em Java',
        difficulty: 'medium',
        count: 10,
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const corpo = JSON.stringify(init.body);

      expect(corpo).toContain('herança e polimorfismo em Java');
      expect(corpo).toContain('Insígnia da POO');
      expect(corpo).toContain('10');
    });

    it('nao poe a chave na URL de log, e sim no cabecalho', async () => {
      // Chave em query string vaza em log de proxy e em historico de erro.
      const { service, fetchMock } = makeService();
      fetchMock.mockReturnValue(okWith([questaoGerada()]));

      await service.generate({
        badgeTitle: 'Insígnia da Lógica',
        prompt: 'laços',
        difficulty: 'easy',
        count: 1,
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(url).not.toContain('AIza_x');
      expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
        'AIza_x',
      );
    });
  });
});
