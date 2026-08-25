import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
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
import { AudienceService } from './audience.service';
import { AudienceFilterDto } from './dto/audience-filter.dto';

/** Só a contagem. Ver o comentário do endpoint. */
export class AudienceCountDto {
  count: number;
}

@ApiTags('emails')
@ApiBearerAuth()
@Controller('admin/emails')
@UseGuards(FirebaseAuthGuard, AdminGuard)
export class AdminEmailsController {
  constructor(private readonly audience: AudienceService) {}

  /**
   * Prévia da audiência, antes do disparo (spec 014, decisão 14).
   *
   * Existe porque **disparo de e-mail é a operação mais irreversível do
   * produto**: excluir vídeo se republica, moderar pergunta se refaz, `grade`
   * errado se corrige. E-mail que saiu, saiu — não há edição, não há apagar, e o
   * erro fica na caixa de entrada de todo mundo, com o nome do produto em cima.
   *
   * **Devolve a contagem e nunca a lista de e-mails.** O admin precisa saber
   * *quantos*, e a tela já lista os membros em `/dashboard/admin/usuarios`. Uma
   * rota que despeja a base de e-mails a cada mudança de filtro é um vazamento
   * esperando um bug de autorização.
   */
  @Post('audiencia')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Contar a audiência de um conjunto de filtros',
    description:
      'Devolve SÓ o número. Nunca a lista de e-mails: uma rota que despeja a ' +
      'base a cada mudança de filtro é um vazamento esperando um bug de ' +
      'autorização, e a tela de usuários já lista quem existe.',
  })
  @ApiResponse({
    status: 200,
    description: 'Contagem da audiência.',
    type: AudienceCountDto,
  })
  @ApiResponse({ status: 403, description: 'Rota restrita a administradores.' })
  async countAudience(
    @Body() dto: AudienceFilterDto,
  ): Promise<AudienceCountDto> {
    const count = await this.audience.count({
      tiers: dto.tiers ?? null,
      gradeMin: dto.gradeMin ?? null,
      gradeMax: dto.gradeMax ?? null,
    });

    return { count };
  }
}
