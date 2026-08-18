# Fix: o README fala de índices que produção não tem mais como hipótese

Aberto em 2026-08-18, depois de os índices compostos serem criados à mão no console do Firebase.

## Sintoma

Não é uma falha de execução — é o README descrevendo um estado que deixou de ser verdade em três
lugares diferentes, e um deles é uma negação frontal do que o código faz.

### 1. A seção "Banco de Dados" nega a existência de índice

Linhas 107-109:

> Firestore, pelo Admin SDK. **Não há migrations e não há schema a versionar** — nem TypeORM, nem
> SQL. As duas leituras do sistema são por caminho de documento, então também não há índice composto
> a manter.

A primeira frase continua certa. **A segunda está errada desde a spec 009** e ficou mais errada com a
010: existem quatro consultas que não são por caminho, e todas exigem índice composto. O parágrafo é
da 007, quando o sistema tinha `waitlist_entries` e `profiles` e nada mais — e ninguém voltou nele
quando as consultas apareceram.

Esse é o pior dos três, porque é o único que **desmente** uma exigência de produção. Quem lê o README
de cima para baixo é informado de que não há índice a manter antes de chegar, 340 linhas depois, na
tabela que lista os índices a manter.

### 2. A tabela da linha 447 está incompleta

Ela lista três índices:

| Coleção | Campos |
|---|---|
| `mural_questions` | `weekId` + `voteCount desc` + `createdAt asc` |
| `mural_questions` | `weekId` + `createdAt asc` |
| `badge_videos` | `badgeId` + `kind` + `order` |

**Falta um.** `BadgeVideoRepository.listByBadge` recebe `kind` como opcional:

```ts
const base = this.collection.where('badgeId', '==', badgeId);
const query = kind ? base.where('kind', '==', kind) : base;
const snapshot = await query.orderBy('order').get();
```

Sem `kind`, a consulta é `badgeId` + `order` — dois campos, índice diferente. E o caminho sem `kind`
não é hipotético: o comentário do próprio método diz que ele existe para a administração, que precisa
das duas abas juntas. O `docblock` do repositório já lista os dois índices corretamente; **só a tabela
do README perdeu um**.

### 3. Os índices deixaram de ser uma pendência

Todo o vocabulário do README trata índice como coisa que ainda vai falhar: "pede um índice composto",
"a falha aparece só em produção, com um link no erro". Isso era verdade quando ninguém tinha criado
nada. Agora que os índices existem no projeto, esse texto manda o próximo leitor esperar uma falha
que não vai acontecer — e, pior, sugere que o jeito de criar índice aqui é **esperar quebrar e clicar
no link do erro**, que é como foi feito uma vez e não é como deve ser feito de novo.

---

## O que o conserto faz

### 1. Uma única fonte da verdade sobre índices

A tabela da linha 447 vira **a** lista, completa, e as três menções espalhadas passam a apontar para
ela em vez de repeti-la pela metade:

- Linha 108 — troca "também não há índice composto a manter" por o oposto: há índices compostos, eles
  não estão no repositório, e a lista está na seção própria.
- Linha 297 (`badge_videos`, spec 009) — para de dizer "pede um índice composto (`badgeId` + `order`)"
  como se fosse o único, e remete à tabela.
- Linhas 449-450 — o texto acima da tabela deixa de descrever a falha esperada e passa a descrever o
  estado: **criados em produção em 2026-08-18**, com a data, porque índice criado à mão sem registro
  de quando vira folclore em três meses.

A tabela ganha as duas colunas que faltam para ser acionável:

| Coleção | Campos | Consulta que o exige |
|---|---|---|
| `mural_questions` | `weekId` asc + `voteCount` desc + `createdAt` asc | `listByWeek(byVotes: true)` e `findWinner` |
| `mural_questions` | `weekId` asc + `createdAt` asc | `listByWeek(byVotes: false)` |
| `badge_videos` | `badgeId` asc + `order` asc | `listByBadge()` sem `kind` — a visão do admin |
| `badge_videos` | `badgeId` asc + `kind` asc + `order` asc | `listByBadge(kind)` — as abas Aulas e FAQ |

Ligar cada índice ao método que o exige é o que impede o próximo apagar um "que ninguém usa".

### 2. A frase que faltava, e que é o motivo de este fix existir

> **O emulador não exige índice.** A suíte passa verde sem nenhum deles, e por isso a existência de um
> índice em produção nunca é verificada por teste. É a mesma forma de falha dos dois fixes da spec
> 007: o ambiente onde tudo funciona é o ambiente que não faz a pergunta.

Não é retórica. É a terceira vez que este projeto é mordido pela mesma coisa — `require(esm)` que o
Node local aceita, `localhost` que o Firebase autoriza de graça, e agora índice que o emulador não
cobra —, e a única defesa disponível é o README dizer onde o teste não olha.

### 3. O CLAUDE.md tem a mesma frase e o mesmo erro

`CLAUDE.md`, na lista do "There is no schema and no migrations":

> **Two queries now need composite indexes in production** (`mural_questions` by week+votes,
> `badge_videos` by badge+kind+order).

