import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { TierCatalogDto } from './dto/tier-catalog.dto';
import { ProfileRepository } from '../profile/profile.repository';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing')
@UseGuards(FirebaseAuthGuard)
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly profileRepository: ProfileRepository,
  ) {}

  @Get('tiers')
  @ApiOperation({
    summary: 'Catálogo de tiers, com preço',
    description:
      'Exige sessão, e essa é a única razão de o endpoint existir para um dado ' +
      'estático: o preço não pode sair no bundle público. Ver a decisão 1 da spec 009.',
  })
  @ApiResponse({ status: 200, type: TierCatalogDto })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou expirado.',
  })
  async getTiers(
    @CurrentUser() user: CurrentUserData,
  ): Promise<TierCatalogDto> {
    const profile = await this.profileRepository.findById(user.id);
    if (!profile.found || !profile.entry) {
      throw new NotFoundException('Perfil não encontrado.');
    }

    return this.billingService.getCatalog(profile.entry);
  }
}
