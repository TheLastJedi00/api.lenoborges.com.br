import { NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../auth/firebase.service';
import { BadgeVideoRepository } from './badge-video.repository';
import { WatchedVideoRepository } from './watched-video.repository';
import { WatchedVideoService } from './watched-video.service';
import { XP_PER_VIDEO } from './track.constants';
import { FakeFirestore } from './testing/fake-firestore';

const UID = 'uid-1';
const RAZAO = `profiles/${UID}/watched_videos`;

/** Os ids reais da trilha: `{badgeId}__{youtubeId}`. */
const A = 'logica__dQw4w9WgXcQ';
const B = 'logica__abc12345678';
const C = 'poo__def12345678';

describe('WatchedVideoService', () => {
  let firestore: FakeFirestore;
  let service: WatchedVideoService;
  let videos: { findById: jest.Mock };

  beforeEach(() => {
    firestore = new FakeFirestore();
    firestore.seedProfile(UID);

    const firebase = { firestore } as unknown as FirebaseService;
    const watched = new WatchedVideoRepository(firebase);

    videos = {
      findById: jest.fn((id: string) =>
        Promise.resolve({
          found: true,
          entry: { id, badgeId: id.split('__')[0] },
        }),
      ),
    };

    // O repositorio e o de verdade, sobre o Firestore em memoria: um mock
    // devolveria o `xp` que o teste quisesse, e a invariante que este arquivo
    // existe para provar nao seria provada.
    service = new WatchedVideoService(
      watched,
      videos as unknown as BadgeVideoRepository,
    );
  });

  function xp(): number {
    return firestore.raw(`profiles/${UID}`)!.xp as number;
  }

  describe('marcar', () => {
    it('devolve o estado novo e o XP ja atualizado', async () => {
      await expect(
        service.setWatched(UID, A, { watched: true }),
      ).resolves.toEqual({
        videoId: A,
        watched: true,
        xp: XP_PER_VIDEO,
      });
    });

    it('grava o badgeId vindo do documento do video, e nao do id partido', async () => {
      videos.findById.mockResolvedValue({
        found: true,
        // Um video cujo `badgeId` **nao** e o prefixo do id. Nao acontece hoje,
        // e o teste existe justamente para o dia em que o formato do id mudar:
        // quem trocar esta leitura por um `split('__')` fica vermelho aqui.
        entry: { id: A, badgeId: 'frontier-ia' },
      });

      await service.setWatched(UID, A, { watched: true });

      expect(firestore.raw(`${RAZAO}/${A}`)).toMatchObject({
        badgeId: 'frontier-ia',
      });
    });

    it('remarcar nao rele o video: a conferencia so acontece na primeira vez', async () => {
      await service.setWatched(UID, A, { watched: true });
      await service.setWatched(UID, A, { watched: false });
      await service.setWatched(UID, A, { watched: true });

      expect(videos.findById).toHaveBeenCalledTimes(1);
    });
  });

  describe('a conferencia da decisao 5', () => {
    /**
     * XP e moeda, e o `videoId` vem da URL. Uma rota que cunha moeda a partir de
     * uma string do cliente cunha a partir de qualquer string: bastaria repetir
     * a chamada com sufixos diferentes para ter XP infinito sem tocar em nenhum
     * video.
     */
    it('teste-trava: videoId inexistente e 404 e NAO paga XP', async () => {
      videos.findById.mockResolvedValue({ found: false, entry: null });

      await expect(
        service.setWatched(UID, 'qualquer-coisa-1', { watched: true }),
      ).rejects.toThrow(NotFoundException);

      expect(xp()).toBe(0);
      expect(firestore.countUnder(RAZAO)).toBe(0);
    });
  });

  describe('a invariante da decisao 2', () => {
    /**
     * **A propriedade que a spec inteira existe para garantir.**
     *
     * O `xp` do perfil e sempre `XP_PER_VIDEO` vezes o **numero de documentos**
     * do razao -- nunca o numero de marcados agora. E isso que separa este
     * desenho de um contador solto: um campo que so sabe somar nao tem com o que
     * ser comparado, e uma divergencia nele seria indetectavel.
     *
     * A sequencia abaixo mistura marcacao, desmarcacao e remarcacao em tres
     * videos, e termina com **um** deles marcado. O XP e de tres.
     */
    it('teste-trava: xp === XP_PER_VIDEO x numero de documentos, sempre', async () => {
      await service.setWatched(UID, A, { watched: true });
      await service.setWatched(UID, B, { watched: true });
      await service.setWatched(UID, A, { watched: false });
      await service.setWatched(UID, C, { watched: true });
      await service.setWatched(UID, B, { watched: false });
      await service.setWatched(UID, A, { watched: true });
      await service.setWatched(UID, A, { watched: false });
      await service.setWatched(UID, C, { watched: false });

      const documentos = firestore.countUnder(RAZAO);

      expect(documentos).toBe(3);
      expect(xp()).toBe(XP_PER_VIDEO * documentos);

      // E, para deixar explicito o que o numero **nao** e: no fim desta
      // sequencia nenhum video esta marcado, e o XP continua em 30.
      expect(xp()).toBe(30);
    });

    it('a invariante vale depois de dezenas de idas e vindas no mesmo video', async () => {
      for (let i = 0; i < 20; i += 1) {
        await service.setWatched(UID, A, { watched: i % 2 === 0 });
      }

      expect(firestore.countUnder(RAZAO)).toBe(1);
      expect(xp()).toBe(XP_PER_VIDEO);
    });
  });
});
