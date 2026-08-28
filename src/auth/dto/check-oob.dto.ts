import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Corpo de `POST /auth/password/check` e de `POST /auth/email-action`.
 *
 * **Nao ha campo `mode`, e a ausencia e a decisao 3 da spec 020.** O `mode`
 * chega na URL do navegador, escrito por quem manda o link e nao pelo Firebase,
 * e um `switch` sobre ele aqui seria a API deixando o cliente escolher qual
 * operacao executar sobre uma credencial. Quem decide e o proprio `oobCode`:
 * ele carrega o `requestType`, e o Firebase recusa um codigo de reset usado
 * como codigo de verificacao. Deixar a recusa acontecer la e ter uma regra em
 * vez de duas.
 *
 * O `whitelist` do ValidationPipe recusa o corpo que traga `mode` assim mesmo,
 * e ha teste-trava disso no controller.
 */
export class CheckOobDto {
  @ApiProperty({
    example: 'C0d1gO_qu3_v31o_n0_l1nk',
    description:
      'Código de uso único que o Firebase pôs na query do link do e-mail. ' +
      'É ele quem carrega o requestType: o corpo não diz qual operação executar.',
  })
  @IsString({ message: 'Código deve ser um texto' })
  @IsNotEmpty({ message: 'Código é obrigatório' })
  @MaxLength(2000, { message: 'Código inválido' })
  oobCode: string;
}
