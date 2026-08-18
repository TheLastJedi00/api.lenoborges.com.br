import { ApiProperty } from '@nestjs/swagger';
import { AdminUserDto } from './admin-user.dto';

export class AdminUserPageDto {
  @ApiProperty({ type: [AdminUserDto] })
  users: AdminUserDto[];

  @ApiProperty({
    nullable: true,
    example: 'AGxvbGE',
    description:
      'Token da próxima página, do Firebase Auth. Nulo no fim. A paginação é a ' +
      'do Auth e não a do Firestore, porque o Auth é a fonte de quem existe — ' +
      'paginar pelo Firestore esconderia quem ainda não tem perfil',
  })
  nextPageToken: string | null;
}
