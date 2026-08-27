# Spec 016: Adiantar e Editar no Mural

## Objetivo
O Mural da spec 010 tem um relógio e nenhum acelerador. Uma pergunta nasce na semana em coleta, espera a
virada de domingo para receber voto, espera a virada seguinte para sair do mural, e só então vira pauta de
vídeo. **Do "essa é ótima" até o vídeo poder existir são até 14 dias, e nenhum deles é negociável.**

Duas coisas entram aqui, e as duas são sobre destravar o que o relógio prende:

1. **O admin adianta uma pergunta.** Do cartão dela, empurra para **Votação** — abre o voto agora, sem
   esperar domingo — ou para **Responder** — tira do mural e põe na pauta, para gravar o vídeo hoje.
2. **O membro edita a própria pergunta enquanto ela não estiver em votação.** A rota existe desde a 010 e
   o botão existe na tela, mas o formulário abre **em branco**: quem clica em "Editar minha pergunta"
   reescreve tudo do zero, com a insígnia obrigatória zerada. Editar, na prática, é reescrever.

As duas se cruzam num ponto só, e é ele que dá espinha a esta spec: **a pergunta adiantada para votação
deixa de ser editável no mesmo instante**, sem nenhuma regra nova, porque a trava da edição sempre foi a
fase — e a fase passa a saber da promoção.

O par desta spec no front é a **016**.

---

## Numeração
Os números são iguais nos dois repositórios. 013 é Meu Perfil, 014 é Disparo de E-mails, 015 é Encontrar um
Membro, 016 é esta.

**Esta spec depende da 010 estar de pé** — `weekIdOf`, `phaseOf`, `MuralRepository`, `MuralService`,
`VoteService` e o `AdminGuard` da 009. Nada aqui nasce do zero; tudo é emenda.

---

## O problema, com nome

A decisão 1 da spec 010 é a melhor decisão daquela spec e é também a que aperta aqui:

> A virada é uma conta, não um job agendado. [...] O que se perde é a capacidade de "pausar" uma semana ou
> estender um prazo. Isso não é requisito, e o dia que for, o caminho é gravar as datas do ciclo numa
> coleção de configuração — não ressuscitar o cron.

O que se pede agora **não é pausar nem estender**: é adiantar, e uma pergunta por vez, não a semana toda.
Adiantar uma semana inteira mudaria o ciclo para todo mundo — quem publicou sábado à noite perderia os dias
que a decisão 1 existe para garantir. Adiantar **uma** pergunta não mexe no ciclo de ninguém.

Então a saída não é a coleção de configuração que a 010 previu, e a razão é essa: o pedido tem outro
tamanho. A saída é um **piso** por pergunta, e o resto desta spec é sobre por que um piso não é um status.

---

## A invariante do adiantamento

> **O adiantamento é de uma pergunta só. A votação das demais continua exatamente como estava, e o ciclo da
> semana não se move.**

É a propriedade que decide a forma de tudo o que vem depois, e ela vale nos dois sentidos:

- **Para baixo:** promover uma pergunta não abre voto, não fecha voto e não muda a aba de nenhuma outra. As
  que ficaram em coleta continuam em coleta até domingo; as que estavam em votação continuam recebendo voto
  até a virada normal.
- **Para cima:** a semana **continua elegendo a vencedora dela**, entre as que sobraram (decisão 3). Uma
  semana em que o admin adiantou uma pergunta não é uma semana sem vencedora.

O motivo é o caso concreto que o mural vive hoje, e não uma abstração: **quando a semana tem poucas
perguntas, esperar o ciclo inteiro é fazer o aluno esperar 14 dias por uma resposta que já estava pronta no
segundo dia.** O adiantamento é a saída para isso — e só é uma saída se custar zero para quem não foi
adiantado. Um mecanismo que acelerasse a semana toda resolveria o mesmo problema criando outro: as
perguntas escritas sábado à noite perderiam a exposição de todo mundo.

**A consequência de custo fica declarada:** a semana em que houve adiantamento pode render **dois vídeos** —
o da adiantada e o da vencedora do voto. É trabalho a mais e é escolha do admin, não obrigação da
plataforma: a pauta da decisão 5 é uma lista do que pode virar vídeo, e nunca uma fila que precisa ser
zerada. O que a plataforma promete continua sendo um vídeo por semana para a mais votada; o adiantamento é o
que ela faz **além** disso.

