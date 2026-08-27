import { forwardRef, Module } from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { AuthModule } from '../auth/auth.module';
import { MuralModule } from '../mural/mural.module';
import { LegalModule } from '../legal/legal.module';

/**
 * O `forwardRef` no `AuthModule` e a spec 013 chegando: as tres operacoes de
 * credencial -- trocar e-mail, trocar senha, excluir a conta -- reautenticam
 * pelo `AuthService`, e o `AuthModule` ja importava este modulo desde a spec
 * 005. O ciclo e real e declarado, e nao um acidente a desfazer: quem tentar
 * resolve-lo duplicando o verificador de senha quebra a decisao 5 da spec 013.
 *
 * O `MuralModule` entra pelo mesmo motivo e pelo mesmo caminho: excluir a conta
 * anonimiza as perguntas e apaga os votos, e quem sabe fazer isso e o
 * `MuralRepository`.
 *
 * O `LegalModule` (spec 018) fecha mais um ciclo declarado: este modulo precisa
 * do `LegalService` para gravar o aceite e montar o `pendingLegal` do `GET /me`,
 * e o guard de la precisa do `ProfileRepository` para ler o mapa de aceites. E o
 * mesmo desenho do `AuthModule`, pela mesma razao -- as duas metades sao donas
 * de coisas diferentes e nenhuma delas deve duplicar a outra.
 */
@Module({
  imports: [
    WaitlistModule,
    forwardRef(() => AuthModule),
    forwardRef(() => MuralModule),
    forwardRef(() => LegalModule),
  ],
  controllers: [ProfileController],
  providers: [ProfileRepository, ProfileService],
  exports: [ProfileRepository, ProfileService],
})
export class ProfileModule {}
