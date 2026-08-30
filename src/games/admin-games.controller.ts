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
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { DIFFICULTIES, Difficulty } from './games.constants';
import { GymQuestionService } from './gym-question.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import {
  QuestionDto,
  QuestionListDto,
  toCountsDto,
  toQuestionDto,
} from './dto/question.dto';

/**
 * Administracao do banco de questoes do GYM Challenge (spec 022).
 *
 * Controller separado do publico pela mesma razao do `AdminTrackController`: o
 * `AdminGuard` vale no controller inteiro, e assim nao existe a chance de
 * esquecer o decorador numa rota nova. **A rota nova que esquecesse o guard aqui
 * publicaria o `correctIndex` de todo o banco** -- este e o unico controller do
 * produto em que a resposta certa trafega.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/badges')
@UseGuards(FirebaseAuthGuard, AdminGuard)
export class AdminGamesController {
  constructor(private readonly questions: GymQuestionService) {}

  @Get(':badgeId/questions')
  @ApiOperation({
    summary: 'Questões da insígnia, com a contagem por nível',
    description:
      'A contagem vem junto de propósito: é o cabeçalho da tela ("Fáceis: ' +
      '30/30, Médias: 28/30…") e uma segunda requisição para obtê-la seria a ' +
      'mesma leitura duas vezes.',
  })
  @ApiQuery({ name: 'difficulty', required: false, enum: DIFFICULTIES })
  @ApiResponse({ status: 200, type: QuestionListDto })
  @ApiResponse({ status: 404, description: 'Insígnia sem GYM Challenge' })
  async list(
    @Param('badgeId') badgeId: string,
    @Query('difficulty') difficulty?: string,
  ): Promise<QuestionListDto> {
    // O filtro da query e conferido aqui, e nao no service: um valor invalido e
    // uma aba que nao existe na tela, e tratar como "sem filtro" devolveria a
    // lista inteira sob um rotulo errado.
    const level = DIFFICULTIES.includes(difficulty as Difficulty)
      ? (difficulty as Difficulty)
      : undefined;

    const [entries, counts] = await Promise.all([
      this.questions.list(badgeId, level),
      this.questions.counts(badgeId),
    ]);

    return {
      questions: entries.map(toQuestionDto),
      counts: toCountsDto(counts),
    };
  }

  @Post(':badgeId/questions')
  @ApiOperation({ summary: 'Cria uma questão manualmente' })
  @ApiResponse({ status: 201, type: QuestionDto })
  @ApiResponse({ status: 409, description: 'O nível já está no teto de 33' })
  async create(
    @Param('badgeId') badgeId: string,
    @Body() dto: CreateQuestionDto,
  ): Promise<QuestionDto> {
    return toQuestionDto(await this.questions.create(badgeId, dto));
  }

  @Patch(':badgeId/questions/:questionId')
  @ApiOperation({
    summary: 'Edita uma questão',
    description:
      'Vale para as próximas rodadas. Quem está jogando agora não vê o texto ' +
      'mudar debaixo do dedo: a rodada ativa guarda a foto do enunciado.',
  })
  @ApiResponse({ status: 200, type: QuestionDto })
  @ApiResponse({ status: 404, description: 'Questão de outra insígnia' })
  async update(
    @Param('badgeId') badgeId: string,
    @Param('questionId') questionId: string,
    @Body() dto: UpdateQuestionDto,
  ): Promise<QuestionDto> {
    return toQuestionDto(await this.questions.update(badgeId, questionId, dto));
  }

  @Delete(':badgeId/questions/:questionId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove uma questão',
    description:
      'Cair abaixo de 90 devolve o desafio para "Em breve", e **quem já ' +
      'desbloqueou a insígnia não é afetado** (ponto Q.8).',
  })
  @ApiResponse({ status: 204, description: 'Removida' })
  async remove(
    @Param('badgeId') badgeId: string,
    @Param('questionId') questionId: string,
  ): Promise<void> {
    await this.questions.remove(badgeId, questionId);
  }
}
