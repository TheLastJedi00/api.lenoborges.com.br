# Fase 01: Admin como claim []
Branch: `feat/009-admin-claim`

Nenhuma rota nova. Ao fim desta fase existe um admin de verdade, com um guard capaz de reconhecê-lo, e
nada ainda protegido por ele.

- [] Task 01: Propagar `role` no guard de autenticação. Arquivo:
  `src/auth/guards/firebase-auth.guard.ts`, `src/auth/decorators/current-user.decorator.ts`. Objetivo:
  `verifyIdToken` já devolve as custom claims no payload; copiar `payload.role` para `request.user`
  junto de `id` e `email`. `AuthenticatedUser` ganha `role: 'admin' | null`. Sem isso o `AdminGuard`
  precisaria verificar o token uma segunda vez, pagando a mesma conta duas vezes por requisição.
- [] Task 02 (TDD): Escrever a spec do `AdminGuard`. Arquivo: `src/auth/guards/admin.guard.spec.ts`.
  Objetivo: cobrir os três casos — `role: 'admin'` passa; `role` nulo devolve 403 (e não 401, porque a
  pessoa está autenticada, só não é admin); `request.user` ausente devolve 403 também, que é o caso de
  alguém pendurar o guard sem o `FirebaseAuthGuard` antes.
- [] Task 03: Implementar o `AdminGuard`. Arquivo: `src/auth/guards/admin.guard.ts`. Objetivo: ler
  `request.user.role` e nada mais — nenhuma ida ao Firestore, nenhuma ida ao Auth. É o pagamento da
  decisão 5: a claim viaja no token justamente para o guard ser barato.
- [] Task 04: Escrever o script de promoção. Arquivos: `scripts/grant-admin.ts`, `package.json`.
  Objetivo: `npm run admin:grant -- email@dominio.com` acha o usuário por e-mail e chama
  `setCustomUserClaims(uid, { role: 'admin' })`, preservando claims que já existam. **A mensagem de
  sucesso precisa dizer que a claim só vale no próximo token, em até uma hora** — sem isso o próximo
  passo de quem rodou é achar que falhou. Um segundo modo, `--revoke`, remove a claim.
- [] Task 05 (usuário): Rodar `npm run admin:grant -- lenoborges.dev@gmail.com` no projeto de
  desenvolvimento e no de produção. Depois de rodar, sair e entrar de novo na plataforma para o token
  novo trazer a claim — ela não aparece na sessão que já estava aberta.
- [] Task 06: Expor `role` na sessão e no perfil. Arquivos: `src/auth/dto/session.dto.ts`,
  `src/profile/dto/profile.dto.ts`, `src/auth/auth.service.ts`, `src/profile/profile.service.ts`, mais
  as specs correspondentes. Objetivo: o front decide se desenha o botão "Administração" sem decodificar
  o ID token por conta própria. Achatado, como `grade` e `profileCompleted` já são. Aproveitar e
  corrigir a descrição do Swagger de `grade`, que ainda diz "1 a 33" e "Seita Dev" em três lugares.

# Fase 02: Catálogo financeiro []
Branch: `feat/009-billing`

- [] Task 01: Escrever a constante dos tiers. Arquivo: `src/billing/billing.tiers.ts`. Objetivo: os
  quatro tiers da decisão 2, com `id`, `name`, `price` (em centavos, inteiro), `priceLabel`,
  `period`, `summary` e `perks`. **Centavos, não string nem float**: preço em `number` decimal é a
  armadilha clássica, e a string formatada existe ao lado só para a tela. O comentário do arquivo
  carrega o guardrail da decisão 3 — isto vira coleção no dia da cobrança, e não antes.
- [] Task 02: Escrever os DTOs de resposta. Arquivos: `src/billing/dto/tier.dto.ts`,
  `src/billing/dto/tier-catalog.dto.ts`. Objetivo: `TierCatalogDto` é `{ tiers, currentTierId }`. O
  Swagger documenta que este endpoint exige sessão **porque o preço não pode sair no bundle público** —
  é a única justificativa de existir endpoint para dado estático, e ela merece ficar escrita onde
  alguém vai ler.
- [] Task 03 (TDD): Escrever a spec do `BillingService`. Arquivo: `src/billing/billing.service.spec.ts`.
  Objetivo: cobrir que o catálogo sai na ordem dos degraus, que os quatro ids existem, e que
  `resolveCurrentTier` devolve `dev-tier` para qualquer perfil hoje. Este último teste é o que quebra —
  de propósito — no dia em que alguém implementar assinatura sem ler a decisão 4.
- [] Task 04: Implementar `BillingService` e `BillingController`. Arquivos:
  `src/billing/billing.service.ts`, `src/billing/billing.controller.ts`, `src/billing/billing.module.ts`,
  e o import em `src/app.module.ts`. Objetivo: `GET /billing/tiers` sob `FirebaseAuthGuard`.
  `resolveCurrentTier(profile)` isolada, com o `TODO` da decisão 4 em cima.
