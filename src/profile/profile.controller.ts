import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileDto } from './dto/profile.dto';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
@UseGuards(SupabaseAuthGuard)
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
    return this.profileService.getProfile(user.id, user.email);
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
    return this.profileService.updateProfile(user.id, user.email, dto);
  }
}
