import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
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
import { BADGE_TITLES } from '../track/track.constants';
import type { BadgeId } from '../track/track.constants';
import { DIFFICULTIES, Difficulty } from './games.constants';
import { GymQuestionService } from './gym-question.service';
import { GeminiService } from './gemini.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { GenerateQuestionsDto } from './dto/generate-questions.dto';
import type { GeneratedQuestionsDto } from './dto/generate-questions.dto';
import { BulkCreatedQuestionsDto } from './dto/generate-questions.dto';
import { BulkCreateQuestionsDto } from './dto/bulk-create-questions.dto';
import { ChallengeConfigService } from './challenge-config.service';
import {
  ChallengeConfigDto,
  SetChallengeConfigDto,
} from './dto/challenge-config.dto';
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
  constructor(
    private readonly questions: GymQuestionService,
    private readonly gemini: GeminiService,
    private readonly config: ChallengeConfigService,
  ) {}

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

  @Post(':badgeId/questions/generate')
  @ApiOperation({
    summary: 'Gera questões com IA — rascunho, sem gravar nada',
    description:
      'Devolve uma proposta para o admin revisar. **Nada é persistido aqui**: ' +
      'o que grava é o `bulk`, depois que ele editou e escolheu. Questão fora ' +
      'do formato é descartada em silêncio, e `discarded` diz quantas foram.',
  })
  @ApiResponse({ status: 200, description: 'Rascunho de questões' })
  @ApiResponse({
    status: 503,
    description: 'Sem GEMINI_API_KEY, ou a IA não respondeu',
  })
  async generate(
    @Param('badgeId') badgeId: string,
    @Body() dto: GenerateQuestionsDto,
  ): Promise<GeneratedQuestionsDto> {
    // A conferencia do `badgeId` vem antes da chamada paga. Gerar trinta
    // questoes para uma insignia que nao existe custaria a chamada inteira para
    // depois responder 404 no `bulk`.
    await this.questions.counts(badgeId);

    return this.gemini.generate({
      badgeTitle: BADGE_TITLES[badgeId as BadgeId],
      prompt: dto.prompt,
      difficulty: dto.difficulty,
      count: dto.count,
    });
  }

  @Post(':badgeId/questions/bulk')
  @ApiOperation({
    summary: 'Grava em lote as questões aprovadas do rascunho',
    description:
      'Tudo ou nada, inclusive na conferência do teto de 33 por nível: gravar ' +
      'as que cabem deixaria o admin com um rascunho parcialmente salvo e ' +
      'nenhuma forma de saber quais entraram.',
  })
  @ApiResponse({ status: 201, type: BulkCreatedQuestionsDto })
  @ApiResponse({ status: 409, description: 'O lote estoura o teto do nível' })
  async bulk(
    @Param('badgeId') badgeId: string,
    @Body() dto: BulkCreateQuestionsDto,
  ): Promise<BulkCreatedQuestionsDto> {
    const entries = await this.questions.createMany(badgeId, dto.questions);

    return { questions: entries.map(toQuestionDto) };
  }

  @Get(':badgeId/challenge-config')
  @ApiOperation({
    summary: 'A configuração do desafio, com a contagem de questões',
    description:
      'O XP mínimo e o banco de questões vêm juntos porque a tela os desenha ' +
      'no mesmo bloco: a configuração sem o banco embaixo não tem contexto.',
  })
  @ApiResponse({ status: 200, type: ChallengeConfigDto })
  async getConfig(
    @Param('badgeId') badgeId: string,
  ): Promise<ChallengeConfigDto> {
    return this.config.get(badgeId);
  }

  @Put(':badgeId/challenge-config')
  @ApiOperation({
    summary: 'Define o XP mínimo para participar',
    description:
      'Zero é sem exigência, e é o padrão de quem nunca configurou. Salvar ' +
      'duas vezes é a operação normal da tela.',
  })
  @ApiResponse({ status: 200, type: ChallengeConfigDto })
  async setConfig(
    @Param('badgeId') badgeId: string,
    @Body() dto: SetChallengeConfigDto,
  ): Promise<ChallengeConfigDto> {
    return this.config.set(badgeId, dto.requiredXp);
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
