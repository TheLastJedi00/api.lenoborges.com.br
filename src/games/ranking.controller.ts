import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { RankingService } from './ranking.service';
import { RankingPageDto } from './dto/ranking.dto';

/**
 * O Ranking da Liga (spec 022, decisoes 11 e 22).
 *
 * **Autenticada**, e nao publica: o placar mostra gamertag, XP e insignias de
 * todo mundo, e isso e informacao da comunidade para a comunidade -- nao para
 * quem passa pela landing. E, como toda rota desta spec, **nao e isenta do
 * `LegalAcceptanceGuard`**.
 */
@ApiTags('games')
@ApiBearerAuth()
@Controller('ranking')
@UseGuards(FirebaseAuthGuard)
export class RankingController {
  constructor(private readonly ranking: RankingService) {}

  @Get()
  @ApiOperation({
    summary: 'O Ranking da Liga, ordenado por XP',
    description:
      'Paginado por cursor, e **não por número de página**: com XP mudando a ' +
      'toda hora, a página 3 de agora não é a página 3 de daqui a um minuto, e ' +
      'um deslocamento numérico faria a rolagem repetir e pular gente.\n\n' +
      '`myPosition` vem sempre, mesmo que o membro não esteja nesta página — é ' +
      'a linha fixa do topo da tela.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Tamanho da página. Padrão 20, teto 50',
  })
  @ApiQuery({
    name: 'after',
    required: false,
    description:
      'O `nextCursor` da página anterior. **Opaco** — devolva o que recebeu',
  })
  @ApiResponse({ status: 200, type: RankingPageDto })
  @ApiResponse({ status: 400, description: 'Cursor de paginação inválido' })
  async page(
    @CurrentUser() user: CurrentUserData,
    @Query('limit') limit?: string,
    @Query('after') after?: string,
  ): Promise<RankingPageDto> {
    return this.ranking.page({
      uid: user.id,
      limit: limit === undefined ? undefined : Number(limit),
      after,
    });
  }
}
