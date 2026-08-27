# Fase 01: Os documentos [x]
Branch: `feat/018-documentos-legais`

Só texto e constante. Ao fim desta fase os dois documentos existem, têm versão e têm hash — e nenhuma
rota os serve ainda.

- [x] Task 01: A forma do documento. Arquivo: `src/legal/entities/legal-document.entity.ts`. Objetivo:
  `LegalDocument` com `id`, `title`, `version`, `updatedAt`, `contentHash` e
  `sections: { heading: string; paragraphs: string[] }[]`; e `LegalDocumentSummary` com `id`, `title`,
  `version`. **Nenhum campo aceita HTML** — o comentário registra a decisão 2 e o motivo: quem trocar
  `paragraphs: string[]` por uma string de markup obriga o front a um `bypassSecurityTrustHtml` que nunca
  mais sai de lá.
- [x] Task 02: Termos de Uso. Arquivo: `src/legal/documents/termos-de-uso.ts`. Objetivo: o texto do
  Anexo A da spec, seção por seção, `version: '2026-08-27'`. O `id` é `'termos-de-uso'` e **vira caminho
  de documento no Firestore** (decisão 6) — kebab-case, sem acento, sem `/`.
- [x] Task 03: Política de Privacidade. Arquivo: `src/legal/documents/politica-de-privacidade.ts`.
  Objetivo: o texto do Anexo B, mesma forma, `id: 'politica-de-privacidade'`.
- [x] Task 04: O registro dos vigentes. Arquivo: `src/legal/legal.documents.ts`. Objetivo:
  `LEGAL_DOCUMENTS: Record<string, LegalDocument>` com os dois, e `LEGAL_DOCUMENT_IDS` derivado dele.
  **Uma fonte só** — o guard, o `GET /me` e o endpoint de aceite leem daqui, e uma segunda lista de ids
  em qualquer outro arquivo diverge no dia em que o terceiro documento entrar.
- [x] Task 05 (TDD): O hash que trava a edição silenciosa. Arquivos: `src/legal/legal.documents.spec.ts`,
  `src/legal/content-hash.ts`. Objetivo: `contentHashOf(doc)` — SHA-256 de título, headings e parágrafos
  concatenados, **sem a versão dentro** (senão bumpar a versão consertaria o teste sozinho, que é
  exatamente o que ele precisa impedir). O teste percorre `LEGAL_DOCUMENTS` e compara com o
  `contentHash` literal de cada arquivo. Mensagem de falha explícita: *"o texto mudou — atualize a versão
  e o contentHash".*
- [x] Task 06 (TDD): Formato da versão. Objetivo: teste que exige `YYYY-MM-DD` em todo documento, e que
  `updatedAt` bata com a versão. É barato e pega o `'v2'` que alguém vai escrever por hábito.

# Fase 02: Servir os documentos [x]
Branch: `feat/018-legal-endpoints`

- [x] Task 07: Os DTOs. Arquivos: `src/legal/dto/legal-document.dto.ts`,
  `src/legal/dto/legal-document-summary.dto.ts`. Objetivo: `@ApiProperty` em tudo — a Política é a única
  coisa deste produto que alguém de fora pode precisar ler pela API.
- [x] Task 08: O serviço. Arquivo: `src/legal/legal.service.ts`. Objetivo: `list()`, `findById(id)` que
  lança `NotFoundException`, e **`pendingFor(profile)`** — a função que compara `legalAcceptances` com
  `LEGAL_DOCUMENTS` e devolve os sumários do que falta. Ela tem três chamadores (guard, `GET /me`, e o
  próprio aceite) e **é o lugar único que sabe o que "estar em dia" significa**; duas implementações
  divergem no dia em que um documento for descontinuado.
- [x] Task 09: O controller público. Arquivos: `src/legal/legal.controller.ts`, `src/legal/legal.module.ts`.
  Objetivo: `GET /legal/documents` e `GET /legal/documents/:id`, **sem guard nenhum** (decisão 4).
  Registrar o módulo no `AppModule`.
