# Spec 023 (backend): Arena de Treinamento — Tasks

> Regra do repositório: **TDD nos services** — o `.spec.ts` vem antes da lógica.
> Repositories devolvem objeto (`{ found, entry }` / `{ entries }`), nunca `null` cru.
> Uma branch `feat/` por fase, um commit por task, um push por fase.
> As referências de decisão apontam para o `context.md` desta spec.

---

# Fase 01: Fundação — entidade do treinamento, repositório e constantes

Ao fim desta fase a coleção `trainings` existe como código, com converter, repositório e constantes.
Nenhuma rota existe ainda.

- [ ] Task 01: `src/training/training.constants.ts` — criar. `DEFAULT_TRAINING_XP = 30`,
  `TRAINING_COMMENTS_PAGE_SIZE = 10`. Cada constante com o comentário do porquê, no molde de
  `XP_PER_VIDEO` em `src/track/track.constants.ts`. **O número 30 nasce e morre aqui.**
- [ ] Task 02: `src/training/entities/training.entity.ts` — a interface `Training` e o
  `FirestoreDataConverter` da decisão 1. Campos: `id`, `badgeId`, `title`, `description`,
  `steps: string[]`, `videoUrl: string | null`, `xpAmount: number`, `position: number`, `createdAt`,
  `updatedAt`. O `fromFirestore` lê `videoUrl ?? null`, `xpAmount ?? 30`, `steps ?? []` — documentos
  criados antes de qualquer migração lêem valores seguros. Comentar por que a coleção é de primeiro
  nível e não subcoleção de `badge_videos`: treinamento vive mais que vídeo, e o vínculo é por
  `badgeId`, como `gym_questions`.
- [ ] Task 03: `src/training/entities/training.entity.spec.ts` — round-trip do converter: `steps`
  preservado como array, `videoUrl` nulo quando ausente, `xpAmount` fallback para 30 em documento
  legado. É o teste que impede a trilha de treinamento de sumir em silêncio quando o campo não existe.
- [ ] Task 04: `src/training/training.repository.ts` — `create`, `update`, `delete`,
  `listByBadge(badgeId)` (ordenado por `position ASC`), `findById`, e
  `reorder(badgeId, orderedIds: string[])` aplicando `batch.update(docRef, { position: index, updatedAt })`
  para todos os itens em lote — no molde exato do `BadgeVideoRepository.reorder`. Devolve `{ found, entry }` /
  `{ entries }`, nunca `null`.
- [ ] Task 05: `src/training/training.repository.spec.ts` — contra o `fake-firestore` de
  `src/track/testing/`, que já existe.
- [ ] Task 06: `firestore.indexes.json` — adicionar o índice `trainings`: `badgeId ASC, position ASC`.
  Atualizar a tabela "Índices compostos que produção exige" no `README.md`.

---

# Fase 02: Comentários — entidade, repositório e restrição de tier

Ao fim desta fase os comentários existem como dados, com a validação de tier, mas ainda sem rota.

- [ ] Task 01: `src/training/entities/training-comment.entity.ts` — a interface `TrainingComment` e o
  `FirestoreDataConverter`. Campos: `id`, `trainingId`, `uid`, `authorName: string`, `content`,
  `adminReply: { content: string; authorName: string; repliedAt: Date } | null`, `createdAt`,
  `updatedAt`. O `adminReply` é **campo e não documento** (decisão 2): a lista é plana, e uma coleção
  de respostas custaria uma consulta por comentário ou uma costura em memória para devolver a mesma
  informação. O `fromFirestore` lê `adminReply ?? null` — todo comentário escrito antes desta linha
  não tem o campo, e `undefined` chegando no DTO vira erro na listagem inteira.
  O `authorName` é fotografado na criação — mesma decisão do `MuralQuestion`
  com a foto do nome: não custa leitura por visita, sobrevive a alteração de nome no perfil, e é o que
  foi escrito, não o que a pessoa virou.
