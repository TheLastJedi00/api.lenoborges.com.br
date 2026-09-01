# Defeito conhecido: `create()` sobre caminho ocupado **pendurava** com `preferRest`

> Encontrado em 2026-09-01, durante a passada manual da spec 023 contra o `dev-liga-dev`.
> **Não era um defeito desta spec.** Ele é anterior, valia para o produto inteiro, e a Arena só o
> expôs num lugar fácil de alcançar: o segundo clique em "Concluir Desafio".
>
> **Corrigido em 2026-09-01**, na branch `fix/preferrest-already-exists`. O relato abaixo fica como
> está — é a memória do que custou descobrir —, e o que mudou está em "O conserto, como ele ficou".

## O sintoma

`POST /trainings/:id/complete` numa segunda chamada **nunca respondia**. Não era lento: passou de
dois minutos sem resolver, e o log do Nest não registrava nada — nenhuma exceção, nenhum 500. A
requisição ficava pendurada até o cliente desistir.

O mesmo acontecia com **`PUT /me/watched-videos/:videoId` ao remarcar um vídeo** (spec 019), medido
na mesma sessão: duas chamadas seguidas, dez segundos cada, sem resposta.

## A causa

O `FirebaseService` inicializa o Firestore com **`preferRest: true`**, e o comentário ao lado explica
por quê: em função serverless da Vercel, o gRPC não sobrevive ao congelamento do processo, e a
primeira requisição depois de um período ocioso pendura até dar timeout.

Só que no `firebase-admin@13.10.0` (`@google-cloud/firestore@7.11.6`) o transporte REST **não traduz o
erro de documento já existente**: a promessa do `create()` — solto ou dentro de um `WriteBatch` —
simplesmente nunca se resolve.

Medido fora da aplicação, com a mesma credencial e o mesmo projeto:

| SDK | transporte | `create()` duplicado |
|---|---|---|
| 13.10.0 (o que estava no `package.json`) | gRPC | rejeita `code 6` em ~0,6s |
| 13.10.0 | **`preferRest`** — o que a aplicação usava | **pendura; >120s sem resolver** |
| 14.3.0 | gRPC | rejeita `code 6` |
| 14.3.0 | **`preferRest`** | rejeita **`code 409`** em ~0,3s |

O rastreamento temporário dentro de `TrainingService.complete` mostrou o caminho parando exatamente
em `await batch.commit()`: o `catch` do `ALREADY_EXISTS` **nunca era alcançado**.

## Por que isso era grave

**A regra "`create()`, nunca `set()`" é a unicidade deste produto inteiro.** O `CLAUDE.md` a repete em
cada coleção: é o `ALREADY_EXISTS` que ocupa o lugar da unique violation `23505` do Postgres. Onde a
colisão é o **caminho normal**, e não uma corrida rara, o defeito aparecia toda vez:

- `profiles/{uid}/watched_videos/{videoId}` — remarcar um vídeo (spec 019). **Era o mais visível**: o
  check da trilha é a interação mais repetida do produto.
- `training_completions/{uid}__{trainingId}` — concluir de novo (spec 023).
- `profiles/{uid}/legal_acceptances/{documentId}__{version}` — duplo clique em "aceito" (spec 018).
- `notifications/{...}` — publicação repetida (spec 012).
- votos do Mural, `nicknames/{nickname}`, `badge_videos/{badgeId}__{youtubeId}`, `gym_challenges`.

**A lista de espera escapava** porque lê antes de escrever: o `create()` de lá só é alcançado numa
corrida real entre duas inscrições simultâneas. Foi por isso que ninguém tropeçou nisto antes.

## O conserto, como ele ficou

**Subir para `firebase-admin@14`** conserta na origem e mantém o `preferRest`, que existe por uma razão
que continua valendo.

**Mas o upgrade sozinho trocaria um defeito por outro.** Na 14 com `preferRest` o erro chega como
`code: 409` — o código HTTP —, e não `6`. O `ALREADY_EXISTS = 6` de `waitlist.repository.ts` era o que
todos os `catch` deste repositório comparavam, e com o `409` chegando esse `if` daria falso: o erro
seria relançado e o travamento viraria `500`. As três metades do conserto, todas aplicadas:

1. **`firebase-admin@14.3.0`** (`@google-cloud/firestore@8.7.1`). É um major, e ele pede **Node >= 22**
   — daí o `engines` novo no `package.json`, para a Vercel não escolher um runtime mais velho em
   silêncio.
2. **`isAlreadyExists(error)` em `waitlist.repository.ts`**, aceitando os dois códigos — `6` do gRPC e
   `409` do REST. A constante virou função, e ela é agora **o único lugar do produto que sabe como a
   recusa chega**. Os nove `catch` que comparavam com a constante passaram a chamá-la, e junto foram
   embora as três cópias locais de `isAlreadyExists` que tinham nascido em `email-campaign.service`,
   `watched-video.repository` e `training.service` — três implementações da mesma pergunta, que é
   exatamente o que dá errado de novo no próximo transporte.
3. **Testes que travam a regra.** O `fake-firestore` só sabia emitir `code: 6`, e por isso **a suíte
   ficava verde com o produto travado em produção** — foi literalmente o que aconteceu. Ele agora
   recebe o transporte no construtor (`new FakeFirestore('rest')`) e emite `409` nesse modo. Sobre
   isso, três travas: os casos de `isAlreadyExists` em `waitlist.repository.spec.ts`, a idempotência
   da segunda conclusão da Arena e a remarcação de um vídeo da trilha, **repetidas no transporte
   REST**. Conferido: revertendo só a linha que aceita o `409`, as três ficam vermelhas.

O piso de versão está escrito onde ele importa: no comentário do `preferRest`, em
`firebase.service.ts`. Quem for tentado a voltar o SDK lê ali por que não dá.

**Desligar o `preferRest` também resolveria**, e em uma linha, mas reabre o travamento de cold start
que o comentário do `FirebaseService` documenta. Seria trocar um travamento por outro, em situação
diferente — e a Vercel é onde o produto roda.

## O que falta

**Os dois e2e não rodaram nesta máquina**: `npm run test:e2e` sobe o emulador do Firebase, que precisa
de Java no PATH, e não há Java aqui. O que rodou, verde: `npm test` (984 testes, 82 suítes),
`npm run lint` e `npm run build`. **Rodar `npm run test:e2e` numa máquina com Java antes do merge em
`main` é a última conferência que falta**, e ela não é opcional num bump de major do SDK que sustenta
auth e Firestore.

Depois do deploy, a passada manual que encontrou o defeito é a que o fecha: segundo clique em
"Concluir Desafio" e remarcação de um vídeo da trilha, contra o `dev-liga-dev`.

## O que a spec 023 fez a respeito

Nada, e isso foi decisão: o defeito era anterior e do produto inteiro, e um bump de major no SDK que
sustenta auth e Firestore não cabia no fechamento de uma spec de conteúdo. A Arena entrou com o
comportamento correto escrito, testado e coberto — a idempotência da segunda conclusão tem teste
unitário verde contra o `fake-firestore` e caso no e2e — e o que faltava era o transporte devolver o
erro que a aplicação já sabia tratar. É o que esta correção fez.
