import { forwardRef, Module } from '@nestjs/common';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';
import { LegalAcceptanceRepository } from './legal-acceptance.repository';
import { LegalAcceptanceGuard } from './legal-acceptance.guard';
import { ProfileModule } from '../profile/profile.module';

/**
 * Exporta o servico e o guard porque os dois tem consumidores fora daqui: o
 * `ProfileController` grava o aceite e monta o `pendingLegal` do `GET /me`, e o
 * `AppModule` registra o guard globalmente.
 */
@Module({
  imports: [forwardRef(() => ProfileModule)],
  controllers: [LegalController],
  providers: [LegalService, LegalAcceptanceRepository, LegalAcceptanceGuard],
  exports: [LegalService, LegalAcceptanceRepository, LegalAcceptanceGuard],
})
export class LegalModule {}
