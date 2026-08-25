# Spec 012: Notificações Internas

## Objetivo
O produto publica coisas e ninguém fica sabendo. Um vídeo novo entra numa insígnia e só é descoberto por
quem abrir aquela trilha; uma pergunta nova entra no Mural e só é vista por quem abrir o Mural naquela
semana. **Publicar sem avisar é publicar para quem já estava olhando** — e é o oposto do que a trilha e
o Mural precisam para funcionar.

Esta spec cria o **canal de notificação interna** do produto: dois eventos, uma coleção, três endpoints.
O sino, o balanço, o painel e o modal são do front. Este repositório responde uma pergunta só, e responde
bem: **o que esta pessoa ainda não viu?**

O par desta spec no front é a **012**, e as duas entram juntas.

---

## Numeração
Os números são iguais nos dois repositórios: 010 é o Mural, 011 é a Sessão que Sobrevive ao F5, 012 é
esta. No front não existe 006 nem 007, e aqui não existe 008 — a divergência é antiga e não muda nada.

---

## Os dois eventos, e só eles

| Evento | Quem dispara | Onde nasce |
|---|---|---|
| **Vídeo novo numa insígnia** | admin | `BadgeVideoService.create` (spec 009) |
| **Pergunta nova no Mural** | qualquer membro pagante | `MuralService.createQuestion` (spec 010) |

Nenhum outro evento entra nesta spec, e a lista curta é proposital: um canal de notificação que começa
com sete gatilhos vira ruído antes de virar hábito, e o primeiro reflexo de quem recebe ruído é ignorar
o sino para sempre. Dois eventos, os dois raros — um vídeo por semana, uma pergunta por membro por
semana —, e o sino continua significando alguma coisa.

---

## Decisões

### 1. Uma notificação por evento, nunca uma por pessoa
A saída óbvia é fan-out: o vídeo entra, e o servidor escreve um documento para cada membro. É a saída
óbvia e é a errada aqui.

Fan-out custa **N escritas por evento** e cresce com a comunidade — cem membros são cem escritas por
vídeo publicado, e o número só sobe. Pior que o custo: o mesmo evento passa a existir em cem cópias, e
corrigir um título errado vira uma varredura.

Aqui a notificação é **um documento só, global**, e o que é por pessoa é apenas **o que ela já leu**.
Duas escritas por evento no total: a do vídeo e a da notificação.

> A comunidade lê muito mais do que o produto publica. O barato precisa ser publicar; ler já é barato
> porque a janela é pequena (decisão 4).

### 2. O ID do documento carrega o evento
`notifications/video__{badgeId}__{youtubeId}` e `notifications/pergunta__{questionId}`.

É a mesma regra de `waitlist_entries/{email}`, `profiles/{uid}` e `badge_videos/{badgeId}__{youtubeId}`:
**o caminho é a garantia de unicidade**, porque o Firestore não tem `UNIQUE`. Com ela, um `POST` repetido
por clique duplo ou retry de rede não produz duas notificações do mesmo vídeo.

E vale aqui o que já vale lá: **`create()`, nunca `set()`**. O `ALREADY_EXISTS` é o sinal de que o evento
já foi anunciado, e ele é **engolido em silêncio** — anunciar duas vezes é o erro; falhar a publicação
por causa disso seria pior (decisão 7).

### 3. O que é lido mora no perfil, em subcoleção
`profiles/{uid}/notification_reads/{notificationId}`, documento com `readAt`.

A alternativa era um array `readIds` no perfil. Array cresce sem teto, e o documento do perfil é lido em
toda requisição autenticada — engordar o perfil para resolver notificação faz o produto inteiro pagar.

A leitura de "quais destas eu já vi" é **um `getAll` por caminho**, exatamente como
`MuralRepository.findMyVotes` já faz para saber qual coração pintar. Nunca uma consulta por usuário,
nunca N leituras em laço.

