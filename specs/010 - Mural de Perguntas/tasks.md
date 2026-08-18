# Fase 01: O relógio da semana [x]
Branch: `feat/010-semana`

Nada de mural ainda. Ao fim desta fase existe uma função que sabe em que semana estamos, e ela é a peça
de que todo o resto depende.

- [x] Task 01 (TDD): Escrever a spec do `weekId`. Arquivo: `src/mural/week-id.spec.ts`. Objetivo: cobrir
  a virada de domingo 00:00 em `America/Sao_Paulo` (sábado 23:59 é uma semana, domingo 00:00 é outra), a
  virada de ano — que é onde numeração de semana quebra —, e a estabilidade sob um `Date` em UTC. O
  teste fixa o relógio; nenhum caso pode depender de quando a suíte roda.
- [x] Task 02: Implementar o `weekId`. Arquivos: `src/mural/week-id.ts`,
  `src/mural/mural.constants.ts`. Objetivo: `weekIdOf(date)` devolve `2026-W34`, calculado com
  `Intl.DateTimeFormat` no fuso constante — sem dependência nova. Mais `previousWeekId(id)`, que é como
  a semana em votação é encontrada. O comentário registra a decisão 1: **a virada é uma conta, não um
  cron**, e por quê.
- [x] Task 03: Escrever as fases derivadas. Arquivo: `src/mural/mural-phase.ts` + `.spec.ts`. Objetivo:
  `phaseOf(weekId, now)` devolve `'coleta' | 'votacao' | 'encerrada'`. É a única tradução de semana em
  estado, e ela existir sozinha é o que impede três controllers de reimplementarem a comparação com
  sinais trocados.

# Fase 02: Tier no perfil [x]
Branch: `feat/010-tier-no-perfil`

O portão da Fase 04 precisa saber quem paga. Esta fase é o que torna a pergunta respondível.

- [x] Task 01: Acrescentar `tier` à entidade. Arquivo: `src/profile/entities/profile.entity.ts`.
  Objetivo: `tier: TierId`, com `TIER_IDS` e default `'dev-tier'`. **O converter lê documento antigo com
  `?? 'dev-tier'`** — é o mesmo cuidado do `completedAt ?? null`, e sem ele todo perfil existente vira
  `undefined` e derruba a comparação de tier em silêncio. O comentário registra o guardrail: `tier` é
  acesso, `grade` é conquista, e nenhum dos dois se deriva do outro.
- [x] Task 02: Dar corpo ao `resolveCurrentTier`. Arquivo: `src/billing/billing.service.ts`. Objetivo: a
  função que a spec 009 criou com `TODO` passa a devolver `profile.tier`. Continua sendo o **único**
  lugar que responde "qual é o tier desta pessoa" — é ela que um gateway substitui por dentro.
- [x] Task 03: Expor `tier` na sessão e no perfil. Arquivos: `src/auth/dto/session.dto.ts`,
  `src/profile/dto/profile.dto.ts`, mais os services e specs. Objetivo: o front decide se habilita o
  campo de pergunta sem uma segunda ida à rede, como já faz com `role` e `grade`.
- [x] Task 04 (TDD + implementação): Admin edita `tier`. Arquivos:
  `src/admin/dto/update-user-grade.dto.ts` (renomear para `update-user.dto.ts`),
  `src/admin/admin-users.service.ts` + spec. Objetivo: `PATCH /admin/users/:id` passa a aceitar `tier`
  além de `grade`, os dois opcionais e independentes. **O teste que importa é o que prova que mexer em
  `tier` não toca `grade`** — a spec 008 inteira depende de os dois nunca se contaminarem.
- [x] Task 05: Atualizar a e2e da 009. Arquivo: `test/admin.e2e-spec.ts`. Objetivo: promover um usuário a
  `great-dev-tier` pela API e conferir que o `GET /me` dele reflete na hora — `tier` não é claim, e não
  espera token novo (decisão 6).

# Fase 03: O mural, leitura []
Branch: `feat/010-mural-leitura`

- [] Task 01: Entidade e converter. Arquivo: `src/mural/entities/mural-question.entity.ts`. Objetivo:
  `MuralQuestion` com `weekId`, `badgeId`, `authorUid`, `authorName`, `title`, `body`, `voteCount`,
  `answerVideoId`, `createdAt`, `updatedAt`. O comentário registra que o ID do documento é
  `{weekId}__{uid}` e o que isso garante (decisão 4), e que `authorName` é denormalizado de propósito,
  com o preço declarado — o nome exibido é o de quando perguntou.
- [] Task 02 (TDD): Spec do `MuralRepository`. Arquivo: `src/mural/mural.repository.spec.ts`. Objetivo:
  `listByWeek` ordenando por `voteCount desc` na votação e por `createdAt` na coleta; `findMine` como
  leitura por caminho; `create` com `create()` e não `set()`. Contrato `{ found, entry }` de sempre.
