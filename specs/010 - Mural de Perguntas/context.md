# Spec 010: Mural de Perguntas

## Objetivo
Um mural semanal onde o membro escolhe uma insígnia e pergunta sobre um tema dela. Os outros votam. **A
pergunta mais votada da semana ganha um vídeo curto de resposta**, e esse vídeo vai morar na trilha
daquela insígnia, numa aba de **Perguntas Frequentes**.

O ciclo é semanal e tem duas semanas vivas ao mesmo tempo: enquanto uma recebe perguntas, a anterior
recebe votos. Na virada, quem estava em votação sai do mural e a vencedora vira pauta.

Três coisas entram junto, porque o Mural obriga:

1. **O primeiro portão de tier do produto.** Dev Tier lê o mural e **vota**, mas não escreve pergunta. Um
   portão real precisa saber quem é pagante, e hoje ninguém sabe — daí nasce o campo `tier` no perfil,
   editável pelo admin, que é como a cobrança funciona hoje (manual, pelo WhatsApp).
2. **O contrapeso: vídeo liberado para todos.** O admin marca um vídeo como **Dev Tier** e ele fica livre,
   mesmo sendo de uma insígnia adiante. É o que impede o portão de fechar a porta da frente.
3. **Vídeo tem natureza.** `aula` ou `resposta`, e a insígnia passa a ter duas abas na trilha.

O par desta spec no front é a **010**.

---

## Numeração

Os números são iguais nos dois repositórios. Esta é a 010 aqui e a 010 lá. A 008 é Liga Dev (só no
front), a 009 é Financeiro, Administração e Trilha (nos dois).

**Esta spec depende da 009 estar de pé** — ela usa a claim de admin, o `AdminGuard`, a coleção
`badge_videos`, o `BADGE_IDS` e a função `resolveCurrentTier`. Executar a 010 antes da 009 não é uma
ordem alternativa; é retrabalho.

---

## O ciclo semanal, por inteiro

A instrução original tinha dois calendários que não fecham: perguntas de domingo a sábado (7 dias) e
votação de segunda a sábado (6 dias), com a votação começando **ao mesmo tempo** que o mural abre para
perguntas novas. Se o mural abre no domingo e a votação começa na segunda, não é ao mesmo tempo.

**O "ao mesmo tempo" venceu**, porque é o que faz o ciclo ser um ciclo. Existe **um instante de virada,
domingo 00:00 no fuso de São Paulo**, e nele três coisas acontecem juntas:

| No instante da virada | O que acontece |
|---|---|
| A semana que estava coletando | congela e **entra em votação** |
| A semana nova | **abre para perguntas** |
| A semana que estava em votação | **encerra**, sai do mural, e a mais votada vira pauta |

Uma pergunta vive no mural por até 14 dias: 7 recebendo companhia, 7 recebendo voto.

```
        semana N            semana N+1          semana N+2
   |------------------|------------------|------------------|
    perguntas N         votação N          encerrada N
                        perguntas N+1       votação N+1
                                            perguntas N+2
```

**Não se vota na semana em coleta**, e isso é decisão, não limitação. Se o voto abrisse junto com a
pergunta, quem publicasse domingo de manhã acumularia sete dias de vantagem sobre quem publicasse
sábado à noite, e o mural viraria uma corrida de quem acorda cedo. Com a votação atrasada em uma semana,
**todas as perguntas ficam expostas exatamente o mesmo tempo.**

> Se a preferência for mesmo por votação de segunda a sábado, a mudança é de uma constante — o offset da
> virada — e a decisão 1 continua inteira. Está no ponto em aberto 1.

---

## Decisões

### 1. A virada é uma conta, não um job agendado
Cada pergunta guarda o `weekId` da semana em que nasceu (`2026-W34`), calculado **no servidor** a partir
de `createdAt` no fuso `America/Sao_Paulo`. O estado dela nunca é gravado: é derivado na leitura,
comparando o `weekId` dela com o `weekId` de agora.

```
semanaAtual   = weekIdOf(now)          -> aceita pergunta
semanaVotacao = weekIdOf(now) - 1      -> aceita voto
qualquer outra                          -> encerrada, fora do mural
```

