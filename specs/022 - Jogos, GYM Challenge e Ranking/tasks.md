# Spec 022 (backend): Jogos, GYM Challenge e Ranking — Tasks

> Regra do repositório: **TDD nos services** — o `.spec.ts` vem antes da lógica.
> Repositories devolvem objeto (`{ found, entry }`), nunca `null` cru.
> Uma branch `feat/` por fase, um commit por task, um push por fase.
> As referências de decisão apontam para o `context.md` desta spec, buracos de numeração incluídos (adendo A.2).

---

# Fase 01: Fundação — constantes, tipos e ambiente [x]

- [x] Task 01: `src/games/games.constants.ts` — criar. `QUESTIONS_PER_ROUND = 10`, `PASSING_SCORE = 7`,
  `XP_PER_CORRECT_ANSWER = 50`, `FREE_SECONDS = 5`, `MIN_XP_PER_ANSWER = 1`,
  `CLIENT_ELAPSED_TOLERANCE_SECONDS = 2`, `MIN_QUESTIONS_PER_DIFFICULTY = 30`,
  `MAX_QUESTIONS_PER_DIFFICULTY = 33`, `CHALLENGE_BADGE_IDS` (as 8 primeiras de `BADGE_IDS`),
  `ROUND_DIFFICULTY: Record<1 | 2 | 3, Difficulty>`. Cada constante com o comentário do porquê, no molde
  de `XP_PER_VIDEO` em `src/track/track.constants.ts`. **O número 50 nasce e morre aqui.**
- [x] Task 02: `src/games/games.constants.spec.ts` — travar que `CHALLENGE_BADGE_IDS` tem exatamente 8 ids e
  que todos pertencem a `BADGE_IDS`. É o teste que impede a Elite Four de ganhar desafio por acidente (Q.2).
- [x] Task 03: `src/games/xp.ts` + `xp.spec.ts` — a função pura `computeXp({ serverSeconds, clientElapsedMs })`
  da decisão 3. Testes primeiro: 0-5s paga 50; 6s paga 49; 60s paga o piso 1; `clientElapsedMs` menor vence;
  `clientElapsedMs` negativo é descartado; `clientElapsedMs` acima de `serverSeconds + 2` é descartado.
  **Função pura, sem Firestore** — é a regra de negócio mais copiável da spec e a mais fácil de duplicar errado.
- [x] Task 04: `src/config/env.validation.ts` — adicionar `GEMINI_API_KEY` como `@IsString() @IsOptional()`
  e a checagem imperativa dentro de `validate()` exigindo-a em produção, no molde exato do `RESEND_API_KEY`
  (adendo A.6). `env.validation.spec.ts` ganha os dois casos: ausente fora de produção passa, ausente em
  produção derruba o boot.
- [x] Task 05: `firestore.indexes.json` — adicionar os três índices do adendo A.5: `gym_questions`
  (badgeId + difficulty), `gym_questions` (badgeId + createdAt) e `ranking` (xp DESC + uid ASC).
  Atualizar a tabela "Índices compostos que produção exige" no `README.md`. **O deploy é por projeto e com
  `--project` explícito, nos dois** — a lição de 2026-08-28.

---

# Fase 02: Banco de questões — entidade, repositório e CRUD do admin [x]

- [x] Task 01: `src/games/entities/gym-question.entity.ts` — a interface `GymQuestion` e o
  `FirestoreDataConverter` da decisão 6. Comentar por que `correctIndex` é número e não a string da
  alternativa, e por que a coleção é de primeiro nível e não subcoleção de `badge_videos`.
- [x] Task 02: `src/games/entities/gym-question.entity.spec.ts` — round-trip do converter, `alternatives`
  sempre com 4 posições, `correctIndex` preservado.
- [x] Task 03: `src/games/dto/create-question.dto.ts` e `update-question.dto.ts` — validação de classe:
  `question` não vazio, `alternatives` com `@ArrayMinSize(4) @ArrayMaxSize(4)` de strings não vazias,
  `correctIndex` com `@Min(0) @Max(3)`, `difficulty` com `@IsIn(['easy', 'medium', 'hard'])`.
  O `forbidNonWhitelisted` já é global e rejeita campo a mais.
