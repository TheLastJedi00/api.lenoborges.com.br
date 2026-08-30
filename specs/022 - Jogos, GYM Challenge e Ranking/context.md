# Spec 022: Jogos, GYM Challenge e Ranking

## Objetivo
Jogos, ranking e insígnias conquistadas por mérito existem no vocabulário do produto desde a spec 008 —
na tabela de tiers, nos `perks`, na metáfora inteira de Liga — e nunca foram mais que promessa. `grade`
sobe à mão. XP conta vídeos assistidos. Não existe desafio, não existe placar, e a insígnia não tem
como ser conquistada pelo membro.

Esta spec constrói as três peças que faltam:

| Peça | O que é |
|---|---|
| **GYM Challenge** | Um questionário de 10 perguntas por rodada, em três rodadas (fácil → média → difícil), vinculado a uma insígnia. Acertar 7/10 nas três rodadas desbloqueia a insígnia |
| **Ranking da Liga** | Uma lista pública ordenada por XP, com nome, pontuação e contagem de insígnias de cada membro, pódio com destaque visual |
| **Banco de Questões** | Uma coleção de questões por insígnia, alimentada pelo admin — manualmente ou via IA generativa (Gemini) — com validação de mínimo por dificuldade |

O par desta spec no front é a **022**, e as duas entram juntas.

---

## Numeração
Os números são iguais nos dois repositórios, com a exceção conhecida da 008 (Liga Dev, só no front). 021
é Respostas na Trilha, 022 é esta.

Esta spec depende da **009** (trilha, `badge_videos`, `BADGE_IDS`), da **019** (XP, `watched_videos`) e
da **008** (vocabulário de insígnias, `grade`). Nenhuma fase depende de spec posterior.

---

## Decisões

### 1. O GYM Challenge é um questionário, não um jogo em tempo real
Cada rodada apresenta **10 perguntas de múltipla escolha**, uma por vez, com quatro alternativas. O membro
responde, passa para a próxima, e no fim vê o resultado da rodada.

A tentação é algo mais elaborado — timer visual, vidas, animação de batalha. **A primeira versão não pode
custar a segunda.** Um questionário sólido, com regra de XP clara e progressão por dificuldade, entrega a
mecânica inteira do GYM Challenge sem criar uma dívida de UX que engessa tudo o que vier depois.

### 2. Três rodadas, progressão de dificuldade, e a insígnia exige as três
| Rodada | Dificuldade | Questões | Mínimo para aprovar |
|---|---|---|---|
| 1ª | Fácil | 10 | 7 acertos |
| 2ª | Média | 10 | 7 acertos |
| 3ª | Difícil | 10 | 7 acertos |

A progressão é linear: a rodada 2 só abre depois de aprovar na 1, e a 3 depois da 2. **Reprovar numa
rodada não reseta as anteriores** — quem passou na fácil e reprovou na média volta direto para a média,
sem refazer a fácil.

A insígnia é desbloqueada quando as três rodadas estão aprovadas. Nesse momento `grade` sobe
automaticamente — **e é a primeira vez que `grade` sobe sem a mão do admin**. A decisão 12 da spec 019
dizia que XP não destrava nada; esta spec muda o jogo: **a insígnia é conquistada por mérito, não por
decreto**. A mudança é explícita, deliberada, e não retroativa: insígnias já conquistadas à mão
continuam como estão.

### 3. XP por questão acertada: 50 XP base com penalidade de tempo
Cada pergunta acertada vale **50 XP**. A penalidade de tempo funciona assim:

- Os **primeiros 5 segundos** são livres — sem perda de XP.
- A partir do 6º segundo, **cada segundo completo que o membro leva perde 1 XP** da recompensa daquela
  pergunta.
- O **piso é 1 XP** — nunca zero, nunca negativo. Quem acerta, recebe.
- **Pergunta errada não perde XP nenhum.** Nem da pergunta, nem do acumulado.

A fórmula:

```
tempoResposta = segundos desde que a pergunta apareceu
penalidade    = max(0, tempoResposta - 5)
xpGanho       = max(1, 50 - penalidade)
```

#### Validação de tempo dupla

O tempo de resposta é medido em **dois lugares**, e a discrepância entre eles é resolvida a favor do
membro:

| Fonte | O que mede | Onde vive |
|---|---|---|
| **Servidor** | `submittedAt - servedAt` — timestamps de quando a pergunta foi servida e quando a resposta chegou | `active_round/{idx}`, gravado pelo backend |
| **Cliente** | `clientElapsedMs` — milissegundos que o front mediu entre a exibição da pergunta e o clique | corpo do `POST .../answer` |

O servidor calcula `tempoServidor = submittedAt - servedAt` e `tempoCliente = clientElapsedMs / 1000`.
**Se houver discrepância, o `clientElapsedMs` é quem diz a verdade.**

A razão é que o servidor é penalizado pela rede, e o membro não. A latência entre o clique e o
`submittedAt` no servidor é tempo que o membro não gastou pensando — é tempo de rede. O relógio do
front começa quando a pergunta aparece na tela e para quando o dedo toca a alternativa, e esse é o
intervalo real de decisão.