A alternativa era um cron que, toda madrugada de domingo, varresse as perguntas e mudasse `status`.
Ela custa: um agendador para configurar, um deploy para não esquecer, e — a parte cara — **um estado que
pode ficar errado**. Cron que não roda deixa o mural congelado no domingo passado, sem erro, sem alarme,
e a primeira pessoa a perceber é um aluno. Uma conta não tem como não rodar.

O que se perde é a capacidade de "pausar" uma semana ou estender um prazo. Isso não é requisito, e o dia
que for, o caminho é gravar as datas do ciclo numa coleção de configuração — não ressuscitar o cron.

**O fuso é constante e é do servidor.** `America/Sao_Paulo`, fixo em `mural.constants.ts`. "Domingo" para
este público é domingo brasileiro, e o relógio do cliente nunca decide nada — quem manda o `weekId` de
uma pergunta é a API, no momento da escrita. O Brasil não tem horário de verão desde 2019, então o
cálculo é estável; o teste cobre a virada de ano, que é onde a numeração de semana costuma quebrar.

### 2. "Limpas" quer dizer fora do mural. Nada é apagado.
A instrução diz que as antigas são limpas. **Limpas da tela, não do banco.**

Apagar destruiria três coisas de uma vez: o registro de qual pergunta venceu, o vínculo entre o vídeo de
resposta e a pergunta que o originou, e o histórico que responde "isso já foi perguntado?". O vídeo de
resposta existe **por causa** daquela pergunta, e um vídeo cuja pergunta sumiu perde metade do sentido.

Então: pergunta encerrada continua no Firestore, some do mural por derivação (decisão 1), e aparece num
histórico — `GET /mural/vencedoras` — que também alimenta a aba de Perguntas Frequentes.

### 3. O voto é um documento com o UID no caminho
Subcoleção `mural_questions/{questionId}/votes/{uid}`.

O caminho é a garantia, como em `waitlist_entries/{email}` e `profiles/{uid}`: **um voto por pessoa por
pergunta, sem consulta e sem índice**. Votar duas vezes falha no `create()` com `ALREADY_EXISTS`, do
mesmo jeito que o e-mail repetido da waitlist.

O contador fica denormalizado em `voteCount`, na própria pergunta, e a escrita é **um `WriteBatch`** com
as duas operações: cria o voto e incrementa o contador com `FieldValue.increment(1)`. Se o voto já
existe, o batch inteiro falha e o contador não se mexe — que é exatamente a proteção contra contar duas
vezes.

Sem o contador denormalizado, ordenar o mural por votos exigiria contar a subcoleção de cada pergunta a
cada leitura. Com ele, é um `orderBy('voteCount', 'desc')`.

**O voto pode ser desfeito** enquanto a semana estiver em votação: apaga o documento e decrementa, no
mesmo batch. Voto irreversível transforma um clique errado em um problema de suporte.

**Quem já votou é dado da tela**, e vem junto: a listagem faz um `getAll` dos caminhos de voto do próprio
usuário para as perguntas daquela página — leitura por caminho, sem consulta. Sem isso, o front não sabe
qual coração pintar e a tela pisca a cada recarga.

### 4. Uma pergunta por membro por semana, garantida pelo caminho
ID do documento: `{weekId}__{uid}`.

**A tabela existe e não custa nada**, porque a garantia já é o caminho: ninguém escreve duas na mesma
semana, e o `create()` recusa a segunda com `ALREADY_EXISTS` — que o service traduz num 409 com mensagem
própria ("você já perguntou esta semana").

O limite é de produto, não técnico. Um mural com trinta perguntas de cinco pessoas é ilegível e a
votação se dilui; com uma pergunta por pessoa, **quem tem duas dúvidas escolhe a melhor**, que é
exatamente o comportamento desejado. E a pessoa pode trocar a própria pergunta enquanto a semana estiver
aberta — `PUT` no mesmo caminho —, o que remove o medo de "gastar" a vez cedo demais.

Como o `uid` está no ID do documento, "qual é a minha pergunta desta semana" também é leitura por
caminho. Nenhuma consulta em lugar nenhum deste fluxo.

### 5. O primeiro portão de tier, e ele é sobre acesso, nunca sobre progresso
Este é o ponto onde a decisão 9 da spec 009 é emendada, e vale ser explícito sobre o que muda e o que
não muda.

