import { forwardRef, Module } from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { AuthModule } from '../auth/auth.module';
import { MuralModule } from '../mural/mural.module';

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
 */
@Module({
  imports: [
    WaitlistModule,
    forwardRef(() => AuthModule),
    forwardRef(() => MuralModule),
  ],
  controllers: [ProfileController],
  providers: [ProfileRepository, ProfileService],
  exports: [ProfileRepository, ProfileService],
})
export class ProfileModule {}