```
tempoReal     = min(tempoServidor, tempoCliente)
penalidade    = max(0, tempoReal - 5)
xpGanho       = max(1, 50 - penalidade)
```

O `min` garante que o membro nunca é prejudicado pela latência. **O `clientElapsedMs` é validado com
um piso de 0 e um teto de `tempoServidor + 2`** — o cliente não pode alegar ter respondido em menos
de 0 segundos, e não pode alegar um tempo maior que o servidor mais uma margem de 2 segundos (que
cobriria qualquer dessincronização de relógio razoável). Fora desse range, o tempo do servidor
prevalece.

> **O front não calcula XP, não conhece a fórmula e não exibe o número 50.** É a mesma regra do
> `XP_PER_VIDEO` (spec 019, decisão 7): o servidor afirma, a tela obedece. O `clientElapsedMs` é a
> única coisa que o front envia — ele mede o tempo e o servidor decide o que fazer com ele.

### 4. As questões são selecionadas aleatoriamente dentro da dificuldade
O banco tem até 33 questões por nível de dificuldade (fácil, médio, difícil). A cada rodada, **10 são
sorteadas aleatoriamente** dentre as disponíveis daquela dificuldade. Duas consequências:

- **Duas tentativas nunca são iguais.** Com 30+ questões por nível e 10 por rodada, a probabilidade de
  repetição completa é desprezível.
- **O sorteio é do servidor.** O front não conhece o banco — ele pede "comece a rodada N" e recebe as
  questões uma a uma (ou em lote, ver decisão 10). Conhecer o banco inteiro no front é dar a cola de
  graça.

### 5. Mínimo de 90 questões para ativar o desafio, e os três estados do card
O admin precisa cadastrar **no mínimo 30 questões por nível** (30 fáceis + 30 médias + 30 difíceis =
90 total). Até 33 por nível (99 no total) é o teto. Abaixo de 90, o desafio daquela insígnia **não
fica disponível**.

O card do GYM Challenge na trilha tem três estados:

| Estado | Condição | O que o membro vê |
|---|---|---|
| **Em breve** | Admin não criou questões suficientes (< 90) | "GYM Battle dessa Insígnia em breve" |
| **XP insuficiente** | Desafio existe, mas o membro não tem XP mínimo | Card com barra de progresso (XP atual / XP necessário), aviso para treinar mais |
| **Disponível** | Desafio existe e membro tem XP suficiente | Card brilhante com botão "Iniciar GYM Challenge" |

O **XP mínimo** é um campo configurável pelo admin ao criar o desafio de cada insígnia. Cada insígnia
pode exigir um valor diferente — a primeira insígnia pode exigir 0 (qualquer um tenta), e a última pode
exigir 500. O default é `0` (sem exigência).

### 6. O banco de questões é uma coleção nova, separada
`gym_questions/{questionId}`

```
badgeId:      string              ← a insígnia
difficulty:   'easy' | 'medium' | 'hard'
question:     string              ← o enunciado
alternatives: string[]            ← exatamente 4 alternativas
correctIndex: number              ← 0, 1, 2 ou 3
createdAt:    Timestamp
updatedAt:    Timestamp
```

**É coleção de primeiro nível, e não subcoleção de `badge_videos`.** Questões vivem mais que vídeos: um
vídeo pode ser removido sem afetar o desafio, e o desafio pode existir antes de qualquer vídeo. A ligação
é por `badgeId`, que é a insígnia, e nada mais.

O `correctIndex` é um número, não a string da alternativa certa. **Isso impede que a ordem no front
denuncie a resposta** — quem embaralhar as alternativas na tela precisa embaralhar junto o índice, e a
comparação é sempre no servidor.

### 7. O GYM Challenge do membro é um documento de estado
`gym_challenges/{odId}` — onde `odId` é `{badgeId}__{uid}`

```
badgeId:        string
uid:            string
currentRound:   1 | 2 | 3
roundResults: {
  1?: { passed: boolean, score: number, completedAt: Timestamp }
  2?: { passed: boolean, score: number, completedAt: Timestamp }
  3?: { passed: boolean, score: number, completedAt: Timestamp }
}
badgeUnlocked:  boolean
startedAt:      Timestamp
updatedAt:      Timestamp
```

**Um documento por (membro, insígnia), sempre.** Não é um log de tentativas, é o estado atual. Quem
reprova e tenta de novo sobrescreve a rodada corrente no mesmo documento. A razão: o que importa para o
produto é "este membro desbloqueou esta insígnia", e isso é uma pergunta de sim/não, não um histórico.

O `currentRound` avança quando `roundResults[round].passed === true`. Se `roundResults[3].passed`,
`badgeUnlocked` vira `true` e `grade` é incrementado **no mesmo WriteBatch** — a mesma atomicidade da
spec 019 para XP.

### 8. As questões de uma rodada ativa vivem numa subcoleção efêmera
`gym_challenges/{odId}/active_round/{questionIndex}`

