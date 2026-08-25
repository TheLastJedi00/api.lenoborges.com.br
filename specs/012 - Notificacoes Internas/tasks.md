# Fase 01: A coleção e o repositório [ ]
Branch: `feat/012-notificacoes-camada-de-dados`

Nenhum endpoint. Ao fim desta fase a notificação existe, é única por evento, e dá para saber quem já leu
o quê — tudo coberto por teste, e nada disso ainda visível.

- [ ] Task 01: Módulo e entidade. Arquivos: `src/notifications/notifications.module.ts`,
  `src/notifications/entities/notification.entity.ts`. Objetivo: `Notification` com `kind`, `title`,
  `badgeId`, `actorUid`, `targetId`, `createdAt`, e o converter com `Timestamp`. A função
  `notificationDocId(kind, ...)` monta `video__{badgeId}__{youtubeId}` e `pergunta__{questionId}` — **a
  regra do ID tem um dono só**, como em `badgeVideoDocId` (decisão 2).
- [ ] Task 02 (TDD + implementação): `NotificationRepository`. Arquivos:
  `src/notifications/notification.repository.ts`, `.spec.ts`. Objetivo: `create()` da janela e
  `listWindow(limite, desde)` com `orderBy('createdAt','desc').limit(50)`. **Só ordenação, nenhum
  `where`** (decisão 12) — o teste-trava é que a consulta não ganhe filtro por acidente, porque cada
  filtro aqui é um índice composto novo em produção.
- [ ] Task 03 (TDD + implementação): O `ALREADY_EXISTS` é engolido. Objetivo: `create()` de uma
  notificação que já existe **não lança**. Reusar a constante `ALREADY_EXISTS` de
  `waitlist.repository.ts` em vez de repetir a string (decisão 2).
- [ ] Task 04 (TDD + implementação): Leitura por pessoa. Arquivos:
  `src/notifications/notification-read.repository.ts`, `.spec.ts`. Objetivo: `markRead(uid, id)`,
  `markAllRead(uid, ids)` em `WriteBatch`, e `findMyReads(ids, uid)` devolvendo um `Set` via **um
  `getAll` por caminho** — o mesmo desenho de `MuralRepository.findMyVotes` (decisão 3). Nunca uma
  consulta por usuário, nunca N leituras em laço.
- [ ] Task 05: Comentário registrando a exceção do `set()`. Arquivo: `notification-read.repository.ts`.
  Objetivo: dizer que aqui é `set()` e não `create()` porque marcar como lida **precisa** ser
  idempotente (decisão 10). Sem o comentário, alguém "corrige" para `create()` e o segundo clique passa
  a responder 409.

# Fase 02: Os três endpoints [ ]
Branch: `feat/012-notificacoes-api`

- [ ] Task 01 (TDD + implementação): `NotificationsService.listUnread`. Arquivos:
  `src/notifications/notifications.service.ts`, `.spec.ts`. Objetivo: lê a janela, descarta o que é do
  próprio `actorUid` (decisão 5), descarta o anterior ao `createdAt` do perfil (decisão 6), descarta o
  que já foi lido, e devolve o resto. **Os três cortes em memória**, depois da leitura (decisão 12).
  Testes-trava: quem escreveu não é notificado; membro criado hoje não vê o de ontem.
- [ ] Task 02: DTO da resposta. Arquivo: `src/notifications/dto/notification.dto.ts`. Objetivo: `id`,
  `kind`, `title`, `badgeId`, `createdAt` ISO. **Sem `read`, sem nome de insígnia e sem rota** — a
  decisão 9 inteira cabe num comentário aqui, e é aqui que ela vai ser lida quando alguém quiser
  "facilitar para o front".
- [ ] Task 03 (TDD + implementação): Controller. Arquivos:
  `src/notifications/notifications.controller.ts`, `.spec.ts`. Objetivo: `GET /notificacoes`,
  `POST /notificacoes/:id/lida` (204), `POST /notificacoes/lidas` (204), os três sob
  `FirebaseAuthGuard`, `uid` vindo do `@CurrentUser`. Teste-trava: **marcar duas vezes a mesma
  notificação responde 204 nas duas** (decisão 10).
- [ ] Task 04: Registrar o módulo. Arquivo: `src/app.module.ts`. Objetivo: `NotificationsModule` nos
  imports, e exportando o service — as Fases 03 e 04 dependem disso.
- [ ] Task 05: Swagger. Objetivo: `@ApiTags('notificacoes')`, `@ApiBearerAuth()` e os `@ApiResponse`. O
  `GET` documenta em uma frase que a lista **já vem filtrada** e que o cliente não peneira nada.

