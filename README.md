# Eduleno Backend API

API para o serviço da Seita Dev (eduleno-back).

## Funcionalidades
- Endpoint para lista de espera (`POST /waitlist`)
- Autenticação com Firebase Auth (`/auth/*`): cadastro por e-mail, login com e-mail/senha, renovação de sessão e logout. **A senha é definida na tela hospedada pelo Firebase**, fora desta API
- Gestão de perfil e onboarding do membro (`/me` e `/me/profile`), com ID token verificado pelo Admin SDK
- Sessão segura: access token em memória e refresh token em cookie `HttpOnly` rotacionado
- Persistência no Firestore pelo Admin SDK, sem ORM, sem migrations e sem schema a versionar
- Validação estrita de dados (class-validator) e normalização compartilhada
- Rate limit por rota e proteção contra abuso (`@nestjs/throttler`)
- Documentação interativa de API com Swagger (`/docs`)

## Configuração do Ambiente (.env)

Crie um arquivo `.env` na raiz do projeto com base no `.env.example`:

```env
# Porta da API
PORT=3000
NODE_ENV=development

# Origens permitidas para CORS (separadas por vírgula)
FRONTEND_URL="http://localhost:4200"

# Quantidade de proxies reversos na frente da API (para rate limit por IP real)
TRUST_PROXY_HOPS=1

# Swagger em /docs (ativado por padrão fora de produção)
# SWAGGER_ENABLED=true

# Firebase (spec 007). Chave de serviço: o JSON inteiro em UMA linha.
# É credencial de administrador do projeto — nunca comitar um valor real.
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...", ...}'

# Chave pública do projeto (Project settings > General > Web API Key).
# NÃO é segredo: vai no bundle de qualquer app Firebase web por desenho.
FIREBASE_WEB_API_KEY="sua-web-api-key"

# Cookie do refresh token
AUTH_COOKIE_SECURE=false          # true em produção (exigido por SameSite=None)
AUTH_COOKIE_SAMESITE=lax          # none em produção (front e API em domínios distintos)
AUTH_COOKIE_MAX_AGE_DAYS=30
```

## Configuração do Firebase Auth

Identidade e dados vivem no mesmo fornecedor, autenticados pelo mesmo arquivo: a chave de serviço em
`FIREBASE_SERVICE_ACCOUNT_JSON`. Ela fica confinada ao `FirebaseService`, como a service role key do
Supabase ficava antes.

### A senha é definida fora desta aplicação

Este é o ponto que o código não conta e que costuma surpreender quem lê só os endpoints.

O cadastro (`POST /auth/signup`) cria o usuário com uma senha aleatória descartada na mesma linha, e
dispara o e-mail de definição de senha pelo Firebase. O link desse e-mail leva para a **tela
hospedada pelo Google**, em `<projeto>.firebaseapp.com/__/auth/action`, e é lá que o usuário digita a
senha. **Não existe `POST /auth/password`**: o `oobCode` nunca chega nesta API.

```
signup -> e-mail do Firebase -> tela do Google -> botão de retorno -> <front>/?entrar=1
```

O `continueUrl` que a API passa no envio é o que faz esse botão de retorno existir. Sem ele o usuário
define a senha e fica parado numa página do Google, sem caminho de volta.

### O que vive no console, e não no repositório

Três configurações não têm representação em código, e todas afetam o fluxo:

| Onde | O quê | Por que importa |
|---|---|---|
| Authentication > Settings > Password policy | **Mínimo de 8 caracteres** | A tela é do Firebase e aplica a política do projeto, que nasce em 6. O front garantia 8 e deixou de existir; sem configurar, o piso cai sem aviso. |
| Authentication > Templates | Nome público do projeto e remetente | Aparecem no e-mail e na tela onde a senha é digitada. |
| Authentication > Sign-in method | Provedor Email/Password ligado | Sem ele, nada do fluxo funciona. |

**Não configure "customize action URL".** Ela desviaria o link para uma página nossa, e a decisão da
[spec 007](specs/007%20-%20Firestore%20e%20Firebase%20Auth/context.md) é usar a tela do Firebase como
está — desfazer isso significa ressuscitar página, endpoint, DTO e testes.

### Sessão

