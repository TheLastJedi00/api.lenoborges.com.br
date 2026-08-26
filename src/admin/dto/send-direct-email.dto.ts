import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Um recado para uma pessoa (spec 015, decisão 12).
 *
 * **Não tem `ctaLabel` nem `ctaUrl`, e a ausência é decisão.** É o primeiro
 * campo que alguém vai querer "só adicionar", por simetria com a campanha: um
 * recado para uma pessoa não tem para onde apontar, e o único botão que
 * existiria seria "clique aqui". Quando houver um destino de verdade a apontar,
 * o e-mail que o leva é uma campanha, e a tela de campanha é outra.
 *
 * **`body` é texto puro com quebras de linha, e nunca HTML** (spec 014, decisão
 * 11). O escape é do `renderEmail`, e é de lá — marcação digitada aqui sai como
 * texto, e ninguém precisa reimplementar isso neste caminho.
 */
export class SendDirectEmailDto {
  @ApiProperty({
    example: 'Sobre a sua dúvida no Mural',
    minLength: 3,
    maxLength: 150,
  })
  @IsString({ message: 'O assunto deve ser um texto' })
  @IsNotEmpty({ message: 'O assunto é obrigatório' })
  @MinLength(3, { message: 'O assunto deve ter no mínimo 3 caracteres' })
  @MaxLength(150, { message: 'O assunto deve ter no máximo 150 caracteres' })
  subject: string;

  @ApiProperty({
    example: 'Oi, Leno.\n\nVi sua pergunta no Mural…',
    minLength: 10,
    maxLength: 5000,
    description:
      'O corpo, em TEXTO SIMPLES. Linha em branco separa parágrafos. Marcação ' +
      'digitada aqui sai como texto: o template escapa tudo',
  })
  @IsString({ message: 'O corpo deve ser um texto' })
  @IsNotEmpty({ message: 'O corpo é obrigatório' })
  @MinLength(10, { message: 'O corpo deve ter no mínimo 10 caracteres' })
  @MaxLength(5000, { message: 'O corpo deve ter no máximo 5000 caracteres' })
  body: string;
}