```
questionId:     string
question:       string
alternatives:   string[]            ← já embaralhadas pelo servidor
servedAt:       Timestamp
answeredAt:     Timestamp | null
chosenIndex:    number | null
correct:        boolean | null
xpAwarded:      number | null
clientElapsedMs: number | null      ← milissegundos medidos pelo front (decisão 3)
```

Quando o membro inicia uma rodada, o servidor sorteia 10 questões, embaralha as alternativas de cada uma,
e grava os 10 documentos. **O `correctIndex` não existe nesta subcoleção** — a resposta certa é conferida
pelo servidor contra `gym_questions` quando a resposta chega. Dar a resposta ao front seria confiar na
inspeção do tráfego.

Ao fim da rodada a subcoleção é consolidada no `roundResults` do documento pai e os documentos efêmeros
são apagados. **Se o membro abandonar no meio, a subcoleção fica** — e recomeçar a rodada a substitui
inteira.

### 9. A geração de questões por IA usa a Gemini API
O admin pode popular o banco de questões com IA generativa:

- O admin escreve um **prompt descritivo** do tema da insígnia e a dificuldade desejada.
- O backend chama a **Gemini API** (`GEMINI_API_KEY` no `.env`) com um prompt estruturado que pede
  questões no formato exato do schema.
- A resposta é parseada e devolvida ao admin como **rascunho** — não grava nada no banco ainda.
- O admin revisa, **edita ou exclui** questões individuais do rascunho.
- Ao confirmar, as questões aprovadas são gravadas em `gym_questions`.

A `GEMINI_API_KEY` é variável de ambiente, validada no bootstrap (como `FIREBASE_WEB_API_KEY`), e
**só usada em rotas de admin**. Nenhuma rota pública toca a Gemini.

O prompt estruturado pede:

```
Gere {N} questões de múltipla escolha sobre {tema} no nível {dificuldade}.
Cada questão deve ter exatamente 4 alternativas, sendo apenas uma correta.
Responda em JSON: [{ question, alternatives: [string x4], correctIndex: 0|1|2|3 }]
```

O backend valida o JSON devolvido: 4 alternativas, `correctIndex` dentro de 0-3, nenhum campo faltando.
Questão malformada é descartada silenciosamente, e o admin vê quantas sobraram.

### 10. As questões são servidas em lote, e as respostas uma a uma
O front pede "comece a rodada" e recebe as **10 questões de uma vez**, sem o `correctIndex`. A resposta
é enviada **uma por vez**, e o servidor devolve o resultado imediato: certo ou errado, XP ganho.

A alternativa — servir uma por vez — exigiria 10 round-trips por rodada e faria cada pergunta depender
da latência da anterior. Servir todas de uma vez e responder uma por vez dá ao front o conteúdo para
pré-renderizar e a responsividade para mostrar o resultado na hora.

**O risco de servir todas: o membro pode inspecionar o tráfego e ver as perguntas seguintes.** Isso é
aceito — ele vê as perguntas, não as respostas, e olhar a pergunta seguinte não dá vantagem quando a
pressão é de tempo.

### 11. O Ranking é uma coleção separada, populada por backfill e mantida por trigger
`ranking/{odId}` — onde `odId` é o `uid`

```
uid:          string
name:         string
xp:           number
badgeCount:   number           ← quantas insígnias desbloqueadas (min(grade, 8))
updatedAt:    Timestamp
```

**Por que não `getAll` em `profiles`?** Três razões:

1. **Ler 200 perfis para montar um ranking é 200 leituras, toda vez.** Um ranking que cresce com a base
   custa proporcional à base, e numa coleção dedicada a consulta é uma só.
2. **O perfil tem dados que o ranking não pode vazar.** E-mail, telefone, tier, redes sociais, aceites
   legais — tudo viria junto, e o filtro teria que ser perfeito toda vez. A coleção do ranking tem cinco
   campos, e é tudo o que a tela precisa.
3. **O ranking ordena por XP, e isso é um índice.** Numa coleção dedicada o índice é trivial
   (`xp DESC`). No perfil ele é um índice composto a mais, num documento que já é consultado por cinco
   caminhos diferentes.

A coleção é **eventualmente consistente** — o XP do perfil pode estar um passo à frente do ranking, e
isso é aceitável porque o ranking atualiza em segundos, não em dias.

**Manutenção:**
- **Backfill inicial:** `npm run ranking:backfill` — lê todos os perfis com `completedAt` não nulo e
  grava os documentos correspondentes. Idempotente e seguro para reexecução.
- **Manutenção em tempo de execução:** Toda operação que muda `xp` ou `grade` no perfil **atualiza o
  documento correspondente no ranking no mesmo WriteBatch**. É a mesma estratégia da spec 019: a
  atomicidade do lote é a trava.

### 12. O GYM Challenge aparece em dois lugares: a tela de jogos e a trilha da insígnia
O card do GYM Challenge — com seus três estados (decisão 5) — aparece:

