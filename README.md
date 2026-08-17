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
- `grade` (number, 0 a 13, default 0 — ver spec 008: 1 a 8 são insígnias, 9 a 12 a Elite Four, 13 o pós-game)
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
- Resposta: `200` `{ accessToken, expiresIn, user: { id, email }, profileCompleted, grade }` + Cookie `eduleno_rt`
- Rate limit: 5 req / 60s

### `POST /auth/refresh`
- Entrada: Leitura automática do cookie `eduleno_rt`
- Resposta: `200` `{ accessToken, expiresIn, user: { id, email }, profileCompleted, grade }` + Cookie `eduleno_rt` rotacionado
- Rate limit: 30 req / 60s

### `POST /auth/logout`
- Entrada: Leitura do cookie `eduleno_rt`
- Resposta: `204 No Content` + Cookie `eduleno_rt` limpo (idempotente)
- Comportamento: a sessão é carregada a partir do refresh token do próprio cookie antes de ser
  revogada no Supabase, com escopo `local` (derruba só esta sessão, não os outros dispositivos).
  Cookie ausente, expirado ou forjado não revoga nada e ainda responde `204`.

### `GET /me`
- Header: `Authorization: Bearer <accessToken>`
- Resposta: `200` `{ id, email, name, phone, bio, grade, profileCompleted }`

### `PATCH /me/profile`
- Header: `Authorization: Bearer <accessToken>`
- Entrada: `{ name, phone, bio }`
- Resposta: `200` `{ id, email, name, phone, bio, grade, profileCompleted }`
- Comportamento: Preenche `completed_at` na primeira execução e não sobrescreve nas seguintes.
- Rate limit: 10 req / 60s
