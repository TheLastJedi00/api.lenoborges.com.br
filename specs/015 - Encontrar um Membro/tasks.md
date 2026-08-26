> **Dependência de ordem:** as Fases 04 e 05 reusam `EmailCampaignService`, `AudienceService` e a coleção
> `email_campaigns`, que são da spec **014**, e o detalhe da Fase 03 mostra `linkedin`/`instagram`, que são
> da **013** — nenhuma das duas está no código (as tasks das duas estão abertas). As Fases 01 a 03 **não
> dependem delas** e podem entrar antes; onde um campo da 013 ou da 014 ainda não existir, ele sai do DTO e
> volta quando aquela spec subir. As Fases 04 e 05 esperam a 014.

# Fase 01: A varredura [x]
Branch: `feat/015-varredura`

Nenhuma rota nova e nenhum comportamento visível. Ao fim desta fase o servidor sabe montar a base inteira
— Auth cruzado com perfis — num lugar só, e a lista de hoje continua respondendo igual.

- [x] Task 01 (TDD + implementação): O varredor. Arquivos: `src/admin/member-directory.service.ts`,
  `.spec.ts`. Objetivo: `loadAll()` percorrendo `listUsers` **até o fim**, em páginas de 1000, cruzando com
  `profiles` por `getAll` de caminho. Testes-trava: (a) base com 1200 usuários faz **duas** chamadas ao Auth
  e devolve os 1200 — um `listUsers` sem laço devolve mil e ninguém percebe; (b) usuário **sem documento de
  perfil aparece no resultado**, com os campos nulos — é a pessoa que a spec inteira existe para achar.
- [x] Task 02: O dono único da junção. Arquivos: `src/admin/admin-users.service.ts`,
  `src/emails/audience.service.ts`. Objetivo: as duas passam a usar o varredor da Task 01 em vez de cada uma
  ter a sua leitura de perfis. **Se a 014 ainda não estiver no código, esta task é só o `AdminUsersService`**,
  e a Task 01 da Fase 03 da 014 passa a apontar para cá. O comentário registra que a junção tem um dono, e
  por quê: duas implementações da mesma junção divergem no primeiro campo novo.
- [x] Task 03 (TDD + implementação): Normalização de texto. Arquivos: `src/common/text/normalize.ts`,
  `.spec.ts`. Objetivo: minúsculas e acentos removidos (`NFD` + remoção de diacríticos). Testes-trava:
  `normalize('José') === normalize('jose')`; `normalize(null)` devolve string vazia e não lança — nome nulo
  é o estado normal de metade da base que esta spec lista.
- [x] Task 04: O comentário do teto. Arquivo: `member-directory.service.ts`. Objetivo: registrar em cima da
  classe que **cada chamada varre a base inteira**, quanto isso custa (`N/1000` chamadas ao Auth mais `N`
  leituras), que **não existe cache e por que não** (função serverless, cache por instância, tier antigo
  aparecendo depois de salvar), e qual é o sinal de que passou do ponto (decisão 4). É o comentário que
  impede alguém de "otimizar" isso com um `Map` estático numa tarde.

# Fase 02: Buscar e filtrar [x]
Branch: `feat/015-busca-e-filtros`

Ao fim desta fase `GET /admin/users` responde ao recorte, e o contrato muda.

- [x] Task 01: DTO da consulta. Arquivo: `src/admin/dto/list-users-query.dto.ts`. Objetivo: `q`,
  `onboarding` (`'pendente' | 'concluido'`), `tiers` com `@IsIn(TIER_IDS)` por item, `gradeMin`/`gradeMax`
  entre `GRADE_MIN` e `GRADE_MAX`, `limit` e `offset`. **Os filtros de tier e grade têm a mesma forma do
  `AudienceFilterDto` da spec 014** (decisão 7) — reusar o que der, e o comentário registra por que os dois
  precisam continuar iguais.
- [x] Task 02 (TDD + implementação): A busca. Objetivo: `q` comparado por `includes` contra `name` e
  `email`, os dois normalizados pela Task 03 da Fase 01. Testes-trava: (a) `q: 'borges'` acha "Leno Borges";
  (b) `q: 'eno'` acha "Leno" — **prefixo não basta, e é o teste que impede alguém trocar por
  `startsWith`**; (c) `q: 'jose'` acha "José"; (d) **telefone não é buscável** (decisão 5).
- [x] Task 03 (TDD + implementação): Onboarding pendente. Objetivo: `onboarding: 'pendente'` devolve quem
  tem `profileCompleted === false`. **Teste-trava: quem não tem documento de perfil nenhum entra no
  resultado**, junto de quem tem documento com `completedAt` nulo (decisão 6) — os dois estados, um filtro.
- [x] Task 04 (TDD + implementação): Tier e faixa de insígnia. Objetivo: `tiers` e `gradeMin`/`gradeMax`
  aplicados **em memória**, depois da junção. Testes-trava: (a) filtro ausente significa **todos**, e nunca
  ninguém — é a inversão que uma lista não pode errar; (b) `gradeMin > gradeMax` responde **400**, e não um
  recorte vazio em silêncio.
