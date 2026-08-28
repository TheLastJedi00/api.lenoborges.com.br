> **Dependência de ordem:** tudo aqui emenda as specs **009**, **010** e **017**, que estão no código. As
> três fases entram na ordem escrita: a Fase 02 troca o eixo das consultas para o campo que a Fase 01 cria, e
> a Fase 03 só expõe o que as duas já garantem. **A API pode subir sozinha, antes do front** — sem `tab` no
> corpo o servidor deriva `tab = kind`, e o comportamento é bit a bit o de hoje (decisão 4).

# Fase 01: O campo [x]
Branch: `feat/021-campo-tab`

Ao fim desta fase a `BadgeVideo` sabe dizer em que lista vive, e nada mais no produto usa isso. Nenhuma rota
muda, nenhuma consulta muda, e a suíte inteira continua verde sem uma expectativa reescrita.

- [x] Task 01: O campo na entidade e nos dois lados do converter. Arquivo:
  `src/track/entities/badge-video.entity.ts`. Objetivo: `BadgeVideoTab = 'aula' | 'resposta'`, o campo
  `tab: BadgeVideoTab` na `BadgeVideo` e no `BadgeVideoDocument`, escrito no `toFirestore` e lido no
  `fromFirestore` como **`data.tab ?? data.kind ?? 'aula'`**. O comentário registra a decisão 1 com a frase
  que separa os dois campos — **`kind` é a natureza do vídeo, `tab` é o endereço dele** — e por que não é um
  booleano: `naTrilha` obrigaria a consulta a virar disjunção com `orderBy`, que no Firestore é índice novo e
  plano imprevisível.
- [x] Task 02 (TDD + implementação): O teste-trava do documento antigo. Arquivo:
  `src/track/entities/badge-video.entity.spec.ts` (ou o spec do repositório, onde o converter já é
  exercitado). Objetivo: um documento **sem `tab`** e com `kind: 'resposta'` lê `tab: 'resposta'`; um sem
  `tab` e sem `kind` — o vídeo anterior à spec 010 — lê `tab: 'aula'`. O comentário do teste diz o que ele
  impede: sem o fallback, `where('tab', '==', 'aula')` devolve **lista vazia com 200** para a base inteira, e
  a trilha some sem ninguém ter apagado nada. É a terceira vez que este repositório encontra essa armadilha —
  `kind` (010) e `devTierFree` (009) foram as duas primeiras.
- [x] Task 03: O `tab` no `CreateBadgeVideoData`. Arquivo: `src/track/badge-video.repository.ts`. Objetivo:
  `tab?: BadgeVideoTab` no tipo de criação, com o mesmo default do `create` — sem valor, o vídeo nasce em
  `'aula'`, como já acontece com `kind`. O repositório **não deriva `tab` de `kind`**: quem decide a lista é o
  service, que é onde a regra da decisão 4 mora. O comentário registra isso, porque a derivação aqui pareceria
  mais barata e faria a validação do 400 nunca ser alcançada.

# Fase 02: A lista e a ordem passam a ser por `tab` [x]
Branch: `feat/021-ordem-por-tab`

A fase que muda comportamento. Ao fim dela uma resposta publicada com `tab: 'aula'` aparece na trilha, entra
no fim dela, e é reordenada pelas setas como qualquer aula — tudo isso ainda com o parâmetro de rota antigo.

- [x] Task 01: `listByBadge` filtra por `tab`. Arquivo: `src/track/badge-video.repository.ts`. Objetivo: a
  assinatura passa a receber `tab?: BadgeVideoTab` e o `where` troca de campo. **Sem filtro continua
  devolvendo as duas listas juntas**, que é a visão da administração e não muda. O comentário do topo do
  método troca "filtra a aba (spec 010)" pela frase nova: a aba é o endereço, e o endereço deixou de ser a
  natureza — uma resposta pode viver na lista das aulas desde a spec 021.
- [x] Task 02 (TDD + implementação): O 400 da aula na aba errada. Arquivos:
  `src/track/badge-video.service.ts`, `badge-video.service.spec.ts`. Objetivo: em `create`, `tab = dto.tab ??
  kind`; `kind: 'aula'` com `tab: 'resposta'` responde **400** com a mensagem que diz o que fazer, na mesma
  família dos dois 400 da spec 017. Testes-trava: (a) `kind: 'resposta'` com `tab: 'aula'` é aceito e grava
  `tab: 'aula'` — **é o caso que a spec inteira existe para permitir**, e um teste que só cobre o erro
  deixaria alguém "endurecer" a validação e matar a funcionalidade; (b) corpo sem `tab` grava `tab` igual ao
  `kind`, nos dois valores; (c) `kind: 'aula'` com `tab: 'resposta'` é 400 e **não grava nada**.
- [x] Task 03 (TDD + implementação): O novo vídeo entra no fim da lista dele, e não da aba do `kind`.
  Arquivos: `src/track/badge-video.service.ts`, `badge-video.service.spec.ts`. Objetivo: o `order` do vídeo
  novo é calculado sobre `listByBadge(badge, tab)`. Teste-trava com o caso que revela a diferença: numa
  insígnia com **três aulas e uma resposta na aba**, publicar uma resposta com `tab: 'aula'` grava
  `order: 3` — e não `order: 1`, que é o que sai se alguém contar pela lista do `kind`. Esse é o bug mais
  provável desta fase, e ele não estoura: **dois vídeos com o mesmo `order` na mesma lista** ordenam por
  sorte do Firestore e a trilha embaralha em silêncio.
