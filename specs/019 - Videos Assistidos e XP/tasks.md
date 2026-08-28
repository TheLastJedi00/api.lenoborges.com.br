> ## Ajustes durante a execução
>
> Cinco coisas saíram diferentes do que o `tasks.md` escreveu, e nenhuma delas muda uma decisão.
>
> 1. **`findMany` chama-se `findWatchedIds` e devolve um `Set<string>`**, não uma lista de documentos.
>    Quem chama só precisa responder "este vídeo está marcado?", e devolver as entidades faria o
>    `BadgeVideoService` reimplementar o filtro por `watched` — que é a linha em que alguém, um dia,
>    desenharia o check de um vídeo cujo documento existe só porque o XP já foi pago.
> 2. **Existe um `src/track/testing/fake-firestore.ts`**, que o `tasks.md` não previu. A invariante da
>    decisão 2 — `xp === XP_PER_VIDEO × nº de documentos` — **não é verificável com `jest.fn()`**: um mock
>    prova que `batch.create` foi chamado, não que a segunda chamada falhou, que o incremento não aconteceu
>    por causa dela, e que o número final bate com a contagem. O fake implementa só a superfície que o
>    repositório usa, e o `commit()` dele falha inteiro no `ALREADY_EXISTS`, que é a atomicidade de que a
>    decisão 3 depende.
> 3. **O `AdminTrackController` passou a receber `@CurrentUser`** e a mandar o próprio uid para
>    `listByBadge`. A alternativa era um `uid` opcional com um ramo devolvendo `watched: false` para todo
>    mundo; um caminho único em `listByBadge` é um ramo a menos para envelhecer sozinho.
> 4. **`ProfileRepository` ganhou `setSocialLinksPublic`**, em vez de o serviço usar o `update` genérico.
>    É o mesmo molde do `setEmailOptOut` ao lado — um campo, uma escrita, e o `{ found }` que o serviço
>    traduz em `404`.
> 5. **Os documentos legais subiram para `2026-08-28`** (Task 26, ampliada a pedido). O cartão exibe bio e
>    redes, e a cláusula 3 da Política falava só de nome e pergunta: os dois documentos ganharam parágrafos
>    sobre o cartão e sobre o registro de vídeos assistidos, e a Política ganhou o interruptor na tabela de
>    direitos. **Isso custa um novo aceite de toda a base**, pelo desenho da spec 018, e é o comportamento
>    correto. Como efeito colateral, `legal.service.spec.ts` e `legal-acceptance.guard.spec.ts` passaram a
>    derivar a versão de `LEGAL_DOCUMENTS` em vez de fixá-la: bumpar já custa um aceite da base inteira,
>    não pode custar também meia dúzia de testes vermelhos que não dizem nada sobre comportamento. Quem
>    guarda o texto contra edição silenciosa continua sendo o teste-trava do `contentHash` — e ele fez
>    exatamente o que deveria: ficou vermelho na primeira vírgula editada.


# Fase 01: O razão e o XP [x]
Branch: `feat/019-razao-de-xp`

Modelo e repositório. Ao fim desta fase o XP é gravável e conferível, e **nenhuma rota o expõe ainda**.

- [x] Task 01: Os dois campos no perfil. Arquivo: `src/profile/entities/profile.entity.ts`. Objetivo:
  `xp: number` e `socialLinksPublic: boolean` na interface, no `ProfileDocument` e nos dois lados do
  converter. **`xp ?? 0`** e **`socialLinksPublic ?? false`** no `fromFirestore`, cada um com o comentário
  do motivo (decisões 3 e 9): sem o primeiro, `undefined + 10` é `NaN` e o painel exibe `NaN XP` para a
  base inteira; sem o segundo, o `undefined` numa comparação booleana é falso por acidente e não por
  escolha — e o dia em que alguém "corrigir" para `?? true` publica o LinkedIn de todo mundo.
