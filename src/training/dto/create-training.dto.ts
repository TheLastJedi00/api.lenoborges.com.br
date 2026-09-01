import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { DEFAULT_TRAINING_XP } from '../training.constants';

/** Tira o espaço das pontas sem estourar quando o valor não é texto. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateTrainingDto {
  @ApiProperty({
    example: 'Refatore o laço em três funções',
    description: 'O título do desafio, como ele aparece no card da trilha',
  })
  @IsString()
  @Transform(trim)
  @Length(3, 140)
  title: string;

  @ApiProperty({
    example: 'Um exercício de leitura antes de escrever.',
    description: 'A descrição curta do card, expandida dentro do modal',
  })
  @IsString()
  @Transform(trim)
  @Length(3, 600)
  description: string;

  @ApiProperty({
    type: [String],
    example: ['Clone o repositório', 'Rode os testes', 'Extraia as funções'],
    description:
      'Os passos a executar, na ordem, um por item. **Pelo menos um** — um ' +
      'desafio sem passo é um card que abre num modal vazio',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(1, 500, { each: true })
  @Transform(({ value }: { value: unknown }): unknown =>
    Array.isArray(value)
      ? (value as unknown[]).map((item) =>
          typeof item === 'string' ? item.trim() : item,
        )
      : value,
  )
  steps: string[];

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    description:
      'Um vídeo de apoio, opcional. **É a URL crua**, e não o ID extraído como ' +
      'em `badge_videos`: aqui o vídeo é anexo do enunciado, não o conteúdo, e ' +
      'amarrar o campo ao YouTube fecharia a porta para qualquer outra ' +
      'hospedagem sem ganho nenhum',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  videoUrl?: string;

  @ApiProperty({
    required: false,
    example: DEFAULT_TRAINING_XP,
    description:
      'Quanto o desafio paga, uma vez só. Sem valor, nasce com o padrão de ' +
      `${DEFAULT_TRAINING_XP}. Fica no documento, e não na constante: um ` +
      'exercício de trinta minutos e um de três horas não valem a mesma coisa',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  xpAmount?: number;
}
