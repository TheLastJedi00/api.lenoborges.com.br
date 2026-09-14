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
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { BADGE_TITLES } from '../track/track.constants';
import type { BadgeId } from '../track/track.constants';
import { TrainingService } from './training.service';
import { GeminiService } from './gemini.service';
import { CreateTrainingDto } from './dto/create-training.dto';
import { UpdateTrainingDto } from './dto/update-training.dto';
import { ReorderTrainingsDto } from './dto/reorder-trainings.dto';
import { GenerateTrainingsDto } from './dto/generate-training.dto';
import type { GeneratedTrainingsDto } from './dto/generate-training.dto';
import { AdminReplyDto } from './dto/admin-reply.dto';
import {
  AdminTrainingCommentListDto,
  TrainingCommentDto,
  TrainingDto,
  TrainingListDto,
} from './dto/training.dto';

/**
 * Administração da Arena de Treinamento (spec 023, decisão 4).
 *
 * Controller separado do público de propósito: o `AdminGuard` vale no controller
 * inteiro, e assim não existe a chance de esquecer o decorador numa rota nova. A
 * ordem dos guards importa -- o `FirebaseAuthGuard` é quem popula
 * `request.user`, e o `AdminGuard` só lê o que ele deixou.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(FirebaseAuthGuard, AdminGuard)
export class AdminTrainingController {
  constructor(
    private readonly trainings: TrainingService,
    private readonly gemini: GeminiService,
  ) {}

  @Get('badges/:badgeId/trainings')
  @ApiOperation({ summary: 'Desafios da insígnia, para administrar' })
  @ApiResponse({ status: 200, type: TrainingListDto })
  async list(@Param('badgeId') badgeId: string): Promise<TrainingListDto> {
    return this.trainings.listByBadgeForAdmin(badgeId);
  }

  @Post('badges/:badgeId/trainings')
  @ApiOperation({
    summary: 'Cria um desafio no fim da lista da insígnia',
    description:
      'A posição é calculada no servidor, como a última + 1. Uma posição vinda ' +
      'do cliente colidiria com a de outro item, e a lista passaria a ter dois ' +
      '`position: 3` — o estado que a renormalização existe para nunca deixar ' +
      'acontecer.',
  })
  @ApiResponse({ status: 201, type: TrainingDto })
  @ApiResponse({ status: 404, description: 'Insígnia inexistente.' })
  async create(
    @Param('badgeId') badgeId: string,
    @Body() dto: CreateTrainingDto,
  ): Promise<TrainingDto> {
    return this.trainings.createTraining(badgeId, dto);
  }

  @Post('badges/:badgeId/trainings/generate')
  @ApiOperation({
    summary: 'Gera treinamentos com IA — rascunho, sem gravar nada',
    description:
      'Devolve uma proposta para o admin revisar. **Nada é persistido aqui**: ' +
      'o que grava é a criação de sempre, uma chamada por rascunho aprovado — ' +
      'não existe rota de `bulk` para treinamentos. Treinamento fora do ' +
      'formato é descartado em silêncio, e `discarded` diz quantos foram.',
  })
  @ApiResponse({ status: 201, description: 'Rascunho de treinamentos' })
  @ApiResponse({ status: 404, description: 'Insígnia inexistente.' })
  @ApiResponse({
    status: 503,
    description: 'Sem GEMINI_API_KEY, ou a IA não respondeu',
  })
  async generate(
    @Param('badgeId') badgeId: string,
    @Body() dto: GenerateTrainingsDto,
  ): Promise<GeneratedTrainingsDto> {
    // A conferência do `badgeId` vem **antes** da chamada paga. Gerar dez
    // treinamentos para uma insígnia que não existe custaria a chamada inteira
    // para responder 404 depois, e o admin pagaria por um rascunho que nunca
    // teve onde ser salvo.
    await this.trainings.listByBadgeForAdmin(badgeId);

    return this.gemini.generate({
      badgeTitle: BADGE_TITLES[badgeId as BadgeId],
      prompt: dto.prompt,
      difficulty: dto.difficulty,
      count: dto.count,
    });
  }

  @Patch('badges/:badgeId/trainings/reorder')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Reordena a insígnia em lote atômico',
    description:
      'Recebe a lista inteira de ids na ordem nova. Precisa bater exatamente ' +
      'com o conjunto que existe: as três formas de errar — faltando, sobrando ' +
      'e repetido — são 400, antes de qualquer escrita.\n\n' +
      'As posições são renormalizadas para 0..n-1 **num lote atômico**. Uma ' +
      'atualização por item deixa dois treinamentos em `position: 3` quando a ' +
      'segunda escrita falha, e essa lista fica errada em silêncio.',
  })
  @ApiResponse({ status: 204, description: 'Reordenado.' })
  @ApiResponse({ status: 400, description: 'A ordem não bate com a insígnia.' })
  async reorder(
    @Param('badgeId') badgeId: string,
    @Body() dto: ReorderTrainingsDto,
  ): Promise<void> {
    await this.trainings.reorder(badgeId, dto);
  }

  @Patch('trainings/:trainingId')
  @ApiOperation({ summary: 'Edita o desafio' })
  @ApiResponse({ status: 200, type: TrainingDto })
  @ApiResponse({ status: 404, description: 'Treinamento inexistente.' })
  async update(
    @Param('trainingId') trainingId: string,
    @Body() dto: UpdateTrainingDto,
  ): Promise<TrainingDto> {
    return this.trainings.updateTraining(trainingId, dto);
  }

  @Delete('trainings/:trainingId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Exclui o desafio, seus comentários e suas conclusões',
    description:
      '**A exclusão é em cascata, e precisa ser.** No Firestore nada some ' +
      'junto com o pai: sem esta limpeza os comentários e as conclusões do ' +
      'desafio apagado ficam invisíveis, cobrados e impossíveis de encontrar ' +
      'depois. As posições dos que sobraram voltam a ser 0..n-1.',
  })
  @ApiResponse({ status: 204, description: 'Excluído.' })
  @ApiResponse({ status: 404, description: 'Treinamento inexistente.' })
  async remove(@Param('trainingId') trainingId: string): Promise<void> {
    await this.trainings.removeTraining(trainingId);
  }

  @Get('trainings/comments/recent')
  @ApiOperation({
    summary: 'Comentários mais recentes de toda a Arena',
    description:
      'O painel centralizado. Cada linha carrega o título do desafio ' +
      'comentado — sem ele o admin lê "travei no passo 3" sem saber de onde, e ' +
      'precisa abrir a trilha para descobrir.',
  })
  @ApiResponse({ status: 200, type: AdminTrainingCommentListDto })
  async listRecentComments(): Promise<AdminTrainingCommentListDto> {
    return this.trainings.listRecentComments();
  }

  @Post('trainings/comments/:commentId/reply')
  @ApiOperation({
    summary: 'Responde ao comentário, direto no painel',
    description:
      'A resposta é gravada **no próprio comentário**, em `adminReply`. Uma ' +
      'por comentário: responder de novo sobrescreve a anterior, que é o certo ' +
      'para o que a tela faz — o admin corrige o que escreveu, não conversa em fio.',
  })
  @ApiResponse({ status: 201, type: TrainingCommentDto })
  @ApiResponse({ status: 404, description: 'Comentário inexistente.' })
  async reply(
    @CurrentUser() user: CurrentUserData,
    @Param('commentId') commentId: string,
    @Body() dto: AdminReplyDto,
  ): Promise<TrainingCommentDto> {
    return this.trainings.replyComment(user.id, commentId, dto.content);
  }
}
