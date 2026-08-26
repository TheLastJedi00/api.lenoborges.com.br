import { ApiProperty } from '@nestjs/swagger';
import { AdminUserDto } from './admin-user.dto';

/**
 * Uma página do recorte (spec 015, decisão 2).
 *
 * **O `nextPageToken` saiu, e a quebra é declarada.** Ele era o cursor do
 * Firebase Auth, e depois da decisão 1 a paginação não é mais do Auth: ela é
 * sobre uma lista já filtrada e reordenada, que o Auth nunca viu. Não existe
 * token para devolver.
 */
export class AdminUserPageDto {
  @ApiProperty({ type: [AdminUserDto] })
  users: AdminUserDto[];

  @ApiProperty({
    example: 213,
    description:
      'O tamanho do RECORTE, e NÃO da base. Com filtro ligado os dois números ' +
      'são diferentes, e a tela precisa escrever a diferença ("12 de 213 ' +
      'membros"): um número grande sozinho é lido como o tamanho da comunidade',
  })
  total: number;

  @ApiProperty({
    example: 0,
    description: 'Deslocamento desta página DENTRO do recorte',
  })
  offset: number;

  @ApiProperty({ example: 50, description: 'Tamanho pedido, no teto de 200' })
  limit: number;
}