- [x] Task 04: `src/games/gym-question.repository.ts` — `create`, `update`, `delete`,
  `listByBadge(badgeId, difficulty?)`, `countByDifficulty(badgeId)` e `pickRandom(badgeId, difficulty, n)`.
  Devolve `{ found, entry }` / `{ entries }`, nunca `null`. O `countByDifficulty` usa o agregado `count()`:
  contar documentos lendo-os inteiros custa o banco inteiro a cada abertura da tela do admin.
- [x] Task 05: `src/games/gym-question.repository.spec.ts` — contra o `fake-firestore` de
  `src/track/testing/`, que já existe e é onde a spec 019 provou que um `jest.fn()` não prova o lote.
- [x] Task 06: `src/games/gym-question.service.spec.ts` — **testes antes**: rejeita `badgeId` fora de
  `CHALLENGE_BADGE_IDS`; rejeita a 34ª questão de uma dificuldade (teto da decisão 5); devolve a contagem
  por nível; `correctIndex` fora de 0-3 não chega ao repositório.
- [x] Task 07: `src/games/gym-question.service.ts` — a lógica que os testes acima descrevem.
- [x] Task 08: `src/games/admin-games.controller.ts` — `GET` / `POST` / `PATCH` / `DELETE` de
  `/admin/badges/:badgeId/questions`, com `AdminGuard`. O `:badgeId` passa por `isBadgeId` antes de virar
  dado — a razão está escrita em `track.constants.ts`.
- [x] Task 09: `src/games/games.module.ts` e o registro em `AppModule.imports`.
- [x] Task 10: `src/games/admin-games.controller.spec.ts` — cobertura dos quatro verbos, incluindo o `404`
  de `badgeId` inexistente.

---

# Fase 03: Geração de questões com IA (Gemini) [x]

- [x] Task 01: `src/games/gemini.service.spec.ts` — **testes antes**, com o cliente HTTP mockado:
  JSON válido vira N questões; questão com 3 alternativas é descartada em silêncio; `correctIndex: 7` é
  descartado; resposta que não é JSON não derruba a rota; sem `GEMINI_API_KEY` responde `503`.
- [x] Task 02: `src/games/gemini.service.ts` — a chamada à Gemini com o prompt estruturado da decisão 9.
  **Só rotas de admin a alcançam**, e o service não tem nenhum caminho público.
- [x] Task 03: `src/games/dto/generate-questions.dto.ts` — `{ prompt, difficulty, count }`, com `count`
  em `@Min(1) @Max(30)` (Q.3).
- [x] Task 04: `src/games/dto/bulk-create-questions.dto.ts` — `{ questions: CreateQuestionDto[] }` com
  `@ValidateNested({ each: true })`. Sem isso o `class-validator` valida o array e ignora o conteúdo,
  e o rascunho da IA entra sem validação nenhuma.
- [x] Task 05: `POST /admin/badges/:badgeId/questions/generate` no `admin-games.controller.ts` — devolve o
  rascunho e **não persiste nada**, com a contagem de quantas sobraram após o descarte.
- [x] Task 06: `POST /admin/badges/:badgeId/questions/bulk` — grava num `WriteBatch`, respeitando o teto de
  33 por dificuldade.
- [x] Task 07: Documentar as duas rotas no `README.md`, e a `GEMINI_API_KEY` na tabela de ambiente.

---

# Fase 04: Configuração do desafio [x]

- [x] Task 01: `src/games/entities/challenge-config.entity.ts` e o converter — `challenge_configs/{badgeId}`,
  com `requiredXp ?? 0` no `fromFirestore`. **Todo documento é inexistente no dia do deploy**, e a ausência
  do documento tem que significar "sem exigência", não `undefined`.
- [x] Task 02: `src/games/challenge-config.repository.ts` + `.spec.ts` — `get(badgeId)` devolvendo
  `{ found, entry }` com o default quando não existe, e `save(badgeId, requiredXp)`.
