import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { BadgeVideoService } from './badge-video.service';
import { CreateBadgeVideoDto } from './dto/create-badge-video.dto';
import { UpdateBadgeVideoDto } from './dto/update-badge-video.dto';
import { ReorderVideosDto } from './dto/reorder-videos.dto';
import { BadgeVideoDto, BadgeVideoListDto } from './dto/badge-video.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

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
  @ApiOperation({
    summary: 'Vídeos da insígnia, para administrar',
    description:
      'Sem `tab`, as duas abas juntas. **O painel precisa pedir uma aba por ' +
      'vez**: a reordenação valida a lista contra os vídeos daquela aba, e uma ' +
      'lista misturada responde 400 em toda seta clicada.',
  })
  @ApiQuery({
    name: 'tab',
    required: false,
    enum: ['aula', 'resposta'],
    description:
      'A aba a listar. Sem o parâmetro, as duas. Nomeia a **lista**, e não a ' +
      'natureza do vídeo — chamava-se `kind` até a spec 021, e não há alias ' +
      'do nome antigo',
  })
  @ApiResponse({ status: 200, type: BadgeVideoListDto })
  async list(
    @CurrentUser() user: CurrentUserData,
    @Param('badgeId') badgeId: string,
    @Query('tab') tab?: string,
  ): Promise<BadgeVideoListDto> {
    // O `uid` do próprio admin: o `watched` da resposta é o check **dele**, e
    // não tem uso nesta tela. Passá-lo — em vez de um ramo que devolvesse
    // `false` para todo mundo — mantém um caminho único em `listByBadge`, e um
    // ramo a menos é um ramo a menos para envelhecer sozinho.
    return this.videos.listByBadge(
      badgeId,
      user.id,
      tab === 'aula' || tab === 'resposta' ? tab : undefined,
    );
  }

  @Post(':badgeId/videos')
  @ApiOperation({
    summary: 'Publicar um vídeo na insígnia',
    description:
      'Recebe a URL do YouTube em qualquer uma das seis formas — **link de ' +
      'Shorts incluído** — e grava só o ID. Entra no fim da ordem **da aba**. O ' +
      'título é da plataforma e é obrigatório.\n\n' +
      'Com `kind: resposta`, o `questionId` é **obrigatório** e a pergunta ' +
      'é lida e fotografada: o vídeo passa a carregar título, autor e data ' +
      'dela, e a pergunta passa a apontar de volta para o vídeo.\n\n' +
      'A lista de destino é `tab`, e sem ela vale `tab = kind`. ' +
      '`kind: resposta` com `tab: aula` é a **resposta posicionada na ' +
      'trilha**: ela entra no fim da trilha, é reordenada pelas setas como ' +
      'qualquer aula, e continua saindo em `retrato`.',
  })
  @ApiResponse({ status: 201, type: BadgeVideoDto })
  @ApiResponse({
    status: 400,
    description:
      'Link do YouTube irreconhecível, resposta sem pergunta, aula com ' +
      'pergunta, ou aula na aba de respostas.',
  })
  @ApiResponse({ status: 404, description: 'A pergunta informada não existe.' })
  @ApiResponse({ status: 409, description: 'Vídeo já está nesta insígnia.' })
  async create(
    @Param('badgeId') badgeId: string,
    @Body() dto: CreateBadgeVideoDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<BadgeVideoDto> {
    // O uid do admin vai junto porque publicar avisa a comunidade, e quem
    // publica não é notificado do próprio evento (spec 012, decisão 5).
    return this.videos.create(badgeId, dto, user.id);
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
    summary: 'Reordenar uma aba da insígnia',
    description:
      'Escrita em lote atômica: ou entram todas as posições ou nenhuma. A lista ' +
      'precisa bater exatamente com os vídeos **daquela aba** — reordenar não ' +
      'cria, não apaga e não mexe na outra aba.',
  })
  @ApiQuery({
    name: 'tab',
    required: false,
    enum: ['aula', 'resposta'],
    description:
      'A aba a reordenar. Sem o parâmetro, Aulas. A lista de `tab: aula` ' +
      '**pode conter respostas posicionadas na trilha**, e é uma lista válida',
  })
  @ApiResponse({ status: 204, description: 'Ordem gravada.' })
  @ApiResponse({ status: 400, description: 'A ordem não bate com a aba.' })
  async reorder(
    @Param('badgeId') badgeId: string,
    @Body() dto: ReorderVideosDto,
    @Query('tab') tab?: string,
  ): Promise<void> {
    // Sem `tab`, assume Aulas: é onde a esmagadora maioria das reordenações
    // acontece, e é o comportamento que a spec 009 já tinha. A tolerância é a
    // de sempre — valor desconhecido é tratado como `'aula'` —, e só o nome do
    // parâmetro mudou (spec 021, decisão 7).
    await this.videos.reorder(
      badgeId,
      dto,
      tab === 'resposta' ? 'resposta' : 'aula',
    );
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