- [] Task 03: Implementar o `MuralRepository`. Arquivo: `src/mural/mural.repository.ts`. Objetivo:
  coleção `mural_questions`. Registrar no comentário o índice composto que o Firestore vai exigir
  (`weekId` + `voteCount`) — ele não existe sozinho, e a primeira consulta em produção falha com um link
  no erro que ninguém está esperando.
- [] Task 04: DTOs de leitura. Arquivos: `src/mural/dto/mural-question.dto.ts`,
  `src/mural/dto/mural-state.dto.ts`. Objetivo: a pergunta sai com `phase`, `voteCount`, `hasVoted` e
  `isMine`. `MuralStateDto` carrega `currentWeekId`, `votingWeekId`, `canAsk` e `myQuestionId` — é o que
  o front precisa para desenhar a tela inteira sem adivinhar nada.
- [] Task 05 (TDD + implementação): `MuralService`, parte de leitura. Arquivos:
  `src/mural/mural.service.ts` + `.spec.ts`. Objetivo: `getState` e `listQuestions`. **`hasVoted` sai de
  um `getAll` dos caminhos de voto do próprio usuário** — nunca de uma consulta por autor, e nunca de N
  leituras em laço (decisão 3).
- [] Task 06: Controller e módulo. Arquivos: `src/mural/mural.controller.ts`,
  `src/mural/mural.module.ts`, import em `src/app.module.ts`. Objetivo: `GET /mural` e
  `GET /mural/perguntas`, sob `FirebaseAuthGuard`. Leitura é de todo mundo, inclusive Dev Tier.

# Fase 04: O mural, escrita []
Branch: `feat/010-mural-escrita`

- [] Task 01: DTOs de escrita. Arquivos: `src/mural/dto/create-question.dto.ts`,
  `src/mural/dto/update-question.dto.ts`. Objetivo: `title` de 10 a 140, `body` até 1000, **texto puro**
  — nada de markdown ou HTML (decisão 10). `badgeId` validado contra `BADGE_IDS`.
- [] Task 02 (TDD): Spec da escrita. Arquivo: `src/mural/mural.service.spec.ts`. Objetivo: os cinco
  casos que o portão precisa acertar — Dev Tier recebe **403**; segunda pergunta na mesma semana recebe
  **409** traduzido do `ALREADY_EXISTS`; `badgeId` inválido recebe 400; editar pergunta de outra pessoa
  recebe 403; editar depois que a semana virou recebe **409**, porque a pergunta já está em votação e
  mexer no texto invalidaria os votos que ela recebeu.
- [] Task 03: Implementar a escrita. Arquivo: `src/mural/mural.service.ts`. Objetivo: `POST` e `PUT`. O
  `weekId` vem **sempre do servidor**, nunca do corpo da requisição — cliente que escolhe a própria
  semana escolhe também votar na semana errada.
- [] Task 04: O guard de tier. Arquivos: `src/auth/guards/paid-tier.guard.ts` + `.spec.ts`. Objetivo:
  roda depois do `FirebaseAuthGuard`, lê o perfil e recusa `dev-tier` com 403 e uma mensagem que
  **diz o que fazer** — "o Dev Tier vota no mural; para perguntar, veja o Financeiro". 403 sem caminho
  de saída é a forma mais cara de perder um upgrade.
- [] Task 05: Moderação. Arquivo: `src/mural/admin-mural.controller.ts`. Objetivo:
  `DELETE /admin/mural/perguntas/:id`, com `AdminGuard`. **Apaga a subcoleção de votos junto** — no
  Firestore a subcoleção sobrevive ao pai apagado, e esse é o vazamento clássico. O teste da Fase 06
  cobre exatamente isso.

# Fase 05: Votação []
Branch: `feat/010-votacao`

- [] Task 01: Entidade do voto. Arquivo: `src/mural/entities/mural-vote.entity.ts`. Objetivo: documento
  mínimo — `votedAt` e nada mais. **O dado é o caminho**: `mural_questions/{id}/votes/{uid}` já diz quem
  votou em quê (decisão 3).
- [] Task 02 (TDD): Spec do voto. Arquivo: `src/mural/vote.service.spec.ts`. Objetivo: votar duas vezes
  não incrementa duas vezes; votar em pergunta na fase de coleta recebe 409; votar em pergunta encerrada
  recebe 409; desvotar decrementa; desvotar sem ter votado é **idempotente**, não erro. E o caso que
  ninguém lembra: `voteCount` nunca fica negativo.
- [] Task 03: Implementar o voto. Arquivo: `src/mural/vote.service.ts`. Objetivo: `WriteBatch` com as
  duas operações — `create()` do voto e `FieldValue.increment(±1)` no contador. Se o voto já existe, o
  batch inteiro falha e o contador não se mexe. **Nunca ler-somar-escrever**: duas pessoas votando no
  mesmo segundo perderiam um voto.