# Fase 03: Os dois gatilhos [ ]
Branch: `feat/012-gatilhos`

É a fase que faz o recurso existir de fato, e é a que tem o maior risco: um efeito colateral mal posto
aqui derruba a publicação de vídeo e a criação de pergunta.

- [ ] Task 01 (TDD + implementação): Vídeo novo notifica. Arquivos: `src/track/badge-video.service.ts`,
  `.spec.ts`. Objetivo: depois de criar o vídeo, escrever a notificação com `actorUid` do admin.
  **Teste-trava: notificação falhando, o vídeo continua criado e a resposta continua 201** (decisão 7).
- [ ] Task 02 (TDD + implementação): Pergunta nova notifica. Arquivos: `src/mural/mural.service.ts`,
  `.spec.ts`. Objetivo: mesmo desenho, `actorUid` do autor. Mesmo teste-trava.
- [ ] Task 03: Log de erro na falha ao notificar. Objetivo: o `catch` dos dois gatilhos loga com o id do
  evento. Um `catch` vazio aqui torna a ausência de notificação indetectável — e o sintoma seria "às
  vezes não avisa", que é o pior tipo de bug para investigar.
- [ ] Task 04 (TDD + implementação): Moderar pergunta apaga a notificação dela. Arquivos:
  `src/mural/mural.service.ts`, `.spec.ts`. Objetivo: no mesmo fluxo que já apaga a subcoleção `votes`,
  apagar `notifications/pergunta__{id}` (ponto em aberto 4). Falha ao apagar não derruba a moderação,
  pela decisão 7.
- [ ] Task 05: Comentário nos dois gatilhos. Objetivo: registrar que a notificação é **acessória** e que
  nenhuma falha dela pode virar status de erro. É o tipo de `try/catch` que parece descuido e é decisão.

# Fase 04: O Mural ordenado por mais recentes [ ]
Branch: `feat/012-mural-ordem-recentes`

- [ ] Task 01 (TDD + implementação): `ordem=recentes` no repositório. Arquivos:
  `src/mural/mural.repository.ts`, `.spec.ts`. Objetivo: `listByWeek` aceita a direção e inverte
  `createdAt` para `desc`. O comentário registra que **inverter todas as direções usa o mesmo índice** e
  que nenhum índice novo é exigido (decisão 13) — sem isso, a próxima pessoa abre um chamado para criar
  um índice que já existe.
- [ ] Task 02 (TDD + implementação): O parâmetro no controller. Arquivos: `src/mural/mural.controller.ts`,
  `src/mural/mural.service.ts`, `.spec.ts`. Objetivo: `GET /mural/perguntas?ordem=recentes`. **Sem o
  parâmetro, nada muda** — teste-trava: a chamada de hoje continua devolvendo a mais antiga primeiro.
- [ ] Task 03: `@ApiQuery` do `ordem`. Objetivo: valores e o padrão explícito.

# Fase 05: Documentação e verificação [ ]
Branch: `feat/012-docs`

- [ ] Task 01: `CLAUDE.md`. Objetivo: duas linhas novas na lista de garantias que vivem em código —
  **o ID de `notifications` carrega o evento** e **`notification_reads` é subcoleção e não some com o
  perfil**. É a lista que alguém lê antes de mexer no Firestore, e é o único lugar onde essas duas
  regras são vistas na hora certa.
- [ ] Task 02: `README.md`. Objetivo: os três endpoints na tabela de rotas. Na tabela de índices
  compostos, **uma linha dizendo que a spec 012 não acrescenta nenhum** — a ausência precisa estar
  escrita, ou alguém vai criar um "por precaução" (decisão 12).
- [ ] Task 03: `firestore.rules`. Objetivo: conferir que `notifications` e `notification_reads` caem no
  `deny` global. Nada muda; a regra já nega tudo e só o Admin SDK escreve. **Confirmar, não editar.**
- [ ] Task 04: `npm test` verde e `npm run lint` limpo.
- [ ] Task 05: Verificação no emulador. Objetivo: publicar um vídeo com uma conta e ler `/notificacoes`
  com outra — a segunda vê, a primeira não. Marcar como lida e conferir que sai da lista. Marcar de novo
  e conferir o 204.
- [ ] Task 06: Verificação em produção, junto com o front. Objetivo: publicar um vídeo de verdade e ver o
  sino tocar em outra conta. É a única prova de que o gatilho e o índice de campo único funcionam fora do
  emulador — que não exige índice e por isso nunca reprova.

---

## Resultado da execução

_A preencher ao fim, no formato das specs 009, 010 e 011: o que ficou de fora e por quê, e o que a
execução decidiu que vale registrar._
