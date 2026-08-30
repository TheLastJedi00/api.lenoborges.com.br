import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CreateQuestionDto } from './create-question.dto';

/**
 * As questoes aprovadas do rascunho, para gravar de uma vez.
 *
 * **O `@ValidateNested({ each: true })` com o `@Type` e o que faz este DTO
 * valer alguma coisa.** Sem os dois juntos, o `class-validator` confere que
 * `questions` e um array e **ignora o conteudo** -- e o conteudo aqui veio de um
 * modelo de linguagem, editado a mao numa tela, com quatro campos que precisam
 * estar certos. Um array de `{}` passaria, e o `create()` gravaria noventa
 * documentos vazios que so aparecem quando alguem tenta jogar.
 *
 * O `@Type` nao e enfeite do `@ValidateNested`: sem ele o `plainToInstance` nao
 * transforma os itens em `CreateQuestionDto`, e o validador nao acha decorador
 * nenhum para rodar. Os dois sozinhos nao fazem nada.
 */
export class BulkCreateQuestionsDto {
  @ApiProperty({
    type: [CreateQuestionDto],
    description:
      'As questões que o admin aprovou. O teto de 33 por nível é conferido no ' +
      'service, e o lote é **tudo ou nada**',
  })
  @IsArray()
  @ArrayMinSize(1)
  // Teto generoso e proposital: o rascunho da IA para em 30, mas o admin pode
  // colar uma lista propria. O limite que importa e o de 33 por nivel, e ele e
  // do service, porque depende do que ja esta gravado.
  @ArrayMaxSize(99)
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions: CreateQuestionDto[];
}
