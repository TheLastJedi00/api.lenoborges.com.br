import { IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * A gamertag escolhida pelo membro (spec 022, decisao 20).
 *
 * O formato e fechado de proposito: letras, numeros, hifen e underscore, de 3 a
 * 20 caracteres. **Espaco e acento ficam de fora** porque o nickname aparece num
 * placar publico ao lado do de outras pessoas, e um nome com espacos duplos ou
 * com caracteres que se leem igual e a forma mais simples de se passar por
 * outro membro. Nome real, com acento e espaco, e o `name` do perfil, e ele nao
 * vai ao ranking.
 */
export class SetNicknameDto {
  @ApiProperty({
    example: 'leno_dev',
    minLength: 3,
    maxLength: 20,
    description:
      'Letras, números, hífen e underscore. **Único e imutável** — uma vez ' +
      'gravado, `PUT /me/nickname` responde 409',
  })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Matches(/^[A-Za-z0-9_-]{3,20}$/, {
    message:
      'O gamertag aceita letras, números, hífen e underscore, de 3 a 20 caracteres.',
  })
  nickname: string;
}
