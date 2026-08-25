import { Module } from '@nestjs/common';
import { MemberDirectoryService } from './member-directory.service';
import { ProfileModule } from '../profile/profile.module';

/**
 * O módulo existe só para a varredura ter um dono e nenhum ciclo.
 *
 * A Administração e o disparo de e-mail precisam dela, e a Administração
 * também precisa do `EmailCampaignService` para o e-mail direto (spec 015,
 * Fase 04). Deixar o varredor dentro do `AdminModule` fecharia o grafo em
 * `AdminModule -> EmailsModule -> AdminModule`, que só se resolve com dois
 * `forwardRef` — e `forwardRef` que existe por acidente de arrumação é dívida
 * que ninguém consegue distinguir do `forwardRef` que existe por decisão, como
 * o do `ProfileModule`.
 */
@Module({
  imports: [ProfileModule],
  providers: [MemberDirectoryService],
  exports: [MemberDirectoryService],
})
export class MemberDirectoryModule {}