São quatro, não duas, e a contagem envelheceu do mesmo jeito da linha 108. Sai no mesmo commit — dois
arquivos com a mesma afirmação errada é como a afirmação sobrevive à correção de um deles.

---

## O console, conferido

As quatro entradas acima foram derivadas do código. O `firebase firestore:indexes` do projeto trouxe
**cinco**. As quatro batem, campo por campo, incluindo a ordem — e a quinta não tem consulta:

```json
{
  "collectionGroup": "mural_questions",
  "fields": [
    { "fieldPath": "voteCount",  "order": "DESCENDING" },
    { "fieldPath": "createdAt",  "order": "ASCENDING"  },
    { "fieldPath": "__name__",   "order": "ASCENDING"  }
  ]
}
```

**É `voteCount` + `createdAt` sem o `weekId` na frente**, e nenhuma consulta do repositório é assim.
Os dois `orderBy('voteCount', 'desc')` que existem — `listByWeek(byVotes: true)` e `findWinner` —
vêm os dois depois de um `.where('weekId', '==', ...)`, e um índice que não começa pelo campo do
filtro de igualdade não serve nenhum dos dois. Conferido por leitura direta de
`src/mural/mural.repository.ts`, linhas 47-53 e 69-75.

Provavelmente é o rascunho do índice certo, criado antes de o `weekId` entrar na consulta, ou um clique
num link de erro que trouxe a sugestão errada. **Ele custa uma escrita a mais em toda gravação de
pergunta e em todo voto** — o `voteCount` muda a cada voto, então é exatamente o campo mais escrito da
coleção que está indexado à toa.

**Não sai neste fix.** Apagar índice é operação em produção, e este commit é de documentação; misturar
os dois faz o rollback de um arrastar o outro. O que este fix faz é registrar a sobra na tabela do
README com o motivo, para que ela não seja recriada por engano depois de removida:

> Um quinto índice existe no projeto — `mural_questions` por `voteCount desc` + `createdAt asc`, sem o
> `weekId`. **Nenhuma consulta o usa**, e ele encarece toda gravação de voto. Está marcado para
> remoção; se aparecer de novo, é rascunho ou link de erro, não requisito.

O `__name__` no fim de cada entrada é o desempate que o Firestore acrescenta sozinho. Não é campo
nosso e não entra na tabela do README — listá-lo faria parecer que há uma decisão de modelagem onde só
há mecânica do banco.

---

## O que não fazer

**Não criar um `firestore.indexes.json` neste fix.** Seria o conserto certo — índice como código,
publicado por `firebase deploy --only firestore:indexes`, do mesmo jeito que `firestore.rules` já é —
e é exatamente por ser o conserto certo que ele não cabe aqui: mexe no `firebase.json`, no pipeline de
publicação e num script de `package.json`, e este fix é de documentação. **Fica registrado como a
próxima spec**, não como um extra deste commit.

**Não apagar as menções a índice das seções 009 e 010 para "centralizar".** Quem chega em
`badge_videos` pela seção da 009 precisa saber ali que existe índice; o que não pode é a seção repetir
a lista e divergir dela. Apontar não é repetir.

---

## O que este fix deixa registrado

Um número dentro de uma frase de documentação ("duas consultas", "as duas leituras") é uma afirmação
que envelhece sozinha, sem que ninguém a edite e sem que nada quebre. O README tinha três dessas sobre
o mesmo assunto, escritas em três specs diferentes, e as três estavam erradas na mesma direção: para
menos. Contagem de coisas que crescem pertence a uma tabela, não a uma oração subordinada.

---

## Aplicação (2026-08-18)

Branch `fix/010-indices-no-readme`. Só documentação — **nenhuma linha de `src/` mudou**, e nenhum
índice foi criado ou removido no projeto Firebase.

| Arquivo | O que mudou |
|---|---|
| `README.md`, seção "Banco de Dados" | "também não há índice composto a manter" virou o oposto, com link para a lista |
| `README.md`, seção `badge_videos` (009) | parou de citar `badgeId` + `order` como se fosse o único índice; aponta para a lista |
| `README.md`, "Índices compostos que produção exige" | tabela completa com quatro entradas, coluna da consulta que exige cada uma, data de criação, o aviso de que o emulador não cobra índice, o comando de conferência e a nota do quinto índice a remover |
| `CLAUDE.md` | "Two queries" → quatro, com a nota de que `badgeId` + `order` não é prefixo de `badgeId` + `kind` + `order` |

Verificado: `npm test` e `npm run lint` limpos — o que só prova que a documentação não quebrou código,
porque **nenhum teste deste projeto consegue verificar um índice**. É o ponto da seção nova.

## Fica para a próxima spec

**`firestore.indexes.json` no repositório**, publicado por `firebase deploy --only firestore:indexes`
do mesmo jeito que o `firestore.rules` já é por `npm run rules:deploy`. É o conserto de verdade: hoje
a lista do README é uma transcrição à mão de um estado que mora só no console, e transcrição à mão é
o que este fix acabou de corrigir três vezes seguidas.

Sai junto a remoção do quinto índice, que aí vira uma linha apagada de um arquivo versionado em vez de
um clique sem registro.
