import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { BadgeVideoService } from './badge-video.service';
import { BadgeVideoListDto } from './dto/badge-video.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';

/**
 * Leitura da trilha, para o membro.
 *
 * Exige sessão e **nada mais** — não confere `grade`, não confere tier. Não
 * existe estado de assinatura no modelo, e um guard escrito agora só teria como
 * chave o `grade`, que é o erro mais tentador de programar: derivar acesso a
 * partir de progresso. Ver a decisão 9 da spec 009.
 */
@ApiTags('trilha')
@ApiBearerAuth()
@Controller('badges')
@UseGuards(FirebaseAuthGuard)
export class TrackController {
  constructor(private readonly videos: BadgeVideoService) {}

  @Get(':badgeId/videos')
  @ApiOperation({
    summary: 'Vídeos de uma insígnia, na ordem',
    description:
      'Insígnia sem vídeo responde 200 com lista vazia — é o estado normal do ' +
      'produto, não um erro. 404 só quando a insígnia não existe na trilha.',
  })
  @ApiResponse({ status: 200, type: BadgeVideoListDto })
  @ApiResponse({ status: 404, description: 'Insígnia inexistente.' })
  async listVideos(
    @Param('badgeId') badgeId: string,
  ): Promise<BadgeVideoListDto> {
    return this.videos.listByBadge(badgeId);
  }
}