> **Apagar um perfil precisa apagar esta subcoleção explicitamente.** Subcoleção não some com o pai no
> Firestore — a mesma armadilha que os votos do Mural já documentam. Órfã, ela fica invisível, cobrada e
> impossível de achar.

### 4. A janela é de 30 dias e no máximo 50, e não existe histórico
A listagem devolve as **não lidas** dos últimos 30 dias, limitadas a 50, mais recentes primeiro.

Notificação lida some para sempre: não há tela de histórico, e não deve haver. O que aconteceu já está
na trilha e no Mural, que são as telas que guardam as coisas de verdade. Uma tela de histórico de
notificações seria uma segunda cópia, pior, do produto.

A janela é o que mantém a leitura barata: no pior caso são 50 documentos e 50 caminhos no `getAll`, e
esse teto não muda quando a comunidade crescer.

### 5. Ninguém é notificado do próprio evento
A notificação guarda `actorUid` — quem publicou o vídeo, quem escreveu a pergunta — e a listagem
**descarta as em que o `actorUid` é o próprio leitor**.

Sem isso, o membro escreve a pergunta dele e o sino toca por causa dela. É o tipo de detalhe que faz o
recurso inteiro parecer quebrado no primeiro uso, porque o primeiro uso de quase todo mundo é escrever.

### 6. Quem entrou depois não vê o que veio antes
A listagem também descarta o que é anterior ao `createdAt` do perfil.

Membro novo abrindo o painel pela primeira vez com 50 notificações no sino não recebe um resumo do
produto — recebe uma pilha, e a primeira coisa que aprende é a limpá-la sem ler.

### 7. Notificar nunca derruba a operação que originou a notificação
O vídeo é publicado; a pergunta é criada. **Depois** a notificação é escrita, fora da transação, e
qualquer falha ali é capturada e vira **log de erro** — nunca resposta de erro para quem publicou.

Um `POST /admin/badges/:id/videos` que responde 500 porque a notificação falhou é uma API que perde o
trabalho do admin por causa de um aviso. A inversão certa é: o conteúdo é o essencial, o aviso é o
acessório, e o acessório não decide o destino do essencial.

O log importa: sem ele, notificação que não é escrita é notificação que ninguém sabe que faltou.

### 8. A listagem devolve só não lidas — o front não filtra
Nada de `read: boolean` para o cliente peneirar. Filtrar no cliente significa mandar as lidas pela rede
para serem descartadas, e significa duas implementações da mesma regra: a do servidor, que já precisa
saber, e a do front, que divergiria na primeira exceção.

É o mesmo princípio do `canAsk` do Mural, e vale pela mesma razão.

### 9. A API manda o `badgeId`, e nunca o nome da insígnia nem a URL de destino
A resposta carrega `kind`, `title` cru, `badgeId` e `createdAt`. Não carrega "Insígnia do Git e GitHub",
não carrega ícone, e **não carrega rota**.

Os treze `badgeId` já estão duplicados no front de propósito (`track.constants.ts` diz por quê), e rota
é assunto de quem tem roteador. Uma API que devolve `/dashboard/trilha/git-github` amarra o endereço das
telas ao servidor — e quebra o painel inteiro na primeira reorganização de rotas do front.

**Abreviar o título também não é daqui.** O título vai inteiro; quantos caracteres cabem no cartão é
decisão de layout.

### 10. Marcar como lida usa `set()`, e é a exceção que confirma a regra
Em todo o resto do projeto vale `create()`, nunca `set()`. Aqui é ao contrário: marcar como lida
**precisa ser idempotente**, porque o mesmo clique pode chegar duas vezes e a segunda vez não é erro. Um
409 em "já li isso" seria um erro sem nada para consertar.

O comentário no código registra a inversão, ou ela vira "bug" no próximo code review.