| Ação | Dev Tier (grátis) | Great, Ultra e Master |
|---|---|---|
| Ler o mural | sim | sim |
| **Votar** | **sim** | sim |
| Escrever pergunta | **não** | sim |
| Ver vídeo de resposta | conforme a insígnia, ou livre se marcado Dev Tier | sim |
| Jogos e desafios | não *(specs futuras)* | sim |

**Votar é de todo mundo de propósito.** É o ato que dá valor ao mural — sem volume de voto, "a mais
votada" não significa nada — e é o mais barato de conceder. Quem vota lê as perguntas dos outros, vê o
que a plataforma discute, e chega à decisão de assinar tendo visto o produto funcionar.

**Escrever é o que se compra.** Perguntar é pedir tempo do Leno: a pergunta vencedora vira um vídeo
gravado. Faz sentido que a fila de quem pede seja a de quem paga.

Para o portão existir, a API precisa saber o tier de alguém. Hoje não sabe — e é aqui que entra a
decisão 6.

> **O que continua proibido:** gatear conteúdo por `grade`. O portão desta spec é o **tier**, que é
> acesso; `grade` é conquista, e as decisões 5c e 5d da spec 008 continuam inteiras.
> `GET /badges/:badgeId/videos` segue sem guard de assinatura.

### 6. `tier` é campo do perfil, editável pelo admin, porque a cobrança é manual
`profiles` ganha `tier: 'dev-tier' | 'great-dev-tier' | 'ultra-dev-tier' | 'master-dev-tier'`, default
`'dev-tier'`. O admin edita, na mesma tela em que já edita `grade` (spec 009).

Isso parece um atalho e não é: **é o desenho fiel do produto de hoje.** Não existe checkout — o upgrade
acontece por WhatsApp e o pagamento por fora (decisão 4 da spec 009). Se o pagamento é manual, o
direito de acesso também é, e fingir o contrário exigiria inventar um estado de assinatura que ninguém
alimenta.

`resolveCurrentTier(profile)`, que a spec 009 criou com corpo vazio e um `TODO`, **finalmente tem
corpo**: devolve `profile.tier`. Continua sendo a única função que responde essa pergunta, e é ela que
um gateway de pagamento vai substituir por dentro no dia que existir.

Três guardrails, e os três são fáceis de violar:

- **`tier` e `grade` não se falam.** Nenhum código pode derivar um do outro, em nenhuma direção.
- **`tier` não é claim.** Ao contrário de `role`, ele muda com frequência e precisa valer na hora — uma
  claim levaria até uma hora para entrar em vigor (decisão 5 da spec 009), e o membro que acabou de
  pagar ficaria de fora vendo o relógio.
- **Preço continua fora do perfil.** Guarda-se qual tier, nunca quanto custou. O guardrail da decisão 3
  da 009 vale igual.

**Isto muda a estrutura de `profiles`**, que as specs 005 e 007 montaram. As duas continuam **vigentes**,
não Deprecated: nenhum campo existente muda de tipo, de nome ou de significado, e todo código que lia o
documento antigo continua lendo igual. O que a regra 6 do `clauderc.md` protege é a leitura que quebra
em silêncio, e um campo novo com default não produz nenhuma. **Documento antigo sem `tier` lê como
`dev-tier`** pelo `?? 'dev-tier'` do converter — é o mesmo cuidado que o `completedAt ?? null` já
tomava, e pela mesma razão.

### 7. Vídeo tem natureza, e a insígnia ganha duas abas
`badge_videos` ganha `kind: 'aula' | 'resposta'` e `questionId: string | null`.

A trilha da insígnia passa a ter **Aulas** e **Perguntas Frequentes**. São duas listas com propósitos
diferentes: a primeira se assiste em ordem, a segunda se consulta por assunto. Misturadas, a trilha
fica com respostas avulsas no meio da sequência e a sequência deixa de ser sequência.

**A ordem passa a ser por `(badgeId, kind)`**, e isso emenda a decisão 7 da spec 009: a renormalização
para 0..n-1 acontece dentro da aba, não dentro da insígnia. Uma insígnia com três aulas e duas respostas
tem duas sequências independentes — `0,1,2` e `0,1`. Renormalizar sem separar por `kind` embaralharia as
duas abas de uma vez, e é o bug mais provável de quem implementar isso sem ler este parágrafo.