- [x] Task 02 (TDD): Spec do converter. Arquivo: `profile.entity.spec.ts`. Objetivo: dois teste-trava, ao
  lado dos que já existem para `emailOptOut`, `tier` e `legalAcceptances` — documento antigo lê `xp: 0` e
  `socialLinksPublic: false`. O segundo tem uma mensagem explícita: *"o padrão é invisível; mudar isto
  publica as redes de quem nunca foi perguntado"*.
- [x] Task 03: A constante. Arquivo: `src/track/track.constants.ts`. Objetivo: `XP_PER_VIDEO = 10`, ao
  lado de `BADGE_IDS`. **Um lugar só, e do lado do servidor** (decisão 7) — o front nunca multiplica, e
  quem escrever um `10` solto em qualquer outro arquivo cria a segunda regra.
- [x] Task 04: A entidade do razão. Arquivo: `src/track/entities/watched-video.entity.ts`. Objetivo:
  `WatchedVideo` com `videoId`, `badgeId`, `watched`, `firstWatchedAt`, `updatedAt`, e o converter. O
  comentário no topo é a decisão 2 inteira, em três linhas: **`firstWatchedAt` é imutável e nenhum caminho
  do código o reescreve**; `watched` é o interruptor da tela; existir documento significa XP já pago.
  Quem trocar `watched: false` por um `delete` transforma o duplo clique em farm de pontos.
- [x] Task 05: O repositório. Arquivo: `src/track/watched-video.repository.ts`. Objetivo:
  `WATCHED_VIDEO_SUBCOLLECTION = 'watched_videos'`; `findMany(uid, videoIds)` com **`getAll` nos caminhos
  exatos** (decisão 6, e o comentário diz por que não é um `where`); `setWatched(uid, videoId, badgeId,
  watched)` devolvendo `{ granted: boolean }`; e `removeAll(uid)` para a exclusão de conta.
- [x] Task 06: A escrita que paga o XP, e a única que paga. Arquivo: `watched-video.repository.ts`.
  Objetivo: quando não existe documento, **um `WriteBatch` com `create()` do razão e
  `FieldValue.increment(XP_PER_VIDEO)` no perfil**. `ALREADY_EXISTS` derruba o lote inteiro e é isso que
  impede o incremento (decisão 3) — **sem transação, sem leitura prévia, sem janela entre conferir e
  escrever**. Quando o documento já existe, é um `update` de `watched` e `updatedAt`, e mais nada: sem
  tocar em `firstWatchedAt`, sem tocar em `xp`.
- [x] Task 07 (TDD): Spec do repositório. Arquivo: `watched-video.repository.spec.ts`. Objetivo: as travas
  que sustentam a spec inteira — marcar pela primeira vez cria e incrementa 10; **marcar de novo não
  incrementa**; **desmarcar não decrementa e não apaga o documento**; **desmarcar e remarcar não
  incrementa** (é o farm da decisão 2, e este é o teste que o impede de nascer); `firstWatchedAt` é o mesmo
  valor nas três escritas seguintes; `findMany` de um vídeo nunca marcado devolve ausência, e não erro.

# Fase 02: Marcar e listar [x]
Branch: `feat/019-marcar-video`

- [x] Task 08: O serviço. Arquivo: `src/track/watched-video.service.ts`. Objetivo: `setWatched(uid,
  videoId, dto)`. **Confere que o vídeo existe antes de pagar** (decisão 5): lê `badge_videos/{videoId}`,
  `404` se não achar, e é dali que sai o `badgeId` gravado — nunca de um `split` no id. A conferência
  acontece **só quando não há documento do razão**; remarcar não relê o vídeo. Devolve `{ videoId,
  watched, xp }` com o `xp` já atualizado.
- [x] Task 09: A lista diz o que já foi visto. Arquivos: `src/track/badge-video.service.ts`,
  `src/track/dto/badge-video.dto.ts`, `src/track/track.controller.ts`. Objetivo: `listByBadge` passa a
  receber o `uid`, chama `findMany` com os ids que já vai devolver, e cada `BadgeVideoDto` ganha
  `watched: boolean`. Vídeo sem documento é `false` — **não existe "não sei"** (decisão 6). O
  `@CurrentUser` entra no controller; o guard já estava lá.
