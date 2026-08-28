import { FirebaseService } from '../auth/firebase.service';
import { WatchedVideoRepository } from './watched-video.repository';
import { XP_PER_VIDEO } from './track.constants';
import { FakeFirestore } from './testing/fake-firestore';

const UID = 'uid-1';
const VIDEO = 'logica__dQw4w9WgXcQ';
const OUTRO = 'logica__abc12345678';
const RAZAO = `profiles/${UID}/watched_videos`;

describe('WatchedVideoRepository', () => {
  let firestore: FakeFirestore;
  let repository: WatchedVideoRepository;

  beforeEach(() => {
    firestore = new FakeFirestore();
    firestore.seedProfile(UID);
    repository = new WatchedVideoRepository({
      firestore,
    } as unknown as FirebaseService);
  });

  function xp(): number {
    return firestore.raw(`profiles/${UID}`)!.xp as number;
  }

  describe('a primeira marcacao', () => {
    it('cria o registro e paga o XP, no mesmo lote', async () => {
      const { granted } = await repository.setWatched(
        UID,
        VIDEO,
        'logica',
        true,
      );

      expect(granted).toBe(true);
      expect(xp()).toBe(XP_PER_VIDEO);
      expect(firestore.raw(`${RAZAO}/${VIDEO}`)).toMatchObject({
        badgeId: 'logica',
        watched: true,
      });
    });
  });

  describe('as travas da decisao 2', () => {
    /**
     * Marcar duas vezes e o duplo clique de sempre, e ele nao pode pagar duas
     * vezes. Quem segura isto e o `create()` derrubando o lote inteiro com
     * ALREADY_EXISTS -- nao ha leitura previa, nao ha transacao, e nao ha janela
     * entre conferir e escrever.
     */
    it('teste-trava: marcar de novo nao incrementa', async () => {
      await repository.setWatched(UID, VIDEO, 'logica', true);
      const { granted } = await repository.setWatched(
        UID,
        VIDEO,
        'logica',
        true,
      );

      expect(granted).toBe(false);
      expect(xp()).toBe(XP_PER_VIDEO);
    });

    /**
     * O XP e definitivo. Desmarcar tira o check e **nao** devolve os pontos.
     */
    it('teste-trava: desmarcar nao decrementa', async () => {
      await repository.setWatched(UID, VIDEO, 'logica', true);
      await repository.setWatched(UID, VIDEO, 'logica', false);

      expect(xp()).toBe(XP_PER_VIDEO);
    });

    /**
     * **A trava que a spec inteira existe para escrever.** Se desmarcar apagasse
     * o documento, esta sequencia pagaria 20 XP por um video so -- e o farm
     * seria um duplo clique repetido, sem bug e sem exploracao, usando a tela
     * exatamente como ela foi desenhada.
     */
    it('teste-trava: desmarcar e remarcar NAO paga de novo', async () => {
      await repository.setWatched(UID, VIDEO, 'logica', true);
      await repository.setWatched(UID, VIDEO, 'logica', false);
      await repository.setWatched(UID, VIDEO, 'logica', true);

      expect(xp()).toBe(XP_PER_VIDEO);
    });

    it('teste-trava: desmarcar nao apaga o documento do razao', async () => {
      await repository.setWatched(UID, VIDEO, 'logica', true);
      await repository.setWatched(UID, VIDEO, 'logica', false);

      expect(firestore.raw(`${RAZAO}/${VIDEO}`)).toMatchObject({
        watched: false,
      });
      expect(firestore.countUnder(RAZAO)).toBe(1);
    });

    /**
     * `firstWatchedAt` e a prova de quando o XP foi pago. Um `set()` no lugar do
     * `update()` parcial a reescreveria, e a informacao nao volta.
     */
    it('teste-trava: firstWatchedAt nao muda nas escritas seguintes', async () => {
      await repository.setWatched(UID, VIDEO, 'logica', true);
      const original = firestore.raw(`${RAZAO}/${VIDEO}`)!.firstWatchedAt;

      await repository.setWatched(UID, VIDEO, 'logica', false);
      await repository.setWatched(UID, VIDEO, 'logica', true);

      expect(firestore.raw(`${RAZAO}/${VIDEO}`)!.firstWatchedAt).toEqual(
        original,
      );
    });
  });

  describe('findWatchedIds', () => {
    it('devolve so o que esta marcado agora', async () => {
      await repository.setWatched(UID, VIDEO, 'logica', true);
      await repository.setWatched(UID, OUTRO, 'logica', true);
      await repository.setWatched(UID, OUTRO, 'logica', false);

      const marcados = await repository.findWatchedIds(UID, [VIDEO, OUTRO]);

      // O `OUTRO` tem documento -- e por isso ja pagou XP --, mas o check esta
      // desligado. O que a tela desenha e o check, e nao o razao.
      expect(marcados).toEqual(new Set([VIDEO]));
    });

    it('video nunca marcado simplesmente nao esta no conjunto', async () => {
      const marcados = await repository.findWatchedIds(UID, [VIDEO]);

      expect(marcados.size).toBe(0);
    });

    /** Insignia vazia e o estado normal do produto, e `getAll()` sem ref estoura. */
    it('lista vazia nao toca no Firestore', async () => {
      const marcados = await repository.findWatchedIds(UID, []);

      expect(marcados.size).toBe(0);
    });

    /**
     * O razao e por perfil, e o caminho ja carrega o `uid`. Este teste existe
     * para o dia em que alguem trocar o `getAll` por uma consulta e esquecer o
     * `where` do dono.
     */
    it('o razao de um membro nao aparece para outro', async () => {
      firestore.seedProfile('uid-2');
      await repository.setWatched(UID, VIDEO, 'logica', true);

      const doOutro = await repository.findWatchedIds('uid-2', [VIDEO]);

      expect(doOutro.size).toBe(0);
    });
  });

  describe('removeAll', () => {
    it('apaga o razao inteiro do perfil', async () => {
      await repository.setWatched(UID, VIDEO, 'logica', true);
      await repository.setWatched(UID, OUTRO, 'logica', true);

      await repository.removeAll(UID);

      expect(firestore.countUnder(RAZAO)).toBe(0);
    });

    it('perfil sem nada assistido nao lanca', async () => {
      await expect(repository.removeAll(UID)).resolves.toBeUndefined();
    });
  });
});
