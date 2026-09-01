import { PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CreateTrainingDto } from './create-training.dto';

/**
 * A edição: tudo opcional, mais a posição.
 *
 * **`badgeId` não entra**, nem aqui nem no create -- ele vem da URL. Mudar um
 * treinamento de insígnia é criar outro: a posição pertence à lista de origem, e
 * uma troca silenciosa deixaria um buraco na numeração da insígnia antiga.
 */
export class UpdateTrainingDto extends PartialType(CreateTrainingDto) {
  @ApiProperty({
    required: false,
    example: 0,
    description:
      'A posição na lista da insígnia, de 0 a n-1. **A rota de reorder é o ' +
      'caminho normal**: ela renormaliza a lista inteira num lote atômico, e ' +
      'este campo move um item só, sem tocar nos vizinhos',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
