import { contentHashOf } from './content-hash';
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_IDS,
  LEGAL_DOCUMENT_LIST,
} from './legal.documents';

describe('LEGAL_DOCUMENTS', () => {
  /**
   * **O teste que existe para ser quebrado** (spec 018, decisao 3).
   *
   * Editar uma virgula de qualquer clausula derruba esta linha, e o unico jeito
   * de deixa-la verde e escrever o hash novo -- o que obriga a olhar a linha da
   * versao, que fica logo acima dela no arquivo. Sem isto, o texto muda, o
   * numero fica, ninguem e chamado a aceitar de novo e nada falha em lugar
   * nenhum; a descoberta acontece no dia em que alguem pede reembolso citando um
   * texto que o produto nao mostra mais.
   */
  it.each(LEGAL_DOCUMENT_LIST)(
    'teste-trava: o contentHash de $id confere com o texto',
    (document) => {
      expect(contentHashOf(document)).toBe(document.contentHash);
    },
  );

  it.each(LEGAL_DOCUMENT_LIST)(
    'a versao de $id e uma data YYYY-MM-DD, e updatedAt a acompanha',
    (document) => {
      // Data e nao `v1`/`v2`: "aceitei em 12/03 a versao de 27/08" e a frase que
      // a tela de Contratos precisa mostrar, e ela nao funciona com um numero
      // sequencial. O `v2` que alguem vai escrever por habito morre aqui.
      expect(document.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(document.updatedAt).toBe(document.version);
    },
  );

  it.each(LEGAL_DOCUMENT_LIST)(
    'o id de $id serve como segmento de caminho no Firestore',
    (document) => {
      // O id vira `legal_acceptances/{documentId}__{version}`. Uma barra aqui
      // parte o caminho em dois segmentos e a escrita falha com um erro que nao
      // menciona este campo.
      expect(document.id).toMatch(/^[a-z0-9-]+$/);
    },
  );

  it.each(LEGAL_DOCUMENT_LIST)('$id tem titulo e secoes', (document) => {
    expect(document.title.length).toBeGreaterThan(0);
    expect(document.sections.length).toBeGreaterThan(0);
    for (const section of document.sections) {
      expect(section.paragraphs.length).toBeGreaterThan(0);
    }
  });

  it('a chave do registro e o proprio id do documento', () => {
    // O guard e o endpoint de aceite indexam LEGAL_DOCUMENTS pelo id que chega
    // do front. Chave divergindo do `id` faria `findById` achar um documento e
    // devolver outro.
    for (const [key, document] of Object.entries(LEGAL_DOCUMENTS)) {
      expect(key).toBe(document.id);
    }
  });

  it('LEGAL_DOCUMENT_IDS e derivado, e cobre os dois documentos vigentes', () => {
    expect(LEGAL_DOCUMENT_IDS).toEqual([
      'termos-de-uso',
      'politica-de-privacidade',
    ]);
  });
});