| Operação | Como |
|---|---|
| login | REST `accounts:signInWithPassword`, no servidor, com a Web API Key |
| refresh | `securetoken.googleapis.com`, com o refresh token do cookie HttpOnly |
| guard | `admin.auth().verifyIdToken()` |
| logout | `admin.auth().revokeRefreshTokens(uid)` |

O login é chamado **pela API**, e não pelo front: o Admin SDK não verifica senha, e a alternativa
seria o front falar direto com o Google. Isso preserva a decisão da spec 005 de o front nunca receber
material de sessão do provedor de auth.

**O logout é global.** O Firebase revoga refresh tokens por usuário, não por sessão: sair em um
dispositivo desloga todos. A spec 005 tinha escolhido escopo `local` de propósito, e isso se perdeu
na troca de fornecedor — não há contorno.

**A revogação não derruba o ID token na hora.** Ela invalida a renovação; um ID token já emitido vale
até expirar, em no máximo uma hora. O guard tem uma constante `CHECK_REVOKED` que fecha essa janela
ao custo de uma ida à rede por requisição autenticada, e ela está `false`. O raciocínio está no
comentário em `src/auth/guards/firebase-auth.guard.ts`.

## Banco de Dados

Firestore, pelo Admin SDK. **Não há migrations e não há schema a versionar** — nem TypeORM, nem SQL.
As duas leituras do sistema são por caminho de documento, então também não há índice composto a
manter.

```bash
npm run emulators        # Auth + Firestore locais (exige o Firebase CLI)
npm run test:e2e         # sobe o emulador, roda a suíte e derruba
npm run rules:deploy     # publica firestore.rules no projeto linkado
```

O e2e roda contra o emulador, não contra um projeto real: é offline, descartável, e é o único jeito
de exercitar as security rules.

### Coleção `waitlist_entries` (spec 004, remodelada pela 007)

**ID do documento: o e-mail normalizado.**

- `name` (string)
- `phone` (string)
- `email` (string, igual ao ID)
- `consent` (boolean)
- `createdAt` (Timestamp)

O e-mail é o ID porque o Firestore não tem constraint `UNIQUE`, e o ID do documento é o único lugar
onde ele garante unicidade. O `create()` do repository — nunca `set()`, que sobrescreveria em
silêncio — falha com `ALREADY_EXISTS`, e esse erro ocupa exatamente o lugar que a unique violation
`23505` do Postgres ocupava, na mesma janela de corrida entre duas inscrições simultâneas.

Consequência no contrato: o `id` do recibo de `POST /waitlist` é o e-mail, não um UUID.

### Coleção `profiles` (spec 005, remodelada pela 007)

**ID do documento: o UID do Firebase.**

- `name`, `phone`, `bio` (string ou null até o onboarding)
- `grade` (number, 0 a 13, default 0 — ver spec 008 (Liga Dev, no repositório do front): 1 a 8 são insígnias, 9 a 12 a Elite Four, 13 o pós-game)
- `completedAt` (Timestamp ou null)
- `waitlistEntryId` (string ou null — é o e-mail normalizado, o caminho em `waitlist_entries`)
- `createdAt`, `updatedAt` (Timestamp)

O UID como caminho substitui a FK para `auth.users` com `on delete cascade`: "existe perfil para este
usuário" vira uma leitura direta, sem consulta e sem índice.

### O que o banco garantia e agora é responsabilidade da aplicação

| Garantia | Era | É |
|---|---|---|
| E-mail único na waitlist | `unique` na coluna | ID do documento |
| Perfil pertence a um usuário | FK + cascade | UID como ID do documento |
| `grade` entre 0 e 13 | `check` constraint | Validação na aplicação |
| Campos obrigatórios | `not null` | `class-validator` no DTO e o converter |
| Acesso direto bloqueado | RLS sem policy | `firestore.rules` com `deny all` |

A última linha não é formalidade. Só a API toca no Firestore, sempre pelo Admin SDK, que **ignora as
security rules** por ser credencial de administrador. A superfície que as rules fecham é o SDK
cliente, que fala com o Google a partir de qualquer navegador que tenha a Web API Key — e ela é
pública. Sem rules explícitas, um projeto Firestore em modo de teste é uma base aberta na internet.

## Arquitetura de Sessão e Segurança

