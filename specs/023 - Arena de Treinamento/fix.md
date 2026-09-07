# Defeito corrigido: `create()` sobre caminho ocupado **pendurava** com `preferRest`

> Encontrado em 2026-09-01, na passada manual da spec 023 contra o `dev-liga-dev`.
> **Corrigido no mesmo dia**, na branch `fix/preferrest-already-exists`, e conferido contra o preview.
>
> **Não era um defeito desta spec.** Ele era anterior, valia para o produto inteiro, e a Arena só o
> expôs num lugar fácil de alcançar: o segundo clique em "Concluir Desafio".

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

Só que no `firebase-admin@13.10.0` (`@google-cloud/firestore@7.11.6`) o transporte REST **não traduz
o erro de documento já existente**: a promessa do `create()` — solto ou dentro de um `WriteBatch` —
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

**A regra "`create()`, nunca `set()`" é a unicidade deste produto inteiro.** O `CLAUDE.md` a repete
em cada coleção: é o `ALREADY_EXISTS` que ocupa o lugar da unique violation `23505` do Postgres. Onde
a colisão é o **caminho normal**, e não uma corrida rara, o defeito aparecia toda vez:

- `profiles/{uid}/watched_videos/{videoId}` — remarcar um vídeo (spec 019). **Era o mais visível**: o
  check da trilha é a interação mais repetida do produto.
- `training_completions/{uid}__{trainingId}` — concluir de novo (spec 023).
- `profiles/{uid}/legal_acceptances/{documentId}__{version}` — duplo clique em "aceito" (spec 018).
- `notifications/{...}` — publicação repetida (spec 012).
- votos do Mural, `nicknames/{nickname}`, `badge_videos/{badgeId}__{youtubeId}`, `gym_challenges`.

**A lista de espera escapava** porque lê antes de escrever: o `create()` de lá só é alcançado numa
corrida real entre duas inscrições simultâneas. Foi por isso que ninguém tropeçou nisto antes.

---

# As quatro decisões

O conserto não foi um upgrade. Foram quatro decisões, e **três delas só apareceram depois da
primeira** — cada uma escondida atrás da anterior, e nenhuma visível na etapa em que se estava.

## 1. Subir para o `firebase-admin@14`, e não desligar o `preferRest`

`14.3.0`, com `@google-cloud/firestore@8.7.1`. Conserta na origem e mantém o `preferRest`, que existe
por uma razão que continua valendo.

**Desligar o `preferRest` também resolveria, em uma linha**, e essa alternativa foi considerada e
recusada: ela reabre o travamento de cold start que o comentário do `FirebaseService` documenta.
Seria trocar um travamento por outro, em situação diferente — e a Vercel é onde o produto roda.

É um major, e ele pede **Node >= 22**. Daí o `engines` novo no `package.json`: sem ele a Vercel pode
escolher um runtime mais velho em silêncio, e a decisão de versão fica no painel em vez de no repo.

## 2. Aceitar os dois códigos, num lugar só

**Esta é a metade que dá para esquecer, e sozinha ela troca um defeito por outro.** Na 14 com
`preferRest` o erro chega como `code: 409` — o status HTTP —, e não como o `6` do gRPC. O
`ALREADY_EXISTS = 6` de `waitlist.repository.ts` era o que todos os `catch` comparavam; com o `409`
chegando, o `if` daria falso, o erro seria relançado, e **o travamento viraria `500`**.

A constante virou `isAlreadyExists(error)`, que aceita os dois e é agora **o único lugar do produto
que sabe como a recusa chega**. Os nove `catch` que comparavam com a constante passaram a chamá-la.

Junto foram embora **três cópias locais** da mesma função, que tinham nascido em
`email-campaign.service`, `watched-video.repository` e `training.service` — três implementações da
mesma pergunta, que é exatamente o que dá errado de novo no próximo transporte.

## 3. `preferRest` desligado contra o emulador

Achado rodando o e2e. Com o `firebase-admin@14`, a requisição REST chega ao emulador **sem se
identificar como Admin SDK**, então o `firestore.rules` é avaliado — e ele nega tudo, de propósito,
porque só o Admin SDK toca nesses dados. O corpo do erro traz a linha da regra
(`false for 'delete' @ L21`), que é o que entrega a causa. Isso derrubava a suíte e2e inteira.

| SDK | transporte | contra o **emulador** |
|---|---|---|
| 13.10.0 | `preferRest` | `create()` duplicado **pendura** |
| 14.3.0 | `preferRest` | **`403 PERMISSION_DENIED` em tudo** |
| 14.3.0 | gRPC | funciona; recusa duplicata com `code 6` |

**Contra o Firestore de verdade não acontece**: lá o JWT da conta de serviço é admin e as regras não
valem. É defeito só do emulador, e portanto só do e2e.

O conserto é uma linha, e ela não é atalho: `preferRest` fica desligado quando
`FIRESTORE_EMULATOR_HOST` está definido. Ele existe por causa do congelamento de processo em função
serverless, e o emulador roda em localhost, no mesmo processo vivo — ali ele não compra nada. Quem
cobre o transporte REST não é o e2e; é o `fake-firestore`, que sabe emitir o `409`.

## 4. `jose` preso na 5, ou a function nem sobe

Achado só depois do deploy. Com tudo verde e o preview publicado, **a API de preview respondia `500`
em toda rota, inclusive a raiz**. O log da Vercel deu a causa em uma linha:

```
ERR_REQUIRE_ESM: require() of ES Module .../jose/dist/webapi/index.js
from .../jwks-rsa/src/utils.js not supported
```

O `nest build` emite CommonJS, e a function da Vercel carrega esse bundle com um `require` próprio. O
upgrade trocou a cadeia inteira por baixo:

