import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { GRADE_MAX, GRADE_MIN } from '../../profile/entities/profile.entity';

/**
 * O que o admin pode mudar num usuário: `grade`, e só.
 *
 * Não há promover a admin por aqui — isso é script de terminal, porque o
 * primeiro admin não teria quem o criasse. Não há desativar nem apagar: apagar
 * usuário é a operação irreversível do produto e não entra numa spec junto de
 * outras nove decisões.
 */
export class UpdateUserDto {
  @ApiProperty({
    example: 3,
    minimum: GRADE_MIN,
    maximum: GRADE_MAX,
    description:
      'Etapas concluídas: 0 a 8 são insígnias, 9 a 12 a Elite Four, 13 a ' +
      'Battle Frontier. A faixa vem das constantes da entidade, nunca reescrita à mão',
  })
  @IsOptional()
  @IsInt()
  @Min(GRADE_MIN)
  @Max(GRADE_MAX)
  grade?: number;
}