`questionId` é o vínculo com a pergunta que originou a resposta. É o que permite mostrar, sob o vídeo, a
pergunta original e quem perguntou — que é metade do valor da aba.

### 8. Um vídeo pode ser marcado Dev Tier, e isso vale mais que qualquer regra de insígnia
`badge_videos` ganha `devTierFree: boolean`, default `false`. Marcado, o vídeo fica livre para todo
mundo, **mesmo estando numa insígnia que o Dev Tier ainda não alcançaria.**

O motivo é que o Mural cria uma armadilha: a melhor pergunta da semana pode ser sobre Angular, a resposta
vira um vídeo excelente, e ele nasce trancado para 90% de quem votou nela. **A marcação é a válvula** —
o admin libera a resposta que vale como vitrine, e a plataforma ganha uma porta de entrada nova toda
semana.

**A precedência é total, e a ordem importa:** `devTierFree` vence qualquer verificação de tier ou de
insígnia. Quando o gate de conteúdo existir, ele começa por essa flag e sai; ela não é um empate a ser
resolvido depois.

Hoje isso não muda nenhum comportamento de leitura — não existe gate de conteúdo (decisão 9 da 009). O
campo nasce **agora** porque quem grava os vídeos é o admin, e marcar durante o cadastro é grátis;
voltar depois em cem vídeos para decidir um por um, não é.

### 9. A vencedora sai de uma conta determinística, e o vídeo é decisão humana
Vencedora da semana encerrada = **maior `voteCount`**; empate resolve pela **mais antiga** (`createdAt`
crescente). O desempate precisa ser determinístico, ou duas telas mostram vencedoras diferentes para o
mesmo estado; e "quem perguntou primeiro" é o critério que não premia nada além de ter chegado antes.

**A API calcula a vencedora. Ninguém a promove.** É uma consulta ordenada com `limit(1)`, derivada, e
por isso não pode ficar errada — nada é gravado, nada precisa ser mantido em dia.

O que é humano é o resto: gravar o vídeo, cadastrar como `kind: 'resposta'` com o `questionId`, e decidir
se marca `devTierFree`. **A API nunca cria vídeo sozinha**, e não existe estado de "pendente de
resposta" — se a semana não rendeu vídeo, o histórico mostra a vencedora sem resposta vinculada, o que é
uma informação honesta e não um erro a esconder.

**Uma vencedora por semana, global**, e não uma por insígnia. É a leitura literal de "a mais votada" e é
o que sustenta a promessa: um vídeo por semana é um compromisso que dá para cumprir; treze são treze
promessas quebradas. Ver o ponto em aberto 2.

### 10. Pergunta é texto puro, com teto, e o admin pode remover
- `title`: obrigatório, 10 a 140 caracteres. `body`: opcional, até 1000.
- **Texto puro**, sem markdown e sem HTML. Não porque escapar seja difícil — o Angular escapa sozinho —,
  mas porque um campo que aceita formatação convida `innerHTML` no primeiro pedido de "deixa o código
  em `<pre>`", e aí a superfície de XSS aparece num commit que ninguém revisou como se fosse de
  segurança.
- `badgeId` validado contra o `BADGE_IDS` da spec 009. Pergunta sobre insígnia que não existe é
  pergunta invisível.
- `authorName` é **denormalizado** na criação, a partir do perfil. Listar trinta perguntas não pode
  custar trinta leituras de perfil. O preço é o nome ficar velho se a pessoa mudar depois — aceito, e
  registrado: o nome exibido é o de quando perguntou.
- **`DELETE /admin/mural/perguntas/:id`** existe para o que todo mural público precisa: pergunta
  ofensiva, duplicada ou fora de tema. É a única remoção real desta spec, e ela apaga a subcoleção de
  votos junto — subcoleção órfã no Firestore não desaparece com o pai, e é a pegadinha clássica.

### 11. As security rules continuam negando tudo
`mural_questions` e a subcoleção de votos nascem dentro do mesmo `match /{document=**}` que já nega
tudo. Vale repetir o alerta da decisão 11 da 009, porque aqui a tentação é maior: mural com voto em
tempo real é o caso de uso que mais pede um `onSnapshot` direto do cliente. Ceder abre a coleção inteira
para qualquer navegador com a Web API Key — e entrega o poder de votar mil vezes.

