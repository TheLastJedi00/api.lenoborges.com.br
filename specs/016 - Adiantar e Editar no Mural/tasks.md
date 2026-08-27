> **Dependência de ordem:** tudo aqui emenda a spec **010**, que está no código. Não há dependência da 013,
> da 014 nem da 015. As fases entram em ordem: a Fase 01 muda a assinatura de `phaseOf` e é o que faz o
> compilador apontar os chamadores para as fases seguintes.

# Fase 01: O piso [x]
Branch: `feat/016-piso-da-fase`

Nenhuma rota nova e nenhum comportamento visível. Ao fim desta fase a fase de uma pergunta sabe da
promoção, e nada ainda promove nada.

- [x] Task 01: O campo. Arquivo: `src/mural/entities/mural-question.entity.ts`. Objetivo: `promotedTo:
  'votacao' | 'encerrada' | null` na interface, no `MuralQuestionDocument` e nos dois lados do converter,
  com `data.promotedTo ?? null` na leitura. O comentário em cima do campo registra que ele é **piso e não
  estado**: levanta o chão da fase e nunca a segura, que é o que mantém a decisão 1 da spec 010 de pé.
- [x] Task 02 (TDD + implementação): `phaseOf` passa a receber a pergunta. Arquivos:
  `src/mural/mural-phase.ts`, `mural-phase.spec.ts`. Objetivo: assinatura `phaseOf(question, now)` onde
  `question` é `{ weekId, promotedTo }`, devolvendo o **maior** entre a fase natural e o piso, na escala
  `coleta < votacao < encerrada`. Testes-trava: (a) pergunta da semana em coleta com `promotedTo: 'votacao'`
  responde `votacao`; (b) **pergunta de três semanas atrás com `promotedTo: 'votacao'` responde
  `encerrada`** — é o teste que prova que o relógio ganha quando está à frente, e é o bug que um campo
  `status` gravado teria; (c) `promotedTo: null` devolve exatamente o que a versão antiga devolvia, nos três
  casos.
- [x] Task 03: Os chamadores. Arquivos: `src/mural/mural.service.ts`, `src/mural/vote.service.ts`.
  Objetivo: passar a pergunta inteira onde hoje se passa `found.entry.weekId` ou `question.weekId`. É
  mecânico e é o motivo de a Task 02 ter trocado a assinatura em vez de aceitar um terceiro parâmetro
  opcional — **um parâmetro opcional deixaria os três chamadores compilando com a fase errada.**
- [x] Task 04 (TDD + implementação): O voto obedece ao piso. Arquivo: `src/mural/vote.service.spec.ts`.
  Objetivo: teste-trava de que uma pergunta da semana em coleta, promovida a `votacao`, **aceita voto** — e
  que a mesma pergunta sem promoção continua respondendo 409. É a primeira prova de que a decisão 1 desta
  spec é uma decisão, e não um `if` a mais em cada tela.

# Fase 02: A rota de adiantar [x]
Branch: `feat/016-adiantar`

Ao fim desta fase o admin promove, e o mural ainda não sabe mostrar o resultado — a Fase 03 é que arruma a
listagem.

- [x] Task 01: DTO da promoção. Arquivo: `src/mural/dto/promote-question.dto.ts`. Objetivo: `fase` com
  `@IsIn(['votacao', 'encerrada'])`. O comentário registra que **`'coleta'` não é valor aceito de
  propósito** (decisão 11): despromover é recusado na validação, que é o lugar mais barato de dizer a
  decisão 2.
- [x] Task 02 (TDD + implementação): `promote` no service. Arquivos: `src/mural/mural.service.ts`,
  `mural.service.spec.ts`. Objetivo: ler a pergunta, calcular a fase atual pela Task 02 da Fase 01, gravar
  `promotedTo` e devolver o DTO. Testes-trava: (a) pergunta inexistente responde **404**; (b) promover para
  `votacao` uma pergunta **já em votação pela conta natural** responde **409**, e não um 200 que não faz
  nada — a tela precisa saber que o botão não tinha efeito; (c) promover para `encerrada` uma pergunta em
  coleta funciona e **pula a votação inteira** (ponto em aberto 3); (d) `votacao → encerrada` é aceito.
- [x] Task 03: O `promotedTo` no repositório. Arquivo: `src/mural/mural.repository.ts`. Objetivo: incluir
  `promotedTo` no `Partial<Pick<...>>` que o `update` aceita. Nada mais muda no repositório — o `create`
  continua nascendo sem o campo, e o converter da Task 01 da Fase 01 é quem o lê como `null`.
