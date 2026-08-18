import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BadgeVideoRepository } from './badge-video.repository';
import { ALREADY_EXISTS } from '../waitlist/waitlist.repository';
import { BadgeId, isBadgeId } from './track.constants';
import { extractYoutubeId } from './youtube-id';
import { CreateBadgeVideoDto } from './dto/create-badge-video.dto';
import { UpdateBadgeVideoDto } from './dto/update-badge-video.dto';
import { ReorderVideosDto } from './dto/reorder-videos.dto';
import { BadgeVideoDto, BadgeVideoListDto } from './dto/badge-video.dto';
import { BadgeVideo, BadgeVideoKind } from './entities/badge-video.entity';

function toDto(video: BadgeVideo): BadgeVideoDto {
  return {
    id: video.id,
    badgeId: video.badgeId,
    title: video.title,
    description: video.description,
    youtubeId: video.youtubeId,
    kind: video.kind,
    questionId: video.questionId,
    devTierFree: video.devTierFree,
    order: video.order,
  };
}

@Injectable()
export class BadgeVideoService {
  constructor(private readonly repository: BadgeVideoRepository) {}

  /**
   * Insignia inexistente e 404; insignia sem video e 200 com lista vazia.
   *
   * A distincao importa para o front: a primeira e bug ou URL adulterada, a
   * segunda e terca-feira. Se as duas fossem 404, o front acabaria tratando
   * conteudo em preparo como falha de rede, com tela de erro no lugar do aviso
   * de que o material ainda esta sendo preparado. Ver a decisao 8 da spec 009.
   */
  async listByBadge(
    badgeId: string,
    kind?: BadgeVideoKind,
  ): Promise<BadgeVideoListDto> {
    const badge = this.assertBadge(badgeId);
    const videos = await this.repository.listByBadge(badge, kind);

    return { badgeId: badge, videos: videos.map(toDto) };
  }

  async create(
    badgeId: string,
    dto: CreateBadgeVideoDto,
  ): Promise<BadgeVideoDto> {
    const badge = this.assertBadge(badgeId);

    // A extracao acontece uma vez, aqui na entrada. O admin cola a URL inteira;
    // saber que existem cinco formas dela e problema nosso.
    const youtube = extractYoutubeId(dto.youtubeUrl);
    if (!youtube.found || !youtube.id) {
      throw new BadRequestException(
        'Não reconheci esse link do YouTube. Cole a URL do vídeo (youtube.com/watch?v=… ou youtu.be/…).',
      );
    }

    const kind = dto.kind ?? 'aula';

    // `questionId` so faz sentido em resposta. Aula com pergunta e resposta sem
    // pergunta sao os dois estados incoerentes, e o 400 e mais barato que um
    // dado torto que ninguem sabe interpretar depois.
    if (kind === 'aula' && dto.questionId) {
      throw new BadRequestException(
        'Só vídeo de resposta se vincula a uma pergunta do Mural.',
      );
    }

    // A ordem e por (badgeId, kind): o novo video entra no fim da ABA dele, e
    // nao no fim da insignia. Contar a insignia inteira faria a primeira
    // resposta nascer na posicao 3 de uma lista que tem um item so.
    const existing = await this.repository.listByBadge(badge, kind);

    try {
      const created = await this.repository.create({
        badgeId: badge,
        title: dto.title,
        description: dto.description?.length ? dto.description : null,
        youtubeId: youtube.id,
        kind,
        questionId: dto.questionId ?? null,
        devTierFree: dto.devTierFree ?? false,
        // Entra no fim: quem cadastra esta acrescentando, e reordenar depois e
        // uma operacao propria.
        order: existing.length,
      });

      return toDto(created.entry);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === ALREADY_EXISTS
      ) {
        // O caminho do documento e `{badgeId}__{youtubeId}`, entao o Firestore
        // recusa o mesmo video duas vezes na mesma insignia. Em outra insignia
        // ele entra, e isso e proposital.
        throw new ConflictException(
          'Esse vídeo já está nesta insígnia. Ele pode entrar em outra, mas não duas vezes na mesma.',
        );
      }
      throw error;
    }
  }

  async update(
    badgeId: string,
    videoId: string,
    dto: UpdateBadgeVideoDto,
  ): Promise<BadgeVideoDto> {
    this.assertBadge(badgeId);
    await this.assertVideo(videoId);

    const updated = await this.repository.update(videoId, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description.length ? dto.description : null }
        : {}),
      // Marcar como "Livre para todos" é a válvula da decisão 8: sem ela, a
      // melhor resposta da semana nasce trancada para 90% de quem votou nela.
      ...(dto.devTierFree !== undefined
        ? { devTierFree: dto.devTierFree }
        : {}),
    });

    return toDto(updated.entry);
  }

  /**
   * Apaga e **renormaliza a ordem da aba**.
   *
   * Sem a renormalizacao, apagar o video do meio deixa a lista com as posicoes 0
   * e 2 -- um buraco que nao quebra nada visivelmente e vai envelhecendo ate
   * alguem tentar entender por que os numeros pulam.
   *
   * A renormalizacao e **dentro do `kind`** (spec 010): renormalizar a insignia
   * inteira embaralharia as duas abas de uma vez, e uma delas nao foi tocada.
   */
  async remove(badgeId: string, videoId: string): Promise<void> {
    const badge = this.assertBadge(badgeId);
    const video = await this.assertVideo(videoId);

    await this.repository.delete(videoId);

    const remaining = await this.repository.listByBadge(badge, video.kind);
    if (remaining.length > 0) {
      await this.repository.reorder(remaining.map((item) => item.id));
    }
  }

  /**
   * Reordena **uma aba** da insignia, em lote atomico.
   *
   * A lista recebida precisa bater **exatamente** com o conjunto daquela aba.
   * Reordenar nao pode criar nem apagar, e as tres formas de errar -- faltando,
   * sobrando e repetido -- viram 400 aqui, antes de qualquer escrita. Misturar
   * ids de abas diferentes tambem cai no 400, pelo mesmo teste de conjunto.
   */
  async reorder(
    badgeId: string,
    dto: ReorderVideosDto,
    kind: BadgeVideoKind = 'aula',
  ): Promise<void> {
    const badge = this.assertBadge(badgeId);
    const existing = await this.repository.listByBadge(badge, kind);

    const existingIds = new Set(existing.map((video) => video.id));
    const receivedIds = new Set(dto.videoIds);

    if (receivedIds.size !== dto.videoIds.length) {
      throw new BadRequestException(
        'A ordem enviada tem vídeo repetido. Reordenar não pode duplicar.',
      );
    }

    if (
      receivedIds.size !== existingIds.size ||
      dto.videoIds.some((id) => !existingIds.has(id))
    ) {
      throw new BadRequestException(
        'A ordem enviada não bate com os vídeos desta insígnia. Recarregue a lista e tente de novo.',
      );
    }

    await this.repository.reorder(dto.videoIds);
  }

  private assertBadge(badgeId: string): BadgeId {
    if (!isBadgeId(badgeId)) {
      throw new NotFoundException(
        `Insígnia "${badgeId}" não existe na trilha.`,
      );
    }
    return badgeId;
  }

  /** Devolve o vídeo, porque quem chama precisa do `kind` para renormalizar. */
  private async assertVideo(videoId: string): Promise<BadgeVideo> {
    const found = await this.repository.findById(videoId);
    if (!found.found || !found.entry) {
      throw new NotFoundException('Vídeo não encontrado.');
    }
    return found.entry;
  }
}
