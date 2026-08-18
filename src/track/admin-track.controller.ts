import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { BadgeVideoService } from './badge-video.service';
import { CreateBadgeVideoDto } from './dto/create-badge-video.dto';
import { UpdateBadgeVideoDto } from './dto/update-badge-video.dto';
import { ReorderVideosDto } from './dto/reorder-videos.dto';
import { BadgeVideoDto, BadgeVideoListDto } from './dto/badge-video.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

/**
 * Administração dos vídeos da trilha.
 *
 * Controller separado do público de propósito: o `AdminGuard` vale no controller
 * inteiro, e assim não existe a chance de esquecer o decorador numa rota nova.
 * A ordem dos guards importa — o `FirebaseAuthGuard` é quem popula
 * `request.user`, e o `AdminGuard` só lê o que ele deixou.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/badges')
@UseGuards(FirebaseAuthGuard, AdminGuard)
export class AdminTrackController {
  constructor(private readonly videos: BadgeVideoService) {}

  @Get(':badgeId/videos')
  @ApiOperation({ summary: 'Vídeos da insígnia, para administrar' })
  @ApiResponse({ status: 200, type: BadgeVideoListDto })
  async list(@Param('badgeId') badgeId: string): Promise<BadgeVideoListDto> {
    return this.videos.listByBadge(badgeId);
  }

  @Post(':badgeId/videos')
  @ApiOperation({
    summary: 'Publicar um vídeo na insígnia',
    description:
      'Recebe a URL do YouTube em qualquer forma e grava só o ID. Entra no fim ' +
      'da ordem. O título é da plataforma e é obrigatório.',
  })
  @ApiResponse({ status: 201, type: BadgeVideoDto })
  @ApiResponse({ status: 400, description: 'Link do YouTube irreconhecível.' })
  @ApiResponse({ status: 409, description: 'Vídeo já está nesta insígnia.' })
  async create(
    @Param('badgeId') badgeId: string,
    @Body() dto: CreateBadgeVideoDto,
  ): Promise<BadgeVideoDto> {
    return this.videos.create(badgeId, dto);
  }

  /**
   * Vem antes da rota de `:videoId` de propósito.
   *
   * O Nest casa rotas na ordem de declaração, e `order` cairia dentro de
   * `:videoId` se esta viesse depois — um bug silencioso que responderia 404
   * para toda reordenação.
   */
  @Patch(':badgeId/videos/order')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Reordenar a insígnia inteira',
    description:
      'Escrita em lote atômica: ou entram todas as posições ou nenhuma. A lista ' +
      'precisa bater exatamente com os vídeos que existem — reordenar não cria ' +
      'nem apaga.',
  })
  @ApiResponse({ status: 204, description: 'Ordem gravada.' })
  @ApiResponse({ status: 400, description: 'A ordem não bate com a insígnia.' })
  async reorder(
    @Param('badgeId') badgeId: string,
    @Body() dto: ReorderVideosDto,
  ): Promise<void> {
    await this.videos.reorder(badgeId, dto);
  }

  @Patch(':badgeId/videos/:videoId')
  @ApiOperation({ summary: 'Editar título e descrição' })
  @ApiResponse({ status: 200, type: BadgeVideoDto })
  async update(
    @Param('badgeId') badgeId: string,
    @Param('videoId') videoId: string,
    @Body() dto: UpdateBadgeVideoDto,
  ): Promise<BadgeVideoDto> {
    return this.videos.update(badgeId, videoId, dto);
  }

  @Delete(':badgeId/videos/:videoId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remover vídeo',
    description: 'Renormaliza a ordem dos que sobraram, sem deixar buraco.',
  })
  @ApiResponse({ status: 204, description: 'Removido.' })
  async remove(
    @Param('badgeId') badgeId: string,
    @Param('videoId') videoId: string,
  ): Promise<void> {
    await this.videos.remove(badgeId, videoId);
  }
}