- [x] Task 04 (TDD + implementação): A renormalização passa a ser por `(badgeId, tab)`. Arquivos:
  `src/track/badge-video.service.ts`, `badge-video.service.spec.ts`. Objetivo: `remove` renormaliza a lista do
  `video.tab`, e `reorder` recebe e valida contra `tab`. O lote atômico da spec 009 não muda em nada além do
  eixo. Teste-trava: apagar uma resposta que estava **no meio da trilha** deixa as aulas restantes em 0..n-1 e
  **não toca em nenhum vídeo da aba de respostas** — renormalizar as duas listas de uma vez é o jeito de
  embaralhar as duas com uma escrita só.
- [x] Task 05: O comentário do `order` na entidade. Arquivo: `src/track/entities/badge-video.entity.ts`.
  Objetivo: o bloco que hoje diz "posição dentro da insígnia **e da aba**" e explica a renormalização por
  `(badgeId, kind)` passa a dizer `(badgeId, tab)`, mantendo a frase que importa — renormalizar sem separar
  por lista embaralha as duas de uma vez, e é o bug mais provável de toda essa família.

# Fase 03: A API [x]
Branch: `feat/021-api-tab`

Ao fim desta fase o front tem como pedir a aba certa e como ligar o toggle, e o Swagger conta a história
inteira.

- [x] Task 01: O `tab` no corpo da publicação. Arquivo: `src/track/dto/create-badge-video.dto.ts`. Objetivo:
  `tab?: 'aula' | 'resposta'` com `@IsOptional() @IsIn([...])`, e a descrição de Swagger dizendo as três
  coisas que quem integra precisa: sem valor, `tab = kind`; `kind: 'resposta'` com `tab: 'aula'` é a resposta
  posicionada na trilha; e `kind: 'aula'` com `tab: 'resposta'` é 400.
- [x] Task 02: O `tab` na resposta. Arquivo: `src/track/dto/badge-video.dto.ts`. Objetivo: o campo no
  `BadgeVideoDto`, com a descrição separando-o de `kind` na mesma frase da decisão 1 — **`kind` é a natureza,
  `tab` é a lista** — e dizendo que os dois divergem exatamente num caso, a resposta posicionada na trilha. O
  `toDto` do service passa a copiar o campo. **`orientation` continua derivando de `kind`** e a descrição dela
  não muda: a resposta na trilha continua sendo `retrato`, e é o cliente que decide não pintar o player ali.
- [x] Task 03: `?kind=` vira `?tab=` nas três rotas. Arquivos: `src/track/track.controller.ts`,
  `src/track/admin-track.controller.ts`. Objetivo: o `@ApiQuery` e o `@Query` mudam de nome nas três, com as
  tolerâncias de hoje preservadas — valor desconhecido é ausente na leitura, e `'aula'` na reordenação. O
  comentário registra a decisão 7: **sem o rename, `?kind=aula` passaria a devolver vídeos cujo `kind` é
  `resposta`**, e um parâmetro que mente sobre o campo que nomeia custa uma tarde a quem for depurar isso
  meses depois. Sem alias do nome antigo — o front é o único cliente e as duas specs entram juntas.
- [x] Task 04: O índice troca de campo. Arquivo: `firestore.indexes.json`. Objetivo: `badgeId + kind + order`
  sai e `badgeId + tab + order` entra; o `badgeId + order` da administração fica. É substituição, não adição:
  nenhuma consulta filtra por `kind` depois desta spec. Publicar com
  `firebase deploy --only firestore:indexes`, e **publicar antes de o código novo receber tráfego** — sem o
  índice, a consulta responde erro com o link para criá-lo, e o emulador não avisa porque não exige índice
  nenhum. **Pendente:** o arquivo está trocado, mas `firebase deploy --only firestore:indexes` não foi
  rodado aqui. Publicar nos **dois projetos** — produção e `dev-liga-dev` — antes de o código novo
  receber tráfego.
- [x] Task 05 (TDD + implementação, **escrito e não executado**): O e2e do caminho inteiro. Arquivo: `test/track.e2e-spec.ts` (ou o
  arquivo e2e da trilha). Objetivo: publicar uma resposta com `tab: 'aula'` numa insígnia que já tem aulas, e
  provar as três coisas de uma vez: (a) `GET /badges/:id/videos?tab=aula` a devolve, no fim; (b)
  `GET /badges/:id/videos?tab=resposta` **não** a devolve; (c) o `PATCH .../order?tab=aula` com a lista
  incluindo o id dela responde 200 — a lista de uma aba com uma resposta dentro é uma lista válida, e é
  exatamente o que a validação recusaria se alguém a escrevesse contra `kind`.
- [x] Task 06: O README. Arquivo: `README.md`. Objetivo: a seção da coleção `badge_videos` ganha o `tab` com
  a frase da decisão 1 e a do fallback do converter; a linha da tabela de índices compostos troca `kind` por
  `tab`; e a seção da spec 010 ganha a emenda de uma linha — **o padrão continua sendo duas listas, e ele
  passa a poder ser dispensado por vídeo, na publicação.**
- [x] Task 07: O `CLAUDE.md`. Arquivo: `CLAUDE.md`. Objetivo: uma linha na lista de decisões arquiteturais,
  no lugar certo — perto da linha de `badge_videos` e da de `orientation`. Ela diz o que a próxima pessoa
  precisa saber antes de tocar em qualquer consulta de vídeo: **`kind` é a natureza e `tab` é a lista; toda
  consulta e toda renormalização são por `tab`, e `orientation` continua saindo de `kind`.** E diz o fallback
  do converter, que é a linha cuja ausência apaga a trilha inteira em silêncio.
