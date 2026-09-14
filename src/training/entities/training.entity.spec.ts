import { QueryDocumentSnapshot, Timestamp } from 'firebase-admin/firestore';
import { Training, trainingConverter } from './training.entity';
import { DEFAULT_TRAINING_XP } from '../training.constants';

/**
 * Um snapshot com a superfície exata que o converter usa: `id` e `data()`.
 *
 * O `unknown` no meio é deliberado, pela mesma razão do
 * `badge-video.entity.spec.ts`: metade destes documentos é escrita **sem** os
 * campos que o teste existe para conferir, e tipar a entrada faria o compilador
 * exigir justamente o que precisa faltar.
 */
function snapshot(data: Record<string, unknown>): QueryDocumentSnapshot {
  return {
    id: 'trn-001',
    data: () => data,
  } as unknown as QueryDocumentSnapshot;
}

const AGORA = new Date('2026-09-01T12:00:00.000Z');
const AGORA_TS = Timestamp.fromDate(AGORA);

function documentoBase(extra: Record<string, unknown> = {}) {
  return {
    badgeId: 'logica',
    title: 'Refatore o laço em três funções',
    description: 'Um exercício de leitura antes de escrever.',
    objective: 'Um laço lido de cima a baixo sem rolar a tela.',
    hints: [
      'Repare quantas responsabilidades o laço acumula.',
      'Uma delas dá nome a uma função sozinha.',
      'Extraia a menor primeiro, e rode os testes.',
    ],
    videoUrl: null,
    xpAmount: DEFAULT_TRAINING_XP,
    position: 0,
    createdAt: AGORA_TS,
    updatedAt: AGORA_TS,
    ...extra,
  };
}