### 11. Sem tempo real e sem polling
Nem `onSnapshot`, nem endpoint de contagem batido a cada trinta segundos. A notificação chega **na
próxima vez que a pessoa abrir o painel**, e isso é uma frase honesta que ninguém precisa esconder.

Polling de contador é a feature que custa dinheiro em silêncio: uma requisição por membro por minuto,
para descobrir na esmagadora maioria das vezes que nada mudou. O Mural já recusou tempo real pela mesma
razão (spec 010, fora de escopo), e nada aqui muda o argumento.

### 12. Nenhum índice composto novo
A consulta é `orderBy('createdAt', 'desc').limit(50)` sobre a coleção inteira — **ordenação por um campo
só**, que o Firestore atende com o índice de campo único que ele cria sozinho.

Isso é deliberado, e é o motivo de o corte por `actorUid` e por data de entrada (decisões 5 e 6)
acontecer **em memória, depois da leitura**, e não em `where`: cada `where` combinado com o `orderBy`
exigiria um índice composto, e a lista de índices que produção exige já cresceu duas vezes sem ninguém
perceber. Com teto de 50 documentos, filtrar em memória não custa nada mensurável.

### 13. O Mural ganha ordenação por mais recentes
O destino da notificação de pergunta é o Mural com as perguntas mais novas em cima. Hoje a aba de coleta
ordena por `createdAt` **ascendente** — a mais antiga primeiro, que é o certo para quem está lendo a
semana inteira, e o errado para quem chegou por um aviso de "pergunta nova".

`GET /mural/perguntas` ganha `ordem=recentes`, que inverte a direção. **Não pede índice novo:** inverter
todas as direções de uma consulta ordenada usa o mesmo índice (`weekId` + `createdAt`), que já existe.

---

## Endpoints

| Método | Rota | Guard | O que faz |
|---|---|---|---|
| `GET` | `/notificacoes` | auth | Não lidas dos últimos 30 dias, no máximo 50, mais recentes primeiro. Sem as do próprio autor e sem as anteriores à entrada do membro |
| `POST` | `/notificacoes/:id/lida` | auth | Marca uma como lida. **Idempotente**: 204 mesmo se já estava |
| `POST` | `/notificacoes/lidas` | auth | Marca todas as da janela como lidas, num lote. 204 |

Os dois `POST` têm **dois chamadores cada um** no front (spec 012 de lá, decisão 9): o de `:id/lida` é
chamado ao abrir o modal de uma notificação **e** pelo botão de check da linha, que marca sem abrir nada;
o de `lidas` é o "Marcar todas como lidas" do rodapé do painel. É por isso que a idempotência da decisão
10 não é zelo: com dois caminhos até a mesma marcação, marcar duas vezes é rotina, não erro.

`GET /notificacoes` responde:

```jsonc
[
  {
    "id": "video__git-github__dQw4w9WgXcQ",
    "kind": "video",                 // "video" | "pergunta"
    "title": "Rebase sem medo",      // cru, sem abreviar (decisão 9)
    "badgeId": "git-github",
    "createdAt": "2026-08-25T18:03:11.204Z"
  }
]
```

### Endpoints existentes que mudam

| Endpoint | O que muda |
|---|---|
| `POST /admin/badges/:badgeId/videos` | Passa a escrever uma notificação depois de criar o vídeo. **Contrato de resposta inalterado**, e falha ao notificar não muda o status (decisão 7) |
| `POST /mural/perguntas` | Idem, para a pergunta |
| `GET /mural/perguntas` | Aceita `ordem=recentes` (decisão 13). Sem o parâmetro, o comportamento de hoje |

---

## Modelo

```
notifications/{video__badgeId__youtubeId | pergunta__questionId}
  kind: 'video' | 'pergunta'
  title: string        // título do vídeo, ou da pergunta
  badgeId: BadgeId
  actorUid: string     // quem publicou; nunca é notificado (decisão 5)
  targetId: string     // youtubeId do vídeo, ou id da pergunta
  createdAt: Timestamp

profiles/{uid}/notification_reads/{notificationId}
  readAt: Timestamp
```