---

## Endpoints

| Método | Rota | Guards | O que faz |
|---|---|---|---|
| `GET` | `/mural` | auth | Estado do ciclo: `currentWeekId`, `votingWeekId`, `canAsk`, `myQuestionId` |
| `GET` | `/mural/perguntas` | auth | `?fase=coleta\|votacao`. Ordena por votos na votação, por data na coleta |
| `POST` | `/mural/perguntas` | auth + **tier pago** | Cria. 403 para Dev Tier, 409 se já perguntou nesta semana |
| `PUT` | `/mural/perguntas/:id` | auth + dono | Reescreve a própria pergunta, só na semana em coleta |
| `POST` | `/mural/perguntas/:id/voto` | auth | Vota. Só na semana em votação |
| `DELETE` | `/mural/perguntas/:id/voto` | auth | Desfaz o voto |
| `GET` | `/mural/vencedoras` | auth | Histórico: vencedora de cada semana encerrada e o vídeo, se houver |
| `DELETE` | `/admin/mural/perguntas/:id` | auth + admin | Modera. Apaga os votos junto |
| `PATCH` | `/admin/users/:id` | auth + admin | Passa a aceitar `tier`, além de `grade` |

E, na 009, `POST`/`PATCH` de `/admin/badges/:badgeId/videos` ganham `kind`, `questionId` e `devTierFree`.

---

## Fora de escopo

- **Jogos e desafios.** Citados na tabela de tier porque a regra já está decidida — Dev Tier não
  participa —, mas nada disso existe ainda.
- **Comentar ou responder pergunta por texto.** O mural é perguntar e votar. Discussão é o WhatsApp.
- **Notificação** de "sua pergunta venceu" ou "o vídeo saiu". Não há canal de notificação no produto.
- **Cobrança automática.** `tier` é editado à mão pelo admin, e continua assim até existir gateway.
- **Gate de leitura de conteúdo por tier.** O `devTierFree` nasce, mas ninguém ainda o consulta para
  decidir acesso, porque não há acesso a decidir.
- **Busca ou filtro no histórico de vencedoras.**

---

## Specs afetadas

### Spec 009 (Financeiro, Administração e Trilha) — vigente, com três emendas
- **Decisão 9** (nenhum guard de assinatura) — emendada: nasce o portão de tier para *escrever no
  mural*. O que ela proibia e continua proibido é gatear por `grade`.
- **Decisão 4** (`resolveCurrentTier` sem corpo) — cumprida: passa a ler `profile.tier`.
- **Decisão 7** (ordem 0..n-1 por insígnia) — emendada: a ordem é por `(badgeId, kind)`.

### Specs 005 e 007 (`profiles`) — vigentes, estendidas
`profiles` ganha `tier`, com default e leitura tolerante a documento antigo. Não vão a Deprecated, e a
decisão 6 explica por quê: nenhum campo existente muda de forma, então nenhuma leitura quebra.

### Spec 008 (Liga Dev) — vigente
As decisões 5c e 5d são a restrição que a decisão 5 desta spec obedece: **`grade` é conquista, não
aluguel.**

---

## Pontos em aberto

1. **A votação é domingo a sábado ou segunda a sábado?** Escrito aqui como um instante único de virada,
   domingo 00:00, porque "ao mesmo tempo" era a parte insubstituível da instrução. Se a preferência for
   segunda, muda uma constante — e a votação passa a ter 6 dias contra 7 de coleta, com o domingo sendo
   um dia em que as perguntas novas já entram e ninguém vota ainda.
2. **Uma vencedora por semana ou uma por insígnia?** Escrito como uma, global. Uma por insígnia
   distribuiria melhor entre os assuntos, ao custo de treze vídeos por semana — inviável — ou de um
   rodízio, que é mais mecanismo do que o problema merece hoje.
3. **A pergunta aparece com o nome de quem perguntou?** Assumido que sim, com o primeiro nome. Anônimo
   traria mais pergunta e pergunta pior.
4. **O que acontece se a semana em votação não teve nenhuma pergunta?** Assumido: o mural mostra que a
   semana passou em branco, e nenhum vídeo é devido. Não há penalidade nem acúmulo para a semana
   seguinte.