1. Na **tela de Jogos**, como uma lista de todas as insígnias com seus respectivos desafios.
2. Na **trilha da insígnia** (na página de vídeos), como um card ao final da lista de vídeos daquela
   insígnia.

Em ambos os lugares, o card é o mesmo componente e os três estados funcionam identicamente. A diferença é
que na trilha ele tem **contexto** — o membro acabou de assistir aos vídeos daquela insígnia, e o card
brilhante é o convite natural.

### 13. Incremento de `grade` pelo GYM Challenge respeita a ordem da trilha
Completar o GYM Challenge de uma insígnia só incrementa `grade` se o `grade` atual do membro é
**exatamente um abaixo** da posição daquela insígnia na trilha. Completar a insígnia da POO (posição 2) só
incrementa `grade` se `grade === 1`.

**A consequência:** o membro pode tentar qualquer GYM Challenge que esteja disponível (XP suficiente +
questões cadastradas), mas o `grade` só avança em ordem. Um membro com `grade: 1` que completar o GYM de
Angular (`posição 7`) ganha os três selos de rodada aprovada e o XP das questões, mas **não** ganha
`grade: 7`. Ele ganha `grade: 2` quando completar o de POO.

Isso preserva a invariante da spec 008: `grade` é contagem de etapas concluídas em sequência, não um
conjunto arbitrário de insígnias.

**Mas o `badgeUnlocked` é gravado de qualquer forma.** Quando o `grade` finalmente alcançar aquela
posição, a decisão 2 diz que as rodadas aprovadas contam — e o `grade` avança automaticamente. Um
background check no WriteBatch da rodada final: "este membro tem todas as insígnias até aqui desbloqueadas?
Avança o `grade` até onde puder."

### 14. Excluir a conta apaga `gym_challenges` e os dados do ranking
Quinto encontro com **subcoleção que não some com o pai no Firestore**: `gym_challenges` do membro (com a
subcoleção `active_round` dentro) e `ranking/{uid}`.

Entra na **ordem de exclusão** existente, junto de `watched_videos`, `notification_reads` e
`legal_acceptances`, antes de `profiles/{uid}`.

### 17. Tela de aviso obrigatória antes de todo desafio, e o backend a exige
Antes de iniciar **qualquer** rodada de **qualquer** GYM Challenge, o membro vê uma tela com a
mensagem:

> **"Não se sabote, se permita errar primeiro."**

Acompanhada de um texto curto incentivando o membro a testar seus conhecimentos honestamente — sem
depender de IA ou de ajuda externa para responder. O argumento é direto: conhecimento se constrói
errando o suficiente para aprender, não acertando tudo de primeira. Quem usa ChatGPT para responder
engana a si mesmo, e o XP que ganha não representa nada.

A tela tem um **checkbox "Eu li e entendi"** que desbloqueia o botão de iniciar a rodada. **Ela
aparece SEMPRE** — não é um aceite único que se marca e nunca mais volta. Cada rodada, cada desafio,
cada insígnia: a tela aparece. A repetição é deliberada: o aviso não é burocracia, é ritual. Ele
coloca o membro no estado mental certo antes de cada tentativa.

**O backend não valida o aceite do aviso** — não há campo para isso no `POST .../start`. A tela é
uma barreira de UI, e a decisão de pular é do membro se ele inspecionar o tráfego. O preço de
validar seria um campo a mais em toda requisição e um estado a mais no documento, para proteger
contra quem deliberadamente contorna a tela — que é exatamente quem não leria o aviso mesmo que ele
aparecesse.

### 20. O nome no ranking é o `nickname`, e ele é imutável e único
O ranking e o GYM Challenge não usam `name` do perfil — usam um **`nickname`** (gamertag) escolhido
pelo membro. O nickname é:

- **Único na base.** Dois membros não podem ter o mesmo nickname.
- **Imutável depois de gravado.** Escolheu, é para sempre. O modal avisa isso antes de confirmar.
- **Obrigatório para jogar.** Quem não tem nickname não entra no GYM Challenge e não aparece no
  ranking. Ao tentar acessar qualquer tela de jogos sem nickname, um modal aparece pedindo para
  criar um — com o aviso de que é único e definitivo.

**Unicidade pelo documento:** o nickname é o **ID do documento** na coleção `nicknames/{nickname}`,
com o `uid` dentro. Criar o nickname é um `create()` — que falha com `ALREADY_EXISTS` se alguém já
pegou aquele nome. **Sem consulta, sem race condition, sem índice.** A mesma estratégia do `create()`
da spec 019 para o razão do XP.

```
nicknames/{nickname}
  uid:        string
  createdAt:  Timestamp

profiles/{uid}
  ...campos de sempre
  nickname:   string | null         ← novo, ?? null
```

O campo `nickname` no perfil é **denormalização para leitura**, e nasce `null`. O `PUT /me/nickname`
grava nos dois lugares no mesmo `WriteBatch`: o documento de unicidade e o campo no perfil. **Se o
campo já não é `null`, a rota responde `409`** — o nickname já foi escolhido.