```
13.x -> jwks-rsa@3.2.2 -> jose@4.15.9   (tem build CJS)
14.x -> jwks-rsa@4.1.0 -> jose@^6       (só ESM)
```

E o `jwks-rsa@4.1.0` continua sendo CommonJS — a primeira linha do `utils.js` dele é
`require('jose')`. A combinação só funciona onde o `require()` de ESM é permitido, que é Node 22.12+
fora de bundler. **Por isso o build passou, os 984 testes passaram, o e2e passou e a máquina de
desenvolvimento não reclamou**: o Node daqui aceita; o carregador da Vercel não. **Nada rodando
localmente podia pegar isto**, o e2e incluído, porque ele roda no mesmo Node permissivo.

Conserto: um `overrides` prendendo o `jose` na 5, que publica as duas formas — a condição `require`
está no `exports` dela. O `jwks-rsa` usa `importJWK` e `exportSPKI`, que a 5 tem. `npm ci`, que é o
que a Vercel roda, reproduz.

---

# Os testes que travam cada decisão

O `fake-firestore` só sabia emitir `code: 6`, e é exatamente por isso que **a suíte ficava verde com
o produto travado em produção**. Ele agora recebe o transporte no construtor
(`new FakeFirestore('rest')`) e emite `409` nesse modo.

Sobre isso, quatro travas. As três primeiras foram conferidas revertendo só a linha que aceita o
`409`: ficam vermelhas.

1. **`isAlreadyExists`** em `waitlist.repository.spec.ts` — aceita `6` e `409`, recusa qualquer outro
   código e o que não é erro com código.
2. **A idempotência da segunda conclusão da Arena**, repetida no transporte REST.
3. **A remarcação de um vídeo da trilha**, repetida no transporte REST.
4. **`cjs-dependencies.spec.ts`** — lê o `exports` do pacote que o consumidor de fato carrega e exige
   a condição `require`. **Ele resolve a partir do consumidor, e não do arquivo de teste**, e isso já
   custou um verde falso na primeira versão: de `src/config` o Node subia até um `jose` solto em
   `C:\Users\<usuário>\node_modules` e passava, com a cópia certa quebrada. Conferido com o `exports`
   da cópia real mutilado: fica vermelho.

O piso de versão está escrito onde importa: no comentário do `preferRest`, em `firebase.service.ts`.
Quem for tentado a voltar o SDK lê ali por que não dá.

---

# A conferência

**Local**, verde: `npm test` (985 testes, 83 suítes), `npm run lint`, `npm run build`.

**E2e**: rodou — o `firebase-tools` de hoje exige Java >= 21, então quem serviu foi o JBR do
IntelliJ, e não o JDK 17 da máquina. Resultado: **178 falhas antes do upgrade, 178 depois, com os
nomes de teste idênticos** — a diferença entre os dois conjuntos é vazia nos dois sentidos.
**Nenhuma regressão.**

**A passada manual**, contra `apipreview.lenoborges.com.br` — Firestore de verdade, `preferRest`
ligado, sessão real do painel. Os dois sintomas do começo deste documento:

`POST /trainings/:id/complete`, três vezes no mesmo desafio já concluído:

| chamada | status | tempo | `xpAwarded` | `xp` |
|---|---|---|---|---|
| 1ª | `201` | 823 ms | 0 | 512 |
| 2ª — **a que pendurava** | `201` | 683 ms | 0 | 512 |
| 3ª | `201` | 961 ms | 0 | 512 |

`PUT /me/watched-videos/:videoId`, seis idas e vindas no mesmo vídeo: todas `200`, entre 720 ms e
1514 ms, `xp` parado em 512 nas seis.

Antes: dois minutos e dez segundos, respectivamente, sem resposta nenhuma.

Uma observação que vale guardar: **o botão "Concluir Desafio" some depois da primeira conclusão**,
então o segundo clique não é alcançável pela tela e o teste teve que ir pela API. É uma boa defesa do
front, mas nunca foi o que segurava o defeito — um duplo clique rápido, ou uma aba aberta antes da
conclusão, chegava lá.

---

# O que fica em aberto

**O merge da PR #43 em `main` e o deploy de produção.** É a única coisa que falta deste conserto.

**As 178 falhas do e2e, que são anteriores e não têm relação com este upgrade.** Elas merecem passada
própria, e enquanto estiverem de pé **o e2e só consegue provar "não piorou", nunca "está certo"**. A
causa é estrutural: `POST /auth/login` não passa pelo Admin SDK — chama
`identitytoolkit.googleapis.com` direto, com a `FIREBASE_WEB_API_KEY` —, enquanto os usuários do
teste nascem no emulador. O login vai ao Google de verdade procurar alguém que só existe local e leva
`401` (e `429` quando a corrida se repete). Só as duas suítes que não dependem de login passam.

Consertar isso não é uma linha: é decidir se o login passa a respeitar `FIREBASE_AUTH_EMULATOR_HOST`,
e isso mexe no caminho de sessão, que a spec 005 fez questão de ter um só. Por isso não entrou junto
de um bump de SDK.

---

# O que a spec 023 fez a respeito

Nada, e isso foi decisão: o defeito era anterior e do produto inteiro, e um bump de major no SDK que
sustenta auth e Firestore não cabia no fechamento de uma spec de conteúdo. A Arena entrou com o
comportamento correto escrito, testado e coberto — a idempotência da segunda conclusão tem teste
unitário verde contra o `fake-firestore` e caso no e2e — e o que faltava era o transporte devolver o
erro que a aplicação já sabia tratar.

É o que esta correção fez. **A lição que sobra é de altura, e não de código**: quatro ambientes
diferentes — o `fake-firestore`, o emulador, o Node local e o carregador da Vercel — e cada um deles
escondia um defeito que os outros três não podiam ver.
