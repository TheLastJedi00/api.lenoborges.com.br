import { HttpException, HttpStatus } from '@nestjs/common';
import { LegalDocumentSummary } from './entities/legal-document.entity';

/**
 * A recusa por falta de aceite (spec 018, decisao 8).
 *
 * **`428 Precondition Required`, e nao `403`.** `403` diz "voce nao pode" e nao
 * tem continuacao; `428` diz "falta uma condicao previa" e vem com a lista do
 * que falta. O front decide o que fazer **pelo numero**, nunca procurando texto
 * dentro da mensagem de erro -- que e o acoplamento que quebra na primeira
 * revisao de copy.
 *
 * O `pending` no corpo e o que o modal de bloqueio desenha. Ele vem do mesmo
 * `LegalService.pendingFor` que alimenta o `pendingLegal` do `GET /me`: os dois
 * canais precisam dizer a mesma coisa, sempre.
 */
export class LegalAcceptanceRequiredException extends HttpException {
  constructor(pending: LegalDocumentSummary[]) {
    super(
      {
        statusCode: HttpStatus.PRECONDITION_REQUIRED,
        error: 'legal_acceptance_required',
        message:
          'É necessário aceitar os documentos vigentes para continuar usando a plataforma.',
        pending,
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
}