---

## Decisões

### 1. A promoção é um piso, e nunca um estado gravado
`mural_questions` ganha `promotedTo: 'votacao' | 'encerrada' | null`, default `null`.

A fase continua **derivada na leitura**. O que muda é que ela passa a ser o **maior** entre a fase natural
da semana e o piso da promoção, na escala `coleta < votacao < encerrada`:

```
fase(pergunta, agora) = max( phaseOf(weekId, agora), promotedTo ?? 'coleta' )
```

A diferença entre isto e gravar `status` é a diferença que a decisão 1 da 010 defendeu, e ela sobrevive
inteira: **o relógio continua sendo a autoridade quando está à frente.** Uma pergunta promovida a `votacao`
em agosto não fica presa em votação para sempre — quando a semana dela virar, a conta devolve `encerrada`
sozinha, sem ninguém varrer nada. **Nenhum valor gravado pode ficar velho**, porque nenhum valor gravado
decide sozinho: ele só levanta o chão.

Um campo `status` gravado teria a falha que a 010 recusou, só que sem o cron: alguém promove, a semana
passa, o documento continua dizendo `votacao`, e o mural mostra em votação uma pergunta de três semanas
atrás. Sem erro, sem alarme, e a primeira pessoa a perceber é um aluno.

**`phaseOf` muda de assinatura e continua sendo a única função que responde "em que fase isto está".**
Assinatura nova: `phaseOf(question, now)`, recebendo a pergunta, e não mais só o `weekId`. É a mudança que
faz o compilador achar os quatro lugares que chamam — dois no `MuralService`, um no `VoteService` — em vez
de deixar um deles lendo a fase antiga por esquecimento. Trocar a assinatura é o objetivo, não o efeito
colateral.

### 2. A promoção é de mão única
`coleta → votacao → encerrada`, e nunca o contrário. Promover para uma fase igual ou anterior à atual
responde **409**.

Não é rigidez: é a única forma de a promoção não criar estado incoerente. Uma pergunta despromovida de
`votacao` para `coleta` voltaria a ser editável **com votos em cima dela** — e quem votou votou naquele
texto. A trava da decisão 7 existe exatamente por isso, e um botão de "desfazer" a atravessaria por baixo.

O caminho de arrependimento já existe e é o certo: `DELETE /admin/mural/perguntas/:id`, que apaga os votos
junto. Remover é honesto; despromover seria fingir que a semana não aconteceu.

### 3. Pergunta promovida nunca vence a semana
A vencedora de uma semana é derivada — maior `voteCount`, desempate pela mais antiga (decisão 9 da 010). A
partir daqui, **perguntas com `promotedTo` não nulo ficam fora dessa conta.**

O motivo é aritmético e é o mesmo da decisão 1 da 010. Uma pergunta promovida a `votacao` na semana N
recebe voto durante a semana N (pelo piso) e durante a semana N+1 (pela conta natural): até 14 dias de
exposição contra 7 de todas as outras. Deixá-la competir transformaria "a mais votada" em "a que o admin
adiantou", e a promessa do mural — a comunidade escolhe — viraria decoração.

Fora da competição, o problema some: ela não disputa com ninguém, e a semana continua elegendo entre
iguais. **Ficar de fora da conta é diferente de esvaziar a conta** — é a invariante lá de cima: tirar uma
pergunta da disputa não cancela a disputa, e a semana que teve uma adiantada continua tendo vencedora.

**Consequência aceita e declarada:** uma pergunta promovida a `votacao` que nunca for promovida a
`encerrada` fecha sem vencer e sem virar pauta. Não é buraco — é o admin dizendo "quero ver o interesse
nisto" sem dizer "vou responder isto". Se quiser responder, promove de novo, que é um clique e é válido
pela decisão 2.

### 4. O corte da vencedora é em memória, e essa escolha tem um motivo específico
A tentação é `where('promotedTo', '==', null)` na consulta da vencedora. **Ela quebraria em silêncio.**

No Firestore, `== null` casa com documentos em que o campo **existe e vale null** — e não com documentos em
que o campo não existe. Toda pergunta escrita antes desta spec não tem `promotedTo` no documento. A
consulta as ignoraria, e o histórico de vencedoras apareceria vazio para todas as semanas anteriores, sem
erro nenhum, com a resposta 200.