describe('trainingConverter', () => {
  describe('ida e volta', () => {
    it('devolve o mesmo treinamento que gravou', () => {
      const training: Training = {
        id: 'trn-001',
        badgeId: 'logica',
        title: 'Refatore o laço em três funções',
        description: 'Um exercício de leitura antes de escrever.',
        objective: 'Um laço lido de cima a baixo sem rolar a tela.',
        hints: [
          'Repare quantas responsabilidades o laço acumula.',
          'Uma delas dá nome a uma função sozinha.',
        ],
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        xpAmount: 45,
        position: 2,
        createdAt: AGORA,
        updatedAt: AGORA,
      };

      const gravado = trainingConverter.toFirestore(training);
      const lido = trainingConverter.fromFirestore(snapshot(gravado));

      expect(lido).toEqual(training);
    });

    it('grava as datas como Timestamp, que é o que o Firestore ordena', () => {
      const gravado = trainingConverter.toFirestore({
        id: 'trn-001',
        badgeId: 'logica',
        title: 'Título',
        description: 'Descrição',
        objective: 'Objetivo',
        hints: ['Dica única'],
        videoUrl: null,
        xpAmount: DEFAULT_TRAINING_XP,
        position: 0,
        createdAt: AGORA,
        updatedAt: AGORA,
      });

      expect(gravado.createdAt).toBeInstanceOf(Timestamp);
      expect(gravado.updatedAt).toBeInstanceOf(Timestamp);
    });

    /**
     * **`hints` é array e continua array, e a ordem é o produto.**
     *
     * Se o converter achatasse as dicas num texto -- por conveniência de
     * exibição, que é a tentação -- a edição dica a dica do admin deixaria de
     * existir, e a revelação sequencial de uma por vez, que é o que cobra o
     * 1 XP, não teria mais item nenhum para contar.
     */
    it('preserva as dicas como array, na ordem em que foram escritas', () => {
      const gravado = trainingConverter.toFirestore({
        id: 'trn-001',
        badgeId: 'logica',
        title: 'Título',
        description: 'Descrição',
        objective: 'Objetivo',
        hints: ['Primeira', 'Segunda', 'Terceira'],
        videoUrl: null,
        xpAmount: DEFAULT_TRAINING_XP,
        position: 0,
        createdAt: AGORA,
        updatedAt: AGORA,
      });

      expect(gravado.hints).toEqual(['Primeira', 'Segunda', 'Terceira']);
      expect(trainingConverter.fromFirestore(snapshot(gravado)).hints).toEqual([
        'Primeira',
        'Segunda',
        'Terceira',
      ]);
    });

    /**
     * **O `toFirestore` grava `hints` e não grava `steps`** (spec 025).
     *
     * Gravar os dois seria a saída preguiçosa da renomeação, e ela custa caro
     * mais tarde: dois campos com o mesmo conteúdo divergem na primeira edição
     * feita por um caminho que só conhece um deles, e a partir daí ninguém sabe
     * qual dos dois a tela está lendo.
     */
    it('não emite `steps` no documento gravado', () => {
      const gravado = trainingConverter.toFirestore({
        id: 'trn-001',
        badgeId: 'logica',
        title: 'Título',
        description: 'Descrição',
        objective: 'Objetivo',
        hints: ['Primeira'],
        videoUrl: null,
        xpAmount: DEFAULT_TRAINING_XP,
        position: 0,
        createdAt: AGORA,
        updatedAt: AGORA,
      });

      expect('steps' in gravado).toBe(false);
    });
  });

  /**
   * Os testes-trava dos documentos incompletos.
   *
   * **É o que impede um treinamento de sumir em silêncio.** Um `steps`
   * indefinido estoura no `.map` da tela e derruba a seção inteira; um
   * `xpAmount` indefinido vira `NaN` no incremento e contamina o contador do
   * membro para sempre, porque `NaN` não volta a ser número com nenhuma soma
   * seguinte. Nos dois casos não há erro em log nenhum -- só um número errado.
   */
  describe('documento gravado sem os campos opcionais', () => {
    it('lê `hints` como lista vazia em vez de `undefined`', () => {
      const documento = documentoBase();
      delete (documento as Record<string, unknown>).hints;

      expect(
        trainingConverter.fromFirestore(snapshot(documento)).hints,
      ).toEqual([]);
    });

    /**
     * **A migração inteira da spec 025 é este teste.**
     *
     * Todo treinamento criado pela spec 023 tem `steps` e não tem `hints`, e
     * nenhum script vai passar neles. Sem este fallback, a Arena aparece com o
     * desafio certo e **zero dicas** -- 200, sem erro em log nenhum, e o único
     * a perceber é o membro que travou e não tinha onde se apoiar.
     */
    it('lê o `steps` de um documento anterior à spec 025 como `hints`', () => {
      const documento = documentoBase();
      delete (documento as Record<string, unknown>).hints;
      (documento as Record<string, unknown>).steps = [
        'Clone o repositório',
        'Rode os testes',
      ];

      expect(
        trainingConverter.fromFirestore(snapshot(documento)).hints,
      ).toEqual(['Clone o repositório', 'Rode os testes']);
    });

    it('prefere `hints` quando o documento tem os dois campos', () => {
      const documento = documentoBase({ hints: ['A dica nova'] });
      (documento as Record<string, unknown>).steps = ['O passo velho'];

      expect(
        trainingConverter.fromFirestore(snapshot(documento)).hints,
      ).toEqual(['A dica nova']);
    });

    it('lê `objective` como texto vazio num documento legado', () => {
      const documento = documentoBase();
      delete (documento as Record<string, unknown>).objective;

      expect(
        trainingConverter.fromFirestore(snapshot(documento)).objective,
      ).toBe('');
    });

    it('lê `videoUrl` como nulo quando o campo não existe', () => {
      const documento = documentoBase();
      delete (documento as Record<string, unknown>).videoUrl;

      expect(
        trainingConverter.fromFirestore(snapshot(documento)).videoUrl,
      ).toBeNull();
    });

    it('lê `xpAmount` como 30 num documento legado, e nunca `undefined`', () => {
      const documento = documentoBase();
      delete (documento as Record<string, unknown>).xpAmount;

      const lido = trainingConverter.fromFirestore(snapshot(documento));

      expect(lido.xpAmount).toBe(DEFAULT_TRAINING_XP);
      expect(Number.isNaN(lido.xpAmount)).toBe(false);
    });

    it('lê `description` como texto vazio, e não `undefined`', () => {
      const documento = documentoBase();
      delete (documento as Record<string, unknown>).description;

      expect(
        trainingConverter.fromFirestore(snapshot(documento)).description,
      ).toBe('');
    });
  });
});
