import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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
}