Então: `findWinner` passa a carregar a semana pelo `listByWeek` que já existe e escolher **em memória**.
Custo real zero — uma semana tem dezenas de perguntas, não milhares —, nenhum índice novo, nenhum backfill,
e o converter continua fazendo o trabalho de sempre com `promotedTo: data.promotedTo ?? null`. É o mesmo
tipo de leitura tolerante que `voteCount ?? 0` e `answerVideoId ?? null` já faziam, e pela mesma razão.

### 5. Pauta é o que espera vídeo, e ela tem duas origens
`GET /mural/vencedoras` passa a devolver, além da vencedora de cada semana encerrada, **as perguntas
promovidas a `encerrada`** — as adiantadas. Cada entrada ganha `origem: 'voto' | 'adiantada'`.

Duas listas separadas seriam duas telas, dois carregamentos e a mesma pergunta em dois lugares dependendo
de como ela chegou lá. O que o admin quer saber é uma coisa só: **o que está esperando vídeo.** E o que o
membro quer saber é a mesma coisa vista de fora: o que vai ser respondido.

**E a pauta não custa nenhuma consulta nova.** Pela decisão 4, cada semana já é carregada inteira para a
vencedora sair em memória; as adiantadas daquela semana saem do mesmo array, no mesmo passo. As adiantadas
das duas semanas vivas saem da leitura da decisão 6, que também já acontece. Uma consulta por
`where('promotedTo', '==', 'encerrada')` seria o caminho óbvio e pediria um índice composto novo — para ler
documentos que já estão na memória do processo.

**O nome da rota continua `vencedoras` e isso é uma imprecisão consciente.** Renomear para `/mural/pauta`
custaria uma rota nova, o front inteiro apontando para ela e um período com as duas de pé — para o leitor
ganhar zero, já que o `origem` diz a verdade em cada linha. A imprecisão fica registrada aqui em vez de
gerar churn.

**A pergunta adiantada não some da vida do autor.** Sem a decisão 5 ela sairia do mural e não apareceria em
lugar nenhum, o que é indistinguível de ter sido removida pela moderação. Com ela, o autor vê a própria
pergunta na pauta, que é a melhor notícia que o mural podia dar.

### 6. O mural lê as duas semanas vivas e separa em memória
Hoje `GET /mural/perguntas?fase=coleta|votacao` traduz a fase em um `weekId` e consulta aquela semana. Isso
para de funcionar no primeiro adiantamento: uma pergunta da semana em coleta, promovida a `votacao`,
pertence à aba de votação e continua tendo o `weekId` da coleta.

Então o serviço passa a carregar **as duas semanas vivas** — a atual e a anterior — e a particionar o
resultado pela fase derivada da decisão 1. A aba pedida sai da partição; as promovidas a `encerrada` caem
fora das duas, que é exatamente o que "sair do mural" quer dizer.

O preço é uma consulta a mais por carregamento de aba, e ele é pequeno perto da alternativa: manter a
consulta por semana e emendar cada aba com um `where` extra por `promotedTo` significaria dois índices
compostos novos e a armadilha do `== null` da decisão 4 de volta, em dois lugares.

**A ordenação passa a ser em memória junto com a partição** — votos decrescentes na votação, data crescente
na coleta, e a inversão do `ordem=recentes` da spec 012 continua igual. O comportamento visível não muda em
nada.

> **Os índices compostos de `mural_questions` continuam existindo e continuam necessários.** Eles servem ao
> `orderBy` das consultas por semana, que seguem de pé. O que esta spec faz é ordenar **depois**, sobre o
> resultado já carregado — nenhuma linha da tabela de índices do README muda, para cima ou para baixo. Vale
> dizer isso no commit, porque "spec nova, índice novo" é a suposição padrão e aqui ela é falsa.

### 7. Editar continua sendo a fase, e por isso a promoção já tranca
`PUT /mural/perguntas/:id` já recusa fora da coleta, com 409, desde a spec 010. A regra dela em uma frase:
depois da virada a pergunta está em votação, e mexer no texto invalidaria os votos — quem votou votou
naquilo.

Como a trava lê `phaseOf` e `phaseOf` passa a conhecer o piso (decisão 1), **adiantar para votação tranca a
edição no mesmo instante, sem uma linha de regra nova.** É o teste que prova que a decisão 1 é uma decisão
e não um `if` a mais: uma coisa mudou de lugar e três comportamentos obedeceram.

