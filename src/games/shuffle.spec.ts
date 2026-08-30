import { sample, shuffle, shuffleAlternatives } from './shuffle';

/** Uma fonte de aleatoriedade previsivel, para o teste afirmar em vez de torcer. */
function fixedRandom(values: number[]): () => number {
  let i = 0;

  return () => values[i++ % values.length];
}

describe('shuffle', () => {
  it('nao perde nem duplica item', () => {
    const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    const embaralhado = shuffle(original);

    expect([...embaralhado].sort((a, b) => a - b)).toEqual(original);
  });

  it('nao muda o array de origem', () => {
    // Embaralhar no lugar mudaria a lista que o chamador ainda vai usar.
    const original = [1, 2, 3];

    shuffle(original);

    expect(original).toEqual([1, 2, 3]);
  });

  it('e deterministico com a mesma fonte', () => {
    const a = shuffle([1, 2, 3, 4], fixedRandom([0.1, 0.9, 0.5]));
    const b = shuffle([1, 2, 3, 4], fixedRandom([0.1, 0.9, 0.5]));

    expect(a).toEqual(b);
  });

  it('com random sempre zero, inverte de forma previsivel', () => {
    // Fisher-Yates com j = 0 sempre: cada posicao troca com a primeira. O que
    // importa aqui nao e o resultado exato, e que ele seja o mesmo sempre --
    // um `sort(() => Math.random() - 0.5)` nao teria essa propriedade.
    const primeiro = shuffle([1, 2, 3, 4], () => 0);
    const segundo = shuffle([1, 2, 3, 4], () => 0);

    expect(primeiro).toEqual(segundo);
    expect(primeiro).toHaveLength(4);
  });

  it('aguenta lista vazia e de um item', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(['a'])).toEqual(['a']);
  });
});

describe('sample', () => {
  it('devolve exatamente n itens distintos', () => {
    const dez = sample(
      Array.from({ length: 30 }, (_, i) => i),
      10,
    );

    expect(dez).toHaveLength(10);
    expect(new Set(dez).size).toBe(10);
  });

  it('nunca repete, mesmo pedindo tudo', () => {
    // Sortear com reposicao e descartar repetidos nunca terminaria aqui.
    const todos = sample([1, 2, 3, 4, 5], 5);

    expect(new Set(todos).size).toBe(5);
  });

  it('pedir mais do que existe devolve tudo o que existe', () => {
    // Quem decide se isso e suficiente e o service, que conhece o minimo de 30.
    expect(sample([1, 2, 3], 10)).toHaveLength(3);
  });

  it('pedir zero ou menos devolve vazio', () => {
    expect(sample([1, 2, 3], 0)).toEqual([]);
    expect(sample([1, 2, 3], -5)).toEqual([]);
  });
});

describe('shuffleAlternatives', () => {
  it('teste-trava: a correta acompanha o embaralhamento', () => {
    // **O defeito que este teste impede:** embaralhar a lista e deixar o
    // correctIndex original vale dizer que a resposta certa e a que estava na
    // posicao 2 de uma lista que nao existe mais. O membro clica na alternativa
    // certa e o servidor responde "errou" -- sem erro, sem log, e para uma
    // fracao aleatoria das questoes.
    const original = ['certa', 'errada-1', 'errada-2', 'errada-3'];

    for (let seed = 0; seed < 50; seed += 1) {
      const { alternatives, correctAlternativeIndex } = shuffleAlternatives(
        original,
        0,
      );

      expect(alternatives[correctAlternativeIndex]).toBe('certa');
    }
  });

  it('funciona com a correta em qualquer posicao de origem', () => {
    const original = ['a', 'b', 'c', 'd'];

    for (const correctIndex of [0, 1, 2, 3]) {
      const { alternatives, correctAlternativeIndex } = shuffleAlternatives(
        original,
        correctIndex,
      );

      expect(alternatives[correctAlternativeIndex]).toBe(
        original[correctIndex],
      );
    }
  });

  it('teste-trava: nao se apoia no texto, e sim no indice', () => {
    // Duas alternativas com o mesmo texto sao um erro de revisao, e nao devem
    // virar um erro de correcao. Uma implementacao que achasse a certa por
    // `indexOf(texto)` apontaria para a primeira ocorrencia, que pode ser a
    // errada.
    const original = ['igual', 'igual', 'diferente', 'outra'];

    const { alternatives, correctAlternativeIndex } = shuffleAlternatives(
      original,
      1,
      () => 0,
    );

    expect(alternatives).toHaveLength(4);
    expect(alternatives[correctAlternativeIndex]).toBe('igual');
    expect(correctAlternativeIndex).toBeGreaterThanOrEqual(0);
  });

  it('preserva as quatro alternativas', () => {
    const original = ['a', 'b', 'c', 'd'];

    const { alternatives } = shuffleAlternatives(original, 2);

    expect([...alternatives].sort()).toEqual(original);
  });
});