`targetId` não é usado por nenhuma tela hoje — o destino dos dois eventos é uma lista, não um item. Ele
existe porque é o único dado que **não dá para reconstruir depois** se um dia a notificação precisar
levar ao vídeo exato, e gravá-lo agora custa um campo.

---

## Fora de escopo

- **E-mail, push do navegador e WhatsApp.** Isto é notificação *interna*: ela só existe com o painel
  aberto. Canal externo é outra spec, com consentimento, descadastro e reputação de domínio junto.
- **Preferências de notificação.** Com dois eventos, uma tela de preferências teria dois interruptores e
  daria mais trabalho de manter do que os eventos que governa.
- **"Sua pergunta venceu a semana".** É o terceiro evento óbvio e continua fora: a vencedora é
  **derivada, nunca gravada** (spec 010), então não existe o instante em que ela "acontece" para virar
  gatilho. Notificar exigiria o cron que a spec 010 recusou de propósito.
- **Histórico de notificações lidas** (decisão 4).
- **Contador em tempo real, badge no favicon, som.**
- **Agrupar notificações** ("3 perguntas novas"). Com o volume real — uma pergunta por membro por
  semana — agrupar esconderia informação para economizar um espaço que sobra.
- **Notificar por insígnia que a pessoa acompanha.** Não existe "acompanhar insígnia" no produto.

---

## Specs afetadas

### Spec 010 (Mural de Perguntas) — vigente, com uma linha revogada
O "Fora de escopo" de lá diz: *"**Notificação** de 'sua pergunta venceu'. Não existe canal de notificação
no produto."* **A segunda frase deixa de valer** — o canal passa a existir. A primeira continua valendo,
e o motivo está registrado acima: a vencedora é derivada e não tem instante de disparo.

A ordenação da aba de coleta ganha `ordem=recentes` (decisão 13); o padrão não muda.

### Spec 009 (Financeiro, Administração e Trilha) — vigente, estendida
Publicar vídeo passa a ter um efeito colateral. A decisão 7 existe para que esse efeito colateral nunca
possa custar a publicação.

### Spec 007 (Firestore e Firebase Auth) — vigente
`create()` nunca `set()` continua sendo a regra da casa; a decisão 10 abre **uma** exceção, nomeada e
justificada.

---

## Pontos em aberto

1. **30 dias e 50 itens são chute.** São números escolhidos para caber numa leitura barata, não medidos.
   Se a comunidade crescer a ponto de 50 encherem em dois dias, o teto vira paginação — e aí a decisão 4
   é reaberta, não remendada.
2. **Vídeo em insígnia trancada notifica quem não pode assistir?** Escrito como **sim**. A trilha não é
   travada (spec 009, decisão 6): a insígnia abre para todo mundo e explica o bloqueio na própria tela, e
   ver o que se ganha é o argumento comercial. Se ficar agressivo, o filtro por `tier` entra na listagem
   — e aí a decisão 12 muda, porque `tier` não é campo da notificação.
3. **O admin é notificado de vídeo publicado por outro admin?** Sim, pela decisão 5 — só o próprio autor
   é descartado. Hoje há um admin só, então na prática o admin nunca recebe notificação de vídeo.
4. **Apagar a pergunta do Mural apaga a notificação dela?** Escrito como **sim**, no mesmo fluxo que já
   apaga a subcoleção de votos. Uma notificação que leva a uma pergunta moderada é um aviso que aponta
   para o vazio.
5. **Limpeza das notificações fora da janela.** Nada as apaga hoje; elas só param de ser lidas. A 30 dias
   e dois eventos por semana isso é irrelevante por anos, e um job de limpeza agora seria manutenção
   inventada. Fica registrado para não ser "descoberto" como bug depois.