O `ranking/{uid}` passa a usar `nickname` em vez de `name`:

```
ranking/{uid}
  uid:          string
  nickname:     string              ← gamertag, nunca name
  xp:           number
  badgeCount:   number
  updatedAt:    Timestamp
```

### 21. Replay de rodada aprovada: pode jogar, sem XP
Rodada aprovada é definitiva para efeito de `badgeUnlocked` e `grade`. Mas o membro **pode refazer
qualquer rodada** — inclusive de insígnia já conquistada — como treino.

A diferença: **nenhum XP é concedido no replay.** A rodada roda normalmente — questões aleatórias,
timer, feedback de certo/errado — mas o `xpAwarded` de cada pergunta é `0`, e a resposta da API
diz `replay: true` para o front saber que é treino.

As regras:
- `roundResults[round].passed === true` → a rodada já foi aprovada. Jogar de novo não sobrescreve o
  resultado original e não grava `score` novo.
- O `active_round` é criado normalmente (para ter as questões aleatórias), mas o flag `replay: true`
  vive no documento `gym_challenges/{odId}` durante a rodada.
- Ao fim da rodada de replay, a subcoleção é limpa como sempre, mas `roundResults` não é tocado.

Isso satisfaz o pedido sem criar farm: a pessoa pratica, vê perguntas novas, mas não acumula XP.

### 22. Evolução de posição no ranking: tracking diário
O ranking guarda a posição anterior do membro para mostrar a **variação diária**:

```
ranking/{uid}
  ...campos da decisão 11
  previousPosition:  number | null    ← posição de ontem, null no primeiro dia
  currentPosition:   number | null    ← posição calculada
  positionUpdatedAt: Timestamp | null
```

A variação é `previousPosition - currentPosition` (positivo = subiu, negativo = desceu). Um script
diário (`npm run ranking:snapshot`) — ou um trigger na atualização do ranking — copia
`currentPosition` para `previousPosition` e recalcula `currentPosition` com base na ordenação por
XP.

O cálculo de posição é feito **no momento da consulta** para o ranking completo, e gravado de volta
como cache. **Não é recalculado a cada mudança de XP individual** — a posição é eventual, e o delay
de até um dia é aceitável para "subiu 3 posições hoje".

### 23. As rotas de admin para questões e a rota de geração por IA
| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/admin/badges/:badgeId/questions` | Lista questões da insígnia, com filtro por dificuldade |
| `POST` | `/admin/badges/:badgeId/questions` | Cria uma questão manualmente |
| `PATCH` | `/admin/badges/:badgeId/questions/:questionId` | Edita questão |
| `DELETE` | `/admin/badges/:badgeId/questions/:questionId` | Remove questão |
| `POST` | `/admin/badges/:badgeId/questions/generate` | Gera questões com IA (rascunho, não grava) |
| `POST` | `/admin/badges/:badgeId/questions/bulk` | Grava em lote as questões aprovadas do rascunho |
| `GET` | `/admin/badges/:badgeId/challenge-config` | Lê a configuração do desafio (XP mínimo, ativo) |
| `PUT` | `/admin/badges/:badgeId/challenge-config` | Configura o desafio (XP mínimo) |

### 19. As rotas do membro para jogar e ver o ranking
| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/games/challenges` | Lista todas as insígnias com o estado do desafio para o membro logado |
| `GET` | `/games/challenges/:badgeId` | Detalhe do desafio: estado, rodadas, progresso |
| `POST` | `/games/challenges/:badgeId/start` | Inicia ou reinicia a rodada corrente |
| `POST` | `/games/challenges/:badgeId/answer` | Responde uma questão da rodada ativa |
| `GET` | `/ranking` | Ranking ordenado por XP, paginado, com posição do membro logado |

Throttle: `POST .../start` em `10/min` — não dá para iniciar dez desafios por minuto em uso normal.
`POST .../answer` em `120/min` — dez respostas por rodada, mais margem para retries. Os `GET` herdam o
padrão global.

---

## Endpoints — Resumo

### Admin

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/admin/badges/:badgeId/questions` | `?difficulty=` | `200` lista de questões |
| `POST` | `/admin/badges/:badgeId/questions` | `CreateQuestionDto` | `201` questão criada |
| `PATCH` | `/admin/badges/:badgeId/questions/:id` | `UpdateQuestionDto` | `200` questão atualizada |
| `DELETE` | `/admin/badges/:badgeId/questions/:id` | — | `204` |
| `POST` | `/admin/badges/:badgeId/questions/generate` | `{ prompt, difficulty, count }` | `200` rascunho de questões (não persiste) |
| `POST` | `/admin/badges/:badgeId/questions/bulk` | `{ questions: CreateQuestionDto[] }` | `201` questões criadas |
| `GET` | `/admin/badges/:badgeId/challenge-config` | — | `200` configuração |
| `PUT` | `/admin/badges/:badgeId/challenge-config` | `{ requiredXp }` | `200` configuração atualizada |

### Membro

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/games/challenges` | — | `200` lista de desafios com estado por insígnia |
| `GET` | `/games/challenges/:badgeId` | — | `200` detalhe do desafio |
| `POST` | `/games/challenges/:badgeId/start` | — | `200` `{ questions: QuestionDto[] }` (sem `correctIndex`) |
| `POST` | `/games/challenges/:badgeId/answer` | `{ questionIndex, chosenIndex, clientElapsedMs }` | `200` `{ correct, xpAwarded, roundComplete?, roundPassed?, badgeUnlocked?, totalXp? }` |
| `GET` | `/ranking` | `?limit=&after=` | `200` `{ entries: RankingEntryDto[], myPosition: number }` |

