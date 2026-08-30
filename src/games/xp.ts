import {
  CLIENT_ELAPSED_TOLERANCE_SECONDS,
  FREE_SECONDS,
  MIN_XP_PER_ANSWER,
  XP_PER_CORRECT_ANSWER,
} from './games.constants';

/**
 * Os dois relogios de uma resposta (spec 022, decisao 3).
 *
 * `serverSeconds` e `submittedAt - servedAt`, medido aqui. `clientElapsedMs` e o
 * que o front cronometrou entre pintar a questao e o dedo tocar a alternativa --
 * e chega `null` quando o cliente nao mandou.
 */
export interface ElapsedInput {
  serverSeconds: number;
  clientElapsedMs: number | null;
}

/**
 * Qual dos dois relogios vale, e por que quase sempre e o do cliente.
 *
 * **O tempo do servidor inclui a rede, e a rede nao e tempo de pensar.** Entre o
 * clique e o `submittedAt` cabe uma viagem inteira de requisicao, e cobrar isso
 * do membro faria a mesma resposta valer menos no 4G do onibus do que no wi-fi
 * de casa. O `min` dos dois e o que garante que a latencia nunca custa XP.
 *
 * O tempo do cliente e **conferido, nao confiado**: ele so entra se estiver
 * entre zero e `serverSeconds + CLIENT_ELAPSED_TOLERANCE_SECONDS`. A folga cobre
 * relogio dessincronizado, e nao rede -- rede so faz o servidor medir mais, e
 * medir mais nunca prejudica ninguem aqui.
 *
 * **O que isto nao protege**: um cliente adulterado que manda `0`. Isso e
 * conhecido e aceito. A alternativa seria ignorar o cliente, e ai a rede lenta
 * roubaria XP de todo mundo que joga honesto -- um dano certo e distribuido para
 * evitar um dano possivel e individual.
 */
export function resolveElapsedSeconds({
  serverSeconds,
  clientElapsedMs,
}: ElapsedInput): number {
  // `submittedAt - servedAt` nao deveria sair negativo, mas um documento escrito
  // por um caminho que ninguem previu pagaria acima do teto la na frente.
  const server = Math.max(0, serverSeconds);

  if (clientElapsedMs === null || !Number.isFinite(clientElapsedMs)) {
    return server;
  }

  const client = clientElapsedMs / 1000;
  const ceiling = server + CLIENT_ELAPSED_TOLERANCE_SECONDS;

  if (client < 0 || client > ceiling) {
    return server;
  }

  return Math.min(server, client);
}

/**
 * O XP de uma questao acertada (spec 022, decisao 3).
 *
 * ```
 * tempoReal  = min(tempoServidor, tempoCliente)
 * penalidade = max(0, floor(tempoReal) - 5)
 * xpGanho    = max(1, 50 - penalidade)
 * ```
 *
 * **Pura, sem Firestore e sem Nest**, porque e a regra mais copiavel da spec e a
 * mais facil de duplicar errado: um segundo `Math.max` escrito dentro do service
 * divergiria deste no dia em que o piso mudasse, e ninguem veria -- o XP so
 * ficaria um pouco diferente.
 *
 * **Errar nao chama esta funcao.** Questao errada nao perde XP nenhum, nem da
 * questao nem do acumulado (decisao 3), entao o caminho do erro nao passa por
 * aqui em vez de passar pedindo zero.
 */
export function computeXp(input: ElapsedInput): number {
  const elapsed = resolveElapsedSeconds(input);

  // Segundo completo, e nao fracao: a penalidade por 6.9s e a mesma de 6s. XP
  // quebrado na tela nao significa nada para quem esta jogando.
  const penalty = Math.max(0, Math.floor(elapsed) - FREE_SECONDS);

  return Math.max(MIN_XP_PER_ANSWER, XP_PER_CORRECT_ANSWER - penalty);
}
