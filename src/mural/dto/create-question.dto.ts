import { IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  QUESTION_BODY_MAX,
  QUESTION_TITLE_MAX,
  QUESTION_TITLE_MIN,
} from '../mural.constants';

/**
 * Uma pergunta do Mural.
 *
 * **Texto puro, sem markdown e sem HTML.** Não porque escapar seja difícil — o
 * Angular escapa sozinho —, mas porque um campo que aceita formatação convida
 * `innerHTML` no primeiro pedido de "deixa o código em `<pre>`", e aí a
 * superfície de XSS aparece num commit que ninguém revisou como se fosse de
 * segurança. Ver a decisão 10 da spec 010.
 *
 * Note o que **não** está aqui: `weekId`. Ele é carimbado pelo servidor. Cliente
 * que escolhe a própria semana escolhe também votar na semana errada.
 */
export class CreateQuestionDto {
  @ApiProperty({
    example: 'poo',
    description:
      'A insígnia sobre a qual a pergunta é. Validada contra a trilha',
  })
  @IsString()
  badgeId: string;

  @ApiProperty({
    example: 'Como saber quando usar herança em vez de composição?',
    minLength: QUESTION_TITLE_MIN,
    maxLength: QUESTION_TITLE_MAX,
  })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(QUESTION_TITLE_MIN, QUESTION_TITLE_MAX)
  title: string;

  @ApiProperty({
    required: false,
    maxLength: QUESTION_BODY_MAX,
    description: 'Contexto opcional. Texto puro',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(0, QUESTION_BODY_MAX)
  body?: string;
}