- **Identidade e dados, o mesmo fornecedor**: identidade (criação de usuários, envio de e-mails, tokens) e dados de negócio vivem no Firebase, autenticados pela mesma chave de serviço, que fica confinada exclusivamente ao `FirebaseService`. Antes eram dois fornecedores e cinco credenciais.
- **Tokens de Sessão**:
  - **Access Token**: Enviado no corpo JSON da resposta (`SessionResponseDto`) para ser mantido em memória no frontend.
  - **Refresh Token**: Gravado em cookie HTTP seguro (`eduleno_rt`) com flags `HttpOnly`, `Path=/auth`, `SameSite` e `Secure` configuráveis por variáveis de ambiente. `AUTH_COOKIE_SAMESITE` aceita só `lax`, `strict` ou `none`, e `AUTH_COOKIE_SECURE` só `true` ou `false`. A combinação `none` sem `true` **derruba a aplicação no boot**: o navegador descarta cookie `SameSite=None` sem `Secure`, e sem essa checagem o login responderia `200` enquanto a sessão nunca persistiria, sem erro em log nenhum.
  - **Rotação de Refresh**: A cada chamada a `POST /auth/refresh`, o Firebase rotaciona o refresh token e a API emite o novo cookie. No caso de refresh inválido (401), o cookie é limpo imediatamente.
- **Autenticação**: Rotas sob `/me` são protegidas pelo `FirebaseAuthGuard`, que valida o ID token com `admin.auth().verifyIdToken()`. Assinatura, expiração, `aud` e `iss` são conferidos pelo próprio SDK, contra o projeto da credencial — a verificação manual desses campos, que o guard anterior precisava escrever à mão, não tem equivalente aqui e refazê-la duplicaria a regra no lugar errado.

## Endpoints da API

Acesse `/docs` para visualizar o Swagger com os esquemas e exemplos.

### `POST /waitlist`
- Entrada: `{ name, phone, email, consent }`
- Resposta: `201` `{ id, receivedAt }`
- Rate limit: 5 req / 60s

### `POST /auth/signup`
- Entrada: `{ email, emailConfirmation }`
- Resposta: `202` `{ status: "confirmation_sent" }`
- Comportamento: Idêntico para e-mails novos ou já cadastrados (anti-enumeração de usuários). Vincula dados da waitlist no perfil inicial se existirem.
- Rate limit: 3 req / 60s

> **`POST /auth/password` não existe.** A senha é definida na tela hospedada pelo Firebase, para onde
> o link do e-mail aponta, e o `oobCode` nunca chega nesta API. Ver "A senha é definida fora desta
> aplicação", acima.

### `POST /auth/login`
- Entrada: `{ email, password }`
- Resposta: `200` `{ accessToken, expiresIn, user: { id, email }, profileCompleted, grade, role }` + Cookie `eduleno_rt`
- Rate limit: 5 req / 60s

### `POST /auth/refresh`
- Entrada: Leitura automática do cookie `eduleno_rt`
- Resposta: `200` `{ accessToken, expiresIn, user: { id, email }, profileCompleted, grade, role }` + Cookie `eduleno_rt` rotacionado
- Rate limit: 30 req / 60s

### `POST /auth/logout`
- Entrada: Leitura do cookie `eduleno_rt`
- Resposta: `204 No Content` + Cookie `eduleno_rt` limpo (idempotente)
- Comportamento: a sessão é carregada a partir do refresh token do próprio cookie antes de ser
  revogada no Supabase, com escopo `local` (derruba só esta sessão, não os outros dispositivos).
  Cookie ausente, expirado ou forjado não revoga nada e ainda responde `204`.

### `GET /me`
- Header: `Authorization: Bearer <accessToken>`
- Resposta: `200` `{ id, email, name, phone, bio, grade, profileCompleted, role }`

### `PATCH /me/profile`
- Header: `Authorization: Bearer <accessToken>`
- Entrada: `{ name, phone, bio }`
- Resposta: `200` `{ id, email, name, phone, bio, grade, profileCompleted, role }`
- Comportamento: Preenche `completed_at` na primeira execução e não sobrescreve nas seguintes.
- Rate limit: 10 req / 60s

---

## Financeiro, Administração e Trilha (spec 009)

### `GET /billing/tiers`
- Header: `Authorization: Bearer <accessToken>`
- Resposta: `200` `{ tiers: [{ id, name, price, priceLabel, period, summary, perks }], currentTierId }`

