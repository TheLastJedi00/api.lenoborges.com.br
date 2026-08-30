import type { WriteBatch } from 'firebase-admin/firestore';
import { FakeFirestore } from '../track/testing/fake-firestore';
import { FirebaseService } from '../auth/firebase.service';
import { RankingRepository } from './ranking.repository';

function makeRepository(): {
  repository: RankingRepository;
  firestore: FakeFirestore;
} {
  const firestore = new FakeFirestore();

  return {
    repository: new RankingRepository({
      firestore,
    } as unknown as FirebaseService),
    firestore,
  };
}

async function seed(
  repository: RankingRepository,
  rows: { uid: string; xp: number; badgeCount?: number }[],
) {
  for (const row of rows) {
    await repository.upsert({
      uid: row.uid,
      nickname: row.uid.toUpperCase(),
      xp: row.xp,
      badgeCount: row.badgeCount ?? 0,
    });
  }
}

describe('RankingRepository', () => {
  describe('page', () => {
    it('ordena por XP decrescente', async () => {
      const { repository } = makeRepository();
      await seed(repository, [
        { uid: 'a', xp: 100 },
        { uid: 'b', xp: 900 },
        { uid: 'c', xp: 500 },
      ]);

      const { entries } = await repository.page({ limit: 10 });

      expect(entries.map((entry) => entry.uid)).toEqual(['b', 'c', 'a']);
    });

    it('desempata por uid crescente', async () => {
      const { repository } = makeRepository();
      await seed(repository, [
        { uid: 'zeta', xp: 500 },
        { uid: 'alfa', xp: 500 },
      ]);

      const { entries } = await repository.page({ limit: 10 });

      expect(entries.map((entry) => entry.uid)).toEqual(['alfa', 'zeta']);
    });

    it('respeita o limite', async () => {
      const { repository } = makeRepository();
      await seed(
        repository,
        Array.from({ length: 10 }, (_, i) => ({ uid: `u${i}`, xp: i * 10 })),
      );

      const { entries } = await repository.page({ limit: 3 });

      expect(entries).toHaveLength(3);
    });

    it('teste-trava: a paginacao nao pula nem repete com XP empatado', async () => {
      // **A razao do indice `xp DESC + uid ASC`.** XP empata com frequencia --
      // dois membros que assistiram aos mesmos videos tem o mesmo numero -- e um
      // startAfter sobre campo nao unico pula ou repete linha. O sintoma e um
      // placar que perde alguem no meio da rolagem, sem erro e com 200.
      const { repository } = makeRepository();
      await seed(repository, [
        { uid: 'a', xp: 500 },
        { uid: 'b', xp: 500 },
        { uid: 'c', xp: 500 },
        { uid: 'd', xp: 500 },
        { uid: 'e', xp: 100 },
      ]);

      const primeira = await repository.page({ limit: 2 });
      const ultima = primeira.entries[primeira.entries.length - 1];
      const segunda = await repository.page({
        limit: 2,
        after: { xp: ultima.xp, uid: ultima.uid },
      });
      const terceira = await repository.page({
        limit: 2,
        after: {
          xp: segunda.entries[segunda.entries.length - 1].xp,
          uid: segunda.entries[segunda.entries.length - 1].uid,
        },
      });

      const todos = [
        ...primeira.entries,
        ...segunda.entries,
        ...terceira.entries,
      ].map((entry) => entry.uid);

      expect(todos).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(new Set(todos).size).toBe(5);
    });

    it('a pagina depois da ultima vem vazia', async () => {
      const { repository } = makeRepository();
      await seed(repository, [{ uid: 'a', xp: 100 }]);

      const { entries } = await repository.page({
        limit: 10,
        after: { xp: 100, uid: 'a' },
      });

      expect(entries).toEqual([]);
    });
  });

  describe('upsert', () => {
    it('teste-trava: nao apaga a posicao de ontem ao somar XP', async () => {
      // O upsert e chamado a cada ganho de XP, e as posicoes so mudam no
      // snapshot diario. Sobrescrever `previousPosition` com null aqui apagaria
      // o selo de evolucao de todo mundo que ganhasse XP no dia.
      const { repository } = makeRepository();
      await seed(repository, [{ uid: 'a', xp: 100 }]);
      await repository.savePositions([
        { uid: 'a', currentPosition: 3, previousPosition: 7 },
      ]);

      await repository.upsert({
        uid: 'a',
        nickname: 'A',
        xp: 150,
        badgeCount: 1,
      });

      const { entry } = await repository.findByUid('a');
      expect(entry!.xp).toBe(150);
      expect(entry!.currentPosition).toBe(3);
      expect(entry!.previousPosition).toBe(7);
    });

    it('atualiza o nickname e a contagem de insignias', async () => {
      const { repository } = makeRepository();

      await repository.upsert({
        uid: 'a',
        nickname: 'LenoDev',
        xp: 10,
        badgeCount: 2,
      });

      const { entry } = await repository.findByUid('a');
      expect(entry!.nickname).toBe('LenoDev');
      expect(entry!.badgeCount).toBe(2);
    });
  });

  describe('addXpToBatch', () => {
    it('soma no mesmo lote de quem paga o XP', async () => {
      const { repository, firestore } = makeRepository();
      await seed(repository, [{ uid: 'a', xp: 100 }]);

      // O fake e estruturalmente compativel com o que o repositorio usa do lote; o
      // cast existe porque o tipo do firebase-admin e generico nas refs.
      const batch = firestore.batch() as unknown as WriteBatch;
      repository.addXpToBatch(batch, 'a', true, 47, 100);
      await batch.commit();

      const { entry } = await repository.findByUid('a');
      expect(entry!.xp).toBe(147);
    });

    it('teste-trava: nao cria linha para quem nao esta no placar', async () => {
      // **Increment num documento inexistente o criaria sem nickname**, e o
      // placar ganharia uma linha em branco de quem nunca escolheu gamertag --
      // exatamente quem a decisao 20 mantem fora.
      const { repository, firestore } = makeRepository();

      // O fake e estruturalmente compativel com o que o repositorio usa do lote; o
      // cast existe porque o tipo do firebase-admin e generico nas refs.
      const batch = firestore.batch() as unknown as WriteBatch;
      repository.addXpToBatch(batch, 'sem-linha', false, 47, 0);
      await batch.commit();

      await expect(repository.findByUid('sem-linha')).resolves.toEqual({
        found: false,
        entry: null,
      });
    });

    it('nao escreve quando o XP e zero', async () => {
      // Resposta errada e replay pagam zero, e um update por nada e uma escrita
      // cobrada em toda questao errada da base.
      const { repository, firestore } = makeRepository();
      await seed(repository, [{ uid: 'a', xp: 100 }]);
      const antes = firestore.raw('ranking/a')!.updatedAt;

      // O fake e estruturalmente compativel com o que o repositorio usa do lote; o
      // cast existe porque o tipo do firebase-admin e generico nas refs.
      const batch = firestore.batch() as unknown as WriteBatch;
      repository.addXpToBatch(batch, 'a', true, 0, 100);
      await batch.commit();

      expect(firestore.raw('ranking/a')!.updatedAt).toBe(antes);
    });
  });

  describe('savePositions e remove', () => {
    it('grava as posicoes recalculadas', async () => {
      const { repository } = makeRepository();
      await seed(repository, [{ uid: 'a', xp: 100 }]);

      await repository.savePositions([
        { uid: 'a', currentPosition: 1, previousPosition: 4 },
      ]);

      const { entry } = await repository.findByUid('a');
      expect(entry!.currentPosition).toBe(1);
      expect(entry!.previousPosition).toBe(4);
      expect(entry!.positionUpdatedAt).not.toBeNull();
    });

    it('remove a linha do placar', async () => {
      const { repository } = makeRepository();
      await seed(repository, [{ uid: 'a', xp: 100 }]);

      await repository.remove('a');

      await expect(repository.findByUid('a')).resolves.toMatchObject({
        found: false,
      });
    });
  });
});
