import { ApiProperty } from '@nestjs/swagger';

/**
 * Identidade do documento, **sem o texto**.
 *
 * E o que a listagem publica devolve, o que o corpo do `428` carrega e o que
 * `GET /me` traz em `pendingLegal`. Mandar o documento inteiro na listagem seria
 * dezenas de KB em todo carregamento de rodape, para uma tela que so precisa do
 * titulo.
 */
export class LegalDocumentSummaryDto {
  @ApiProperty({ example: 'termos-de-uso' })
  id: string;

  @ApiProperty({ example: 'Termos de Uso' })
  title: string;

  @ApiProperty({ example: '2026-08-27' })
  version: string;
}
