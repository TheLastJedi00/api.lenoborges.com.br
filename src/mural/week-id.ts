import { MURAL_TIMEZONE } from './mural.constants';

/**
 * O relógio do Mural.
 *
 * **A virada é uma conta, não um cron.** Cada pergunta guarda o `weekId` da
 * semana em que nasceu, e o estado dela nunca é gravado: é derivado na leitura,
 * comparando o `weekId` dela com o de agora.
 *
 * A alternativa era um agendador que, toda madrugada de domingo, varresse as
 * perguntas e mudasse `status`. Ele custaria um agendador para configurar, um
 * deploy para não esquecer, e — a parte cara — **um estado que pode ficar
 * errado**: cron que não roda deixa o mural congelado no domingo passado, sem
 * erro, sem alarme, e a primeira pessoa a perceber é um aluno. Uma conta não tem
 * como não rodar.
 *
 * Ver a decisão 1 da spec 010.
 */

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: MURAL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** A data civil em São Paulo, mais o dia da semana. */
function saoPauloDate(date: Date): {
  y: number;
  m: number;
  d: number;
  weekday: number;
} {
  const parts = PARTS.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;

  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    weekday: WEEKDAY_INDEX[get('weekday')],
  };
}

/**
 * O domingo que abre a semana de uma data, como `YYYY-MM-DD`.
 *
 * O identificador é a **data do domingo**, e não um número de semana ISO. A
 * razão é que numeração de semana tem regras diferentes por padrão (ISO começa
 * na segunda, a semana 1 depende de onde cai a quinta) e é onde a virada de ano
 * quebra em silêncio. Uma data é uma data em qualquer dezembro.
 */
export function weekIdOf(date: Date): string {
  const { y, m, d, weekday } = saoPauloDate(date);

  // UTC aqui é só aritmética de calendário: a data civil já foi resolvida no
  // fuso certo acima, e usar UTC evita o fuso do processo entrar na conta.
  const civil = Date.UTC(y, m - 1, d);
  const sunday = new Date(civil - weekday * 86_400_000);

  return sunday.toISOString().slice(0, 10);
}

/** O `weekId` da semana anterior — a que está em votação. */
export function previousWeekId(weekId: string): string {
  const sunday = new Date(`${weekId}T00:00:00.000Z`);
  return new Date(sunday.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Deslocamento do fuso, em minutos, no instante dado.
 *
 * Calculado a partir da propria formatacao em vez de constante: `-180` esta
 * certo hoje e estaria errado se o horario de verao voltasse -- e o sintoma
 * seria um contador tres horas fora, que ninguem associa a um numero magico
 * escrito em 2026.
 */
function offsetMinutes(instant: Date): number {
  const local = new Date(
    instant.toLocaleString('en-US', { timeZone: MURAL_TIMEZONE }),
  );
  const utc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));

  return Math.round((local.getTime() - utc.getTime()) / 60_000);
}

/**
 * O instante exato em que a semana vira, em UTC. Serve ao contador do front.
 *
 * **Nao e meia-noite UTC**, e esse e o erro facil: a virada e meia-noite em Sao
 * Paulo, que hoje sao 03:00 UTC. Um contador construido sobre meia-noite UTC
 * erra por tres horas e so aparece para quem olha a tela de madrugada.
 *
 * A segunda passada existe para o caso de o proprio deslocamento mudar entre o
 * palpite e o resultado, que e o que aconteceria numa virada de horario de
 * verao.
 */
export function weekEndsAt(weekId: string): Date {
  const nextSundayUtc = new Date(
    new Date(`${weekId}T00:00:00.000Z`).getTime() + 7 * 86_400_000,
  );

  const primeira = new Date(
    nextSundayUtc.getTime() - offsetMinutes(nextSundayUtc) * 60_000,
  );

  return new Date(nextSundayUtc.getTime() - offsetMinutes(primeira) * 60_000);
}