- [x] Task 05 (TDD + implementação): Ordem e página. Objetivo: ordenar por `createdAt` decrescente e fatiar
  por `offset`/`limit`, com `limit` fixado em 200 (decisão 3). Teste-trava: **a ordem é aplicada antes do
  fatiamento** — inverter as duas coisas devolve a página certa de uma lista errada, e a tela não teria como
  saber.
- [x] Task 06: A resposta nova. Arquivos: `src/admin/dto/admin-user-page.dto.ts`,
  `admin-users.controller.ts`. Objetivo: `total`, `offset` e `limit` no lugar de `nextPageToken`
  (decisão 2). O `@ApiProperty` de `total` diz que ele é **do recorte, e não da base** — é a frase que
  impede a próxima tela de escrever "213 membros" com um filtro ligado.
- [x] Task 07: `tier` no `AdminUserDto`, e `phone` fora. Arquivo: `src/admin/dto/admin-user.dto.ts`,
  `admin-users.service.ts`, `.spec.ts`. Objetivo: `tier` passa a sair na linha (decisão 9 — a spec 010
  esqueceu, e o front lê o campo desde então) e `phone` sai da listagem (decisão 8). Teste-trava:
  **nenhum telefone na resposta da listagem**, e o comentário diz por que a regra é da API e não do CSS.
- [x] Task 08: `emailOptOut` na linha. Objetivo: o campo que a Task 05 da Fase 06 da spec 014 já pedia.
  **Se a 014 ainda não estiver no código, esta task não entra aqui** e continua sendo daquela spec — está
  escrita para as duas não implementarem o mesmo campo duas vezes.
- [x] Task 09: Swagger. Objetivo: as seis queries documentadas, e uma frase em `GET /admin/users` dizendo
  que **a busca e os filtros são aplicados sobre a base inteira antes da paginação** — sem isso, quem lê a
  documentação supõe que o filtro age sobre a página, que é justamente o erro que a spec existe para não
  cometer.

# Fase 03: O detalhe do membro [x]
Branch: `feat/015-detalhe`

- [x] Task 01: DTO do detalhe. Arquivo: `src/admin/dto/admin-user-detail.dto.ts`. Objetivo: tudo da linha
  mais `phone`, `bio`, `linkedin`, `instagram`, `waitlistEntryId`, `profileCreatedAt`, `profileUpdatedAt`,
  e os três campos de descadastro. Comentário registrando que **este é o único lugar onde dado pessoal de
  terceiro sai da API**, e que é por isso que ele é rota própria (decisão 8).
- [x] Task 02 (TDD + implementação): `GET /admin/users/:id`. Arquivos: `admin-users.controller.ts`,
  `admin-users.service.ts`, `.spec.ts`. Objetivo: `getUserRecord` do Auth mais leitura por caminho do
  perfil. Testes-trava: (a) `uid` inexistente no Auth responde **404**; (b) usuário **sem perfil responde
  200** com os campos nulos, e nunca 404 — um 404 aqui diria "não existe" sobre alguém que a lista acabou
  de mostrar.
- [x] Task 03 (TDD + implementação): `canReceiveEmail`. Arquivos: `src/emails/audience.service.ts` (ou o
  módulo comum, se a 014 ainda não subiu), `.spec.ts`. Objetivo: **uma função só** decide se um membro pode
  receber, e ela é a mesma que a audiência usa para cortar (decisão 12). Devolve o motivo:
  `'desativado' | 'email-nao-verificado' | 'descadastrado' | null`. Teste-trava: os três casos, um por
  corte — duas implementações da mesma pergunta é como a tela passa a oferecer um envio que a API recusa.
- [x] Task 04: A ordem dos motivos. Objetivo: quando mais de um corte se aplica, o motivo devolvido é o
  primeiro da ordem `desativado`, `email-nao-verificado`, `descadastrado`. Não é arbitrário: é da conta mais
  grave para a preferência do membro, e sem ordem definida o texto da tela muda entre requisições sem nada
  ter mudado.

# Fase 04: O e-mail direto [x]
Branch: `feat/015-email-direto`

> Depende da spec 014 estar no código.

A fase com a armadilha da spec inteira. A Task 02 é a que impede um recado para uma pessoa virar um disparo
para a base.

- [x] Task 01: O terceiro `kind`. Arquivos: `src/emails/entities/email-campaign.entity.ts`, `.spec.ts`.
  Objetivo: `'direto'` no tipo, `recipientUid` e `recipientLabel` no documento e no converter.
  **Teste-trava: campanha antiga sem `recipientUid` é lida como `null`** — `undefined` ali faz uma campanha
  direta parecer campanha de base, e é a decisão 11 desligada em silêncio.
- [x] Task 02 (TDD + implementação): O curto-circuito. Arquivos: `src/emails/audience.service.ts`, `.spec.ts`.
  Objetivo: `buildAudience` **lê `recipientUid` primeiro** e, se ele existir, devolve aquele único
  destinatário — os filtros só são consultados quando ele é nulo (decisão 11). **Teste-trava, e é o mais
  importante desta spec: campanha `direto` com os três filtros nulos monta audiência de UM, e nunca da base
  inteira.** Comentário no código explicando o que o teste impede, senão a próxima refatoração "simplifica"
  a ordem das condições.
