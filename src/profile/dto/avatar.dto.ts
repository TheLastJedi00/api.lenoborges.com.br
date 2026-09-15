import { ApiProperty } from '@nestjs/swagger';

/**
 * A resposta de `POST /me/avatar` (spec 027).
 *
 * **Devolve a URL porque a rota tambem persiste**, e o front precisa do valor que
 * ficou gravado para pintar a foto na hora, sem um `GET /me` novo. Uma rota que so
 * subisse o arquivo exigiria um segundo pedido para gravar a URL, e a foto ficaria
 * no bucket sem dono quando o segundo falhasse.
 */
export class AvatarDto {
  @ApiProperty({
    example:
      'https://storage.googleapis.com/dev-liga-dev.firebasestorage.app/avatars/uid-1?v=1757000000000',
    description:
      'A URL publica da foto que acabou de subir, com o ?v= que derruba o cache',
  })
  avatarUrl: string;
}
