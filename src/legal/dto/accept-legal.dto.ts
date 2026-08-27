import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Corpo de `POST /me/legal-acceptances` (spec 018, decisao 5).
 *
 * **Um documento por chamada**, e nao um "aceito tudo que estiver vigente": sao
 * dois modais, abertos em momentos diferentes, cada um com o proprio check. Um
 * endpoint que aceita o pacote inteiro deixa um bug de front registrar aceite de
 * um documento que ninguem abriu -- e o registro de aceite e a unica prova que
 * vai existir de que alguem concordou.
 *
 * **A versao vem no corpo e e conferida contra a vigente.** Sem ela, o backend
 * adivinharia a versao e o `409` de aba velha nunca aconteceria: quem esta com a
 * aba aberta desde antes do deploy aceitaria um texto que nao e mais o texto.
 */
export class AcceptLegalDto {
  @ApiProperty({
    example: 'termos-de-uso',
    description: 'Id do documento aceito. Desconhecido é 404, não 400',
  })
  // Sem `@IsIn(LEGAL_DOCUMENT_IDS)` de proposito: id desconhecido e 404 do
  // servico, e nao 400 de validacao. A diferenca importa para o front distinguir
  // "aba velha" de "front quebrado".
  @IsString({ message: 'documentId deve ser um texto' })
  @IsNotEmpty({ message: 'documentId é obrigatório' })
  documentId: string;

  @ApiProperty({
    example: '2026-08-27',
    description:
      'Versão exibida ao usuário. Diferente da vigente responde 409 com a ' +
      'versão atual, e o front recarrega o documento',
  })
  @IsString({ message: 'version deve ser um texto' })
  @IsNotEmpty({ message: 'version é obrigatória' })
  version: string;
}
