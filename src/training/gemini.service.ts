import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Difficulty } from '../games/games.constants';
import { GeneratedTrainingDto } from './dto/generate-training.dto';

/**
 * O modelo que responde quando `GEMINI_MODEL` não está no ambiente (spec 026).
 *
 * **A leitura é `?? DEFAULT_GEMINI_MODEL`, nunca `config.get(chave, padrão)`.**
 * O dublê de `ConfigService` do `.spec` ignora o segundo argumento, então a
 * forma de dois parâmetros montaria `models/undefined:generateContent` com a
 * suíte verde -- e o defeito só apareceria como 404 da Gemini virando 503 na
 * cara do admin.
 */
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

/**
 * O endereço da geração, montado com o modelo em mãos.
 *
 * Deixou de ser constante de módulo porque o modelo só é conhecido com o
 * `ConfigService` na mão. As três linhas estão duplicadas no outro
 * `gemini.service.ts` de propósito, como o `DIFFICULTY_LABEL` e o `MAX_HINTS` já
 * estão: um módulo compartilhado só para o endereço acoplaria os dois serviços
 * pela parte que menos muda.
 */
const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/**
 * O teto de dicas do `CreateTrainingDto`, repetido aqui de propósito.
 *
 * O rascunho existe para ser salvo por aquela rota, e um treinamento com 40
 * dicas voltaria 400 depois de o admin ter revisado a lista inteira. Cortar na
 * geração é mais barato do que explicar o erro no fim do trabalho.
 */
const MAX_HINTS = 30;

/** Como o admin descreve o que quer. */
export interface GenerateTrainingsInput {
  badgeTitle: string;
  prompt: string;
  difficulty: Difficulty;
  count: number;
}

/** O rascunho, e quantos o modelo devolveu fora do formato. */
export interface GenerateTrainingsResult {
  trainings: GeneratedTrainingDto[];
  /** Quantos foram descartados em silêncio, para o admin ver o que sobrou. */
  discarded: number;
}

/** O texto que o rótulo em português vira dentro do prompt. */
const DIFFICULTY_LABEL: Readonly<Record<Difficulty, string>> = {
  easy: 'fácil',
  medium: 'média',
  hard: 'difícil',
};