- [x] Task 10 (TDD): Spec do controller. Arquivo: `legal.controller.spec.ts`. Objetivo: lista devolve
  sumário sem `sections` — teste-trava, porque mandar o documento inteiro na listagem é 40 KB por
  carregamento de rodapé. Id desconhecido é `404`.

# Fase 03: Guardar o aceite [x]
Branch: `feat/018-registro-de-aceite`

- [x] Task 11: O campo no perfil. Arquivo: `src/profile/entities/profile.entity.ts`. Objetivo:
  `legalAcceptances: Record<string, { version: string; acceptedAt: Date }>` na interface, no
  `ProfileDocument` (com `Timestamp`) e nos dois lados do converter. **`?? {}` no `fromFirestore`** e o
  comentário da decisão 6 junto: sem ele o guard indexa `undefined` e a base inteira toma `500` em toda
  rota, no primeiro request depois do deploy.
- [x] Task 12 (TDD): Spec do converter. Arquivo: `profile.entity.spec.ts`. Objetivo: teste-trava do
  `?? {}` em documento antigo, ao lado dos que já existem para `emailOptOut` e `tier`. E ida e volta de
  `Timestamp` no `acceptedAt` — a data do aceite é a prova, e `Timestamp` cru vazando no DTO é a prova
  ilegível.
- [x] Task 13: A subcoleção. Arquivo: `src/legal/legal-acceptance.repository.ts`. Objetivo:
  `record(uid, documentId, version, acceptedAt)` escrevendo
  `profiles/{uid}/legal_acceptances/{documentId}__{version}` com **`create()`**, e devolvendo
  `{ created: boolean }` — `ALREADY_EXISTS` vira `created: false`, **não** exceção. Repetir o aceite é
  sucesso, e reescrever a data seria apagar quando a pessoa realmente aceitou (decisão 6).
- [x] Task 14: O caso de uso. Arquivo: `src/legal/legal.service.ts`. Objetivo: `accept(uid, dto)` —
  confere o id, confere a versão contra a vigente (`409` com `current` no corpo), grava a subcoleção e
  atualiza o mapa do perfil no mesmo `WriteBatch`. Um lote e não duas escritas: mapa e histórico
  discordando é o único estado que ninguém consegue explicar depois.
- [x] Task 15: O DTO de entrada. Arquivo: `src/legal/dto/accept-legal.dto.ts`. Objetivo: `documentId` e
  `version`, ambos `@IsString` `@IsNotEmpty`. **Sem `@IsIn(LEGAL_DOCUMENT_IDS)`** — id desconhecido é
  `404` do serviço, não `400` de validação, e a diferença importa para o front distinguir "aba velha" de
  "front quebrado".
- [x] Task 16: A rota. Arquivo: `src/profile/profile.controller.ts`. Objetivo:
  `POST /me/legal-acceptances`, `204`, `@Throttle` em `10/min`. Mora no `ProfileController` porque é `/me`
  e o prefixo já é dele; o serviço é o do `LegalModule`.
- [x] Task 17 (TDD): Spec do serviço de aceite. Objetivo: quatro travas — versão velha é `409` e **não
  grava nada**; aceite repetido é `204` e a data original não muda; o mapa e a subcoleção saem no mesmo
  lote; id desconhecido é `404` antes de qualquer escrita.

# Fase 04: O bloqueio [x]
Branch: `feat/018-guard-de-aceite`

A fase que muda o comportamento de todas as rotas do produto. Entra por último e sai fácil.

- [x] Task 18: A exceção. Arquivo: `src/legal/legal-acceptance-required.exception.ts`. Objetivo:
  `HttpException` com status `428` e corpo `{ error: 'legal_acceptance_required', pending }`. `428` e não
  `403` pelo motivo da decisão 8: o front decide pelo número, nunca pelo texto da mensagem.
