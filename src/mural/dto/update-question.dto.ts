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
 * `badgeId` não está aqui, e agora por dois motivos.
 *
 * O primeiro é da spec 010: trocar a insígnia de uma pergunta é fazer outra
 * pergunta, e o limite de uma por semana existe justamente para a pessoa
 * escolher.
 *
 * O segundo nasceu na spec 012 e só ficou escrito na 016: **a notificação de
 * pergunta nova carrega o `badgeId`**, e é por ele que a Liga filtra. Trocar a
 * insígnia depois deixaria um aviso publicado na trilha de Angular apontando
 * para uma pergunta que agora é de POO — e reemitir a notificação faria a mesma
 * pergunta ser anunciada duas vezes.
 *
 * Editar é corrigir o texto. Trocar de assunto é outra pergunta, e ela tem
 * semana própria.
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
