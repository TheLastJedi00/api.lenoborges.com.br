import { FakeFirestore } from '../track/testing/fake-firestore';
import { FirebaseService } from '../auth/firebase.service';
import { ChallengeConfigRepository } from './challenge-config.repository';

function makeRepository(): {
  repository: ChallengeConfigRepository;
  firestore: FakeFirestore;
} {
  const firestore = new FakeFirestore();

  return {
    repository: new ChallengeConfigRepository({
      firestore,
    } as unknown as FirebaseService),
    firestore,
  };
}

describe('ChallengeConfigRepository', () => {
  describe('get', () => {
    it('teste-trava: sem documento, devolve requiredXp zero e nao undefined', async () => {
      // **O documento nao existe para nenhuma insignia no dia do deploy.** Um
      // `undefined` chegando em `xp >= requiredXp` responderia false para todo
      // mundo, e o card ficaria em "XP insuficiente" para a base inteira --
      // inclusive para quem tem XP de sobra, e sem erro em log nenhum.
      const { repository } = makeRepository();

      const { found, entry } = await repository.get('logica');

      expect(found).toBe(false);
      expect(entry.requiredXp).toBe(0);
      expect(entry.badgeId).toBe('logica');
    });

    it('devolve o valor gravado', async () => {
      const { repository } = makeRepository();
      await repository.save('nestjs', 500);

      const { found, entry } = await repository.get('nestjs');

      expect(found).toBe(true);
      expect(entry.requiredXp).toBe(500);
    });

    it('found distingue "nao configurado" de "configurado com zero"', async () => {
      // Os dois valem zero, e a tela precisa saber a diferenca para nao mostrar
      // "salvo em 01/01/1970" numa insignia que ninguem tocou.
      const { repository } = makeRepository();
      await repository.save('poo', 0);

      const naoConfigurada = await repository.get('logica');
      const configuradaComZero = await repository.get('poo');

      expect(naoConfigurada.found).toBe(false);
      expect(configuradaComZero.found).toBe(true);
      expect(naoConfigurada.entry.requiredXp).toBe(
        configuradaComZero.entry.requiredXp,
      );
    });
  });

  describe('getMany', () => {
    it('devolve todas as insignias pedidas, inclusive as sem documento', async () => {
      // Um mapa incompleto faria a tela pintar sete cards e sumir com o oitavo.
      const { repository } = makeRepository();
      await repository.save('poo', 120);

      const mapa = await repository.getMany(['logica', 'poo', 'nestjs']);

      expect(mapa.size).toBe(3);
      expect(mapa.get('logica')!.requiredXp).toBe(0);
      expect(mapa.get('poo')!.requiredXp).toBe(120);
      expect(mapa.get('nestjs')!.requiredXp).toBe(0);
    });

    it('nao chama o banco com lista vazia', async () => {
      const { repository } = makeRepository();

      await expect(repository.getMany([])).resolves.toEqual(new Map());
    });
  });

  describe('save', () => {
    it('sobrescreve, porque salvar duas vezes e a operacao normal da tela', async () => {
      // `set()` e nao `create()`: um ALREADY_EXISTS na segunda vez seria o botao
      // "Salvar" funcionando uma vez so por insignia.
      const { repository } = makeRepository();

      await repository.save('logica', 100);
      await repository.save('logica', 250);

      const { entry } = await repository.get('logica');

      expect(entry.requiredXp).toBe(250);
    });

    it('carimba o updatedAt de agora', async () => {
      const { repository } = makeRepository();
      const antes = Date.now();

      const entry = await repository.save('logica', 100);

      expect(entry.updatedAt.getTime()).toBeGreaterThanOrEqual(antes);
    });
  });
});
