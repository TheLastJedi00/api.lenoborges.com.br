> **Dependência de ordem:** tudo aqui emenda as specs **009** e **010**, que estão no código. A Fase 01 é
> independente de todas as outras e pode entrar sozinha — ela é o que destrava o admin hoje. As Fases 02 e
> 03 dependem uma da outra na ordem escrita: a foto da pergunta precisa existir antes de o DTO poder
> devolvê-la.

# Fase 01: A sexta forma de URL [x]
Branch: `feat/017-shorts-url`

A fase mais curta e a que sozinha já muda a vida do admin. Ao fim dela o link que o botão Compartilhar do
YouTube copia num celular é aceito.

- [x] Task 01 (TDD + implementação): `extractYoutubeId` aprende Shorts. Arquivos: `src/track/youtube-id.ts`,
  `youtube-id.spec.ts`. Objetivo: `youtube.com/shorts/{id}` e `m.youtube.com/shorts/{id}` devolvem o ID,
  reaproveitando o `pathAfter` que já existe — a mesma função, com `'shorts'` no lugar de `'embed'`, e não
  um segundo caminho paralelo. Testes-trava: (a) `https://www.youtube.com/shorts/dQw4w9WgXcQ` devolve o ID;
  (b) **o mesmo link com `?feature=share`** devolve o ID — é a forma real que o app do YouTube copia, e a
  que vai ser colada; (c) `youtube.com/shorts/` sem id e `youtube.com/shorts/abc` (ID curto demais) devolvem
  `{ found: false }`, e não uma string vazia que viraria o caminho `logica__`; (d) as cinco formas antigas
  continuam devolvendo exatamente o que devolviam.
- [x] Task 02: O comentário do topo. Arquivo: `src/track/youtube-id.ts`. Objetivo: o bloco de documentação
  diz "cinco formas" e passa a dizer seis, nomeando Shorts e registrando **por que ele não precisa de mais
  nada além da extração**: o ID é o mesmo ID de 11 caracteres e o `embed` do YouTube serve Short sem
  tratamento especial. Sem essa frase, a próxima pessoa procura um player especial que não existe.

# Fase 02: A foto da pergunta [x]
Branch: `feat/017-foto-da-pergunta`

Ao fim desta fase o vídeo de resposta carrega a pergunta dentro de si, e a API ainda não devolve nada novo.

- [x] Task 01: O campo. Arquivo: `src/track/entities/badge-video.entity.ts`. Objetivo: a interface
  `AnsweredQuestion { id, title, authorName, askedAt }` e o campo `question: AnsweredQuestion | null` na
  `BadgeVideo`, no `BadgeVideoDocument` e nos dois lados do converter, com `askedAt` como `Timestamp` no
  documento e `Date` na entidade, e `data.question ?? null` na leitura. O comentário registra os três
  motivos da decisão 3 — **não custa leitura por visita, sobrevive à remoção da pergunta, e é o que foi
  perguntado e não o que a pergunta virou** — e registra que `askedAt` é o `createdAt` da **pergunta**, e
  nunca o do vídeo.
- [x] Task 02: O `MuralRepository` entra no módulo da trilha. Arquivos: `src/track/track.module.ts`,
  `src/mural/mural.module.ts`. Objetivo: o `BadgeVideoService` passa a poder ler uma pergunta pelo id. O
  comentário registra **por que o repositório e não o `MuralService`**: o que se quer aqui é uma leitura por
  caminho, e passar pelo service traria junto a derivação de fase, o `hasVoted` e a montagem de DTO, além de
  criar um ciclo entre os dois módulos — a 010 já teve esse cuidado ao manter o mural sem depender da
  trilha.
- [x] Task 03 (TDD + implementação): Resposta exige pergunta, e a pergunta tem que existir. Arquivos:
  `src/track/badge-video.service.ts`, `badge-video.service.spec.ts`. Objetivo: em `create`, `kind:
  'resposta'` sem `questionId` responde **400** com a mensagem da simetria (decisão 4), e `questionId` que
  não existe responde **404** nomeando o id. A regra antiga — aula **com** pergunta é 400 — continua
  intacta e ganha um teste ao lado, para as duas metades da simetria caírem no mesmo lugar do arquivo.
  Testes-trava: (a) resposta sem `questionId` é 400; (b) resposta com id inexistente é 404 e **não grava
  nada** — o teste confere que o `create` do repositório não foi chamado; (c) aula com `questionId` continua
  400; (d) aula sem `questionId` continua passando.
- [x] Task 04 (TDD + implementação): A foto é tirada. Arquivos: `badge-video.service.ts`,
  `badge-video.service.spec.ts`. Objetivo: a leitura da Task 03 alimenta `question` no `create` do
  repositório — `{ id, title, authorName, askedAt: createdAt }` —, e `question` é `null` em toda aula.
  Testes-trava: (a) o documento gravado carrega o título e o nome **daquele momento**; (b) alterar a
  pergunta depois não muda o vídeo — o teste edita o mock da pergunta e relê o vídeo; (c) **a insígnia do
  vídeo pode ser diferente da insígnia da pergunta e a publicação passa** (decisão 6), que é o teste que
  impede alguém "consertar" isso com uma validação a mais.
- [x] Task 05: A leitura é uma só. Arquivo: `badge-video.service.ts`. Objetivo: comentário registrando que a
  pergunta é lida **uma vez, na publicação**, e que essa leitura é o preço inteiro da decisão 3 — a
  alternativa era um `getAll` por listagem, e listagem acontece toda vez que alguém abre a aba. Sem o
  comentário, a primeira refatoração que "simplificar" move a leitura para o `listByBadge`.

# Fase 03: O que a API devolve [x]
Branch: `feat/017-dto-da-resposta`