- [x] Task 04: A rota. Arquivo: `src/mural/admin-mural.controller.ts`. Objetivo:
  `PATCH perguntas/:id/fase`, sob os guards que a classe já aplica, devolvendo `MuralQuestionDto`.
  `@ApiOperation` explicando que a promoção é **de mão única** e que o caminho de arrependimento é o
  `DELETE` da mesma classe, com `@ApiResponse` para 404 e 409.
- [x] Task 05 (TDD + implementação): Adiantar não abre vaga. Arquivo: `mural.service.spec.ts`. Objetivo:
  teste-trava de que, depois de promover a própria pergunta da semana corrente, `getState` continua com
  `canAsk: false` e `myQuestionId` apontando para ela (decisão 10). É o teste que impede a "otimização" de
  resolver a fase mexendo no `weekId` do documento.

# Fase 03: O mural obedece à fase []
Branch: `feat/016-mural-por-fase`

A fase que troca o eixo da listagem: de `weekId` para fase derivada.

- [ ] Task 01 (TDD + implementação): As duas semanas vivas. Arquivos: `src/mural/mural.service.ts`,
  `mural.service.spec.ts`. Objetivo: `listQuestions` carrega a semana atual **e** a anterior e particiona
  pela fase da Task 02 da Fase 01, ordenando em memória — votos decrescentes com desempate por
  `createdAt` crescente na votação, `createdAt` crescente na coleta, invertida pelo `newestFirst`.
  Testes-trava: (a) pergunta da semana atual promovida a `votacao` **aparece na aba de votação e some da
  coleta**; (b) pergunta promovida a `encerrada` **não aparece em nenhuma das duas**; (c) sem nenhuma
  promoção, as duas abas devolvem exatamente o que devolviam antes, na mesma ordem — é o teste que garante
  que a troca de eixo não é uma mudança de comportamento.
- [ ] Task 01b (TDD + implementação): **A invariante do adiantamento.** Arquivos: `mural.service.spec.ts`,
  `vote.service.spec.ts`. Objetivo: semear quatro perguntas na semana em coleta, promover **uma**, e provar
  que as outras três não se moveram — continuam na aba de coleta, continuam **recusando voto com 409**, e
  continuam editáveis pelos autores. Depois o inverso, na semana em votação: promover uma para `encerrada`
  não impede as demais de continuarem recebendo voto até a virada normal. É a task que existe para o
  adiantamento custar zero a quem não foi adiantado — sem ela, a primeira refatoração que "simplificar" a
  partição empurra a semana inteira junto, e o sintoma é um mural que abre o voto uma semana antes para todo
  mundo.
- [ ] Task 02: O `getAll` dos votos continua sendo um só. Arquivo: `mural.service.ts`. Objetivo: a leitura
  de "em quais eu votei" acontece **depois** da partição, sobre os ids da aba pedida, e não sobre as duas
  semanas inteiras. Comentário registrando o porquê: o `findMyVotes` é um `getAll` por caminho e o custo é
  linear nos ids passados — particionar antes é o que impede a leitura dobrar de tamanho.
- [ ] Task 03 (TDD + implementação): A vencedora sai em memória. Arquivos: `src/mural/mural.repository.ts`,
  `mural.repository.spec.ts`, `mural.service.ts`. Objetivo: `findWinner` deixa de ser um `limit(1)` e passa
  a carregar a semana pelo `listByWeek`, descartar quem tem `promotedTo` não nulo e escolher em memória —
  maior `voteCount`, desempate pela mais antiga. Testes-trava: (a) a mais votada da semana, **promovida**,
  não vence, e quem vence é a segunda; (b) **semana em que todas as perguntas são documentos sem o campo
  `promotedTo`** elege normalmente — é a armadilha do `== null` da decisão 4, e é o único teste desta spec
  que existe por causa de uma pegadinha do Firestore, não de uma regra de produto; (c) semana vazia continua
  devolvendo `{ found: false }`.
- [ ] Task 04 (TDD + implementação): A pauta. Arquivos: `src/mural/dto/winner.dto.ts`,
  `src/mural/mural.service.ts`, `mural.service.spec.ts`. Objetivo: `listWinners` passa a devolver, junto das
  vencedoras das semanas encerradas, **as promovidas a `encerrada`**, cada entrada com
  `origem: 'voto' | 'adiantada'`. As adiantadas saem dos arrays que as Tasks 01 e 03 já carregaram — **sem
  consulta nova e sem índice novo** (decisão 5). Testes-trava: (a) uma pergunta adiantada da semana corrente
  aparece na pauta com `origem: 'adiantada'`; (b) ela **não aparece duas vezes** quando a semana dela
  encerrar naturalmente.