**Exige sessão, e essa é a única razão de o endpoint existir para um dado estático:** o preço não
pode sair no bundle público. Se o número está no JavaScript que qualquer visitante baixa, ele não
saiu da landing — só saiu da tela. O nome do tier e o que ele entrega continuam sendo conteúdo local
do front, porque são copy; o **preço** existe num lugar só, aqui.

`price` vem em **centavos** (`26000`), e `priceLabel` é o rótulo pronto, para o front usar como
fallback e nunca como fonte.

Os quatro tiers são cumulativos, e cada tier pago abre `perks` com "Tudo do &lt;anterior&gt;":

| Tier | Preço/mês | Acrescenta |
|---|---|---|
| Dev Tier | Gratuito | Insígnias 1 e 2, comunidade, voto no Mural |
| Great Dev Tier | R$ 19,99 | A plataforma da Insígnia 3 em diante e a Elite Four |
| Ultra Dev Tier | R$ 199,99 | A Grinding Arena |
| Master Dev Tier | R$ 260,00 | Duas aulas de inglês por mês, para entrevista técnica |

`currentTierId` sai de `resolveCurrentTier(profile)` e hoje é `dev-tier` para todo mundo — não existe
cobrança. A função existe para haver **um lugar só** onde essa pergunta é respondida quando a
assinatura existir.

### `GET /badges/:badgeId/videos`
- Header: `Authorization: Bearer <accessToken>`
- Resposta: `200` `{ badgeId, videos: [{ id, badgeId, title, description, youtubeId, order }] }`

**Insígnia sem vídeo responde `200` com lista vazia, nunca `404`.** A trilha não é presa — o aluno
escolhe qual insígnia quer conquistar e pode pular —, então insígnia vazia é o estado normal do
produto, não uma exceção. `404` fica reservado para insígnia que não existe na trilha, que é bug ou
URL adulterada.

Não há guard de assinatura aqui, e isso é escolha declarada: não existe estado de assinatura no
modelo, e a única chave disponível hoje seria o `grade` — que é **conquista**, não acesso.

### Rotas de administração

Todas passam por `FirebaseAuthGuard` e depois `AdminGuard`, nessa ordem. Membro comum recebe `403`.

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/admin/users?limit&pageToken` | Lista os cadastrados, paginado pelo Auth |
| `PATCH` | `/admin/users/:id` | Altera `grade`, e só |
| `GET` | `/admin/badges/:badgeId/videos` | Vídeos da insígnia |
| `POST` | `/admin/badges/:badgeId/videos` | Publica; recebe URL, grava o ID; entra no fim da ordem |
| `PATCH` | `/admin/badges/:badgeId/videos/order` | Reordena em lote atômico |
| `PATCH` | `/admin/badges/:badgeId/videos/:videoId` | Edita título e descrição |
| `DELETE` | `/admin/badges/:badgeId/videos/:videoId` | Remove e renormaliza a ordem |

### Coleção `badge_videos` (spec 009)

**ID do documento: `{badgeId}__{youtubeId}`.**

- `badgeId` (string) — uma das treze etapas de `src/track/track.constants.ts`
- `title` (string) — **o título da plataforma**, obrigatório. Não é o do YouTube
- `description` (string ou null)
- `youtubeId` (string) — só o ID, nunca a URL
- `order` (number) — posição dentro da insígnia, inteiro de 0 a n-1
- `createdAt`, `updatedAt` (Timestamp)

O caminho composto é o que garante que **o mesmo vídeo não entra duas vezes na mesma insígnia** — o
`create()` falha com `ALREADY_EXISTS` —, e ao mesmo tempo permite o mesmo vídeo em duas insígnias
diferentes, que é um caso real: um vídeo de Git serve à insígnia de Git e à de DevOps.

O título é nosso porque o do YouTube é de lá: aquele é escrito para o algoritmo, este diz onde a
pessoa está na trilha e precisa poder ser reescrito sem republicar o vídeo.

Guarda-se o ID e não a URL porque ela chega em cinco formas (`watch?v=`, `youtu.be/`, `/embed/`, com
`&t=`, com `?si=`). A extração acontece uma vez, na entrada, em `src/track/youtube-id.ts`.

**Esta é a primeira consulta do sistema que não é por caminho**, e ela pede um índice composto
(`badgeId` + `order`) no Firestore de produção. O emulador não exige índice, então a suíte passa
verde e a falha aparece só em produção, com um link no erro para criá-lo.

### `role` como custom claim

Administrador é uma **custom claim do Firebase Auth** (`role: 'admin'`), nunca um campo no Firestore.
A claim viaja dentro do ID token, então o `verifyIdToken` que o guard já faz devolve o papel de
graça; um campo em `profiles` custaria uma leitura de banco em toda requisição de admin e criaria
dois lugares capazes de discordar sobre quem manda.

```bash
npm run admin:grant -- lenoborges.dev@gmail.com            # promove
npm run admin:grant -- lenoborges.dev@gmail.com --revoke   # rebaixa
```

**A claim só vale no próximo token.** Com `CHECK_REVOKED = false`, o ID token que a pessoa já tem
continua valendo por até uma hora — promover não é instantâneo, e é preciso sair e entrar de novo.

Não existe endpoint que cria admin: o primeiro não teria quem o criasse, e seria a superfície mais
cara do projeto para o menor uso.

`role` sai achatado em `POST /auth/login`, `POST /auth/refresh` e `GET /me`, para o front decidir se
desenha a Administração sem decodificar o ID token por conta própria. **Esconder o botão não é a
segurança** — quem impede é o `AdminGuard`.

### O que o banco garantia, com as linhas novas

| Garantia | É |
|---|---|
| Um vídeo por insígnia, sem repetir | ID do documento `{badgeId}__{youtubeId}` |
| Ordem sem buracos e sem empates | Renormalização 0..n-1 em `WriteBatch` atômico |

---

## Mural de Perguntas (spec 010)

Um mural semanal: o membro escolhe uma insígnia, pergunta sobre um tema dela, e os outros votam. A
mais votada da semana ganha um vídeo curto de resposta, que vai morar na trilha daquela insígnia, na
aba de **Perguntas Frequentes**.

### O ciclo é uma conta, não um cron

Existe **um instante de virada, domingo 00:00 no fuso `America/Sao_Paulo`**, e nele três coisas
acontecem juntas: a semana que coletava entra em votação, uma nova abre para perguntas, e a que
estava em votação encerra.

```
        semana N            semana N+1          semana N+2
   |------------------|------------------|------------------|
    perguntas N         votação N          encerrada N
                        perguntas N+1       votação N+1