- [ ] Task 02: `src/training/entities/training-comment.entity.spec.ts` — round-trip do converter,
  incluindo o **teste-trava do documento legado**: comentário gravado sem `adminReply` volta com
  `null`, nunca `undefined`.
- [ ] Task 03: `src/training/training-comment.repository.ts` — `create`, `findById`,
  `listByTraining(trainingId, { limit, after? })` (ordenado por `createdAt DESC`, paginado por cursor
  com `startAfter`), `listRecent({ limit })` (todos os comentários, `createdAt DESC`, para o admin),
  `setAdminReply(commentId, reply)`, `removeAllByTraining(trainingId)` e `removeAllByUid(uid)`.
  Devolve `{ entries }` / `{ found, entry }`. As duas remoções em lote apagam em `WriteBatch` de 400,
  no molde do `savePositions` do ranking: uma exclusão por documento deixa metade do trabalho feito
  quando a rede cai no meio, e ninguém fica sabendo.
- [ ] Task 04: `src/training/training-comment.repository.spec.ts`.
- [ ] Task 05: `firestore.indexes.json` — adicionar o índice `training_comments`:
  `trainingId ASC, createdAt DESC`.

---

# Fase 03: Conclusão de treinamento e XP

Ao fim desta fase a mecânica de conclusão e ganho de XP existe, atômica e à prova de duplicação.

- [ ] Task 01: `src/training/entities/training-completion.entity.ts` — a interface
  `TrainingCompletion` e o converter. Coleção: `training_completions/{uid}__{trainingId}`. Campos:
  `uid`, `trainingId`, `xpAwarded: number`, `completedAt`. O ID composto garante unicidade
  (membro, treinamento) pelo mesmo mecanismo de `gym_challenges/{badgeId__uid}`: um `batch.create()`
  que falha com `ALREADY_EXISTS` se já existir.
- [ ] Task 02: `src/training/entities/training-completion.entity.spec.ts` — round-trip do converter.
- [ ] Task 03: `src/training/training-completion.repository.ts` — `create(batch, data)` (recebe o
  `WriteBatch` de fora, para compor com o incremento de XP), `findById(uid, trainingId)`,
  `listByUid(uid)` (para saber quais o membro já completou), e `removeAll(uid)` (para exclusão de
  conta). Devolve `{ found, entry }` / `{ entries }`.
- [ ] Task 04: `src/training/training-completion.repository.spec.ts`.

---

# Fase 04: Service do membro — listar, concluir e comentar

Ao fim desta fase toda a lógica de negócio do membro está coberta por testes e implementada.

- [ ] Task 01: `src/training/training.service.spec.ts` — **testes antes**: listar treinamentos por
  insígnia com status de conclusão de cada um para o membro logado; rejeita `badgeId` fora de
  `BADGE_IDS`; concluir dá XP e atualiza o `ranking/{uid}` no mesmo `WriteBatch`; concluir duas vezes
  o mesmo treinamento não duplica XP (`ALREADY_EXISTS` tratado como idempotente, retornando que já foi
  concluído); comentar com tier `dev-tier` retorna `403` com mensagem orientando para o Financeiro;
  comentar com `great-dev-tier` ou superior funciona; listar comentários pagina corretamente.
