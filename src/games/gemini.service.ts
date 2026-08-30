import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateQuestionDto } from './dto/create-question.dto';
import type { Difficulty } from './games.constants';

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/** Como o admin descreve o que quer. */
export interface GenerateInput {
  badgeTitle: string;
  prompt: string;
  difficulty: Difficulty;
  count: number;
}

/** O rascunho, e quantas o modelo devolveu fora do formato. */
export interface GenerateResult {
  questions: CreateQuestionDto[];
  /** Quantas foram descartadas em silencio, para o admin ver o que sobrou. */
  discarded: number;
}

/** O texto que o rotulo em portugues vira dentro do prompt. */
const DIFFICULTY_LABEL: Readonly<Record<Difficulty, string>> = {
  easy: 'fácil',
  medium: 'média',
  hard: 'difícil',
};

/**
 * A geracao de questoes por IA (spec 022, decisao 9).
 *
 * **Devolve rascunho e nao grava nada.** O que sai daqui vai para a tela do
 * admin, que edita, exclui e so entao salva pelo `bulk` -- e essa separacao e o
 * que impede uma questao errada de entrar no banco por descuido de um modelo.
 *
 * **So rotas de admin o alcancam.** Ele e provido no `GamesModule` e injetado
 * apenas no `AdminGamesController`; nenhuma rota publica o toca.
 */
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  constructor(private readonly config: ConfigService) {}

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');

    // Sem a chave o recurso simplesmente nao existe, e dizer isso e melhor do
    // que um 500. A chave e opcional no boot fora de producao de proposito: o
    // resto da API precisa servir numa maquina que nunca vai clicar neste botao.
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'A geração por IA não está configurada.',
      );
    }

    const text = await this.ask(apiKey, this.buildPrompt(input));

    return this.parse(text, input);
  }

  /**
   * O prompt estruturado da decisao 9.
   *
   * **Ele pede o JSON e nao confia que vira JSON**, e por isso o `parse` abaixo
   * tolera cerca de markdown e descarta o que nao encaixa. Instruir o modelo e
   * reduzir a taxa de erro, nao elimina-la.
   */
  private buildPrompt({
    badgeTitle,
    prompt,
    difficulty,
    count,
  }: GenerateInput): string {
    return [
      `Gere ${count} questões de múltipla escolha em português do Brasil sobre o tema a seguir,`,
      `no contexto da etapa "${badgeTitle}" de uma trilha de programação,`,
      `no nível ${DIFFICULTY_LABEL[difficulty]}.`,
      '',
      `Tema: ${prompt}`,
      '',
      'Cada questão deve ter exatamente 4 alternativas, sendo apenas uma correta.',
      'As alternativas erradas devem ser plausíveis, e nenhuma pode ser "todas as anteriores".',
      'Não repita questões nem alternativas entre as questões.',
      '',
      'Responda SOMENTE com um array JSON, sem texto antes ou depois e sem cerca de markdown,',
      'no formato: [{ "question": string, "alternatives": [string, string, string, string], "correctIndex": 0 }]',
    ].join('\n');
  }

  private async ask(apiKey: string, prompt: string): Promise<string> {
    let response: { ok: boolean; status: number; json: () => Promise<unknown> };

    try {
      response = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // **No cabecalho, nunca na query.** Chave em query string vaza em log
          // de proxy e no historico de erro de qualquer intermediario.
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            // Temperatura baixa: aqui se quer formato correto e questao correta,
            // nao criatividade. O tema ja veio do admin.
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
      // A mensagem do Google e util no log e nao deve chegar ao admin: ela fala
      // de cota e de projeto, e nao do que ele pode fazer a respeito.
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
   * Le o JSON e joga fora o que nao serve, **em silencio e contado**.
   *
   * O descarte e silencioso porque uma questao malformada nao e um erro do
   * admin nem algo que ele possa corrigir; e contado porque ele precisa saber
   * que pediu 10 e revisou 7 -- sem o numero, o rascunho curto parece um limite
   * do produto em vez de um modelo que errou o formato.
   */
  private parse(text: string, input: GenerateInput): GenerateResult {
    const raw = parseJsonArray(text);

    if (raw === null) {
      this.logger.error(
        `Gemini devolveu algo que não é JSON: ${text.slice(0, 200)}`,
      );

      throw new ServiceUnavailableException(
        'A IA respondeu num formato que não consegui ler. Tente de novo.',
      );
    }

    const questions: CreateQuestionDto[] = [];
    let discarded = 0;

    for (const item of raw) {
      const question = toQuestion(item, input.difficulty);

      if (question === null) {
        discarded += 1;
        continue;
      }

      // **Nunca mais do que o pedido.** Um modelo generoso que devolvesse 50
      // faria o admin revisar 50 e o `bulk` recusar o lote inteiro por teto,
      // depois do trabalho todo.
      if (questions.length < input.count) {
        questions.push(question);
      }
    }

    return { questions, discarded };
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
 * Le o array, tolerando a cerca de markdown.
 *
 * O modelo devolve ```json ... ``` com frequencia, mesmo instruido a nao
 * devolver. Recusar isso seria transformar um formato previsivel em falha.
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
 * Uma questao do modelo virando `CreateQuestionDto`, ou `null`.
 *
 * **A dificuldade e a que o admin pediu, nunca a que o modelo devolveu.** Ele
 * pediu "difícil" e e nisso que a questao entra; aceitar o campo do modelo faria
 * trinta questoes pedidas como dificeis caírem em fácil e desequilibrar a
 * rodada 1 sem ninguem perceber.
 */
function toQuestion(
  item: unknown,
  difficulty: Difficulty,
): CreateQuestionDto | null {
  if (typeof item !== 'object' || item === null) {
    return null;
  }

  const { question, alternatives, correctIndex } = item as {
    question?: unknown;
    alternatives?: unknown;
    correctIndex?: unknown;
  };

  if (typeof question !== 'string' || question.trim().length === 0) {
    return null;
  }

  if (!Array.isArray(alternatives) || alternatives.length !== 4) {
    return null;
  }

  const texts = alternatives.map((alternative) =>
    typeof alternative === 'string' ? alternative.trim() : '',
  );

  if (texts.some((alternative) => alternative.length === 0)) {
    return null;
  }

  if (
    typeof correctIndex !== 'number' ||
    !Number.isInteger(correctIndex) ||
    correctIndex < 0 ||
    correctIndex > 3
  ) {
    return null;
  }

  return {
    difficulty,
    question: question.trim(),
    alternatives: texts,
    correctIndex,
  };
}