- [x] Task 03: `src/games/dto/challenge-config.dto.ts` — `requiredXp` com `@IsInt() @Min(0)`.
- [x] Task 04: `GET` e `PUT /admin/badges/:badgeId/challenge-config` no `admin-games.controller.ts`.
  O `GET` devolve junto a contagem por dificuldade e o booleano `ready` (≥ 90) — é o que a tela do admin
  mostra no topo, e uma segunda requisição para contar seria a mesma leitura duas vezes.
- [x] Task 05: `.spec.ts` do controller para as duas rotas.

---

# Fase 05: Nickname (gamertag) []

- [] Task 01: `src/profile/entities/nickname.entity.ts` — `nicknames/{nickname}` com o ID em minúsculas
  (adendo A.1). Comentar que `LenoDev` e `lenodev` colidem de propósito.
- [] Task 02: `src/profile/entities/profile.entity.ts` — campo `nickname: string | null` com `?? null` no
  converter, no molde do `emailOptOut ?? false`. Atualizar `profile.entity.spec.ts`.
- [] Task 03: `src/profile/dto/nickname.dto.ts` — `@Matches(/^[A-Za-z0-9_-]{3,20}$/)`.
- [] Task 04: `src/profile/profile.service.spec.ts` — **testes antes**: grava nos dois lugares no mesmo
  `WriteBatch`; `409` quando o perfil já tem nickname; `409` quando o `create()` bate `ALREADY_EXISTS`;
  a colisão é case-insensitive. É `create()`, nunca `set()` — `set()` rouba o nome de outra pessoa em silêncio.
- [] Task 05: `ProfileService.setNickname` e `PUT /me/nickname` no `profile.controller.ts`, respondendo `204`.
- [] Task 06: `nickname` entra no `ProfileDto` (`GET /me`) e **não** no `PublicMemberDto` (adendo A.3).
  Estender o teste de vazamento do `public-member.dto` — ele compara o conjunto de chaves por igualdade,
  e é ele que impede o campo novo de entrar sozinho.
- [] Task 07: `README.md` — documentar a rota, a coleção `nicknames` e a regra de imutabilidade.

---

# Fase 06: Estado do desafio — leitura []

- [] Task 01: `src/games/entities/gym-challenge.entity.ts` e o converter — `gym_challenges/{badgeId__uid}`
  da decisão 7, com `roundResults` como mapa e `badgeUnlocked ?? false`.
- [] Task 02: `src/games/entities/active-round-question.entity.ts` e o converter — a subcoleção efêmera da
  decisão 8, incluindo `clientElapsedMs` e `replayed` (adendo A.1). **`correctIndex` não existe aqui**, e o
  comentário no arquivo diz por quê: dar a resposta ao front é dar a cola no tráfego.
- [] Task 03: `src/games/gym-challenge.repository.ts` + `.spec.ts` — `get`, `listByUid`, `upsert`,
  `listActiveRound`, `replaceActiveRound` (apaga e regrava em lote) e `clearActiveRound`.
- [] Task 04: `src/games/dto/challenge-state.dto.ts` — o DTO dos estados da decisão 5:
  `{ badgeId, status: 'em-breve' | 'xp-insuficiente' | 'disponivel' | 'conquistada', currentRound,
  rounds: [{ round, passed, score }], requiredXp, currentXp, badgeUnlocked, hasActiveRound }`.
- [] Task 05: `src/games/games.service.spec.ts` — **testes antes** para o cálculo de status: < 90 questões é
  `em-breve` mesmo com XP de sobra; XP abaixo do `requiredXp` é `xp-insuficiente`; `badgeUnlocked` é
  `conquistada` **mesmo se o admin apagar questões depois** (Q.8).
- [] Task 06: `src/games/games.service.ts` — `listChallenges(uid)` e `getChallenge(uid, badgeId)`.
  O `listChallenges` monta as 8 insígnias com um `getAll` nos caminhos exatos, no molde do `watched` da
  spec 019 — não uma consulta por `uid` na coleção.