### Erros

| Situação | Status | Corpo |
|---|---|---|
| `badgeId` inexistente | `404` | `Insígnia não encontrada.` |
| Desafio indisponível (< 90 questões) | `403` | `O GYM Challenge dessa insígnia ainda não está disponível.` |
| XP insuficiente | `403` | `Você precisa de mais XP para participar desse desafio.` |
| Rodada já em andamento (tentar `start` sem finalizar) | `409` | `Você já tem uma rodada em andamento.` |
| `questionIndex` fora de faixa | `400` | `Índice de questão inválido.` |
| Questão já respondida | `409` | `Essa questão já foi respondida.` |
| Insígnia já desbloqueada | `200` | Idempotente, sem XP novo |

---

## Modelo

### Novas coleções

```
gym_questions/{questionId}
  badgeId:        string
  difficulty:     'easy' | 'medium' | 'hard'
  question:       string
  alternatives:   string[]            ← exatamente 4
  correctIndex:   number              ← 0, 1, 2 ou 3
  createdAt:      Timestamp
  updatedAt:      Timestamp

gym_challenges/{badgeId__uid}
  badgeId:        string
  uid:            string
  currentRound:   1 | 2 | 3
  roundResults:   map {
    1?: { passed: boolean, score: number, completedAt: Timestamp }
    2?: { passed: boolean, score: number, completedAt: Timestamp }
    3?: { passed: boolean, score: number, completedAt: Timestamp }
  }
  badgeUnlocked:  boolean
  startedAt:      Timestamp
  updatedAt:      Timestamp

gym_challenges/{badgeId__uid}/active_round/{questionIndex}
  questionId:     string
  question:       string
  alternatives:   string[]            ← embaralhadas
  servedAt:       Timestamp
  answeredAt:     Timestamp | null
  chosenIndex:    number | null
  correct:        boolean | null
  xpAwarded:      number | null

challenge_configs/{badgeId}
  badgeId:        string
  requiredXp:     number              ← XP mínimo para participar, default 0
  updatedAt:      Timestamp

ranking/{uid}
  uid:            string
  name:           string
  xp:             number
  badgeCount:     number              ← min(grade, 8)
  updatedAt:      Timestamp
```

### Campos existentes tocados

```
profiles/{uid}
  xp: number                ← já existe. Incrementado também pelo GYM Challenge
  grade: number             ← já existe. Agora pode ser incrementado automaticamente
```

### Índices novos

| Coleção | Campos | Uso |
|---|---|---|
| `gym_questions` | `badgeId` + `difficulty` | Listar/contar questões por insígnia e nível |
| `ranking` | `xp DESC` | Ranking ordenado |

---

## Fora de escopo

- **Duels (Duelos entre membros).** A tela de Jogos terá três opções: GYM Challenge, Duels e Ranking. Os
  Duels são a segunda peça do sistema de jogos e virão numa spec posterior. Esta spec monta a
  infraestrutura de questões que os Duels vão reutilizar.
- **Conquista automática de insígnias da Elite Four e Battle Frontier.** Esta spec cobre as 8 insígnias
  do GYM Battle. A mecânica de desafio para as fases 9-13 pode ser diferente e será definida depois.
- **Matchmaking ou dificuldade adaptativa.** As questões são sorteadas uniformemente dentro da
  dificuldade. Sem algoritmo de adaptação, sem ELO.
- **Imagens nas questões.** As questões são texto puro. Código pode ser incluído no enunciado como texto
  formatado (Markdown), mas imagens são outra spec.
- **Histórico de tentativas.** O documento do challenge guarda o estado atual, não o log completo de
  todas as tentativas. Um log de auditoria é útil e é outra spec.
- **Recompensas além de XP e insígnia.** Sem moeda, sem loja, sem cosmético.
- **Notificação ao desbloquear insígnia.** A spec 012 tem a infraestrutura. A notificação entra quando
  a primeira insígnia for desbloqueada e houver público para receber.
- **XP decrescente por pergunta errada.** Decisão 3: errar não penaliza.

---

## Specs afetadas

### Spec 008 (Liga Dev) — vigente, com emenda fundamental
A promessa de "jogos e ranking" deixa de ser promessa. A mecânica de GYM Battle, que era só nome, agora
tem regra e implementação. `grade` deixa de ser exclusivamente manual.