- [] Task 05: Testar o gate na e2e. Arquivo: `test/billing.e2e-spec.ts`. Objetivo: sem `Authorization`,
  401; com token válido, 200 com quatro tiers e o preço do Master em 26000 centavos. **O caso do 401 é
  o teste mais importante da fase** — é ele que falha se alguém abrir a rota "para facilitar o
  desenvolvimento".

# Fase 03: Vídeos da trilha []
Branch: `feat/009-badge-videos`

- [] Task 01: Escrever as constantes da trilha. Arquivo: `src/track/track.constants.ts`. Objetivo:
  `BADGE_IDS` com as treze etapas na ordem da spec 008, e o guarda de tipo `isBadgeId`. A
  lista é a mesma do `trackStages` do front, e a duplicação é declarada no comentário: são dois
  repositórios, e a alternativa (um endpoint de trilha) trocaria uma duplicação de treze strings
  estáveis por uma requisição em toda abertura de tela.
- [] Task 02: Escrever a entidade e o converter. Arquivo: `src/track/entities/badge-video.entity.ts`.
  Objetivo: tipo `BadgeVideo` mais `FirestoreDataConverter`, nos moldes de `profile.entity.ts`.
  `Timestamp` vira `Date` aqui, num lugar só. O comentário registra que o ID do documento é
  `{badgeId}__{youtubeId}` e o que isso garante (decisão 6).
- [] Task 03 (TDD): Escrever a spec da extração de `youtubeId`. Arquivo:
  `src/track/youtube-id.spec.ts`. Objetivo: cobrir as cinco formas — `watch?v=`, `youtu.be/`,
  `/embed/`, com `&t=`, com `?si=` —, o ID cru já normalizado, e a rejeição do que não casa. É a função
  mais fácil de reimplementar errado em outro lugar, então ela nasce com teste e com dono.
- [] Task 04: Implementar a extração. Arquivo: `src/track/youtube-id.ts`. Objetivo: `extractYoutubeId`
  devolve `{ found, id }`, na convenção de retorno da casa.
- [] Task 05 (TDD): Escrever a spec do `BadgeVideoRepository`. Arquivo:
  `src/track/badge-video.repository.spec.ts`. Objetivo: `listByBadge` ordena por `order` no servidor;
  `create` usa `create()` e não `set()`, para o `ALREADY_EXISTS` valer como a unicidade que o caminho
  promete; `reorder` escreve num `WriteBatch` único. O contrato `{ found, entry }` continua.
- [] Task 06: Implementar o `BadgeVideoRepository`. Arquivo: `src/track/badge-video.repository.ts`.
  Objetivo: coleção `badge_videos`, ID de documento composto, `orderBy('order')`. `reorder` recebe a
  lista de ids já validada e grava as posições 0..n-1 em lote (decisão 7).
- [] Task 07: Escrever os DTOs. Arquivos: `src/track/dto/create-badge-video.dto.ts`,
  `src/track/dto/update-badge-video.dto.ts`, `src/track/dto/reorder-videos.dto.ts`,
  `src/track/dto/badge-video.dto.ts`. Objetivo: `title` obrigatório com `@IsNotEmpty` e tamanho máximo
  — é o título da plataforma, e um vazio silencioso deixa a trilha com um item sem nome. `youtubeUrl`
  entra como URL e sai como `youtubeId`. `reorder` valida array de strings não vazio.
- [] Task 08 (TDD): Escrever a spec do `BadgeVideoService`. Arquivo:
  `src/track/badge-video.service.ts` + `.spec.ts`. Objetivo: cobrir `badgeId` inválido virando 400;
  URL do YouTube inválida virando 400; vídeo repetido na mesma insígnia virando 409 a partir do
  `ALREADY_EXISTS`; reorder com id faltando, sobrando ou repetido virando 400; e a renormalização da
  ordem depois de um `delete`, que é o caso que ninguém lembra de testar e o que deixa buraco na
  sequência.
- [] Task 09: Implementar o `BadgeVideoService`.
- [] Task 10: Implementar os controllers. Arquivos: `src/track/track.controller.ts` (público-com-sessão),
  `src/track/admin-track.controller.ts` (com `AdminGuard`), `src/track/track.module.ts`, e o import em
  `src/app.module.ts`. Objetivo: `GET /badges/:badgeId/videos` **responde 200 com lista vazia** quando
  não há vídeo, e 404 só quando o `badgeId` não é da trilha (decisão 8). As rotas de admin ficam num
  controller separado para o `AdminGuard` valer no controller inteiro, sem chance de esquecer o
  decorador numa rota nova.