- [] Task 07: `src/games/games.controller.ts` — `GET /games/challenges` e `GET /games/challenges/:badgeId`
  com o guard de sessão padrão. **Sem exemção do `LegalAcceptanceGuard`** (adendo A.4).
- [] Task 08: `games.controller.spec.ts` das duas rotas.

---

# Fase 07: Iniciar a rodada []

- [] Task 01: `games.service.spec.ts` — **testes antes** do `startRound`: sorteia 10 da dificuldade da
  rodada corrente; embaralha as alternativas e o `correctIndex` **não** sai na resposta; `403` com < 90
  questões; `403` com XP insuficiente; `409` com rodada em andamento não finalizada; refazer rodada já
  aprovada marca `replayed: true` (decisão 21).
- [] Task 02: `src/games/shuffle.ts` + `shuffle.spec.ts` — Fisher-Yates com a fonte de aleatoriedade
  injetável, para o teste ser determinístico. Embaralhar as alternativas **sem** carregar o índice correto
  junto é o defeito que entrega a resposta na ordem.
- [] Task 03: `GamesService.startRound(uid, badgeId)` — sorteio, embaralhamento e gravação dos 10
  documentos do `active_round` num `WriteBatch`, com `servedAt` do servidor.
- [] Task 04: `src/games/dto/round-question.dto.ts` — `{ index, question, alternatives }`. Nada mais.
- [] Task 05: `POST /games/challenges/:badgeId/start` com `@Throttle` em `10/min` (decisão 19).
- [] Task 06: `.spec.ts` do controller, incluindo os três erros e o corpo sem `correctIndex` — um teste que
  afirma a **ausência** da chave, nunca `toMatchObject`.

---

# Fase 08: Responder, pontuar e conquistar a insígnia []

- [] Task 01: `src/games/dto/answer-question.dto.ts` — `{ questionIndex, chosenIndex, clientElapsedMs }`,
  todos com `@IsInt()` e `@Min(0)`, e `chosenIndex` com `@Max(3)`.
- [] Task 02: `games.service.spec.ts` — **testes antes** do `answer`: acerto paga o `computeXp`; erro paga 0
  e não desconta; `400` com `questionIndex` fora de faixa; `409` na questão já respondida; replay paga
  sempre 0 e devolve `replay: true`; o XP entra no perfil **no mesmo lote** da gravação da resposta.
- [] Task 03: `GamesService.answer` — confere o `chosenIndex` contra o `gym_questions` original (nunca
  contra o `active_round`), calcula o XP com `computeXp`, e grava a resposta, o `FieldValue.increment` no
  perfil e o incremento no `ranking/{uid}` num `WriteBatch` só (adendo A.7).
- [] Task 04: `games.service.spec.ts` — **testes antes** da consolidação: 7 acertos aprova e avança
  `currentRound`; 6 reprova e mantém a rodada; a 3ª aprovada grava `badgeUnlocked`; replay aprovado **não**
  toca `roundResults`; a subcoleção é apagada ao fim.
- [] Task 05: `GamesService.finishRound` — consolidação da rodada no mesmo `WriteBatch` do `badgeUnlocked`
  e do `grade` (adendo A.7).
- [] Task 06: `src/games/grade-progression.ts` + `.spec.ts` — a cascata da decisão 13 e do adendo A.8:
  avança enquanto a insígnia da posição `grade + 1` estiver desbloqueada, **e para em 8**. Testes:
  `grade: 1` conquistando Angular não sobe; conquistando POO sobe para 2; quem já tinha de 3 a 8
  desbloqueados sobe até 8 de uma vez; `grade: 8` não vira 9.
- [] Task 07: `POST /games/challenges/:badgeId/answer` com `@Throttle` em `120/min`, devolvendo
  `{ correct, correctAlternativeIndex, xpAwarded, replay, roundComplete?, roundPassed?, badgeUnlocked?, totalXp? }`.
- [] Task 08: `.spec.ts` do controller para as respostas de meio e de fim de rodada.

---

# Fase 09: Ranking []

- [] Task 01: `src/games/entities/ranking-entry.entity.ts` e o converter — a forma vigente do adendo A.1,
  com `nickname` (nunca `name`) e os três campos de posição da decisão 22, todos com `?? null`.