### Spec 009 (Financeiro, Administração e Trilha) — vigente, estendida
A trilha da insígnia ganha um card ao final da lista de vídeos. O admin ganha uma nova seção para
gerenciar questões. O `BADGE_IDS` continua sendo a fonte de verdade para insígnias válidas.

### Spec 019 (Vídeos Assistidos e XP) — vigente, com emenda
**XP agora tem duas fontes**: vídeos assistidos (10 XP cada) e questões acertadas no GYM Challenge
(até 50 XP cada). A decisão 2 de lá ("o XP é definitivo") continua valendo — XP do GYM Challenge
também é irreversível.

A consequência para a contagem: **a invariante "XP = 10 × documentos em `watched_videos`" deixa de
ser verdadeira**. O XP agora é a soma das duas fontes, e a reconciliação precisa considerar ambas.
O ponto em aberto 3 da 019 ("não existe caminho para reconciliar XP") ganha urgência.

### Spec 013 (Meu Perfil) — vigente
Excluir conta agora apaga mais duas coleções. A ordem de exclusão cresce.

### Spec 010 (Mural de Perguntas) — vigente
Nenhuma mudança direta. O tier continua sendo o portão do Mural, e o GYM Challenge não muda tier.

---

## Pontos em aberto — resolvidos

> Todos os pontos abaixo foram respondidos e as decisões correspondentes foram incorporadas ao corpo
> da spec. A seção permanece como registro.

**Q.1** — ~~O XP mínimo por insígnia deve seguir uma fórmula ou é livre?~~ **Fechado: livre, default 0.**
O admin configura por insígnia, e o default é 0 (sem exigência). A decisão 5 já dizia isso.

**Q.2** — ~~A Elite Four (posições 9-12) e a Battle Frontier (13) terão GYM Challenge?~~ **Fechado: não.**
Apenas GYM Challenge para as 8 insígnias. A Elite Four em diante não precisa.

**Q.3** — ~~Quantas questões a IA deve gerar por chamada?~~ **Fechado: até 30 por chamada.** O front pode
oferecer "gerar 30 fáceis", "gerar 30 médias", etc., em chamadas separadas.

**Q.4** — ~~O ranking deve incluir membros que nunca jogaram?~~ **Fechado: sim.** Se membros ganham XP ao
assistir vídeos, naturalmente todos participam do ranking.

**Q.5** — ~~O GYM Challenge deve ter um tempo máximo por rodada?~~ **Fechado: não.** Sem timeout global.

**Q.6** — ~~O nome no ranking deve ser o `name` do perfil ou um "gamertag" separado?~~ **Fechado: gamertag.**
Adicionado campo `nickname` único e imutável (Decisão 20).

**Q.7** — ~~O membro pode tentar novamente uma rodada já aprovada para melhorar seu XP?~~ **Fechado:
pode jogar após aprovado, mas não ganha mais XP.** (Decisão 21).

**Q.8** — ~~O que acontece com o `grade` quando o admin remove questões e o desafio fica abaixo de 90?~~
**Fechado: desafio volta a "Em breve", mas quem já desbloqueou não é afetado.**

---

## Adendo de levantamento (2026-08-30) — consolidação do modelo e lacunas fechadas

> Esta seção foi escrita ao levantar o `tasks.md`. As decisões acima permanecem vigentes; o que segue
> corrige o que a seção **Modelo** perdeu por ter sido escrita antes das decisões 20, 21 e 22, e fecha
> os pontos que a implementação precisaria adivinhar.

### A.1 A seção "Modelo" estava atrasada em relação às decisões 20 e 22
A tabela de coleções mostra `ranking/{uid}` com `name`, e a decisão 20 diz `nickname`; a decisão 22
acrescenta três campos que a tabela não tem. **A forma vigente é esta:**

```
ranking/{uid}
  uid:                string
  nickname:           string                ← decisão 20, nunca `name`
  xp:                 number
  badgeCount:         number                ← min(grade, 8)
  previousPosition:   number | null         ← decisão 22
  currentPosition:    number | null         ← decisão 22
  positionUpdatedAt:  Timestamp | null      ← decisão 22
  updatedAt:          Timestamp
```

E o `active_round` da tabela perdeu o campo que a decisão 8 declara. A forma vigente inclui
`clientElapsedMs: number | null` e `replayed: boolean` — este último para que a consolidação da rodada
saiba, sem reler o pai, que não deve tocar `roundResults` (decisão 21).

Some-se a coleção que a decisão 20 criou e a tabela não lista:

```
nicknames/{nickname}          ← ID do documento é o nickname normalizado (minúsculas)
  uid:        string
  createdAt:  Timestamp
```

**O ID é o nickname em minúsculas**, e não como digitado. `LenoDev` e `lenodev` são o mesmo nome para
efeito de unicidade, e o `create()` só protege contra o que colide no caminho. O valor **exibido**
guarda a capitalização escolhida, e mora no `profiles/{uid}.nickname`.

