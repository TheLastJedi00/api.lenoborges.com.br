import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { ProfileDto } from './dto/profile.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
@UseGuards(FirebaseAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Obter dados do perfil do membro autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Perfil retornado com sucesso.',
    type: ProfileDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou expirado.',
  })
  async getProfile(@CurrentUser() user: CurrentUserData): Promise<ProfileDto> {
    // O papel vem do token que o guard acabou de verificar, e nao de uma nova
    // ida ao Firebase Auth. E o mesmo valor, uma viagem a menos.
    return this.profileService.getProfile(user.id, user.email, user.role);
  }

  /**
   * Throttle apertado, e nao os 10/min do perfil: sem ele a decisao de nao
   * revelar `EMAIL_EXISTS` vira teatro -- quem pode tentar mil vezes por minuto
   * enumera do mesmo jeito, so mais devagar.
   */
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('email')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Pedir a troca do e-mail de acesso',
    description:
      'ATENÇÃO: este endpoint NÃO troca o e-mail. Ele reautentica com a senha ' +
      'atual e pede ao Firebase que envie a confirmação PARA O ENDEREÇO NOVO. ' +
      'Quem troca o e-mail é o Google, quando o link for clicado — o oobCode ' +
      'não passa por esta API. Até lá, o login continua sendo pelo e-mail antigo.',
  })
  @ApiResponse({
    status: 202,
    description:
      'Pedido aceito e confirmação enviada ao endereço novo. A troca ainda ' +
      'não aconteceu.',
  })
  @ApiResponse({
    status: 400,
    description:
      'E-mail inválido, igual ao atual, ou recusado. A mensagem é a mesma nos ' +
      'três casos, de propósito: distinguir revelaria quais e-mails existem.',
  })
  @ApiResponse({ status: 401, description: 'Senha incorreta.' })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async changeEmail(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ChangeEmailDto,
  ): Promise<{ status: 'confirmation_sent' }> {
    return this.profileService.changeEmail(user.id, user.email, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Patch('profile')
  @ApiOperation({ summary: 'Completar onboarding ou atualizar perfil' })
  @ApiResponse({
    status: 200,
    description:
      'Perfil atualizado com sucesso. completed_at é preenchido na primeira vez.',
    type: ProfileDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Erro de validação nos campos (nome, telefone ou bio).',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou expirado.',
  })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async updateProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileDto> {
    return this.profileService.updateProfile(
      user.id,
      user.email,
      user.role,
      dto,
    );
  }
}