- [] Task 02: `src/games/ranking.repository.ts` + `.spec.ts` — `page({ limit, after })` ordenando por
  `xp DESC, uid ASC`, mais `upsert` e `getByUid`. O desempate por `uid` é o que impede a paginação de
  pular linha em XP empatado (adendo A.5).
- [] Task 03: `src/games/ranking.service.spec.ts` — **testes antes**: a página vem ordenada; a posição do
  membro logado sai correta mesmo fora da página; membro sem nickname **não** aparece (decisão 20);
  a variação é `previousPosition - currentPosition` e é `null` no primeiro dia.
- [] Task 04: `src/games/ranking.service.ts` e `GET /ranking?limit=&after=`, devolvendo
  `{ entries, myPosition, myEntry }`.
- [] Task 05: Manutenção em tempo de execução — o `WatchedVideoRepository` (spec 019) passa a atualizar
  `ranking/{uid}` **no mesmo lote** do incremento de XP. Estender `watched-video.repository.spec.ts`:
  o lote que falha não deixa o ranking à frente do perfil.
- [] Task 06: `scripts/ranking-backfill.ts` e `npm run ranking:backfill` — lê os perfis com `completedAt`
  não nulo **e nickname não nulo**, e grava o documento correspondente. Idempotente, com `--dry-run`, no
  molde de `backfill-tab.ts`.
- [] Task 07: `scripts/ranking-snapshot.ts` e `npm run ranking:snapshot` — copia `currentPosition` para
  `previousPosition` e recalcula, em lotes. Também com `--dry-run`.
- [] Task 08: `README.md` — documentar `GET /ranking`, a coleção, os dois scripts e a consistência eventual.

---

# Fase 10: Exclusão de conta, e2e e fechamento []

- [] Task 01: `ProfileService.deleteAccount` — apagar `gym_challenges/{badgeId__uid}` de todas as insígnias
  **com a subcoleção `active_round` dentro**, `ranking/{uid}` e `nicknames/{nickname}` (decisão 14 — o
  nickname volta a ficar disponível, e é o único jeito de o membro que voltar não encontrar o próprio nome
  ocupado por um fantasma). Entram na ordem existente, **antes** de `profiles/{uid}`, e o usuário do Auth
  continua morrendo por último.
- [] Task 02: `profile.service.spec.ts` — estender o teste de ordem de exclusão com as três novas. É o
  quinto encontro com "subcoleção não some com o pai", e o teste é o que impede o sexto.
- [] Task 03: `test/games.e2e-spec.ts` — o fluxo inteiro contra o emulador: admin cadastra 90 questões,
  membro escolhe o nickname, joga as três rodadas, ganha a insígnia e o `grade` sobe. Usar o
  `accept-legal.helper.ts` no `createSession`, ou toda requisição responde `428`.
- [] Task 04: `test/ranking.e2e-spec.ts` — ordenação, paginação por cursor com XP empatado e a posição do
  membro logado fora da primeira página.
- [] Task 05: `test/games-admin.e2e-spec.ts` — CRUD de questões, o teto de 33, o `ready` do
  `challenge-config` e o `403` de membro comum nas rotas de admin.
- [] Task 06: `README.md` — a seção de endpoints desta spec, a tabela de índices atualizada e a
  `GEMINI_API_KEY` na tabela de ambiente. Marcar na spec **019** a mudança da invariante de XP
  (`XP = 10 × watched_videos` deixa de valer) e na **013** o crescimento da ordem de exclusão.
- [] Task 07: `npm run lint`, `npm test` e `npm run test:e2e` limpos. O e2e precisa de Java no PATH.
- [] Task 08: Deploy dos índices nos **dois** projetos, com `--project` explícito em cada um, e
  `npm run ranking:backfill` em ambos **antes** de o código novo tomar tráfego — sem o backfill, o
  `GET /ranking` responde `200` com lista vazia e nada aparece em log nenhum. É a mesma armadilha do
  `tab` da spec 021, vista do mesmo lado.
