import { FakeFirestore } from '../track/testing/fake-firestore';
import { FirebaseService } from '../auth/firebase.service';
import { NicknameRepository } from './nickname.repository';

function makeRepository(): {
  repository: NicknameRepository;
  firestore: FakeFirestore;
} {
  const firestore = new FakeFirestore();

  return {
    repository: new NicknameRepository({
      firestore,
    } as unknown as FirebaseService),
    firestore,
  };
}

describe('NicknameRepository', () => {
  describe('claim', () => {
    it('grava a reserva e o campo do perfil no mesmo lote', async () => {
      // Os dois sao um fato so: o documento de unicidade sem o campo no perfil e
      // um nome ocupado por ninguem, e o campo sem o documento e uma gamertag
      // que outra pessoa ainda pode pegar.
      const { repository, firestore } = makeRepository();
      firestore.seedProfile('uid-1');

      const { taken } = await repository.claim('uid-1', 'LenoDev');

      expect(taken).toBe(false);
      expect(firestore.raw('nicknames/lenodev')).toMatchObject({
        uid: 'uid-1',
        display: 'LenoDev',
      });
      expect(firestore.raw('profiles/uid-1')).toMatchObject({
        nickname: 'LenoDev',
      });
    });

    it('o ID e minusculo e o display guarda a capitalizacao', async () => {
      const { repository, firestore } = makeRepository();
      firestore.seedProfile('uid-1');

      await repository.claim('uid-1', 'LenoDev');

      expect(firestore.raw('nicknames/LenoDev')).toBeUndefined();
      expect(firestore.raw('nicknames/lenodev')).toBeDefined();
    });

    it('teste-trava: a colisao e case-insensitive', async () => {
      // Duas gamertags que se leem igual num placar sao a mesma gamertag para
      // quem esta olhando. Permitir as duas seria autorizar a copia do nome de
      // outra pessoa trocando uma letra de caixa.
      const { repository, firestore } = makeRepository();
      firestore.seedProfile('uid-1');
      firestore.seedProfile('uid-2');
      await repository.claim('uid-1', 'LenoDev');

      const { taken } = await repository.claim('uid-2', 'lenodev');

      expect(taken).toBe(true);
    });

    it('teste-trava: a colisao nao grava o nickname no perfil do segundo', async () => {
      // E o `create()` do lote que derruba o lote inteiro. Se o `update` do
      // perfil escapasse, o segundo membro ficaria com uma gamertag que o
      // documento de unicidade diz pertencer a outro -- e o ranking nao saberia
      // qual e qual.
      const { repository, firestore } = makeRepository();
      firestore.seedProfile('uid-1');
      firestore.seedProfile('uid-2');
      await repository.claim('uid-1', 'LenoDev');

      await repository.claim('uid-2', 'lenodev');

      expect(firestore.raw('profiles/uid-2')!.nickname).toBeUndefined();
    });
  });

  describe('findByNickname', () => {
    it('acha ignorando a caixa', async () => {
      const { repository, firestore } = makeRepository();
      firestore.seedProfile('uid-1');
      await repository.claim('uid-1', 'LenoDev');

      const { found, entry } = await repository.findByNickname('LENODEV');

      expect(found).toBe(true);
      expect(entry!.uid).toBe('uid-1');
    });

    it('devolve found: false, e nao null cru', async () => {
      const { repository } = makeRepository();

      await expect(repository.findByNickname('ninguem')).resolves.toEqual({
        found: false,
        entry: null,
      });
    });
  });

  describe('release', () => {
    it('libera o nome para outra pessoa', async () => {
      // E o unico jeito de o membro que volta nao encontrar o proprio nome
      // ocupado por um fantasma: um documento cujo uid aponta para um perfil que
      // nao existe mais.
      const { repository, firestore } = makeRepository();
      firestore.seedProfile('uid-1');
      firestore.seedProfile('uid-2');
      await repository.claim('uid-1', 'LenoDev');

      await repository.release('LenoDev');
      const { taken } = await repository.claim('uid-2', 'lenodev');

      expect(taken).toBe(false);
    });
  });
});
