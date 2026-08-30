import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { StartRoundDto } from './dto/round-question.dto';
import { AnswerQuestionDto, AnswerResultDto } from './dto/answer-question.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { GamesService } from './games.service';
import { ChallengeListDto, ChallengeStateDto } from './dto/challenge-state.dto';

/**
 * O GYM Challenge do lado de quem joga (spec 022).
 *
 * **Rotas autenticadas comuns, sem isencao nenhuma do `LegalAcceptanceGuard`**
 * (adendo A.4): quem nao aceitou os documentos nao joga, nao ganha XP e nao
 * aparece no ranking -- e nao houve uma linha escrita para isso ser verdade.
 */
@ApiTags('games')
@ApiBearerAuth()
@Controller('games')
@UseGuards(FirebaseAuthGuard)
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get('challenges')
  @ApiOperation({
    summary: 'As oito insígnias com o estado do desafio de cada uma',
    description:
      'Só as oito do GYM Battle: a Elite Four e a Battle Frontier não têm ' +
      'desafio (ponto Q.2).\n\n' +
      '`hasActiveRound` vem sempre `false` nesta rota — descobri-lo custaria ' +
      'oito consultas de subcoleção para pintar oito cards. Quem precisa dele é ' +
      'a tela do desafio, que lê uma só.',
  })
  @ApiResponse({ status: 200, type: ChallengeListDto })
  async list(@CurrentUser() user: CurrentUserData): Promise<ChallengeListDto> {
    return { challenges: await this.games.listChallenges(user.id) };
  }

  @Get('challenges/:badgeId')
  @ApiOperation({
    summary: 'O desafio de uma insígnia, com a rodada onde o membro parou',
    description:
      '`hasActiveRound` diz se há rodada aberta — é o que troca o botão de ' +
      '"Iniciar" para "Continuar". `replay` diz que a rodada corrente já foi ' +
      'aprovada e que jogar de novo é treino, sem XP.',
  })
  @ApiResponse({ status: 200, type: ChallengeStateDto })
  @ApiResponse({ status: 404, description: 'Insígnia sem GYM Challenge' })
  async detail(
    @CurrentUser() user: CurrentUserData,
    @Param('badgeId') badgeId: string,
  ): Promise<ChallengeStateDto> {
    return this.games.getChallenge(user.id, badgeId);
  }

  /**
   * `10/min`: ninguém inicia dez desafios por minuto em uso normal (decisão 19).
   *
   * O limite existe porque cada `start` sorteia dez questões e escreve onze
   * documentos — é a rota mais cara do módulo, e a única que um script poderia
   * repetir de graça para descobrir o banco inteiro por amostragem.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('challenges/:badgeId/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Inicia (ou reinicia) a rodada corrente',
    description:
      'Sorteia 10 questões da dificuldade da rodada e devolve as dez de uma ' +
      'vez, **sem a resposta certa**. As respostas voltam uma por uma.\n\n' +
      'Servir todas juntas deixa o membro inspecionar as perguntas seguintes, e ' +
      'isso é aceito: ele vê as perguntas, não as respostas, e olhar a próxima ' +
      'não dá vantagem quando a pressão é de tempo. A alternativa custaria dez ' +
      'idas ao servidor por rodada, cada pergunta esperando a latência da ' +
      'anterior.',
  })
  @ApiResponse({ status: 200, type: StartRoundDto })
  @ApiResponse({
    status: 403,
    description: 'Desafio indisponível (< 90 questões) ou XP insuficiente',
  })
  @ApiResponse({ status: 409, description: 'Já há uma rodada em andamento' })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async start(
    @CurrentUser() user: CurrentUserData,
    @Param('badgeId') badgeId: string,
  ): Promise<StartRoundDto> {
    return this.games.startRound(user.id, badgeId);
  }

  /**
   * `120/min`: dez respostas por rodada, com folga larga para retry (decisão 19).
   *
   * O limite é generoso de propósito — apertá-lo puniria a conexão ruim, que é
   * exatamente quem o `clientElapsedMs` existe para proteger. O que impede o
   * abuso aqui não é o throttle, é o `409` da questão já respondida.
   */
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Post('challenges/:badgeId/answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Responde uma questão da rodada aberta',
    description:
      'Devolve o resultado imediato: certo ou errado, qual era a certa, e o XP ' +
      'daquela questão. **O front não calcula XP e não conhece a fórmula** — ele ' +
      'mede o tempo e manda o `clientElapsedMs`, e o servidor decide.\n\n' +
      'Na décima resposta a rodada é consolidada, e o corpo ganha `score`, ' +
      '`roundPassed` e — quando as três fecham — `badgeUnlocked` e `grade`.\n\n' +
      '`totalXp` é o XP do membro **depois** desta resposta: é ele que a tela ' +
      'grava no AuthStore. Somar `xp + xpAwarded` localmente erra no replay e em ' +
      'toda resposta errada.',
  })
  @ApiResponse({ status: 200, type: AnswerResultDto })
  @ApiResponse({ status: 400, description: 'Índice de questão inválido' })
  @ApiResponse({ status: 409, description: 'Essa questão já foi respondida' })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async answer(
    @CurrentUser() user: CurrentUserData,
    @Param('badgeId') badgeId: string,
    @Body() dto: AnswerQuestionDto,
  ): Promise<AnswerResultDto> {
    return this.games.answer(user.id, badgeId, dto);
  }
}