- [ ] Task 02: `src/training/training.service.ts` — a lógica que os testes acima descrevem.
  `listByBadge(uid, badgeId)` faz `Promise.all` entre a lista de treinamentos e as completions do
  membro, devolvendo cada treinamento com `completed: boolean`. `complete(uid, trainingId)` monta
  o `WriteBatch` com: (1) `batch.create` da completion, (2) `FieldValue.increment(xpAmount)` no
  `profiles/{uid}.xp`, (3) atualização do `ranking/{uid}` — **um lote, ou existe um estado em que o
  XP subiu e a completion não existe**. Captura `ALREADY_EXISTS` do `commit()` e trata como
  idempotente: devolve que já foi concluído e `xpAwarded: 0`.
  `addComment(uid, trainingId, content)` valida o tier (`profile.entry.tier === 'dev-tier'` → `403`),
  valida que o treinamento existe (`404`), e grava com o `authorName` fotografado do perfil e
  `adminReply: null`.
  `listComments(trainingId, { limit, after })` pagina do repositório, devolvendo o `adminReply` junto.
  **A linha do ranking é lida antes do lote**: `RankingRepository.addXpToBatch` recebe `exists` e
  `currentXp` e não usa `FieldValue.increment` de propósito — increment num documento inexistente
  criaria uma linha de placar sem `nickname`, de quem nunca escolheu gamertag. Então o `complete()`
  chama `ranking.findByUid(uid)` antes de montar o `WriteBatch` e repassa o que veio; quem não tem
  linha não entra no placar, e o XP do perfil sobe do mesmo jeito.
- [ ] Task 03: `src/training/dto/create-training.dto.ts` — validação de classe: `title` e
  `description` com `@IsString() @IsNotEmpty()`, `steps` com `@IsArray() @ArrayMinSize(1)` de strings
  não vazias, `videoUrl` com `@IsOptional() @IsUrl()`, `xpAmount` com
  `@IsOptional() @IsInt() @Min(1)`, default 30.
- [ ] Task 04: `src/training/dto/update-training.dto.ts` — todos opcionais (PartialType do Create),
  mais `position` com `@IsOptional() @IsInt() @Min(0)`.
- [ ] Task 05: `src/training/dto/create-comment.dto.ts` — `content` com `@IsString() @IsNotEmpty()`.
- [ ] Task 06: `src/training/dto/training.dto.ts` — o DTO público com `completed: boolean`, e
  `trainingCommentDto` com `authorName` e `adminReply` — **sem o `uid` cru** para não vazar identificador interno
  para terceiros.

---

# Fase 05: Controllers — rotas do membro

- [ ] Task 01: `src/training/training.controller.ts` — com `FirebaseAuthGuard`:
  `GET /badges/:badgeId/trainings` (lista com status de conclusão),
  `GET /trainings/:trainingId` (detalhe),
  `POST /trainings/:trainingId/complete` (conclui e ganha XP),
  `GET /trainings/:trainingId/comments` (paginado, `?limit=&after=`),
  `POST /trainings/:trainingId/comments` (adiciona comentário, tier validado no service).
  **Sem exemção do `LegalAcceptanceGuard`** — quem não aceitou os termos não treina.
- [ ] Task 02: `src/training/training.controller.spec.ts` — cobertura das cinco rotas, incluindo o
  `403` de tier gratuito ao comentar, o `404` de treinamento inexistente, e o `200` idempotente de
  conclusão duplicada.

---

# Fase 06: Controllers — rotas do admin

- [ ] Task 01: `src/training/admin-training.controller.ts` — com `FirebaseAuthGuard` e `AdminGuard`:
  `GET /admin/badges/:badgeId/trainings` (lista),
  `POST /admin/badges/:badgeId/trainings` (cria, posição calculada no service como última + 1),
  `PATCH /admin/trainings/:trainingId` (edita),
  `DELETE /admin/trainings/:trainingId` (exclui, **apaga os comentários e as conclusões daquele
  treinamento**, e renormaliza as posições dos que sobraram),
  `PATCH /admin/badges/:badgeId/trainings/reorder` (reordena, recebe `{ orderedIds: string[] }`),
  `GET /admin/trainings/comments/recent` (últimos comentários, para o painel centralizado),
  `POST /admin/trainings/comments/:commentId/reply` (grava o `adminReply` no comentário, com o
  `authorName` do admin logado e `repliedAt` do servidor; responder de novo sobrescreve, e um
  `commentId` inexistente é `404`).
  O `:badgeId` passa por `isBadgeId` antes de virar dado.