- [] Task 11: Testar na e2e. Arquivo: `test/track.e2e-spec.ts`. Objetivo: contra o emulador, o caminho
  inteiro — criar três vídeos, reordenar, ler na ordem nova, apagar o do meio e confirmar que as
  posições fecham 0,1 sem buraco. Mais o 200-vazio e o 403 de quem não é admin.

# Fase 04: Administração de usuários []
Branch: `feat/009-admin-users`

- [] Task 01: Escrever os DTOs. Arquivos: `src/admin/dto/admin-user.dto.ts`,
  `src/admin/dto/admin-user-page.dto.ts`, `src/admin/dto/update-user-grade.dto.ts`. Objetivo: a linha
  da listagem junta identidade (Auth) e perfil (Firestore); a página carrega `nextPageToken` nulo no
  fim. `grade` validado entre `GRADE_MIN` e `GRADE_MAX`, reusando as constantes de
  `profile.entity.ts` — nunca reescrever 0 e 13 à mão, que é como uma das duas faixas envelhece
  sozinha.
- [] Task 02 (TDD): Escrever a spec do `AdminUsersService`. Arquivo:
  `src/admin/admin-users.service.spec.ts`. Objetivo: cobrir a junção das duas fontes, e principalmente
  o caso do **usuário sem documento de perfil** — que não pode sumir da lista nem derrubar a resposta.
  É a razão de a paginação ser a do Auth (decisão 10), e o teste é o que impede alguém de "simplificar"
  para uma consulta no Firestore depois.
- [] Task 03: Implementar o `AdminUsersService`. Arquivo: `src/admin/admin-users.service.ts`. Objetivo:
  `listUsers(limit, pageToken)` do Auth, depois um `getAll` dos perfis daquela página por caminho —
  nenhuma consulta, nenhum índice. `updateGrade` altera só `grade` e `updatedAt`.
- [] Task 04: Implementar o `AdminUsersController`. Arquivos: `src/admin/admin-users.controller.ts`,
  `src/admin/admin.module.ts`, e o import em `src/app.module.ts`. Objetivo: `GET /admin/users` e
  `PATCH /admin/users/:id`, os dois sob `FirebaseAuthGuard` e `AdminGuard`, nessa ordem.
- [] Task 05: Testar na e2e. Arquivo: `test/admin.e2e-spec.ts`. Objetivo: usuário comum recebe 403;
  admin recebe a lista; um usuário criado no Auth e sem perfil aparece com os campos de perfil nulos.

# Fase 05: Documentação []
Branch: `feat/009-docs`

- [] Task 01: Documentar os endpoints novos. Arquivo: `README.md`. Objetivo: a regra do `clauderc.md` —
  endpoint e estrutura de dado se documentam no README. Entram as nove rotas, a coleção `badge_videos`
  com a tabela de campos, e a claim `role` na seção de sessão e segurança.
- [] Task 02: Conferir as citações de "spec 008". Arquivos: `src/profile/entities/profile.entity.ts`,
  `src/auth/auth.service.spec.ts`, `README.md`. Objetivo: as três dizem "spec 008" querendo dizer Liga
  Dev, e **isso está certo** — a numeração é alinhada entre os repositórios, e 008 é Liga Dev nos dois.
  A tarefa é acrescentar "(Liga Dev)" onde a citação está solta, porque o backend não tem pasta 008 e
  quem procurar a origem do `GRADE_MAX` precisa saber que ela está no outro repositório.
- [] Task 03: Atualizar o `CLAUDE.md`. Objetivo: registrar a coleção nova e as duas garantias que ela
  move para o código — a unicidade por caminho composto e a renormalização de `order`. É a seção que
  existe justamente porque o Firestore não tem DDL, e uma coleção nova sem entrada ali é a garantia que
  se perde primeiro.

# Fase 06: Release e verificação []
Branch: `release/009-financeiro-administracao-trilha`

- [] Task 01: Rodar `npm run lint`, `npm test` e `npm run test:e2e` limpos.
- [] Task 02: Unir as `feat/009-*` na `release/009-financeiro-administracao-trilha`, merge em `dev`, e
  abrir o PR contra a `main`. **O merge na `main` está liberado** (autorizado em 2026-08-18): não é
  preciso parar no PR esperando confirmação — abre e fecha, desde que a Task 01 esteja verde. Se algum
  check falhar, o merge espera o conserto; a liberação é de aprovação, não de qualidade.
- [] Task 03 (usuário): Rodar `npm run rules:deploy` e confirmar no console que `badge_videos` continua
  inacessível ao SDK cliente. Objetivo: a decisão 11 só vale se as rules estiverem publicadas — o
  arquivo versionado não protege nada sozinho.
- [] Task 04: Verificar a claim ponta a ponta em produção: entrar com a conta de admin, conferir que
  `GET /me` traz `role: 'admin'`, e que uma conta comum recebe 403 em `/admin/users`.