### A.2 A numeração das decisões tem buracos, e eles não escondem decisão nenhuma
As decisões saltam de 14 para 17, de 17 para 20, e a 19 aparece depois da 23. **Não há decisão 15, 16
ou 18**, e a ordem das tabelas de rotas não implica precedência. O `tasks.md` referencia as decisões
pelo número que elas têm, buracos incluídos, para que uma renumeração futura não invalide as duas
leituras.

### A.3 O `PUT /me/nickname` não estava em nenhuma tabela de endpoints
A decisão 20 o cita no corpo e as tabelas de resumo não o listam. Ele existe, é do membro, e mora no
`ProfileController` junto de `PATCH /me/privacy` e `PATCH /me/emails` — não no módulo de jogos, porque
o nickname é campo de perfil que jogos consome, e não o contrário.

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `PUT` | `/me/nickname` | `{ nickname: string }` | `204` |

Erros: `409` quando o perfil já tem nickname (imutável) **ou** quando o nome já pertence a outra pessoa
(`ALREADY_EXISTS` do `create()`) — dois motivos, mensagens diferentes, mesmo status. `400` quando não
casa com `^[A-Za-z0-9_-]{3,20}$`.

O `nickname` entra no `ProfileDto` (o `GET /me`), porque a tela do perfil precisa saber se o campo já
está travado. **Não entra no `PublicMemberDto`** sem decisão explícita: a spec 019 definiu aquele DTO
pelo que ele deixa de fora, e o nickname já é público por outro caminho — o ranking.

### A.4 A rota do desafio não é exempta do `LegalAcceptanceGuard`
Nenhuma rota desta spec entra na lista de exemções da spec 018. Quem não aceitou os documentos não
joga, não vê ranking e não escolhe nickname — sem uma linha escrita para isso ser verdade.

### A.5 Índices: são três, e o do `nicknames` não existe
| Coleção | Campos | Uso |
|---|---|---|
| `gym_questions` | `badgeId` ASC + `difficulty` ASC | Listar e contar por insígnia e nível |
| `gym_questions` | `badgeId` ASC + `createdAt` ASC | Listar todas as questões da insígnia sem filtro |
| `ranking` | `xp` DESC + `uid` ASC | Ranking ordenado e paginado por cursor estável |

`nicknames` é lido **só por caminho** (`nicknames/{nickname}`) e não gera índice — é o mesmo motivo pelo
qual `waitlist_entries/{email}` nunca gerou. O `ranking` precisa do desempate por `uid` porque XP empata
com frequência e um `startAfter` sobre campo não único pula ou repete linha na paginação.

Todos vão para `firestore.indexes.json` e são publicados **nos dois projetos**, com `--project`
explícito. É a lição de 2026-08-28, e ela custou as duas telas ordenadas do `dev-liga-dev`.

### A.6 `GEMINI_API_KEY` segue a regra do `RESEND_API_KEY`, não a do `FIREBASE_WEB_API_KEY`
Opcional no `EnvironmentVariables`, **obrigatória em produção** pela checagem imperativa dentro de
`validate()`. Sem ela, a rota de geração responde `503` com "A geração por IA não está configurada" em
vez de derrubar o boot: a máquina de desenvolvimento que não tem a chave precisa continuar servindo o
resto da API, e a rota que falta é de admin. Rota pública nenhuma toca a Gemini (decisão 9).

### A.7 A consolidação da rodada é o ponto onde três escritas precisam ser um lote só
Ao responder a 10ª questão, o mesmo `WriteBatch` faz: consolidar `roundResults[round]` no
`gym_challenges/{badgeId__uid}`, avançar `currentRound`, e — quando for a 3ª aprovada — gravar
`badgeUnlocked`, incrementar `grade` conforme a decisão 13 e atualizar `ranking/{uid}`. **Um lote, ou
existe um estado em que a insígnia está desbloqueada e o `grade` não subiu**, e nada o corrige depois.

O XP de cada questão, ao contrário, é escrito **na hora da resposta**, no lote que grava o documento do
`active_round` respondido, com `FieldValue.increment` no perfil e no `ranking/{uid}` — pelo mesmo motivo
da spec 019: quem abandona a rodada no meio já ganhou o que acertou.

### A.8 O `grade` avança em cascata, e o teto é 8
A decisão 13 diz que o `grade` só sobe quando a insígnia conquistada é a próxima da ordem, e que ao
chegar a vez as anteriores contam. A implementação é uma varredura: depois de gravar `badgeUnlocked`,
lê-se os `gym_challenges` do membro e avança-se `grade` enquanto a insígnia da posição `grade + 1`
estiver desbloqueada. **Para em 8**, porque as posições 9 a 13 não têm GYM Challenge (Q.2) e continuam
sendo promoção manual do admin. Um `grade` que passasse de 8 por esta via daria a Elite Four de graça.

### A.9 Scripts novos
```bash
npm run ranking:backfill     # decisão 11, idempotente, por projeto via .env
npm run ranking:snapshot     # decisão 22, copia currentPosition -> previousPosition e recalcula
```
Ambos em `scripts/`, no molde de `backfill-tab.ts`, com `--dry-run`.
