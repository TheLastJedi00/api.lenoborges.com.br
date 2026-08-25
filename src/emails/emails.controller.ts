import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProfileRepository } from '../profile/profile.repository';
import { verifyUnsubscribeToken } from './unsubscribe-token';

/**
 * O que sai do produto e volta de fora (spec 014).
 *
 * **Os dois endpoints daqui são públicos**, e cada um tem o próprio jeito de
 * provar quem chamou: o descadastro por token assinado, o webhook por assinatura
 * do provedor. Nenhum deles exige sessão, e a ausência é decisão em ambos.
 */
@ApiTags('emails')
@Controller('emails')
export class EmailsController {
  private readonly logger = new Logger(EmailsController.name);
  private readonly unsubscribeSecret: string;

  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly configService: ConfigService,
  ) {
    this.unsubscribeSecret = this.configService.getOrThrow<string>(
      'EMAIL_UNSUBSCRIBE_SECRET',
    );
  }

  /**
   * Descadastro em um clique, sem login (decisão 9).
   *
   * Aceita `POST` **cru, sem confirmação nenhuma**, porque é isso que o
   * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` do Gmail e do Yahoo
   * dispara. Não é refinamento: é requisito de remetente em massa desde 2024, e
   * sem ele a entrega degrada por política, independentemente do conteúdo.
   *
   * **Responde `204` sempre**, inclusive com token inválido e com `uid` sem
   * perfil. Um endpoint público que diferencia token válido de inválido é um
   * oráculo de `uid`, e o descadastro não ganha nada com a distinção.
   *
   * Fica sob o `ThrottlerGuard` global com limite próprio: endpoint de escrita
   * público sem limite é o alvo mais barato que a API tem.
   */
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('descadastro')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sair da lista de e-mails',
    description:
      'PÚBLICO e IDEMPOTENTE. Aceita POST cru, sem confirmação, para atender o ' +
      'one-click do Gmail e do Yahoo. Responde 204 sempre — inclusive com token ' +
      'inválido —, porque diferenciar seria um oráculo de uid.',
  })
  @ApiResponse({ status: 204, description: 'Pedido registrado, ou ignorado.' })
  async unsubscribe(@Query('token') token?: string): Promise<void> {
    const uid = token
      ? verifyUnsubscribeToken(token, this.unsubscribeSecret)
      : null;

    if (!uid) {
      // Sem log de token, que é dado de terceiro; o que importa saber é que
      // alguém chegou aqui com um token que não confere.
      this.logger.warn('Descadastro com token invalido ou ausente.');
      return;
    }

    const { found } = await this.profileRepository.setEmailOptOut(
      uid,
      true,
      'membro',
    );

    if (!found) {
      this.logger.warn(`Descadastro para uid sem perfil: ${uid}`);
    }
  }
}