```

Cada pergunta guarda o `weekId` da semana em que nasceu, e **o estado dela nunca é gravado**: é
derivado na leitura, comparando com o `weekId` de agora. A alternativa era um cron de madrugada de
domingo, e ele custaria um agendador para configurar, um deploy para não esquecer, e — a parte cara —
um estado que pode ficar errado: cron que não roda deixa o mural congelado no domingo passado, sem
erro, sem alarme, e a primeira pessoa a perceber é um aluno.

**Não se vota na semana em coleta.** Se o voto abrisse junto com a pergunta, quem publicasse domingo
de manhã acumularia sete dias de vantagem sobre quem publicasse sábado à noite. Com a votação
atrasada em uma semana, todas as perguntas ficam expostas exatamente o mesmo tempo.

**"Limpas" quer dizer fora do mural, não apagadas.** Pergunta encerrada continua no Firestore e
aparece em `GET /mural/vencedoras`: apagar destruiria o registro de qual venceu e o vínculo com o
vídeo que a respondeu.

### Endpoints

| Método | Rota | Guards | O que faz |
|---|---|---|---|
| `GET` | `/mural` | auth | Estado do ciclo: semanas, virada, `canAsk`, `myQuestionId` |
| `GET` | `/mural/perguntas?fase=` | auth | `coleta` ou `votacao`. Ordena por votos na votação |
| `POST` | `/mural/perguntas` | auth + **tier pago** | Cria. 403 para Dev Tier, 409 se já perguntou |
| `PUT` | `/mural/perguntas/:id` | auth + dono | Reescreve, só na semana em coleta |
| `POST` | `/mural/perguntas/:id/voto` | auth | Vota. Só na semana em votação |
| `DELETE` | `/mural/perguntas/:id/voto` | auth | Desfaz. Idempotente |
| `GET` | `/mural/vencedoras` | auth | Histórico, com as semanas em branco incluídas |
| `DELETE` | `/admin/mural/perguntas/:id` | auth + admin | Modera. Apaga os votos junto |

### Coleção `mural_questions`

**ID do documento: `{weekId}__{uid}`.**

- `weekId` (string) — data do domingo que abre a semana, `YYYY-MM-DD`
- `badgeId` (string) — uma das treze etapas da trilha
- `authorUid`, `authorName` (string) — o nome é **denormalizado**: listar trinta perguntas não pode
  custar trinta leituras de perfil. O preço é o nome ficar velho se a pessoa mudar depois
- `title` (10 a 140), `body` (string ou null, até 1000) — **texto puro**, sem markdown e sem HTML
- `voteCount` (number) — contador denormalizado, mantido por `FieldValue.increment` em lote
- `answerVideoId` (string ou null)
- `createdAt`, `updatedAt` (Timestamp)

O caminho garante **uma pergunta por membro por semana**. O limite é de produto, não técnico: um
mural com trinta perguntas de cinco pessoas é ilegível e a votação se dilui; com uma por pessoa, quem
tem duas dúvidas escolhe a melhor.

### Subcoleção `mural_questions/{id}/votes/{uid}`

**O dado é o caminho.** O documento carrega só `votedAt`; quem votou em quê já está dito pelo
endereço, e é ele que garante **um voto por pessoa por pergunta**.

A escrita é um `WriteBatch` com as duas operações — criar o voto e incrementar o contador. Se o voto
já existe, o `create()` falha e o lote inteiro falha junto: o contador não se mexe. **Nunca
ler-somar-escrever**: duas pessoas votando no mesmo segundo perderiam um voto, e o erro seria
invisível.

> **Subcoleção não desaparece com o pai no Firestore.** A moderação apaga os votos explicitamente,
> ou eles ficam órfãos — invisíveis, cobrados e impossíveis de encontrar depois.

### `tier` no perfil, e o primeiro portão do produto

| Ação | Dev Tier | Great, Ultra e Master |
|---|---|---|
| Ler o mural | sim | sim |
| **Votar** | **sim** | sim |
| Escrever pergunta | não | sim |

Votar é de todo mundo de propósito: é o ato que dá valor ao mural — sem volume de voto, "a mais
votada" não significa nada — e quem vota chega à decisão de assinar tendo visto o produto funcionar.

`profiles` ganha `tier`, editável pelo admin em `PATCH /admin/users/:id`. Isso parece atalho e não é:
**é o desenho fiel do produto de hoje**. Não existe checkout, o pagamento acontece por fora, e se o
pagamento é manual o direito de acesso também é.

Diferente de `role`, **`tier` não é claim**: ele muda com frequência e precisa valer na hora. Uma
claim levaria até uma hora para entrar em vigor, e o membro que acabou de pagar ficaria de fora vendo
o relógio.

> **`tier` é acesso; `grade` é conquista.** Um não se deriva do outro, em nenhuma direção. Quem
> cancelou com seis insígnias continua com seis — o que ele perde é o avanço, não o passado.

### Vídeos com natureza, e a válvula do `devTierFree`

`badge_videos` ganha três campos:

- `kind` (`'aula' | 'resposta'`) — a aba da insígnia. Aula se assiste em ordem; resposta se consulta
  por assunto. Misturadas, a trilha fica com respostas avulsas no meio da sequência
- `questionId` (string ou null) — a pergunta que originou a resposta. Só aceito com `kind: resposta`
- `devTierFree` (boolean) — libera o vídeo para todos, mesmo numa insígnia adiantada

**A ordem passa a ser por `(badgeId, kind)`**, e a renormalização 0..n-1 acontece dentro da aba. Uma
insígnia com três aulas e duas respostas tem duas sequências independentes — renormalizar sem separar
por `kind` embaralha as duas de uma vez, e é o erro mais provável de quem mexer nisso.

**A precedência do `devTierFree` é total**: quando existir gate de conteúdo, ele começa por essa flag
e sai. Existe porque o Mural cria uma armadilha — a melhor pergunta da semana pode ser sobre Angular,
e a resposta nasceria trancada para 90% de quem votou nela.

### Índices compostos que produção exige

O emulador não exige índice, então a suíte passa verde e a falha aparece só em produção, com um link
no erro:

| Coleção | Campos |
|---|---|
| `mural_questions` | `weekId` + `voteCount desc` + `createdAt asc` |
| `mural_questions` | `weekId` + `createdAt asc` |
| `badge_videos` | `badgeId` + `kind` + `order` |