- [] Task 04: Rotas de voto. Arquivo: `src/mural/mural.controller.ts`. Objetivo: `POST` e `DELETE` em
  `/mural/perguntas/:id/voto`, só com `FirebaseAuthGuard` — **sem** o guard de tier. Votar é de todo
  mundo, e é a decisão 5.
- [] Task 05 (TDD + implementação): A vencedora. Arquivos: `src/mural/mural.service.ts`,
  `src/mural/dto/winner.dto.ts`. Objetivo: `GET /mural/vencedoras` devolve, por semana encerrada, a de
  maior `voteCount` com desempate pela mais antiga. **Derivada, nunca gravada** (decisão 9). Cobrir a
  semana sem nenhuma pergunta, que sai como semana em branco e não como erro.

# Fase 06: Vídeos de resposta []
Branch: `feat/010-videos-resposta`

- [] Task 01: Estender a entidade de vídeo. Arquivo: `src/track/entities/badge-video.entity.ts`.
  Objetivo: `kind: 'aula' | 'resposta'` (default `'aula'` na leitura de documento antigo),
  `questionId: string | null` e `devTierFree: boolean` (default `false`). O comentário registra a
  precedência total do `devTierFree` (decisão 8) — quem escrever o gate um dia começa por ele e sai.
- [] Task 02: Ordem por `(badgeId, kind)`. Arquivos: `src/track/badge-video.repository.ts`,
  `src/track/badge-video.service.ts`. Objetivo: **esta é a emenda à decisão 7 da spec 009** e o bug mais
  provável desta spec. A renormalização 0..n-1 acontece dentro da aba; uma insígnia com três aulas e
  duas respostas tem duas sequências independentes. `listByBadge` passa a aceitar filtro por `kind`.
- [] Task 03 (TDD): Spec da ordem separada. Arquivo: `src/track/badge-video.service.spec.ts`. Objetivo:
  criar aulas e respostas na mesma insígnia, reordenar uma aba e provar que **a outra não se moveu**.
  Sem este teste, a regressão é invisível até alguém abrir a trilha.
- [] Task 04: DTOs e rotas. Arquivos: `src/track/dto/*.ts`, `src/track/admin-track.controller.ts`.
  Objetivo: criar e editar vídeo passam a aceitar `kind`, `questionId` e `devTierFree`. `questionId` só
  é aceito com `kind: 'resposta'` — resposta sem pergunta e aula com pergunta são os dois estados
  incoerentes, e o 400 é mais barato que um dado torto.
- [] Task 05: e2e do mural. Arquivo: `test/mural.e2e-spec.ts`. Objetivo: contra o emulador, o ciclo
  inteiro com o relógio fixado — Dev Tier vota e não escreve; membro pago escreve uma e a segunda dá
  409; virada de semana muda as fases sem ninguém rodar nada; a vencedora sai correta com empate; e o
  `DELETE` de moderação **não deixa voto órfão**.

# Fase 07: Documentação e release []
Branch: `release/010-mural-de-perguntas`

- [] Task 01: `README.md`. Objetivo: as nove rotas novas, as coleções `mural_questions` e a subcoleção
  `votes`, os três campos novos de `badge_videos` e o `tier` em `profiles`. A tabela "o que o banco
  garantia" ganha duas linhas: uma pergunta por membro por semana e um voto por pessoa por pergunta,
  ambas garantidas pelo caminho do documento.
- [] Task 02: `CLAUDE.md`. Objetivo: registrar o ciclo semanal derivado — é a decisão que mais parece
  candidata a "otimização" por quem chegar depois, e a que mais quebra se virar cron.
- [] Task 03: Marcar as emendas na spec 009. Arquivo: `specs/009 .../context.md`. Objetivo: decisões 4,
  7 e 9 emendadas, com o que continua valendo dito por extenso — "emendada" nunca pode ser lido como
  "revogada".
- [] Task 04 (usuário): `npm run rules:deploy`. Objetivo: as coleções novas só estão fechadas se as
  rules estiverem publicadas.
- [] Task 05 (usuário): Criar o índice composto de `mural_questions` (`weekId` + `voteCount desc`) no
  console de produção. **Antes do merge na `main`, e não depois** — o emulador não exige índice, então a
  suíte inteira passa verde e a listagem em votação quebra no primeiro acesso em produção, com um erro
  que ninguém está esperando. Esta é a única coisa desta spec que a CI não tem como pegar.
- [] Task 06: `npm run lint`, `npm test` e `npm run test:e2e` limpos; unir as `feat/010-*` na
  `release/010-mural-de-perguntas`, merge em `dev`, e abrir o PR contra a `main`. **O merge na `main`
  está liberado** (autorizado em 2026-08-18): abre e fecha o PR, sem parar para confirmar. Se algum
  check falhar, ou se a Task 05 não tiver sido feita, o merge espera — a liberação é de aprovação, não
  de qualidade.