- [ ] Task 05: `promotedTo` sai no DTO. Arquivos: `src/mural/dto/mural-question.dto.ts`, `winner.dto.ts`,
  `mural.service.ts`. Objetivo: `promotedTo` passa a sair na pergunta, `phase` ganha a frase de que ela é
  derivada **e pode ter sido adiantada pelo admin**, e `origem` é documentado como enumeração. **O front
  precisa dos dois campos e eles não se derivam um do outro:** `phase` diz onde a pergunta está, e
  `promotedTo` diz se ela chegou lá pelo relógio ou pela mão do admin — sem o segundo, a tela não tem como
  escrever "adiantada" nem como saber qual botão de promoção ainda faz sentido.

# Fase 04: A edição []
Branch: `feat/016-editar-pergunta`

- [ ] Task 01 (TDD + implementação): A trava da edição já obedece ao piso. Arquivo: `mural.service.spec.ts`.
  Objetivo: teste-trava de que `updateQuestion` responde **409** para uma pergunta da semana corrente que
  foi promovida a `votacao` — **sem nenhuma linha nova no service**, porque a trava lê `phaseOf` e a Fase 01
  já a ensinou. Se este teste exigir código novo, a Fase 01 foi feita errada.
- [ ] Task 02: A mensagem do 409. Arquivo: `src/mural/mural.service.ts`. Objetivo: a mensagem atual diz "a
  semana virou", e ela passa a mentir no caso da promoção. Trocar por uma que fale do estado e não da causa
  — a pergunta está em votação e o texto não muda mais. Comentário registrando que os dois caminhos levam ao
  mesmo lugar e que a pessoa não precisa saber qual foi.
- [ ] Task 03 (TDD + implementação): `myQuestion` no estado. Arquivos: `src/mural/dto/mural-state.dto.ts`,
  `mural.service.ts`, `mural.service.spec.ts`. Objetivo: devolver a pergunta inteira montada do `findMine`
  que **já é lido** para responder `myQuestionId`. Teste-trava: **nenhuma leitura a mais** — o teste conta as
  chamadas ao repositório e exige o mesmo número de antes. `myQuestionId` continua na resposta (decisão 9).
- [ ] Task 04: O segundo motivo do `badgeId`. Arquivo: `src/mural/dto/update-question.dto.ts`. Objetivo:
  acrescentar ao comentário que já existe o motivo da spec 012 — **a notificação de pergunta nova carrega o
  `badgeId`**, e trocar a insígnia depois deixaria um aviso publicado numa trilha apontando para uma
  pergunta de outra. É comentário e nada mais; o DTO não muda.

# Fase 05: Documentação e verificação []
Branch: `feat/016-docs-e-e2e`

- [ ] Task 01: `README.md`. Objetivo: a rota nova na tabela, o campo `promotedTo` em `mural_questions`, os
  campos novos de `GET /mural` e de `GET /mural/vencedoras`, e uma frase dizendo que **a fase de uma
  pergunta é o maior entre a conta do relógio e o piso da promoção**. Na seção de índices compostos, dizer
  explicitamente que **nenhuma linha muda** — a partição e a ordenação passaram para a memória, e as
  consultas por semana que pedem índice continuam iguais (decisão 6).
- [ ] Task 02: `CLAUDE.md`. Objetivo: duas linhas na lista de garantias que vivem em código — **a promoção é
  um piso e nunca um estado, então o relógio ganha sempre que estiver à frente e nenhuma pergunta pode ficar
  presa numa fase velha**; e **o corte de pergunta promovida é em memória porque `where('campo','==',null)`
  não enxerga documento que não tem o campo, e todo documento anterior à spec 016 não tem**.
- [ ] Task 03 (e2e): O adiantamento contra o emulador. Arquivo: `test/mural.e2e-spec.ts`. Objetivo: semear
  uma pergunta na semana corrente, provar que ela não aceita voto, promover pela rota de admin, e provar as
  três consequências de uma vez: **ela aceita voto, ela sai da aba de coleta, e o autor recebe 409 ao tentar
  editar**. É o único lugar onde a decisão 1 desta spec é verificável de ponta a ponta.
- [ ] Task 04 (e2e): A pauta e a vencedora. Arquivo: `test/mural.e2e-spec.ts`. Objetivo: semear duas
  perguntas numa semana encerrada, promover a mais votada a `encerrada`, e provar que **a segunda é a
  vencedora da semana** e que a promovida aparece na pauta com `origem: 'adiantada'` — uma vez só. É a prova
  das decisões 3, 4 e 5 juntas, e da invariante: **a semana que teve uma adiantada continua tendo
  vencedora**, e não vira uma semana em branco.
- [ ] Task 05 (e2e): O formulário de edição tem o que preencher. Arquivo: `test/mural.e2e-spec.ts`.
  Objetivo: criar uma pergunta e conferir que `GET /mural` devolve `myQuestion` com `title` e `body`
  íntegros. É o contrato de que o front depende para a tela de edição abrir preenchida, e é a metade desta
  spec que não tem nada a ver com adiantar.
