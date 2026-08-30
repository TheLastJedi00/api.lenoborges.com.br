import { BadRequestException } from '@nestjs/common';
import { FakeFirestore } from '../track/testing/fake-firestore';
import { FirebaseService } from '../auth/firebase.service';
import { RankingRepository } from './ranking.repository';
import { RankingService } from './ranking.service';

function makeService(): {
  service: RankingService;
  repository: RankingRepository;
} {
  const firestore = new FakeFirestore();
  const repository = new RankingRepository({
    firestore,
  } as unknown as FirebaseService);

  return { service: new RankingService(repository), repository };
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

describe('RankingService', () => {
  it('devolve a pagina ordenada, com a posicao contando de 1', async () => {
    const { service, repository } = makeService();
    await seed(repository, [
      { uid: 'a', xp: 100 },
      { uid: 'b', xp: 900 },
      { uid: 'c', xp: 500 },
    ]);

    const pagina = await service.page({ uid: 'a' });

    expect(pagina.entries.map((e) => [e.position, e.uid])).toEqual([
      [1, 'b'],
      [2, 'c'],
      [3, 'a'],
    ]);
  });

  it('teste-trava: a posicao do membro aparece mesmo fora da pagina', async () => {
    // E a linha fixa do topo da tela: "Sua posicao: #47". Sem ela, quem esta na
    // pagina 3 nao tem como saber onde esta sem rolar ate se achar.
    const { service, repository } = makeService();
    await seed(
      repository,
      Array.from({ length: 30 }, (_, i) => ({
        uid: `u${String(i).padStart(2, '0')}`,
        xp: (30 - i) * 10,
      })),
    );

    const pagina = await service.page({ uid: 'u25', limit: 5 });

    expect(pagina.entries).toHaveLength(5);
    expect(pagina.entries.some((e) => e.uid === 'u25')).toBe(false);
    expect(pagina.myPosition).toBe(26);
    expect(pagina.myEntry!.uid).toBe('u25');
  });

  it('teste-trava: membro sem linha no placar nao inventa posicao', async () => {
    // Quem nao tem gamertag nao aparece no ranking (decisao 20). A tela mostra
    // a lista e nao a linha do topo.
    const { service, repository } = makeService();
    await seed(repository, [{ uid: 'a', xp: 100 }]);

    const pagina = await service.page({ uid: 'sem-gamertag' });

    expect(pagina.myPosition).toBeNull();
    expect(pagina.myEntry).toBeNull();
    expect(pagina.entries).toHaveLength(1);
  });

  it('a variacao e previousPosition menos currentPosition', async () => {
    const { service, repository } = makeService();
    await seed(repository, [{ uid: 'a', xp: 100 }]);
    await repository.savePositions([
      { uid: 'a', currentPosition: 3, previousPosition: 7 },
    ]);

    const pagina = await service.page({ uid: 'a' });

    expect(pagina.entries[0].positionChange).toBe(4);
  });

  it('a variacao e negativa para quem desceu', async () => {
    const { service, repository } = makeService();
    await seed(repository, [{ uid: 'a', xp: 100 }]);
    await repository.savePositions([
      { uid: 'a', currentPosition: 9, previousPosition: 4 },
    ]);

    const pagina = await service.page({ uid: 'a' });

    expect(pagina.entries[0].positionChange).toBe(-5);
  });

  it('teste-trava: a variacao e null no primeiro dia, e nao zero', async () => {
    // Zero diz "nao mudou", e "ainda nao sei" e outra afirmacao. A tela nao
    // desenha selo nenhum quando e null.
    const { service, repository } = makeService();
    await seed(repository, [{ uid: 'a', xp: 100 }]);

    const pagina = await service.page({ uid: 'a' });

    expect(pagina.entries[0].positionChange).toBeNull();
  });

  it('pagina com cursor, sem repetir nem pular', async () => {
    const { service, repository } = makeService();
    await seed(
      repository,
      Array.from({ length: 7 }, (_, i) => ({ uid: `u${i}`, xp: 500 })),
    );

    const primeira = await service.page({ uid: 'u0', limit: 3 });
    const segunda = await service.page({
      uid: 'u0',
      limit: 3,
      after: primeira.nextCursor!,
    });
    const terceira = await service.page({
      uid: 'u0',
      limit: 3,
      after: segunda.nextCursor!,
    });

    const todos = [
      ...primeira.entries,
      ...segunda.entries,
      ...terceira.entries,
    ].map((e) => e.uid);

    expect(todos).toHaveLength(7);
    expect(new Set(todos).size).toBe(7);
    expect(terceira.nextCursor).toBeNull();
  });

  it('a numeracao continua na pagina seguinte', async () => {
    const { service, repository } = makeService();
    await seed(
      repository,
      Array.from({ length: 7 }, (_, i) => ({ uid: `u${i}`, xp: (7 - i) * 10 })),
    );

    const primeira = await service.page({ uid: 'u0', limit: 3 });
    const segunda = await service.page({
      uid: 'u0',
      limit: 3,
      after: primeira.nextCursor!,
    });

    expect(segunda.entries.map((e) => e.position)).toEqual([4, 5, 6]);
  });

  it('teste-trava: nextCursor e null no fim, e nao um cursor que traz vazio', async () => {
    const { service, repository } = makeService();
    await seed(repository, [{ uid: 'a', xp: 100 }]);

    const pagina = await service.page({ uid: 'a', limit: 10 });

    expect(pagina.nextCursor).toBeNull();
  });

  it('limita o tamanho da pagina', async () => {
    const { service, repository } = makeService();
    await seed(
      repository,
      Array.from({ length: 80 }, (_, i) => ({ uid: `u${i}`, xp: i })),
    );

    const pagina = await service.page({ uid: 'u0', limit: 999 });

    expect(pagina.entries).toHaveLength(50);
  });

  it('cursor quebrado e 400, e nao um retorno ao topo em silencio', async () => {
    // Voltar ao topo no meio da rolagem parece a lista se duplicando na tela.
    const { service, repository } = makeService();
    await seed(repository, [{ uid: 'a', xp: 100 }]);

    await expect(
      service.page({ uid: 'a', after: 'bWFsLWZvcm1hZG8' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('o cursor e opaco, e nao expoe a forma da ordenacao', async () => {
    const { service, repository } = makeService();
    await seed(repository, [
      { uid: 'a', xp: 100 },
      { uid: 'b', xp: 200 },
    ]);

    const pagina = await service.page({ uid: 'a', limit: 1 });

    expect(pagina.nextCursor).not.toContain('xp');
    expect(pagina.nextCursor).not.toContain('200');
  });
});