- [x] Task 10: O DTO de entrada. Arquivo: `src/track/dto/set-watched.dto.ts`. Objetivo: `watched`,
  `@IsBoolean()`, obrigatório. **Sem valor padrão** — um corpo vazio que caísse em `true` faria um `PUT`
  malformado marcar o vídeo, e o único jeito de perceber seria pelo XP subindo sozinho.
- [x] Task 11: A rota. Arquivo: `src/profile/profile.controller.ts`. Objetivo:
  `PUT /me/watched-videos/:videoId`, `200`, `@Throttle` em `60/min`. Mora no `ProfileController` porque o
  prefixo `/me` é dele — o serviço é o do `TrackModule`, como o aceite legal mora aqui e o serviço é o do
  `LegalModule` (spec 018, Task 16).
- [x] Task 12 (TDD): A invariante da decisão 2, como teste. Arquivo: `watched-video.service.spec.ts`.
  Objetivo: uma sequência de marcações, desmarcações e remarcações sobre vários vídeos, e ao final
  **`xp === XP_PER_VIDEO × (número de documentos criados)`**, sem contar quantos estão marcados. É a
  propriedade que a decisão 2 existe para garantir, e é a única forma de ela não se perder num refactor
  futuro. Mais: `videoId` inexistente é `404` **antes de qualquer escrita**, e o `xp` não muda.
- [x] Task 13 (TDD): A lista por membro. Arquivo: `badge-video.service.spec.ts`. Objetivo: teste-trava de
  isolamento — o `watched` de um membro **nunca** aparece na resposta de outro. É barato, é óbvio, e é o
  erro que um cache de lista mal colocado produz sem falhar em nada.

# Fase 03: O cartão do membro [x]
Branch: `feat/019-cartao-do-membro`

- [x] Task 14: O DTO público. Arquivo: `src/profile/dto/public-member.dto.ts`. Objetivo: `id`, `name`,
  `bio`, `grade`, `xp`, `linkedin`, `instagram`, com `@ApiProperty` em tudo. O comentário no topo é a
  decisão 8, e ele é a única defesa que este arquivo tem: **não estende `ProfileDto`, não reusa mapeador,
  não é montado por espalhamento de objeto** — os três atalhos que fazem o campo seguinte vazar sem ninguém
  ter escolhido. Campo novo no perfil **não** entra aqui por padrão.
- [x] Task 15: O caso de uso. Arquivo: `src/profile/profile.service.ts`. Objetivo:
  `findPublicMember(uid)` — `404` quando não há perfil **ou quando `completedAt` é nulo** (decisão 8), e
  `linkedin`/`instagram` viram `null` quando `socialLinksPublic` é falso. **O corte é aqui, no serviço, e
  não na tela**: um front que receba o link e decida não desenhá-lo já o entregou a quem abrir a aba de
  rede.
- [x] Task 16: A rota. Arquivos: `src/profile/members.controller.ts`, `src/profile/profile.module.ts`.
  Objetivo: `GET /members/:uid` com `FirebaseAuthGuard`. **Controller próprio**, porque o prefixo não é
  `/me` e pendurar em `/me/members/:uid` seria dizer que o cartão de outra pessoa é um recurso meu.
- [x] Task 17 (TDD): Spec do cartão. Arquivo: `members.controller.spec.ts`. Objetivo: quatro travas —
  perfil com `socialLinksPublic: false` responde `200` com as duas redes em `null`; com `true`, responde
  com elas; **onboarding incompleto é `404`**; e o **teste de vazamento**, que é o que importa mais: a
  resposta tem exatamente as sete chaves esperadas, comparadas por igualdade de conjunto — **não por
  `toMatchObject`**, que passa feliz quando um campo a mais aparece. O dia em que alguém acrescentar
  `phone` ao perfil e a um mapeador compartilhado, este teste é o que fica vermelho.
