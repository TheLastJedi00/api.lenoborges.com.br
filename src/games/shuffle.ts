/**
 * Fisher-Yates com a fonte de aleatoriedade injetavel (spec 022, decisao 4).
 *
 * **Injetavel para o teste ser deterministico**, e nao por elegancia: um sorteio
 * que so pode ser observado por amostragem e um sorteio que ninguem prova estar
 * certo, e o defeito classico do `sort(() => Math.random() - 0.5)` -- que
 * parece embaralhar, passa em qualquer teste de "a ordem mudou", e produz uma
 * distribuicao enviesada que so aparece contando milhares de execucoes.
 *
 * Devolve um array novo: embaralhar no lugar mudaria a lista que o chamador
 * ainda vai usar para outra coisa.
 */
export type RandomSource = () => number;

export function shuffle<T>(
  items: readonly T[],
  random: RandomSource = Math.random,
): T[] {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/**
 * Sorteia `n` itens distintos, sem repetir.
 *
 * Embaralha e corta, em vez de sortear com reposicao e descartar repetidos: com
 * 10 de 30 a segunda abordagem repete o suficiente para custar dezenas de
 * tentativas, e com 10 de 10 ela nunca termina.
 *
 * Pedir mais do que existe devolve tudo o que existe -- e quem decide se isso e
 * suficiente e o service, que conhece o minimo de 30 por nivel.
 */
export function sample<T>(
  items: readonly T[],
  n: number,
  random: RandomSource = Math.random,
): T[] {
  return shuffle(items, random).slice(0, Math.max(0, n));
}

/**
 * Embaralha as alternativas **carregando o indice da correta junto**.
 *
 * E a unica forma segura de fazer isso, e a razao esta no que acontece quando
 * nao se faz: embaralhar a lista e deixar o `correctIndex` original vale dizer
 * que a resposta certa e a que estava na posicao 2 de uma lista que nao existe
 * mais. O membro clica na alternativa certa e o servidor responde "errou" --
 * sem erro, sem log, e para uma fracao aleatoria das questoes.
 *
 * Devolve o texto embaralhado e **onde a certa foi parar**.
 */
export function shuffleAlternatives(
  alternatives: readonly string[],
  correctIndex: number,
  random: RandomSource = Math.random,
): { alternatives: string[]; correctAlternativeIndex: number } {
  // Embaralha os indices, e nao os textos: assim a posicao nova da correta sai
  // de graca, sem comparar strings -- e comparar strings quebraria no dia em que
  // duas alternativas tivessem o mesmo texto.
  const order = shuffle(
    alternatives.map((_, index) => index),
    random,
  );

  return {
    alternatives: order.map((index) => alternatives[index]),
    correctAlternativeIndex: order.indexOf(correctIndex),
  };
}
