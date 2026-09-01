import { forwardRef, Module } from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';
import { NicknameRepository } from './nickname.repository';
import { ProfileController } from './profile.controller';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { AuthModule } from '../auth/auth.module';
import { MuralModule } from '../mural/mural.module';
import { LegalModule } from '../legal/legal.module';
import { WatchedVideoModule } from '../track/watched-video.module';
import { MembersController } from './members.controller';
import { GamesDataModule } from '../games/games-data.module';
import { TrainingDataModule } from '../training/training-data.module';

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
 *
 * O `TrackModule` (spec 019) e o quarto, e o ciclo tem o mesmo formato dos
 * outros tres: `PUT /me/watched-videos/:videoId` mora no `ProfileController`
 * porque o prefixo `/me` e dele, com o `WatchedVideoService` de la; e a exclusao
 * de conta precisa do `WatchedVideoRepository` para apagar a subcolecao do
 * razao. Do outro lado, o `BadgeVideoService` le o `xp` pelo `ProfileRepository`
 * depois de marcar.
 */
@Module({
  imports: [
    WaitlistModule,
    forwardRef(() => AuthModule),
    forwardRef(() => MuralModule),
    forwardRef(() => LegalModule),
    WatchedVideoModule,
    // **E o quinto que NAO virou ciclo, e isso e a decisao** (spec 022).
    // Escolher a gamertag coloca a pessoa no placar, e excluir a conta apaga a
    // linha do placar e os desafios com a subcolecao dentro -- este modulo
    // precisa do `RankingRepository` e do `GymChallengeRepository`. Pendura-los
    // no `GamesModule` obrigaria a importar o `GamesModule` inteiro, que importa
    // este de volta; o `GamesDataModule` nao importa nada e corta a volta na
    // raiz. Ver o comentario dele, e o do `WatchedVideoModule`, que resolveu o
    // mesmo problema na spec 019 depois de derrubar o boot.
    GamesDataModule,
    // **E o sexto que NAO virou ciclo, pela mesma razao** (spec 023). Excluir a
    // conta apaga as conclusoes e os comentarios da Arena, entao este modulo
    // precisa dos dois repositorios de la. O TrainingModule importa ESTE de
    // volta, para ler o tier de quem comenta -- pendura-los no TrainingModule
    // fecharia o ciclo de arquivos que derruba o boot sem nenhum teste unitario
    // notar. O TrainingDataModule nao importa nada e corta a volta na raiz.
    TrainingDataModule,
  ],
  controllers: [ProfileController, MembersController],
  providers: [ProfileRepository, ProfileService, NicknameRepository],
  exports: [ProfileRepository, ProfileService, NicknameRepository],
})
export class ProfileModule {}
