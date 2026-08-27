import { LegalDocument } from './entities/legal-document.entity';
import { TERMOS_DE_USO } from './documents/termos-de-uso';
import { POLITICA_DE_PRIVACIDADE } from './documents/politica-de-privacidade';

/**
 * Os documentos vigentes, e a unica fonte deles (spec 018, decisao 1).
 *
 * O guard, o `GET /me` e o endpoint de aceite leem daqui. **Uma segunda lista de
 * ids em qualquer outro arquivo diverge no dia em que o terceiro documento
 * entrar** -- e o sintoma seria o pior possivel: um documento publicado que
 * ninguem e chamado a aceitar, sem erro nenhum em lugar nenhum.
 *
 * Adicionar um documento e adicionar uma linha aqui. Todo o resto -- listagem
 * publica, bloqueio, tela de Contratos, onboarding -- passa a inclui-lo sem
 * mudanca.
 */
export const LEGAL_DOCUMENTS: Readonly<Record<string, LegalDocument>> = {
  [TERMOS_DE_USO.id]: TERMOS_DE_USO,
  [POLITICA_DE_PRIVACIDADE.id]: POLITICA_DE_PRIVACIDADE,
};

/** Derivado, nunca escrito a mao: duas listas divergem, uma nao. */
export const LEGAL_DOCUMENT_IDS: readonly string[] =
  Object.keys(LEGAL_DOCUMENTS);

export const LEGAL_DOCUMENT_LIST: readonly LegalDocument[] =
  Object.values(LEGAL_DOCUMENTS);