- [x] Task 01: `orientation` no DTO. Arquivos: `src/track/dto/badge-video.dto.ts`,
  `src/track/badge-video.service.ts`. Objetivo: `orientation: 'paisagem' | 'retrato'`, derivado no `toDto` a
  partir do `kind`, **sem existir no documento**. O `@ApiProperty` diz que o campo é derivado e que o
  cliente **não deve recalculá-lo**, e o comentário no `toDto` registra a decisão 2: o dia em que uma
  resposta for gravada em paisagem, muda esta linha e nenhum front. É a mesma forma da `phase` da spec 010.
- [x] Task 02: `question` no DTO. Arquivo: `src/track/dto/badge-video.dto.ts`. Objetivo: a classe
  `AnsweredQuestionDto` com os quatro campos, `askedAt` como ISO 8601 em string, e `question:
  AnsweredQuestionDto | null` no `BadgeVideoDto`. O `@ApiProperty` registra que ela é **uma foto do momento
  da publicação** e que `questionId` continua ao lado dela — o id serve para navegar até o mural, a foto
  serve para desenhar o balão, e um não substitui o outro. Vídeo anterior a esta spec responde `null` e o
  front precisa aguentar isso.
- [x] Task 03 (TDD + implementação): O `kind` no `GET` do admin. Arquivos:
  `src/track/admin-track.controller.ts`, `badge-video.service.spec.ts`. Objetivo: `GET
  /admin/badges/:badgeId/videos` aceita `?kind=`, com `@ApiQuery` igual ao que a rota de reordenação já tem,
  repassando ao `listByBadge` que **já sabe filtrar**. Sem parâmetro, as duas abas — o comportamento de
  hoje. O `@ApiOperation` registra por que o parâmetro existe: **a reordenação valida contra uma aba**, e
  sem esta lista separada o painel manda a lista misturada e leva 400 em toda seta.
- [x] Task 03b: `createdAt` na pergunta do Mural. Arquivos: `src/mural/dto/mural-question.dto.ts`,
  `src/mural/mural.service.ts`. Objetivo: a data de criação sai em ISO 8601 no `MuralQuestionDto`. Não é
  para o balão da trilha — a foto já carrega o `askedAt` —, é para o **painel**, que mostra a pergunta antes
  de gravar o vídeo e monta esse bloco a partir da pauta. O `@ApiProperty` registra por que o `weekId` não
  serve: ele é o domingo que abre a semana, e a pergunta pode ter nascido na quinta — uma data que parece
  certa e está errada em seis dias de cada sete. Nenhuma leitura nova.
- [x] Task 04 (TDD + implementação): O vínculo do outro lado. Arquivos: `badge-video.service.ts`,
  `badge-video.service.spec.ts`. Objetivo: publicada a resposta, gravar `answerVideoId` na pergunta, **por
  último** — depois do vídeo, depois da notificação, depois do e-mail — dentro de `try/catch` que loga e não
  derruba. Testes-trava: (a) publicar resposta grava o id do vídeo na pergunta; (b) **a escrita falhando não
  transforma a publicação em erro** — o teste faz o `update` rejeitar e exige 201 mesmo assim; (c) publicar
  aula não escreve nada no mural. O comentário registra que este é o lado barato de falhar porque o balão
  vem da foto, e não deste vínculo (decisão 7).

# Fase 04: Documentação e verificação [x]
Branch: `feat/017-docs-e-e2e`

- [x] Task 01: `README.md`. Objetivo: os campos novos de `badge_videos` (`question`), os campos novos da
  resposta de `GET /badges/:badgeId/videos` (`orientation`, `question`), o `?kind=` no `GET` do admin, e a
  linha dizendo que **`orientation` é derivada e não gravada**. Na seção de índices compostos, dizer
  explicitamente que **nenhuma linha muda**.
- [x] Task 02: `CLAUDE.md`. Objetivo: duas linhas na lista de garantias que vivem em código — **`extractYoutubeId` é o dono único da normalização de URL do YouTube, e a lista de formas que ele conhece é
  a lista inteira que o produto aceita**; e **a pergunta que um vídeo de resposta mostra é uma foto da
  publicação, não uma junção — ela sobrevive à remoção da pergunta e não acompanha edição dela**.
- [x] Task 03 (e2e, escrito e **não executado**: sem Java nesta máquina, `npm run test:e2e` não sobe o
  emulador): O caminho inteiro. Arquivo: `test/track.e2e-spec.ts`. Objetivo: semear uma pergunta no mural,
  publicar um vídeo **com link de Shorts** e `kind: 'resposta'` apontando para ela, e provar as quatro
  consequências de uma vez: **o vídeo entra com o ID certo, sai da API com `orientation: 'retrato'`, carrega
  a foto da pergunta com título e autor, e a pergunta ficou com `answerVideoId`.** É o único lugar onde
  todas as decisões desta spec se verificam juntas.
- [x] Task 04 (e2e, escrito e **não executado**: sem Java nesta máquina): As recusas. Arquivo:
  `test/track.e2e-spec.ts`. Objetivo: resposta sem `questionId` responde 400, resposta com id inexistente
  responde 404, e aula com `questionId` continua respondendo 400. As três na mesma prova, porque as três são
  a mesma simetria (decisão 4).
- [x] Task 05 (e2e, escrito e **não executado**: sem Java nesta máquina): As duas abas não se misturam.
  Arquivo: `test/track.e2e-spec.ts`. Objetivo: com duas aulas e duas respostas na mesma insígnia, `GET
  /admin/badges/:id/videos?kind=resposta` devolve duas, e reordenar essas duas **não muda a ordem das
  aulas**. É a prova de que o `?kind=` da Fase 03 resolveu o 400 que a primeira publicação de resposta teria
  criado.
