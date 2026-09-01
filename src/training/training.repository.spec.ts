import { FirebaseService } from '../auth/firebase.service';
import { FakeFirestore } from '../track/testing/fake-firestore';
import { DEFAULT_TRAINING_XP } from './training.constants';
import { TRAINING_COLLECTION, TrainingRepository } from './training.repository';

/**
 * Contra o `fake-firestore` da spec 019, e não contra `jest.fn()`.
 *
 * O que este repositório promete não é "chamou `batch.update` três vezes": é que
 * **as posições resultantes são 0..n-1 na ordem pedida**, e que um lote que
 * falha no meio não deixa duas posições iguais. Um mock prova a chamada; só um
 * armazenamento que se comporta prova o resultado.
 */
describe('TrainingRepository', () => {
  let firestore: FakeFirestore;
  let repository: TrainingRepository;

  beforeEach(() => {
    firestore = new FakeFirestore();
    repository = new TrainingRepository({
      firestore,
    } as unknown as FirebaseService);
  });

  async function criar(titulo: string, position: number, badgeId = 'logica') {
    const { entry } = await repository.create({
      badgeId: badgeId as 'logica',
      title: titulo,
      description: 'Descrição',
      steps: ['Passo um'],
      position,
    });

    return entry;
  }

  describe('create', () => {
    it('devolve o treinamento com o id do documento gerado', async () => {
      const entry = await criar('Primeiro', 0);

      expect(entry.id).toBeTruthy();
      expect(firestore.raw(`${TRAINING_COLLECTION}/${entry.id}`)).toBeDefined();
    });

    it('nasce com o XP padrão quando o admin não informa outro', async () => {
      const entry = await criar('Primeiro', 0);

      expect(entry.xpAmount).toBe(DEFAULT_TRAINING_XP);
    });

    it('respeita o XP que o admin escreveu', async () => {
      const { entry } = await repository.create({
        badgeId: 'logica',
        title: 'Um desafio longo',
        description: 'Descrição',
        steps: ['Passo um'],
        position: 0,
        xpAmount: 80,
      });

      expect(entry.xpAmount).toBe(80);
    });

    it('nasce sem vídeo quando nenhum foi anexado', async () => {
      expect((await criar('Primeiro', 0)).videoUrl).toBeNull();
    });
  });

  describe('listByBadge', () => {
    it('devolve `{ entries }`, e não a lista crua', async () => {
      const resultado = await repository.listByBadge('logica');

      expect(resultado).toEqual({ entries: [] });
    });

    it('devolve na ordem de `position`, e não na de criação', async () => {
      await criar('Terceiro', 2);
      await criar('Primeiro', 0);
      await criar('Segundo', 1);

      const { entries } = await repository.listByBadge('logica');

      expect(entries.map((item) => item.title)).toEqual([
        'Primeiro',
        'Segundo',
        'Terceiro',
      ]);
    });

    it('não mistura insígnias', async () => {
      await criar('Da lógica', 0, 'logica');
      await criar('Da POO', 0, 'poo');

      const { entries } = await repository.listByBadge('poo');

      expect(entries.map((item) => item.title)).toEqual(['Da POO']);
    });
  });

  describe('findById', () => {
    it('devolve `{ found: false, entry: null }` quando não existe', async () => {
      expect(await repository.findById('nao-existe')).toEqual({
        found: false,
        entry: null,
      });
    });

    it('devolve o treinamento quando existe', async () => {
      const criado = await criar('Primeiro', 0);

      const { found, entry } = await repository.findById(criado.id);

      expect(found).toBe(true);
      expect(entry?.title).toBe('Primeiro');
    });
  });

  describe('update', () => {
    it('avisa que não encontrou, em vez de estourar', async () => {
      expect(await repository.update('nao-existe', { title: 'x' })).toEqual({
        found: false,
        entry: null,
      });
    });

    it('grava o campo e devolve o treinamento já atualizado', async () => {
      const criado = await criar('Título velho', 0);

      const { entry } = await repository.update(criado.id, {
        title: 'Título novo',
        steps: ['Um', 'Dois'],
      });

      expect(entry?.title).toBe('Título novo');
      expect(entry?.steps).toEqual(['Um', 'Dois']);
    });
  });

  describe('reorder', () => {
    /**
     * **A propriedade, e não a chamada.**
     *
     * O que interessa é que as posições finais sejam 0..n-1 na ordem recebida.
     * Um `jest.fn()` provaria que `batch.update` rodou três vezes e continuaria
     * verde com as três gravando a mesma posição.
     */
    it('renormaliza para 0..n-1 na ordem recebida', async () => {
      const a = await criar('A', 0);
      const b = await criar('B', 1);
      const c = await criar('C', 2);

      await repository.reorder([c.id, a.id, b.id]);

      const { entries } = await repository.listByBadge('logica');

      expect(entries.map((item) => item.title)).toEqual(['C', 'A', 'B']);
      expect(entries.map((item) => item.position)).toEqual([0, 1, 2]);
    });

    /**
     * O lote é atômico, e é isso que impede a lista meio reordenada.
     *
     * Um id que não existe derruba o `commit()` inteiro no Firestore, e o fake
     * reproduz isso: **nenhuma** posição muda. Sem a atomicidade, os dois
     * primeiros teriam gravado e a lista ficaria com duas posições iguais, sem
     * erro para ninguém.
     */
    it('não move nada quando um dos ids não existe', async () => {
      const a = await criar('A', 0);
      const b = await criar('B', 1);

      await expect(
        repository.reorder([b.id, 'fantasma', a.id]),
      ).rejects.toMatchObject({ code: 5 });

      const { entries } = await repository.listByBadge('logica');

      expect(entries.map((item) => item.title)).toEqual(['A', 'B']);
    });

    it('não chama o banco com lista vazia', async () => {
      await expect(repository.reorder([])).resolves.toBeUndefined();
    });
  });

  describe('delete', () => {
    it('some com o documento', async () => {
      const criado = await criar('Primeiro', 0);

      await repository.delete(criado.id);

      expect(await repository.findById(criado.id)).toEqual({
        found: false,
        entry: null,
      });
    });
  });
});