/**
 * A geração de treinamentos por IA (spec 025, decisão 3).
 *
 * **Devolve rascunho e não grava nada.** O que sai daqui vai para a tela do
 * admin, que desmarca o que não presta, edita o que quer e só então salva --
 * um `POST /admin/badges/:badgeId/trainings` por rascunho aprovado, porque
 * **não existe rota de `bulk` para treinamentos**.
 *
 * **Só rotas de admin o alcançam.** Ele é provido no `TrainingModule` e
 * injetado apenas no `AdminTrainingController`; nenhuma rota pública o toca.
 *
 * É um serviço próprio, e não o `GeminiService` do GYM parametrizado: aquele
 * fala de alternativas e `correctIndex`, e generalizá-lo para dois formatos de
 * rascunho custaria mais do que a duplicação do casco.
 */
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  constructor(private readonly config: ConfigService) {}

  async generate(
    input: GenerateTrainingsInput,
  ): Promise<GenerateTrainingsResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');

    // Sem a chave o recurso simplesmente não existe, e dizer isso é melhor do
    // que um 500. A chave é opcional no boot fora de produção de propósito: o
    // resto da API precisa servir numa máquina que nunca vai clicar neste
    // botão -- e é assim que a suíte e2e roda.
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'A geração por IA não está configurada.',
      );
    }

    // Lido uma vez por chamada e passado adiante como a chave: ler de novo
    // dentro do `ask` seria a mesma configuração consultada duas vezes na mesma
    // requisição, e é assim que as duas metades de um serviço acabam falando
    // com modelos diferentes no dia em que alguém trocar só uma.
    const model =
      this.config.get<string>('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL;

    const text = await this.ask(apiKey, model, this.buildPrompt(input));

    return this.parse(text, input);
  }

  /**
   * O prompt estruturado da decisão 3.
   *
   * **A instrução que importa é a que proíbe a solução pronta.** Um modelo
   * solto devolve o código resolvido no lugar da dica, e aí a dica deixa de
   * valer 1 XP porque entrega o desafio inteiro -- a mecânica desta spec morre
   * sem nenhum erro aparecer em lugar nenhum. O exemplo dentro do prompt existe
   * pelo mesmo motivo: dizer "seja lógico" não é instrução, mostrar
   * "precisamos de uma variável inteira para guardar a idade" é.
   *
   * **Ele pede o JSON e não confia que virá JSON**, e por isso o `parse` abaixo
   * tolera cerca de markdown e descarta o que não encaixa. Instruir o modelo
   * reduz a taxa de erro; não a elimina.
   */
  private buildPrompt({
    badgeTitle,
    prompt,
    difficulty,
    count,
  }: GenerateTrainingsInput): string {
    return [
      `Gere ${count} desafios práticos de programação em português do Brasil sobre o tema a seguir,`,
      `no contexto da etapa "${badgeTitle}" de uma trilha de programação,`,
      `no nível ${DIFFICULTY_LABEL[difficulty]}.`,
      '',
      `Tema: ${prompt}`,
      '',
      'Cada desafio tem três partes, e elas não se repetem:',
      '- "description" é o cenário: a situação ou o problema, sem dizer onde se quer chegar.',
      '- "objective" é o resultado esperado, em uma frase.',
      '- "hints" são as dicas de raciocínio, na ordem em que o pensamento caminha.',
      '',
      'As dicas guiam o pensamento e NÃO entregam o código.',
      'Não escreva a solução, não escreva blocos de código e não use nomes de funções prontas.',
      'Uma dica boa é do tipo: "Precisamos de uma variável inteira para guardar a idade".',
      'Uma dica ruim é do tipo: "int idade = sc.nextInt(); if (idade < 0) ...".',
      'Cada desafio deve ter entre 3 e 8 dicas, e a primeira deve ser a mais geral.',
      '',
      'Responda SOMENTE com um array JSON, sem texto antes ou depois e sem cerca de markdown,',
      'no formato: [{ "title": string, "description": string, "objective": string, "hints": [string] }]',
    ].join('\n');
  }

  private async ask(
    apiKey: string,
    model: string,
    prompt: string,
  ): Promise<string> {
    let response: { ok: boolean; status: number; json: () => Promise<unknown> };

    try {
      response = await fetch(endpointFor(model), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // **No cabeçalho, nunca na query.** Chave em query string vaza em log
          // de proxy e no histórico de erro de qualquer intermediário.
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            // Temperatura baixa: aqui se quer formato correto e desafio
            // correto, não criatividade. O tema já veio do admin.
            temperature: 0.4,
            responseMimeType: 'application/json',
          },
        }),
      });
    } catch (error) {
      this.logger.error(`Falha ao chamar a Gemini: ${String(error)}`);

      throw new ServiceUnavailableException(
        'Não foi possível falar com a IA agora. Tente de novo em instantes.',
      );
    }

    const payload: unknown = await response.json();

    if (!response.ok) {
      // A mensagem do Google é útil no log e não deve chegar ao admin: ela fala
      // de cota e de projeto, e não do que ele pode fazer a respeito.
      this.logger.error(
        `Gemini respondeu ${response.status}: ${JSON.stringify(payload)}`,
      );

      throw new ServiceUnavailableException(
        'Não foi possível falar com a IA agora. Tente de novo em instantes.',
      );
    }

    return extractText(payload);
  }

  /**
   * Lê o JSON e joga fora o que não serve, **em silêncio e contado**.
   *
   * O descarte é silencioso porque um treinamento malformado não é erro do
   * admin nem algo que ele possa corrigir; é contado porque ele precisa saber
   * que pediu 5 e revisou 3 -- sem o número, o rascunho curto parece um limite
   * do produto em vez de um modelo que errou o formato.
   */
  private parse(
    text: string,
    input: GenerateTrainingsInput,
  ): GenerateTrainingsResult {
    const raw = parseJsonArray(text);

    if (raw === null) {
      this.logger.error(
        `Gemini devolveu algo que não é JSON: ${text.slice(0, 200)}`,
      );

      throw new ServiceUnavailableException(
        'A IA respondeu num formato que não consegui ler. Tente de novo.',
      );
    }

    const trainings: GeneratedTrainingDto[] = [];
    let discarded = 0;

    for (const item of raw) {
      const training = toTraining(item);

      if (training === null) {
        discarded += 1;
        continue;
      }

      // **Nunca mais do que o pedido.** Um modelo generoso que devolvesse vinte
      // faria o admin revisar vinte depois de ter pedido cinco.
      if (trainings.length < input.count) {
        trainings.push(training);
      }
    }

    return { trainings, discarded };
  }
}

/** Puxa o texto do envelope da Gemini, sem assumir que ele veio. */
function extractText(payload: unknown): string {
  const candidates = (payload as { candidates?: unknown }).candidates;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return '';
  }

  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content
    ?.parts;

  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => (part as { text?: unknown }).text)
    .filter((text): text is string => typeof text === 'string')
    .join('');
}

/**
 * Lê o array, tolerando a cerca de markdown.
 *
 * O modelo devolve o JSON cercado com frequência, mesmo instruído a não
 * devolver. Recusar isso seria transformar um formato previsível em falha.
 */
function parseJsonArray(text: string): unknown[] | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed: unknown = JSON.parse(cleaned);

    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Um treinamento do modelo virando rascunho, ou `null`.
 *
 * **O piso de uma dica é conferido aqui também**, e não só no DTO de criação: um
 * desafio sem nenhuma saída quando o membro trava só paga quem já sabia, e
 * deixá-lo entrar no rascunho seria oferecer ao admin um item que o salvar
 * recusa depois.
 */
function toTraining(item: unknown): GeneratedTrainingDto | null {
  if (typeof item !== 'object' || item === null) {
    return null;
  }

  const { title, description, objective, hints } = item as {
    title?: unknown;
    description?: unknown;
    objective?: unknown;
    hints?: unknown;
  };

  const textos = [title, description, objective].map((valor) =>
    typeof valor === 'string' ? valor.trim() : '',
  );

  if (textos.some((texto) => texto.length === 0)) {
    return null;
  }

  if (!Array.isArray(hints)) {
    return null;
  }

  const dicas = hints
    .map((hint) => (typeof hint === 'string' ? hint.trim() : ''))
    .filter((hint) => hint.length > 0)
    .slice(0, MAX_HINTS);

  if (dicas.length === 0) {
    return null;
  }

  return {
    title: textos[0],
    description: textos[1],
    objective: textos[2],
    hints: dicas,
  };
}