- [ ] Task 02: `src/training/dto/reorder-trainings.dto.ts` — `orderedIds` com
  `@IsArray() @ArrayMinSize(1)` de strings.
- [ ] Task 03: `src/training/dto/admin-reply.dto.ts` — `content` com `@IsString() @IsNotEmpty()`.
- [ ] Task 04: `src/training/admin-training.controller.spec.ts` — cobertura de CRUD, reordenação,
  listagem de comentários e resposta inline, incluindo `403` de membro comum nas rotas de admin.
- [ ] Task 05: Teste-trava da exclusão em cascata, no `.spec.ts` do service: apagar um treinamento
  que tem comentários e conclusões deixa as duas coleções vazias para aquele `trainingId`, e as
  posições dos que sobraram voltam a ser `0..n-1`. É o mesmo descuido que já custou quatro coleções
  órfãs neste projeto, e a única diferença é que desta vez existe um teste que reprova.

---

# Fase 07: Módulo, integração e exclusão de conta

- [ ] Task 01: `src/training/training.module.ts` — registrar controllers e providers, e o
  registro em `AppModule.imports` dentro de `src/app.module.ts`.
- [ ] Task 02: `src/profile/profile.service.ts` — incluir a exclusão de `training_completions` e
  `training_comments` do membro em `deleteAccount()`, esta última pelo `removeAllByUid` da Fase 02.
  Entram na ordem existente, **antes** de
  `profiles/{uid}`, depois da limpeza do GYM Challenge. **Sexta e sétima vez que a regra da subcoleção
  vale**: apagar o perfil primeiro deixaria comentários e completions órfãos — invisíveis, cobrados
  e impossíveis de encontrar depois. Injetar o `TrainingCompletionRepository` e o
  `TrainingCommentRepository` no `ProfileService`.
- [ ] Task 03: `src/profile/profile.service.spec.ts` — estender o teste de ordem de exclusão com as
  duas novas coleções. É o teste que impede a próxima coleção de nascer sem limpeza.
- [ ] Task 04: `README.md` — documentar as rotas, a coleção `trainings`, `training_comments` e
  `training_completions`, e a regra de tier para comentários.
- [ ] Task 05: `CLAUDE.md` — três linhas na lista de decisões arquiteturais: **comentários de
  treinamento exigem Great Tier ou superior (`tier !== 'dev-tier'`), validado no service, no molde
  do Mural de Perguntas**; **a resposta do admin é o campo `adminReply` do comentário e não um
  documento — sem ele a rota de reply responde `200` e grava no vazio**; e **o XP deixou de ter uma
  fonte só**: a propriedade auditável da spec 019 (`xp = XP_PER_VIDEO × contagem de watched_videos`)
  passa a valer como soma de três parcelas, vídeos mais GYM mais treinamentos, e quem for conferir o
  total precisa saber disso antes de achar que encontrou uma divergência.

---

# Fase 08: Testes e2e e fechamento

- [ ] Task 01: `test/training.e2e-spec.ts` — o fluxo do membro contra o emulador: admin cria
  treinamento, membro lista na trilha, conclui e ganha XP, tenta concluir de novo (idempotente),
  comenta (com tier pago), e o membro do dev-tier recebe `403` ao tentar comentar. Usar o
  `accept-legal.helper.ts` no `createSession`.
- [ ] Task 02: `test/training-admin.e2e-spec.ts` — CRUD de treinamentos, reordenação, listagem de
  comentários recentes e resposta inline. O `403` de membro comum nas rotas de admin.
- [ ] Task 03: `npm run lint` e `npm test` **limpos** e `npm run build` passando.
- [ ] Task 04: Deploy dos índices nos **dois** projetos, com `--project` explícito em cada um —
  sem os índices, as consultas por `badgeId + position` e `trainingId + createdAt` respondem erro
  com o link para criá-los.
