import { Injectable, NotFoundException } from '@nestjs/common';
import { BadgeVideoRepository } from './badge-video.repository';
import { RankingRepository } from '../games/ranking.repository';
import { XP_PER_VIDEO } from './track.constants';
import { WatchedVideoRepository } from './watched-video.repository';
import { SetWatchedDto, WatchedVideoDto } from './dto/set-watched.dto';

/**
 * Marcar e desmarcar video assistido (spec 019).
 *
 * O XP nao destrava nada -- nao muda `tier`, nao avanca `grade`, nao libera
 * video e nao abre insignia (decisao 12). E o que torna a marcacao manual segura:
 * derivar acesso de XP faria do check, que ninguem verifica, uma porta para o
 * conteudo pago.
 */
@Injectable()
export class WatchedVideoService {
  constructor(
    private readonly watched: WatchedVideoRepository,
    private readonly videos: BadgeVideoRepository,
    private readonly ranking: RankingRepository,
  ) {}

  /**
   * Deixa o video neste estado, e devolve o XP resultante.
   *
   * **O video precisa existir antes de o XP ser pago** (decisao 5). O `videoId`
   * chega na URL, e escolhido pelo cliente, e XP e moeda: uma rota que cunha
   * moeda a partir de uma string do cliente cunha a partir de qualquer string --
   * `PUT /me/watched-videos/qualquer-coisa-1`, repetido com sufixos diferentes,
   * seria XP infinito sem tocar em nenhum video.
   *
   * A conferencia custa uma leitura e **so acontece na primeira marcacao**:
   * quando o documento do razao ja existe, nao ha XP a pagar e nao ha o que
   * conferir. Remarcar nao rele o video.
   */
  async setWatched(
    uid: string,
    videoId: string,
    dto: SetWatchedDto,
  ): Promise<WatchedVideoDto> {
    const existing = await this.watched.findOne(uid, videoId);

    let badgeId = existing.entry?.badgeId;
    if (!existing.found) {
      const video = await this.videos.findById(videoId);
      if (!video.found || !video.entry) {
        throw new NotFoundException('Vídeo não encontrado.');
      }

      // O `badgeId` sai do documento do video, e nao de partir o `videoId` em
      // pedacos: ele e `{badgeId}__{youtubeId}` hoje, e quem escrever um `split`
      // aqui assina que ele sera sempre assim.
      badgeId = video.entry.badgeId;
    }

    // O `xp` vem do repositorio, que e quem escreveu o incremento. Somar aqui
    // seria a segunda implementacao da mesma regra -- a que erra no video
    // remarcado, que nao paga XP nenhum -- e injetar o `ProfileRepository` so
    // para reler o campo fecharia o ciclo de modulos que derruba o boot.
    // A linha do placar entra **no mesmo lote** do XP do perfil (spec 022,
    // decisao 11). O `found` decide se ha o que somar: quem ainda nao escolheu
    // gamertag nao esta no ranking, e um `increment` num documento inexistente o
    // criaria sem `nickname` -- uma linha em branco no placar de quem a decisao
    // 20 mantem fora.
    const rankingRow = await this.ranking.findByUid(uid);

    const { xp } = await this.watched.setWatched(
      uid,
      videoId,
      badgeId!,
      dto.watched,
      (batch) =>
        this.ranking.addXpToBatch(
          batch,
          uid,
          rankingRow.found,
          XP_PER_VIDEO,
          rankingRow.entry?.xp ?? 0,
        ),
    );

    return { videoId, watched: dto.watched, xp };
  }
}
