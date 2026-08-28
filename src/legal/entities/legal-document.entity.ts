/**
 * Um documento legal do produto (spec 018).
 *
 * **O texto mora aqui, junto da versao, e essa e a decisao 1 da spec.** Ele
 * poderia morar no front -- e conteudo, o front desenha conteudo, e edita-lo nao
 * exigiria subir uma API. Mora aqui porque **quem sabe qual e a versao vigente
 * precisa ser quem guarda o texto**: com o texto la e a versao aqui, existe um
 * estado em que a clausula de reembolso mudou, o numero nao mudou, e ninguem e
 * chamado a aceitar de novo. Nada falha, nada aparece no log, e a descoberta
 * acontece no dia em que alguem pede o reembolso citando um texto que o produto
 * nao mostra mais.
 *
 * **`paragraphs` e texto puro, e nunca vira HTML** (decisao 2). Nao ha tag, nao
 * ha markdown, nao ha `<p>`: o front renderiza `@for` sobre `@for` com
 * interpolacao. O dia em que este campo virar uma string de markup e o dia em
 * que o front precisa de um `bypassSecurityTrustHtml` para desenha-lo -- e
 * aquele `bypass` fica no codigo para sempre, inclusive quando a fonte deixar de
 * ser uma constante nossa.
 */
export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  /**
   * Identificador estavel do documento.
   *
   * **Vira caminho de documento no Firestore** (decisao 6):
   * `profiles/{uid}/legal_acceptances/{documentId}__{version}`. Kebab-case, sem
   * acento e sem `/` -- uma barra aqui parte o caminho em dois segmentos e a
   * escrita falha com um erro que nao menciona este campo.
   */
  id: string;
  title: string;
  /**
   * Data da versao, em `YYYY-MM-DD` (decisao 3).
   *
   * Data e nao `v1`/`v2` porque "aceitei em 12/03 a versao de 27/08" e uma frase
   * que se entende sem consultar tabela nenhuma -- e e a frase que a tela de
   * Contratos precisa mostrar.
   */
  version: string;
  updatedAt: string;
  /**
   * SHA-256 do conteudo, literal no arquivo do documento (decisao 3).
   *
   * `legal.documents.spec.ts` recalcula e compara. **Editar uma virgula do texto
   * derruba a suite**, e o unico jeito de deixa-la verde e escrever o hash novo
   * -- o que obriga a olhar a linha da versao, que esta logo acima. E a mesma
   * ideia do caminho como garantia de unicidade, aplicada a conteudo: a regra
   * vale porque nao existe caminho para viola-la em silencio.
   */
  contentHash: string;
  sections: LegalSection[];
}

/** O que a listagem publica e o corpo do 428 carregam: identidade, sem texto. */
export interface LegalDocumentSummary {
  id: string;
  title: string;
  version: string;
}

export function toSummary(document: LegalDocument): LegalDocumentSummary {
  return {
    id: document.id,
    title: document.title,
    version: document.version,
  };
}