- [x] Task 19: O guard. Arquivo: `src/legal/legal-acceptance.guard.ts`. Objetivo: lê o perfil pelo `uid`
  já autenticado, chama `pendingFor`, e lança quando a lista não é vazia. A lista de isenções é uma
  constante no topo do arquivo, com o motivo de cada linha ao lado (decisão 8) — `PATCH /me/profile`
  **não está nela**, e o comentário diz por quê: é o mesmo bloqueio servindo o onboarding, e um `if`
  dentro do `ProfileService` seria a segunda regra que envelhece sozinha.
- [x] Task 20: Registrar. Arquivo: `src/app.module.ts`. Objetivo: guard global **depois** do
  `FirebaseAuthGuard` — antes dele não há `uid` para consultar, e o sintoma seria `500` em rota pública.
- [x] Task 21 (TDD): Spec do guard. Arquivo: `legal-acceptance.guard.spec.ts`. Objetivo: as travas que
  importam — perfil sem `legalAcceptances` é bloqueado; perfil com a versão **antiga** de um documento é
  bloqueado; perfil em dia passa; **`GET /me` e `POST /me/legal-acceptances` passam mesmo bloqueados**
  (sem isso o bloqueio não tem saída e ninguém entra no produto nunca mais); **`PATCH /me/profile` é
  bloqueado** — é a trava do onboarding e é a que alguém vai "consertar" achando que é engano; **admin é
  bloqueado como qualquer um** (decisão 8).
- [x] Task 22: `GET /me` conta o que falta. Arquivos: `src/profile/dto/profile.dto.ts`,
  `src/profile/profile.service.ts`. Objetivo: `pendingLegal: LegalDocumentSummaryDto[]` vindo do mesmo
  `pendingFor`. Nunca calcular de outro jeito aqui — o corpo do `428` e este campo têm de dizer a mesma
  coisa, sempre.
- [x] Task 23: A exclusão apaga a subcoleção. Arquivo: `src/profile/profile.service.ts`. Objetivo:
  `legal_acceptances` entra no passo 4 da ordem da spec 013, junto de `notification_reads`. Terceira vez
  que o produto esbarra em "subcoleção não morre com o pai" (decisão 11).
- [x] Task 24 (TDD): Spec da exclusão. Objetivo: teste-trava de que a subcoleção some. O da spec 013 para
  `notification_reads` é o molde e está a poucas linhas dali.

# Fase 05: Fechar [ ]
Branch: `feat/018-fechamento`

- [x] Task 25 (e2e): `test/legal.e2e-spec.ts`. Objetivo: o percurso inteiro contra o emulador — ler o
  documento sem sessão; entrar e tomar `428` no dashboard; aceitar os dois; passar; e **aceitar com
  versão velha e tomar `409`**.
- [x] Task 26 (e2e): a trava do onboarding. Objetivo: usuário novo, perfil incompleto, `PATCH /me/profile`
  **antes** dos aceites responde `428` e `completedAt` continua nulo; depois dos dois aceites, responde
  `200`. É a garantia de que o onboarding do front não tem como ser contornado pela API.
- [x] Task 27: `README.md` e `CLAUDE.md`. Objetivo: a nova subcoleção na lista de subcoleções que a
  exclusão precisa apagar; o `428` como o terceiro motivo de recusa do produto, ao lado de sessão e
  papel; e a frase que resume a decisão 1 — **o texto e a versão moram no mesmo módulo, e o hash é o que
  impede um sem o outro**. A tabela de índices compostos **não ganha linha** (decisão 12).
- [ ] Task 28: `npm run lint`, `npm test`, `npm run test:e2e`. O e2e precisa de Java no PATH.
  **Parcial: lint limpo e 555 testes unitarios verdes; o e2e nao rodou** -- `java` nao esta no PATH
  desta maquina e o emulador nao sobe ("Could not spawn `java -version`"). `test/legal.e2e-spec.ts` e as
  chamadas de `acceptCurrentLegalDocuments` nas outras suites compilam e passam no lint, mas **nenhuma
  delas foi executada**. Instalar o JDK e rodar antes de considerar a fase fechada.