A mensagem do 409 precisa mudar, porque a atual mente no caso novo: ela diz "a semana virou". Passa a dizer
que a pergunta já está em votação — sem afirmar por quê, já que os dois caminhos levam ao mesmo lugar e a
pessoa não precisa saber qual foi.

### 8. `badgeId` continua fora da edição, e agora há um segundo motivo
O `UpdateQuestionDto` da spec 010 já registra o primeiro: trocar a insígnia de uma pergunta é fazer outra
pergunta, e o limite de uma por semana existe justamente para a pessoa escolher.

O segundo motivo nasceu na spec 012 e ainda não estava escrito: **a notificação de pergunta nova carrega o
`badgeId`** e é por ele que a Liga filtra. Trocar a insígnia depois deixaria um aviso publicado na trilha de
Angular apontando para uma pergunta que agora é de POO — e reemitir a notificação faria a mesma pergunta ser
anunciada duas vezes.

Editar é corrigir o texto. Trocar de assunto é outra pergunta, e ela tem semana própria.

### 9. O estado devolve a pergunta inteira, e isso não custa uma leitura
`GET /mural` já lê o documento da própria pergunta para responder `myQuestionId` — e joga fora todo o resto.
`MuralStateDto` ganha `myQuestion: MuralQuestionDto | null`, montado do que já está na mão.

É o que faz o formulário de edição abrir preenchido sem endpoint novo, sem `GET /mural/perguntas/:id` e sem
o front baixar a lista da semana inteira para achar uma linha. Zero leitura a mais no Firestore, porque a
leitura já acontecia.

`myQuestionId` **fica**, e não vai a Deprecated: é um campo, não uma estrutura, o front ainda o usa para
decidir qual botão mostrar, e tirá-lo agora é churn sem leitor.

### 10. Adiantar não abre vaga para uma pergunta nova
O ID do documento continua sendo `{weekId}__{uid}` e a promoção **não o toca**. Quem teve a pergunta
adiantada continua com a vaga da semana ocupada: `canAsk` segue falso.

Isto merece decisão própria porque o atalho contrário é sedutor e destrutivo. Mover a pergunta promovida
para outro `weekId` "resolveria" a fase sem campo novo — e exigiria recriar o documento e **migrar a
subcoleção de votos inteira**, liberaria o caminho `{semanaAtual}__{uid}` para uma segunda pergunta na mesma
semana, e colidiria quando a pessoa já tivesse pergunta na semana de destino. Três problemas para não criar
um campo.

### 11. Só o admin promove, e a rota diz isso no caminho
`PATCH /admin/mural/perguntas/:id/fase`, sob `FirebaseAuthGuard` + `AdminGuard`, corpo `{ fase }` com
`@IsIn(['votacao', 'encerrada'])`.

Fica em `AdminMuralController`, junto do `DELETE` que já modera, e não no controller do mural. A separação é
a mesma da spec 010 e vale por si: uma rota de admin no controller aberto é uma rota que alguém protege com
um `if` dentro do service um dia.

**`'coleta'` não é valor aceito no corpo**, e a validação recusa antes do service. É a decisão 2 dita no
lugar mais barato: o que não se pode pedir não precisa de 409.

### 12. As security rules continuam negando tudo
`promotedTo` é campo de documento numa coleção que o cliente não lê nem escreve. O alerta da decisão 11 da
010 vale igual, e ganha um agravante: um campo que muda a fase de uma pergunta, escrito direto do
navegador, é o poder de tirar a pergunta dos outros do mural.

### 13. Nada de notificação nesta spec
Adiantar uma pergunta para "responder" é, do ponto de vista do autor, a melhor notícia possível — e, ao
contrário de "sua pergunta venceu", **tem instante de disparo**, então caberia no canal da spec 012.

Fica fora mesmo assim, e é escolha de escopo, não de arquitetura: o pedido tem duas partes e as duas são
sobre destravar o relógio. Está no ponto em aberto 1, com o desenho pronto para quem pegar.

---

## Endpoints