- [x] Task 03 (TDD + implementação): Os cortes valem. Objetivo: o destinatário do e-mail direto passa pelos
  mesmos três cortes (decisão 12). Testes-trava, um por corte: descadastrado **não recebe**, e a resposta é
  `422` com `reason: 'descadastrado'` — e não um `400` de audiência zero, que não diria à tela o que
  escrever.
- [x] Task 04 (TDD + implementação): A rota. Arquivos: `admin-users.controller.ts`,
  `src/admin/dto/send-direct-email.dto.ts`, `.spec.ts`. Objetivo: `POST /admin/users/:id/email` com
  `subject` e `body`, sob `FirebaseAuthGuard` + `AdminGuard`, criando campanha `kind: 'direto'` e chamando
  **o mesmo `EmailCampaignService.send`**. Teste-trava: **nenhum caminho de envio novo** — o teste verifica
  que o serviço de campanha foi chamado, e não que um `MailerService` foi chamado direto.
- [x] Task 05 (TDD + implementação): Sem botão e sem HTML. Objetivo: o DTO **não tem** `ctaLabel` nem
  `ctaUrl`, e o corpo é texto puro. Teste-trava: `<b>` no corpo sai escapado no HTML final, pelo template da
  spec 014 — e o comentário diz que o escape é de lá, para ninguém reimplementar aqui.
- [x] Task 06 (TDD + implementação): O rodapé vai também. Objetivo: teste-trava de que o e-mail direto sai
  com o link de descadastro e com os cabeçalhos `List-Unsubscribe` (decisão 13). É o teste que documenta a
  decisão: e-mail com remetente e template do produto é e-mail do produto, mesmo com um destinatário.
- [x] Task 07 (TDD + implementação): O trinco. Objetivo: com campanha `enviando`, a rota responde **409**
  (decisão 14). Reusa `findSending()` do repositório da spec 014 — **não uma segunda verificação**.
- [x] Task 08: `recipientLabel` no instante do envio. Objetivo: gravar o nome, ou o e-mail quando não houver
  nome. Comentário registrando que é denormalização deliberada, como o `authorName` do Mural (spec 010), e
  pela mesma razão: a linha do histórico precisa continuar legível depois de a conta mudar de nome ou deixar
  de existir.
- [x] Task 09: Swagger. Objetivo: `@ApiResponse` para `404`, `409` e `422`, com o `reason` documentado como
  enumeração — a tela decide o texto pelo código, e não pela prosa.

# Fase 05: Histórico e verificação [x]
Branch: `feat/015-historico-e-docs`

- [x] Task 01 (TDD + implementação): O direto no histórico. Arquivos:
  `src/emails/dto/email-campaign.dto.ts`, `.spec.ts`. Objetivo: `GET /admin/emails` passa a devolver `kind`
  com `'direto'` e `recipientLabel`. **Nenhum `where` novo, nenhuma segunda listagem** (decisão 15), e o
  comentário registra que filtrar por `kind` custaria um índice composto — que é a decisão 13 da spec 014
  ainda de pé.
- [x] Task 02: `CLAUDE.md`. Objetivo: duas linhas novas na lista de garantias que vivem em código — **a
  lista do admin é uma varredura completa do Auth recortada em memória, e não uma página, porque quem o
  filtro de onboarding procura é quem não tem documento no Firestore**; e **`recipientUid` é lido antes dos
  filtros da campanha, e essa ordem é o que impede um recado para uma pessoa virar um disparo para a base**.
- [x] Task 03: `README.md`. Objetivo: as duas rotas novas na tabela, o contrato novo de `GET /admin/users`
  (`total`/`offset`, sem `pageToken`, sem `phone`), e os dois campos novos de `email_campaigns`. **A tabela
  de índices compostos não muda** — e dizer isso explicitamente no commit, porque "spec nova, índice novo" é
  a suposição padrão e aqui ela é falsa nas três rotas (decisão 16).
- [x] Task 04 (e2e): O recorte contra o emulador. Arquivo: `test/admin-users.e2e-spec.ts`. Objetivo: semear
  usuários com e sem perfil, em tiers e grades diferentes, e provar quatro coisas: (a) a busca acha pelo
  meio da string; (b) "onboarding pendente" traz **quem não tem documento**; (c) `total` é do recorte e não
  da base; (d) `offset` devolve a segunda página do recorte, e não da base. É o único lugar onde a decisão 1
  é verificável de ponta a ponta.
- [x] Task 05 (e2e): O e-mail direto contra o emulador. Arquivo: `test/emails.e2e-spec.ts`. Objetivo: com o
  mailer em modo log, mandar um e-mail direto e conferir que **exatamente um destinatário** foi registrado,
  que ele é o `uid` pedido, e que a campanha ficou `concluida` com `sentCount: 1`. Depois, descadastrar
  aquele membro e conferir o **422**. É a prova das decisões 11, 12 e 13 juntas.
