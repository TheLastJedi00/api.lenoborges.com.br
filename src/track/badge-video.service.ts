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
import { BadgeVideo } from './entities/badge-video.entity';

function toDto(video: BadgeVideo): BadgeVideoDto {
  return {
    id: video.id,
    badgeId: video.badgeId,
    title: video.title,
    description: video.description,
    youtubeId: video.youtubeId,
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
  async listByBadge(badgeId: string): Promise<BadgeVideoListDto> {
    const badge = this.assertBadge(badgeId);
    const videos = await this.repository.listByBadge(badge);

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

    const existing = await this.repository.listByBadge(badge);

    try {
      const created = await this.repository.create({
        badgeId: badge,
        title: dto.title,
        description: dto.description?.length ? dto.description : null,
        youtubeId: youtube.id,
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
    });

    return toDto(updated.entry);
  }

  /**
   * Apaga e **renormaliza a ordem**.
   *
   * Sem a renormalizacao, apagar o video do meio deixa a insignia com as
   * posicoes 0 e 2 -- um buraco que nao quebra nada visivelmente e vai
   * envelhecendo ate alguem tentar entender por que os numeros pulam.
   */
  async remove(badgeId: string, videoId: string): Promise<void> {
    const badge = this.assertBadge(badgeId);
    await this.assertVideo(videoId);

    await this.repository.delete(videoId);

    const remaining = await this.repository.listByBadge(badge);
    if (remaining.length > 0) {
      await this.repository.reorder(remaining.map((video) => video.id));
    }
  }

  /**
   * Reordena a insignia inteira, em lote atomico.
   *
   * A lista recebida precisa bater **exatamente** com o conjunto que existe.
   * Reordenar nao pode criar nem apagar, e as tres formas de errar -- faltando,
   * sobrando e repetido -- viram 400 aqui, antes de qualquer escrita.
   */
  async reorder(badgeId: string, dto: ReorderVideosDto): Promise<void> {
    const badge = this.assertBadge(badgeId);
    const existing = await this.repository.listByBadge(badge);

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

  private async assertVideo(videoId: string): Promise<void> {
    const found = await this.repository.findById(videoId);
    if (!found.found || !found.entry) {
      throw new NotFoundException('Vídeo não encontrado.');
    }
  }
}