| Método | Rota | Guards | O que muda |
|---|---|---|---|
| `PATCH` | `/admin/mural/perguntas/:id/fase` | auth + admin | **Nova.** `{ fase: 'votacao' \| 'encerrada' }`. 409 se não avançar |
| `GET` | `/mural` | auth | Passa a devolver `myQuestion` inteira, além de `myQuestionId` |
| `GET` | `/mural/perguntas` | auth | A aba passa a sair da fase derivada, e não do `weekId` |
| `GET` | `/mural/vencedoras` | auth | Entradas ganham `origem`, e as adiantadas entram na lista |
| `PUT` | `/mural/perguntas/:id` | auth + dono | Mesma regra, mensagem nova de 409 |

`MuralQuestionDto` passa a devolver **`promotedTo` além de `phase`**, e os dois não são redundantes:
`phase` diz onde a pergunta está, `promotedTo` diz se ela chegou lá pelo relógio ou pela mão do admin. Sem o
segundo, a tela não tem como escrever "adiantada" nem como saber qual botão de promoção ainda faz sentido —
e derivar isso no front seria reimplementar a decisão 1 do lado errado.

Nenhuma rota é removida e nenhum campo existente muda de tipo ou de significado.

---

## Fora de escopo

- **Despromover.** Decisão 2. O caminho de arrependimento é o `DELETE` que já existe.
- **Adiantar a semana inteira.** É a coleção de configuração que a decisão 1 da 010 previu, e é outro
  pedido: mexeria no ciclo de todo mundo.
- **Trocar a insígnia na edição.** Decisão 8.
- **Editar durante a votação**, nem pelo admin. O texto que recebeu voto não muda.
- **Notificar o autor da promoção.** Ponto em aberto 1.
- **Histórico de quem promoveu e quando.** `promotedTo` guarda o quê, não o quem. Só existe um admin.

---

## Specs afetadas

### Spec 010 (Mural de Perguntas) — vigente, com quatro emendas
- **Decisão 1** (fase derivada) — **estendida, não revogada**: a fase passa a ser o maior entre a conta do
  relógio e o piso da promoção. O relógio continua autoridade quando está à frente, que era a propriedade
  que ela protegia.
- **Decisão 9** (vencedora derivada) — emendada: perguntas promovidas ficam fora da conta (decisão 3), e o
  corte é em memória (decisão 4).
- **Decisão 2** ("limpas quer dizer fora do mural") — inteira: a promovida a `encerrada` sai do mural e
  continua no banco, aparecendo na pauta.
- **`UpdateQuestionDto`** ganha um segundo motivo documentado para `badgeId` continuar fora.

`mural_questions` ganha um campo com default e leitura tolerante — **documento antigo sem `promotedTo` lê
como `null`**. Nenhum campo existente muda de forma, então nenhuma leitura quebra, e pela regra 6 do
`clauderc.md` a 010 **não vai a Deprecated**. É o mesmo critério que a 010 aplicou às specs 005 e 007
quando `profiles` ganhou `tier`.

### Spec 012 (Notificações Internas) — vigente
O `badgeId` da notificação é o segundo motivo da decisão 8. Nenhuma notificação nova.

### Spec 009 (Financeiro, Administração e Trilha) — vigente
`AdminGuard` e o cadastro de vídeo com `questionId` seguem iguais. A pauta apenas passa a ter mais linhas.

---

## Pontos em aberto

1. **Notificar o autor de que a pergunta foi adiantada?** Fora do escopo por disciplina, não por dúvida de
   desenho: seria um `kind` novo no canal da 012, disparado no `PATCH`, com `actorUid` do admin e
   `targetId` da pergunta — e, ao contrário de "sua pergunta venceu", tem instante de disparo.
2. **A pauta deve mostrar quantos votos a adiantada tinha na hora?** Escrito como não: `voteCount` já sai
   no DTO e ele continua vivo enquanto a pergunta estiver em votação. Congelar o número exigiria um campo a
   mais para uma informação que ninguém pediu.
3. **Adiantar para `encerrada` uma pergunta que está em coleta é pular o voto por completo.** Assumido que
   sim, e que é o ponto: "Responder logo" é responder logo. Se um dia isso incomodar, a trava é recusar o
   salto de duas fases — um `if` no service, e a decisão 2 continua inteira.
4. **Quantas semanas de pauta a lista devolve?** Mantido o parâmetro de 8 semanas encerradas que a 010 já
   usa, mais as adiantadas mais recentes. Se a pauta encher, o corte certo é por "sem vídeo ainda", não por
   data.
