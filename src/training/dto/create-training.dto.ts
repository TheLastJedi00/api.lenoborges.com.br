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
    description:
      'O cenário do desafio, expandido dentro do modal. **Conta a situação, ' +
      'não o alvo** — onde se chega é o `objective` (spec 025)',
  })
  @IsString()
  @Transform(trim)
  @Length(3, 600)
  description: string;

  @ApiProperty({
    example: 'Um laço lido de cima a baixo sem rolar a tela.',
    description:
      'O resultado esperado do desafio. Separado da descrição de propósito: ' +
      'enquanto os dois moravam no mesmo texto, o membro lia um parágrafo e ' +
      'adivinhava qual frase era o alvo (spec 025)',
  })
  @IsString()
  @Transform(trim)
  @Length(3, 300)
  objective: string;

  @ApiProperty({
    type: [String],
    example: [
      'Repare quantas responsabilidades o laço acumula.',
      'Uma delas dá nome a uma função sozinha.',
      'Extraia a menor primeiro, e rode os testes.',
    ],
    description:
      'As dicas de raciocínio, na ordem do pensamento, uma por item. Cada ' +
      'dica revelada custa 1 XP ao membro. **Pelo menos uma** — a Arena ' +
      'existe para ensinar raciocínio, e um desafio que não oferece nenhuma ' +
      'saída quando o membro trava só paga quem já sabia. Quem quiser o ' +
      'desafio duro escreve uma dica cara (spec 025)',
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
  hints: string[];

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
