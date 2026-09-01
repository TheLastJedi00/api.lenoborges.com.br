# Defeito conhecido: `create()` sobre caminho ocupado **pendura** com `preferRest`

> Encontrado em 2026-09-01, durante a passada manual da spec 023 contra o `dev-liga-dev`.
> **Não é um defeito desta spec.** Ele é anterior, vale para o produto inteiro, e a Arena só o
> expôs num lugar fácil de alcançar: o segundo clique em "Concluir Desafio".

## O sintoma

`POST /trainings/:id/complete` numa segunda chamada **nunca responde**. Não é lento: passou de dois
minutos sem resolver, e o log do Nest não registra nada — nenhuma exceção, nenhum 500. A requisição
fica pendurada até o cliente desistir.

O mesmo acontece com **`PUT /me/watched-videos/:videoId` ao remarcar um vídeo** (spec 019), medido na
mesma sessão: duas chamadas seguidas, dez segundos cada, sem resposta.

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
| 13.10.0 (o que está no `package.json`) | gRPC | rejeita `code 6` em ~0,6s |
| 13.10.0 | **`preferRest`** — o que a aplicação usa | **pendura; >120s sem resolver** |
| 14.3.0 | gRPC | rejeita `code 6` |
| 14.3.0 | **`preferRest`** | rejeita **`code 409`** em ~0,3s |

O rastreamento temporário dentro de `TrainingService.complete` mostrou o caminho parando exatamente
em `await batch.commit()`: o `catch` do `ALREADY_EXISTS` **nunca é alcançado**.

## Por que isso é grave

**A regra "`create()`, nunca `set()`" é a unicidade deste produto inteiro.** O `CLAUDE.md` a repete em
cada coleção: é o `ALREADY_EXISTS` que ocupa o lugar da unique violation `23505` do Postgres. Onde a
colisão é o **caminho normal**, e não uma corrida rara, o defeito aparece toda vez:

- `profiles/{uid}/watched_videos/{videoId}` — remarcar um vídeo (spec 019). **É o mais visível**: o
  check da trilha é a interação mais repetida do produto.
- `training_completions/{uid}__{trainingId}` — concluir de novo (spec 023).
- `profiles/{uid}/legal_acceptances/{documentId}__{version}` — duplo clique em "aceito" (spec 018).
- `notifications/{...}` — publicação repetida (spec 012).
- votos do Mural, `nicknames/{nickname}`, `badge_videos/{badgeId}__{youtubeId}`, `gym_challenges`.

**A lista de espera escapa** porque lê antes de escrever: o `create()` de lá só é alcançado numa
corrida real entre duas inscrições simultâneas. Foi por isso que ninguém tropeçou nisto antes.

## O conserto, e a pegadinha dele

**Subir para `firebase-admin@14`** conserta na origem e mantém o `preferRest`, que existe por uma razão
que continua valendo.

**Mas o upgrade sozinho troca um defeito por outro.** Na 14 com `preferRest`, o erro chega como
`code: 409` — o código HTTP —, e não `6`. O `ALREADY_EXISTS = 6` de `waitlist.repository.ts` é o que
todos os `catch` deste repositório comparam:

```ts
function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    (error as { code?: unknown }).code === ALREADY_EXISTS;   // só conhece o 6
}
```

Com o `409` chegando, esse `if` dá falso e **o erro é relançado**: o travamento vira `500`. O conserto
tem duas metades, e a segunda não pode ser esquecida:

1. `npm i firebase-admin@14` (é um major: a suíte inteira e os dois e2e precisam rodar antes).
2. **Aceitar os dois códigos** — `6` do gRPC e `409` do REST — num lugar só. O `ALREADY_EXISTS` de
   `waitlist.repository.ts` já é o dono da constante, e é ele que deve virar a função que os dois
   transportes atendem. Existem cerca de dez `catch` comparando com ela; todos passam a valer de
   graça.
3. Um teste que trave a regra: hoje o `fake-firestore` só emite `code: 6`, então **a suíte fica verde
   com o produto travando em produção** — foi exatamente o que aconteceu. Ele precisa saber emitir os
   dois.

**Desligar o `preferRest` também resolveria**, e em uma linha, mas reabre o travamento de cold start
que o comentário do `FirebaseService` documenta. Seria trocar um travamento por outro, em situação
diferente — e a Vercel é onde o produto roda.

## O que a spec 023 fez a respeito

Nada, e isso é decisão: o defeito é anterior e é do produto inteiro, e um bump de major no SDK que
sustenta auth e Firestore não cabe no fechamento de uma spec de conteúdo. A Arena entra com o
comportamento correto escrito, testado e coberto — a idempotência da segunda conclusão tem teste
unitário verde contra o `fake-firestore` e caso no e2e — e o que falta é o transporte devolver o erro
que a aplicação já sabe tratar.
