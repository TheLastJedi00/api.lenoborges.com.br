import { IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  QUESTION_BODY_MAX,
  QUESTION_TITLE_MAX,
  QUESTION_TITLE_MIN,
} from '../mural.constants';

/**
 * Reescreve a própria pergunta, enquanto a semana está em coleta.
 *
 * `badgeId` não está aqui: trocar a insígnia de uma pergunta é fazer outra
 * pergunta, e o limite de uma por semana existe justamente para a pessoa
 * escolher.
 */
export class UpdateQuestionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(QUESTION_TITLE_MIN, QUESTION_TITLE_MAX)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(0, QUESTION_BODY_MAX)
  body?: string;
}
