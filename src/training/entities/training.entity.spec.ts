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
    steps: ['Clone o repositório', 'Rode os testes', 'Extraia as funções'],
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
        steps: ['Clone o repositório', 'Rode os testes', 'Extraia as funções'],
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
        steps: ['Passo único'],
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
     * **`steps` é array e continua array.**
     *
     * Se o converter achatasse os passos num texto -- por conveniência de
     * exibição, que é a tentação -- a edição passo a passo do admin deixaria de
     * existir e a lista `<ol>` da tela viraria um `<p>` com quebras de linha.
     */
    it('preserva os passos como array, na ordem em que foram escritos', () => {
      const gravado = trainingConverter.toFirestore({
        id: 'trn-001',
        badgeId: 'logica',
        title: 'Título',
        description: 'Descrição',
        steps: ['Primeiro', 'Segundo', 'Terceiro'],
        videoUrl: null,
        xpAmount: DEFAULT_TRAINING_XP,
        position: 0,
        createdAt: AGORA,
        updatedAt: AGORA,
      });

      expect(gravado.steps).toEqual(['Primeiro', 'Segundo', 'Terceiro']);
      expect(trainingConverter.fromFirestore(snapshot(gravado)).steps).toEqual([
        'Primeiro',
        'Segundo',
        'Terceiro',
      ]);
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
    it('lê `steps` como lista vazia em vez de `undefined`', () => {
      const documento = documentoBase();
      delete (documento as Record<string, unknown>).steps;

      expect(
        trainingConverter.fromFirestore(snapshot(documento)).steps,
      ).toEqual([]);
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
