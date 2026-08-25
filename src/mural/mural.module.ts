import { forwardRef, Module } from '@nestjs/common';
import { MuralRepository } from './mural.repository';
import { MuralService } from './mural.service';
import { VoteService } from './vote.service';
import { MuralController } from './mural.controller';
import { AdminMuralController } from './admin-mural.controller';
import { ProfileModule } from '../profile/profile.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // O ciclo com o ProfileModule nasceu na spec 013: excluir a conta anonimiza
  // as perguntas e apaga os votos. Ver o comentario em profile.module.ts.
  imports: [
    forwardRef(() => ProfileModule),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [MuralController, AdminMuralController],
  providers: [MuralRepository, MuralService, VoteService],
  exports: [MuralRepository, MuralService],
})
export class MuralModule {}
