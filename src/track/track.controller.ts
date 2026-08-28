import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { BadgeVideoService } from './badge-video.service';
import { BadgeVideoListDto } from './dto/badge-video.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

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
  @ApiQuery({
    name: 'tab',
    required: false,
    enum: ['aula', 'resposta'],
    description:
      'A aba. Sem o parâmetro, as duas juntas — Aulas se assistem em ordem, ' +
      'Perguntas Frequentes se consultam por assunto.\n\n' +
      'O parâmetro **nomeia a lista, e não a natureza do vídeo**: a aba Aulas ' +
      'inclui as respostas que o admin posicionou na trilha, e elas têm ' +
      '`kind: resposta`. Chamava-se `kind` até a spec 021, e não há alias ' +
      'do nome antigo',
  })
  @ApiResponse({ status: 200, type: BadgeVideoListDto })
  @ApiResponse({ status: 404, description: 'Insígnia inexistente.' })
  async listVideos(
    @CurrentUser() user: CurrentUserData,
    @Param('badgeId') badgeId: string,
    @Query('tab') tab?: string,
  ): Promise<BadgeVideoListDto> {
    // Valor desconhecido cai em `undefined` e devolve as duas abas, em vez de
    // devolver lista vazia: um erro de digitação na URL não deveria fazer a
    // trilha parecer vazia. A tolerância é a de sempre; só o nome mudou.
    //
    // **O rename é a decisão 7 da spec 021, e não é cosmético.** Depois dela,
    // `?kind=aula` devolveria vídeos cujo `kind` é `resposta` — um parâmetro
    // que mente sobre o campo que nomeia, e o tipo de detalhe que custa uma
    // tarde a quem for depurar isso meses depois. Sem alias do nome antigo: o
    // front é o único cliente e as duas specs entram juntas.
    const aba = tab === 'aula' || tab === 'resposta' ? tab : undefined;

    return this.videos.listByBadge(badgeId, user.id, aba);
  }
}
