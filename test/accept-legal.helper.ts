import request from 'supertest';
import type { App } from 'supertest/types';
import { LEGAL_DOCUMENT_LIST } from '../src/legal/legal.documents';

/**
 * Aceita os documentos legais vigentes por uma sessao recem-criada (spec 018).
 *
 * **Toda `createSession` dos e2e passou a precisar disto**, e essa e a prova de
 * que o `LegalAcceptanceGuard` esta de pe: sem esta chamada, a requisicao
 * seguinte de qualquer suite responde `428`. Se um dia alguem apagar o guard, os
 * testes continuam verdes -- entao o `legal.e2e-spec.ts` tem um caso que
 * verifica o bloqueio **antes** de aceitar, e e ele que cobra a existencia da
 * regra.
 *
 * Percorre `LEGAL_DOCUMENT_LIST` em vez de listar os dois ids: no dia em que
 * houver um terceiro documento, nenhuma suite muda.
 */
export async function acceptCurrentLegalDocuments(
  server: App,
  token: string,
): Promise<void> {
  for (const document of LEGAL_DOCUMENT_LIST) {
    await request(server)
      .post('/me/legal-acceptances')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentId: document.id, version: document.version })
      .expect(204);
  }
}