- [x] Task 18: `authorUid` no Mural. Arquivos: `src/mural/dto/mural-question.dto.ts`,
  `src/mural/mural.service.ts`. Objetivo: `authorUid: string | null`, **`null` quando o autor é
  `ANONYMOUS_AUTHOR_UID`** (decisão 11). A tradução acontece aqui, uma vez; o front nunca aprende o
  sentinela.
- [x] Task 19 (TDD): Spec do `authorUid`. Objetivo: pergunta de autor vivo traz o uid; pergunta
  anonimizada traz `null`. Duas linhas, e elas impedem um cartão `404` em cima da pergunta de alguém que
  pediu para ser esquecido.

# Fase 04: O interruptor e a exclusão [x]
Branch: `feat/019-privacidade`

- [x] Task 20: O DTO e a rota. Arquivos: `src/profile/dto/privacy-preference.dto.ts`,
  `src/profile/profile.controller.ts`. Objetivo: `PATCH /me/privacy` com `{ socialLinksPublic: boolean }`,
  `204`, `@Throttle` em `10/min`. Rota própria e **não um campo a mais em `PATCH /me/profile`**: aquele
  exige nome, telefone e bio, e é ele que carimba `completedAt` — um interruptor que exige reenviar o
  cadastro inteiro é um interruptor que ninguém liga. Mesmo desenho de `PATCH /me/emails` (spec 014).
- [x] Task 21: `xp` e `socialLinksPublic` no `GET /me`. Arquivos: `src/profile/dto/profile.dto.ts`,
  `src/profile/profile.service.ts`. Objetivo: os dois campos no `ProfileDto`. O `xp` é o que alimenta o
  selo do painel; o `socialLinksPublic` é o que deixa o interruptor de Meu Perfil abrir já na posição
  certa — sem ele, a tela chuta, e chuta ligado.
- [x] Task 22: A exclusão apaga a subcoleção. Arquivo: `src/profile/profile.service.ts`. Objetivo:
  `watched_videos` entra no **passo 4** da ordem da spec 013, junto de `legal_acceptances` e
  `notification_reads`. Quarta vez que o produto esbarra em "subcoleção não morre com o pai" (decisão 13).
- [x] Task 23 (TDD): Spec da exclusão. Objetivo: teste-trava de que a subcoleção some. O da spec 018 para
  `legal_acceptances` é o molde e está a poucas linhas dali.

# Fase 05: Fechar [ ]
Branch: `feat/019-fechamento`

- [x] Task 24 (e2e): `test/watched-videos.e2e-spec.ts`. Objetivo: o percurso inteiro contra o emulador —
  listar a insígnia e ver tudo `watched: false`; marcar dois vídeos e ver o `xp` em 20; recarregar a lista
  e ver os dois marcados; **desmarcar um e ver o `xp` continuar em 20**; **remarcar e ver o `xp` continuar
  em 20**; e `PUT` num `videoId` inventado responder `404` com o `xp` intacto.
- [x] Task 25 (e2e): `test/members.e2e-spec.ts`. Objetivo: dois membros, um abre o cartão do outro —
  redes ausentes por padrão; `PATCH /me/privacy` liga; o cartão passa a trazê-las; e o corpo **nunca**
  traz e-mail, telefone ou tier, em nenhum dos dois estados.
- [x] Task 26: `README.md` e `CLAUDE.md`. Objetivo: a nova subcoleção na lista das que a exclusão precisa
  apagar (agora são três); os dois campos novos do perfil com seus fallbacks; e a frase que resume a
  decisão 2 — **o XP é definitivo porque o registro é um razão, e por isso ele é sempre igual a dez vezes
  o número de documentos**. A tabela de índices compostos **não ganha linha** (decisão 14).
- [ ] Task 27: `npm run lint`, `npm test`, `npm run test:e2e`. O e2e precisa de Java no PATH — a Task 28
  da spec 018 ficou parada exatamente aqui, e **as suítes e2e daquela spec continuam sem nunca ter sido
  executadas**. Instalar o JDK antes de fechar esta fase fecha as duas.
