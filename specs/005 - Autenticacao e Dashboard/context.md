# Spec 005: Autenticação (Supabase Auth) e perfil do membro

## Objetivo
Dar conta de verdade para o membro da Seita Dev: cadastro com confirmação por e-mail, login com
e-mail e senha, sessão renovável e um perfil obrigatório antes de usar o dashboard.

O frontend **nunca fala com o Supabase**. Toda chamada ao Supabase Auth sai deste backend, que
devolve ao front um access token curto no corpo da resposta e o refresh token em cookie `HttpOnly`.

Repositório irmão: `../eduleno-front`, spec `005 - Autenticacao e Dashboard`. As duas andam juntas;
o contrato desta spec é o que o front consome.

---

## Origem e specs afetadas

### A spec 004 proibia `@supabase/supabase-js`. Esta spec reverte isso.
A [spec 004](../004%20-%20Acesso%20Antecipado/context.md) fechou com "Fora de escopo: uso de
`@supabase/supabase-js` (Auth/Storage) em qualquer forma", e o `.env.example` marca
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` como "reservados para uso futuro, não lidos pela API".

**Este é o uso futuro.** A partir desta spec:
- O acesso a **dados de negócio** continua por TypeORM sobre `DATABASE_URL`, como manda o
  `clauderc.md`. Nada muda aí.
- O acesso a **identidade** (criar usuário, enviar e-mail, trocar senha, login, refresh, logout)
  passa por `@supabase/supabase-js`, porque o GoTrue não é uma tabela: é um serviço com endpoints
  próprios, e replicar hash de senha e ciclo de token na mão seria pior em todos os sentidos.

A fronteira é essa e ela é dura: **nenhum service desta spec lê ou escreve `auth.users` por SQL**.

### Nenhuma spec anterior é marcada como Deprecated
A regra 6 do `clauderc.md` manda marcar specs que criaram tabelas alteradas por esta. A tabela
`waitlist_entries` da 004 **não muda**: não ganha coluna, não perde coluna, não muda índice. Esta
spec só a **lê**, para pré-preencher o onboarding. A tabela `profiles` é nova, sem spec anterior.

---

## Decisões tomadas com o usuário (2026-08-14)

### 1. Cadastro não pede senha. A senha nasce pelo e-mail de redefinição.
Confirmado: _"o cadastro exige confirmação por email, dispare o email do supabase de redefinição de
senha para o cadastrante, o login não exige 2FA, apenas email e senha"_.

Então o formulário de cadastro tem **dois campos, ambos e-mail** (o segundo é confirmação). Não há
campo de senha no cadastro. O fluxo completo:

```
1. front  POST /auth/signup { email, emailConfirmation }
2. back   cria o usuário no Supabase Auth (admin, sem e-mail de confirmação próprio)
3. back   dispara o e-mail de RECUPERAÇÃO DE SENHA do Supabase para esse endereço
4. back   responde 202 { status: 'confirmation_sent' }   <- o "aguarda confirmação" do front
5. user   abre o e-mail e clica no link
6. link   leva para FRONTEND_URL/definir-senha?token_hash=...&type=recovery
7. front  POST /auth/password { tokenHash, password, passwordConfirmation }
8. back   verifica o token no Supabase, grava a senha, marca o e-mail como confirmado
9. front  manda o usuário para o login
```

O mesmo endpoint do passo 7 serve para "esqueci minha senha" mais tarde: é o mesmo tipo de token.
Um fluxo, duas portas de entrada.

### 2. Cadastro aberto, com vínculo à lista de espera quando existir
Confirmado: _"Aberto, mas vincula se já estiver na lista"_.

Qualquer e-mail pode criar conta. No momento em que o perfil é criado, o backend procura o e-mail em
`waitlist_entries`; se achar, usa `name` e `phone` daquela linha como **valor inicial** do perfil e
guarda a referência em `profiles.waitlist_entry_id`. O usuário ainda passa pelo onboarding e pode
corrigir tudo: o dado da waitlist é sugestão, não verdade.

Se não achar, o perfil nasce vazio e `waitlist_entry_id` fica `null`. Não é erro, não é aviso.

### 3. Grau é coluna do perfil e começa em 1
Confirmado: _"Coluna no perfil, todo mundo começa no Grau 1"_.

`profiles.grade` é `smallint not null default 1`, com `check (grade between 1 and 33)` (33 é o total
de Graus que a comunidade anuncia, ver `community.service.ts` no front). **Nada nesta spec altera o
grau.** Não existe endpoint de progressão, não existe cálculo. O dashboard só lê. Progressão é spec
futura, e quando ela vier vai marcar esta como Deprecated se mexer na coluna.

---

## Modelo de dados

### Tabela nova: `public.profiles`

| coluna              | tipo          | regra                                                          |
|---------------------|---------------|----------------------------------------------------------------|
| `id`                | `uuid`        | PK, **igual ao `auth.users.id`**, FK com `on delete cascade`     |
| `name`              | `text`        | nulo até o onboarding                                            |
| `phone`             | `text`        | nulo até o onboarding, só dígitos quando preenchido              |
| `bio`               | `text`        | nulo até o onboarding                                            |
| `grade`             | `smallint`    | `not null default 1`, `check (grade between 1 and 33)`           |
| `completed_at`      | `timestamptz` | nulo enquanto o perfil estiver incompleto                        |
| `waitlist_entry_id` | `uuid`        | FK opcional para `waitlist_entries(id)`, `on delete set null`    |
| `created_at`        | `timestamptz` | `not null default now()`                                         |
| `updated_at`        | `timestamptz` | `not null default now()`, atualizado pelo service                |

**`completed_at` é a fonte da verdade do "perfil completo"**, não uma soma de campos não nulos. Um
timestamp responde "quando" além de "se", e blinda contra o caso de alguém limpar a bio depois e o
guard do front voltar a barrar quem já passou pelo onboarding. `profileCompleted` na API é
`completed_at !== null`.

`timestamptz` em toda data, pelo mesmo motivo registrado na migration da 004: `timestamp` sem fuso
seria gravado no fuso da sessão do banco e lido no fuso do processo Node.

### RLS
A tabela nasce com `alter table public.profiles enable row level security` e **nenhuma policy**.
Esta API acessa o Postgres pela `DATABASE_URL` (papel `postgres`), que ignora RLS por natureza,
então nada quebra. O ganho é fechar a porta do PostgREST: sem policy, a `anon key` do Supabase não
lê nem escreve essa tabela, e o front, que segundo a regra desta spec nem deveria tentar, não
consegue nem por acidente.

### Entity TypeORM
`src/auth/entities/profile.entity.ts` mapeia `public.profiles`. A FK para `auth.users` **não é
mapeada como relação**: é apenas `@PrimaryColumn('uuid') id`. TypeORM não enxerga o schema `auth`, e
a integridade é garantida pelo banco através da FK declarada no SQL.

A FK para `waitlist_entries` também fica como coluna `uuid` simples (`waitlist_entry_id`), sem
`@ManyToOne`. Esta spec só precisa gravar o id, nunca navegar a relação, e uma relação mapeada
convidaria a `join` desnecessário.

---

## Contrato da API

Todos os endpoints ficam sob `/auth`, exceto o perfil, sob `/me`. Sem prefixo global `/api`, mantendo
o padrão da 004.

### `POST /auth/signup`
Body: `{ email: string, emailConfirmation: string }`

- `email`: `IsEmail`, trim + lowercase.
- `emailConfirmation`: precisa ser **idêntico ao `email` já normalizado**. A comparação é feita
  depois da normalização, senão ` Fulano@Email.com ` e `fulano@email.com` seriam recusados sendo o
  mesmo endereço. Divergência devolve 400.

Resposta **202** `{ "status": "confirmation_sent" }`.

**Sempre 202, inclusive para e-mail já cadastrado.** Responder 409 para e-mail existente transforma
o endpoint em um oráculo de "quem tem conta aqui". O comportamento interno diverge, a resposta não:

| situação                                  | o que o backend faz                                        |
|-------------------------------------------|-------------------------------------------------------------|
| e-mail novo                               | cria usuário, cria perfil, dispara e-mail de redefinição      |
| e-mail existente e ainda sem senha        | dispara o e-mail de redefinição de novo                       |
| e-mail existente e com senha definida     | dispara o e-mail de redefinição (vira "esqueci minha senha")  |

Rate limit apertado: **3 requisições / 60s por IP** (`@Throttle`). O endpoint dispara e-mail, então
é o mais caro de abusar.

### `POST /auth/password`
Body: `{ tokenHash: string, password: string, passwordConfirmation: string }`

- `password`: mínimo 8 caracteres. Sem exigência de símbolo/maiúscula: comprimento é o que importa,
  e regra decorativa só empurra o usuário para `Senha@123`.
- `passwordConfirmation`: idêntica a `password`, senão 400.
- `tokenHash`: o `token_hash` que veio na URL do e-mail.

O backend chama `verifyOtp({ token_hash, type: 'recovery' })`, recebe uma sessão, e com ela chama
`updateUser({ password })`. Verificar um token de recuperação **também confirma o e-mail** no
GoTrue, que é como o passo de confirmação da conta se resolve sem um segundo e-mail.

Resposta **204**, sem corpo e **sem sessão**: o usuário definiu a senha, agora loga com ela. Isso é
deliberado. Emitir sessão aqui faria de um link de e-mail um login completo, e esse link pode estar
num histórico de navegador ou num e-mail encaminhado.

Erros: `400` token inválido, expirado ou já usado (mensagem genérica, "link inválido ou expirado,
peça um novo"), `400` validação. Rate limit: 5 / 60s.

### `POST /auth/login`
Body: `{ email: string, password: string }`

Chama `signInWithPassword`. Sucesso responde **200**:

```json
{
  "accessToken": "eyJhbGci...",
  "expiresIn": 3600,
  "user": { "id": "uuid", "email": "fulano@email.com" },
  "profileCompleted": false,
  "grade": 1
}
```

E um `Set-Cookie` com o refresh token (detalhes na seção de sessão).

`profileCompleted` e `grade` vêm no login para o front decidir o destino (dashboard ou onboarding)
sem uma segunda ida à rede antes de pintar a primeira tela.

**Erro sempre `401` com a mesma mensagem**, para credencial errada, usuário inexistente e usuário
sem senha definida: `"E-mail ou senha inválidos."` O front não distingue os casos porque o backend
não conta. Rate limit: 5 / 60s.

Se o perfil não existir (conta criada fora do fluxo, direto no painel do Supabase), o login **cria o
perfil** naquele momento, com o mesmo vínculo à waitlist. Ninguém fica com conta sem perfil.

### `POST /auth/refresh`
Sem corpo. Lê o refresh token do cookie. Chama `refreshSession`.

Resposta **200** `{ accessToken, expiresIn, user, profileCompleted, grade }`, mesmo formato do login,
mais um `Set-Cookie` com o refresh token **novo** (o Supabase rotaciona o refresh a cada uso; gravar
o novo é obrigatório, senão a segunda renovação falha).

Erros: `401` cookie ausente, inválido ou expirado, **sempre limpando o cookie na resposta**. Um
cookie que não serve mais não pode continuar no navegador provocando 401 em toda visita.

Rate limit folgado: 30 / 60s. O front chama esse endpoint na abertura do app e a cada expiração.

### `POST /auth/logout`
Sem corpo. Invalida a sessão no Supabase (`signOut` com o refresh token) e responde **204** com
`Set-Cookie` de expiração imediata.

Responde 204 mesmo sem cookie, ou com cookie já inválido. Logout é idempotente: o objetivo é o
estado final "deslogado", e falhar aí só deixaria o usuário preso.

### `GET /me`
Exige `Authorization: Bearer <accessToken>`. Resposta **200**:

```json
{
  "id": "uuid",
  "email": "fulano@email.com",
  "name": "Fulano de Tal",
  "phone": "47999990000",
  "bio": "Estudando back-end.",
  "grade": 1,
  "profileCompleted": true
}
```

Campos ainda não preenchidos vêm `null`. Erros: `401` sem token ou token inválido/expirado.

### `PATCH /me/profile`
Exige `Authorization`. É o endpoint do onboarding obrigatório e também da edição posterior.

| campo   | regra                                                |
|---------|-------------------------------------------------------|
| `name`  | obrigatório, trim + colapso de espaços, 2 a 120        |
| `phone` | obrigatório, 10 ou 11 dígitos após remover não dígitos |
| `bio`   | obrigatório, trim, 10 a 500 caracteres                 |

As três regras de normalização são as **mesmas** do `WaitlistService` da 004 (`name` colapsa espaço,
`phone` vira só dígitos). Isso não é coincidência: as duas tabelas guardam o mesmo tipo de dado do
mesmo tipo de pessoa. A normalização vira um utilitário compartilhado em `src/common/normalize.ts` e
a 004 passa a usá-lo, sem mudar comportamento nem teste.

Na primeira chamada bem-sucedida, `completed_at` recebe `now()`. Nas seguintes, **não é
sobrescrito**: a data do onboarding é histórico, não um "última edição" (esse é o `updated_at`).

Resposta **200** com o mesmo corpo do `GET /me`. Erros: `400` validação, `401` sem token.

### Resumo dos limites

| rota                  | limite         | por quê                                   |
|-----------------------|----------------|--------------------------------------------|
| `POST /auth/signup`   | 3 / 60s        | dispara e-mail, o mais caro de abusar       |
| `POST /auth/password` | 5 / 60s        | adivinhação de token                        |
| `POST /auth/login`    | 5 / 60s        | força bruta de senha                        |
| `POST /auth/refresh`  | 30 / 60s       | chamado pelo app, não pelo usuário          |
| `POST /auth/logout`   | default global | inofensivo                                  |
| `GET /me`             | default global | leitura autenticada                         |
| `PATCH /me/profile`   | 10 / 60s       | escrita autenticada                         |

O default global de 60/60s da 004 continua valendo para o resto.

---

## Sessão: access em memória, refresh em cookie

### O access token
Vai no corpo da resposta, o front guarda **em memória** e nunca em `localStorage`. Memória morre com
o F5, e é justamente por isso que o refresh existe em cookie: o front recupera a sessão na abertura
do app chamando `POST /auth/refresh`.

### O cookie de refresh

| atributo   | valor                                                | motivo                                                   |
|------------|------------------------------------------------------|-----------------------------------------------------------|
| nome       | `eduleno_rt`                                          | prefixo próprio, não colide com cookie do Supabase        |
| `HttpOnly` | sempre                                                | JS da página não lê, então XSS não rouba a sessão longa   |
| `Secure`   | ligado fora de dev (`AUTH_COOKIE_SECURE`)             | em `http://localhost` o navegador recusaria `Secure`      |
| `SameSite` | `lax` em dev, `none` em produção (`AUTH_COOKIE_SAMESITE`) | em produção front e API estão em domínios diferentes |
| `Path`     | `/auth`                                               | só as rotas que precisam dele recebem o cookie            |
| `Max-Age`  | 30 dias (`AUTH_COOKIE_MAX_AGE_DAYS`)                  | prazo do refresh do Supabase                              |

`SameSite=None` exige `Secure`, e as duas coisas juntas exigem HTTPS. Em dev, front e API são ambos
`localhost` (mesmo site, portas diferentes), então `lax` funciona e `Secure` pode ficar desligado.
Os dois atributos vêm de env justamente para não haver `if (NODE_ENV)` espalhado.

### CORS muda em relação à 004
A 004 configurou CORS **sem** `credentials`, porque o endpoint era anônimo. Agora o navegador
precisa enviar o cookie, então:

- `credentials: true` no `enableCors`.
- A lista de origens continua vindo de `FRONTEND_URL`, **nunca `origin: true`**. Com credenciais
  ligadas, refletir a origem do requisitante seria abrir a API para qualquer site.
- `methods` passa a incluir `GET`, `POST`, `PATCH`, `OPTIONS`.
- `exposedHeaders` não precisa de nada: o token vai no corpo.

### CSRF
Com `SameSite=None`, um site terceiro consegue **disparar** `POST /auth/refresh` com o cookie do
usuário. Ele **não consegue ler** a resposta (o CORS só libera a origem do front), então o access
token não vaza. O estrago possível é rotacionar o refresh do usuário, que a resposta do próprio
front corrige na chamada seguinte, e disparar `POST /auth/logout` alheio, que é chateação e não
brecha.

Decisão: **não entra double-submit token nesta spec.** Fica registrado aqui como consciente, com o
gatilho para revisar: no dia em que existir uma rota autenticada que **altera dado** e aceite
credencial por cookie em vez de `Authorization`. Hoje toda escrita depende do header, que um site
terceiro não consegue forjar.

---

## Verificação do token nas rotas protegidas

`SupabaseAuthGuard` em `src/auth/guards/supabase-auth.guard.ts`, aplicado por `@UseGuards` nas rotas
de `/me` (não global: as rotas públicas de `/auth` e o `POST /waitlist` da 004 continuam anônimas).

O guard **verifica o JWT localmente**, com `jose`, e não chama `supabase.auth.getUser()`. Chamar o
GoTrue a cada requisição colocaria uma ida à rede no caminho de toda leitura e faria a API cair
junto com o Auth. Verificação local é assinatura, `exp`, `aud` e `iss`, tudo em memória.

- Projeto com chave assimétrica (padrão atual): `createRemoteJWKSet` contra
  `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, com cache do `jose`.
- Projeto ainda no segredo legado HS256: `SUPABASE_JWT_SECRET`.

O guard escolhe pelo que estiver configurado no `.env`, e **falha no boot** se nenhum dos dois
estiver presente, no mesmo espírito da validação de env da 004.

Do payload validado sai `sub` (id do usuário) e `email`, anexados em `request.user`. Um decorator
`@CurrentUser()` entrega isso ao controller sem ninguém tocar em `request` diretamente.

O guard **não vai ao banco**. Quem precisa do perfil é o service, pelo id que o guard extraiu.

---

## Camadas

```
src/
  common/
    normalize.ts                      # trim/colapso de nome, dígitos do telefone, lowercase do e-mail
    normalize.spec.ts
  auth/
    auth.module.ts
    auth.controller.ts                # /auth/*
    auth.service.ts                   # orquestra Supabase + perfil
    supabase.service.ts               # único ponto que instancia @supabase/supabase-js
    cookie.service.ts                 # monta e limpa o cookie de refresh
    guards/
      supabase-auth.guard.ts
    decorators/
      current-user.decorator.ts
    dto/
      signup.dto.ts
      set-password.dto.ts
      login.dto.ts
      session.dto.ts                  # resposta de login/refresh
  profile/
    profile.module.ts
    profile.controller.ts             # /me
    profile.service.ts
    profile.repository.ts             # { found, entry }, nunca null solto
    dto/
      update-profile.dto.ts
      profile.dto.ts
    entities/
      profile.entity.ts
supabase/migrations/
  <timestamp>_create_profiles.sql
```

### Dois clientes Supabase, papéis separados
`SupabaseService` expõe exatamente dois:

- **admin** (`SUPABASE_SERVICE_ROLE_KEY`): criar usuário, gerar link de recuperação. A service role
  ignora RLS e é uma chave de administrador, então **fica confinada a este arquivo**, nunca é
  injetada em controller e nunca aparece em log.
- **público** (`SUPABASE_ANON_KEY`): login, refresh, `verifyOtp`, `updateUser`, `signOut`. São
  operações que representam o usuário, não o administrador, e usar a service role nelas seria
  privilégio desnecessário no caminho quente.

Cada chamada que cria sessão usa um cliente com `persistSession: false` e `autoRefreshToken: false`:
o backend é sem estado, quem guarda sessão é o navegador do usuário.

### "Repositories sempre devolvem objeto"
Mesma regra da 004:

```ts
findById(id: string): Promise<{ found: boolean; entry: Profile | null }>
findByEmailOnWaitlist(email: string): Promise<{ found: boolean; entry: WaitlistEntry | null }>
create(data: NewProfile): Promise<{ entry: Profile }>
update(id: string, data: ProfilePatch): Promise<{ entry: Profile }>
```

`findByEmailOnWaitlist` **reaproveita o `WaitlistRepository` da 004** em vez de duplicar a consulta.
O `WaitlistModule` passa a exportar seu repository; nada mais muda lá.

---

## Configuração no painel do Supabase (não é código, mas a spec depende)

1. **Template de e-mail "Reset Password"** precisa apontar para o front com `token_hash`, e não com
   o link padrão que devolve tokens na URL:
   ```
   {{ .SiteURL }}/definir-senha?token_hash={{ .TokenHash }}&type=recovery
   ```
   O padrão do Supabase manda um link que o `supabase-js` do **cliente** interpreta. Como o front
   desta spec não tem `supabase-js`, o `token_hash` é o formato que ele consegue simplesmente repassar
   ao backend.
2. **Site URL** e **Redirect URLs** com a origem do front (dev e produção).
3. **Confirm email** pode ficar ligado; o fluxo não depende dele, porque a verificação do token de
   recuperação já confirma o e-mail.

Fica documentado no `README.md`, porque é ambiente e não sobrevive em nenhum arquivo do repositório.

### Risco verificado e comprovado no projeto real (Fase 01)
O fluxo foi testado e validado diretamente contra o Supabase do projeto:
1. Usuário criado sem confirmação (`email_confirm: false`).
2. Geração e envio do token de recuperação (`type: 'recovery'`).
3. Verificação do OTP (`verifyOtp({ token_hash, type: 'recovery' })`) e atualização de senha (`updateUser({ password })`).
4. O Supabase GoTrue confirma automaticamente o e-mail (`email_confirmed_at` preenchido) e o usuário consegue logar normalmente com a nova senha.

Portanto, o desenho principal está confirmado e o plano B não é necessário.

---

## Variáveis de ambiente

`.env.example` ganha:

```
# Supabase Auth (spec 005). Deixam de ser "reservado para uso futuro".
SUPABASE_URL="https://seu-id.supabase.co"
SUPABASE_ANON_KEY="sua-chave-anon"
SUPABASE_SERVICE_ROLE_KEY="sua-chave-service-role"

# Verificacao local do JWT. Projeto novo usa JWKS (derivado de SUPABASE_URL);
# projeto legado usa o segredo HS256. Um dos dois precisa existir.
# SUPABASE_JWT_SECRET="segredo-legado-hs256"

# Cookie do refresh token
AUTH_COOKIE_SECURE=false          # true em producao (exigido por SameSite=None)
AUTH_COOKIE_SAMESITE=lax          # none em producao, front e API em dominios diferentes
AUTH_COOKIE_MAX_AGE_DAYS=30
```

`env.validation.ts` passa a exigir `SUPABASE_URL`, `SUPABASE_ANON_KEY` e
`SUPABASE_SERVICE_ROLE_KEY`. A aplicação falha no boot sem eles, como já falha sem `DATABASE_URL`.

O comentário do `.env.example` que diz "Reserved for future use (not currently read by API)"
**sai**, porque virou mentira.

---

## Testes (TDD, regra 6 do clauderc)

Testes escritos **antes** da lógica dos services.

### `src/auth/auth.service.spec.ts` (Supabase e repository mockados)
1. e-mail novo: cria usuário no Supabase, cria perfil, dispara recuperação, devolve
   `confirmation_sent`.
2. e-mail já cadastrado: **não** cria usuário, dispara recuperação, devolve `confirmation_sent` (a
   resposta não distingue).
3. e-mail e confirmação diferentes: `BadRequestException`, sem tocar no Supabase.
4. normaliza o e-mail antes de comparar (` Fulano@Email.COM ` e `fulano@email.com` são o mesmo).
5. signup com e-mail presente na waitlist: perfil nasce com `name`/`phone` da entrada e
   `waitlist_entry_id` preenchido.
6. signup com e-mail fora da waitlist: perfil nasce vazio, `waitlist_entry_id` nulo.
7. `setPassword` com token válido: verifica, atualiza a senha, **não** devolve sessão.
8. `setPassword` com token inválido: `BadRequestException` com mensagem genérica, sem vazar a
   mensagem do GoTrue.
9. `setPassword` com senhas divergentes: `BadRequestException`, sem tocar no Supabase.
10. login válido: devolve access, refresh, `profileCompleted` e `grade` do perfil.
11. login inválido: `UnauthorizedException` com a **mesma** mensagem para senha errada e usuário
    inexistente.
12. login de usuário sem perfil: cria o perfil na hora e devolve `profileCompleted: false`.
13. refresh válido: devolve access novo **e refresh novo** (rotação).
14. refresh inválido: `UnauthorizedException`.
15. logout sem cookie: resolve sem erro (idempotente).

### `src/profile/profile.service.spec.ts`
1. `PATCH` normaliza nome, telefone e bio antes de gravar.
2. primeira atualização preenche `completed_at`.
3. atualização seguinte **não** sobrescreve `completed_at`, mas mexe em `updated_at`.
4. `bio` curta demais ou longa demais: `BadRequestException`.
5. perfil inexistente: `NotFoundException`.
6. `grade` **não** é alterável por este endpoint, mesmo que venha no corpo (o `whitelist` do
   `ValidationPipe` já derruba, e o teste garante que continue assim).

### `src/auth/guards/supabase-auth.guard.spec.ts`
1. token válido: passa e popula `request.user` com `sub` e `email`.
2. sem header `Authorization`: 401.
3. token expirado: 401.
4. token com assinatura de outra chave: 401.

### `src/common/normalize.spec.ts`
Casos migrados do `waitlist.service.spec.ts`, provando que extrair o utilitário não mudou nada.

### `test/auth.e2e-spec.ts`
- `POST /auth/signup` válido devolve 202.
- e-mail e confirmação divergentes devolvem 400.
- `POST /auth/login` com credencial errada devolve 401.
- `GET /me` sem token devolve 401.
- Ciclo completo com usuário de teste real: login, `Set-Cookie` presente com `HttpOnly`,
  `GET /me` com o token, `PATCH /me/profile`, `GET /me` refletindo o perfil completo.

Lembrete do `CLAUDE.md`: as duas configs de Jest são separadas. Unit em `src/`, e2e em `test/`.

---

## Documentação (regra 4 do clauderc)
O `README.md` ganha seção de autenticação com: as variáveis novas, a configuração do template de
e-mail no painel, a tabela `profiles`, os sete endpoints com corpo e erros, o desenho de sessão
(access em memória, refresh em cookie) e o aviso de que a service role só existe dentro de
`SupabaseService`.

---

## Fora de escopo
- Progressão de Grau: nenhum endpoint altera `grade` nesta spec.
- Trilha, jogos e ranking. O front vai ter botões para eles, inertes.
- Login social (Google, GitHub) e 2FA. Confirmado com o usuário: login é e-mail e senha, sem 2FA.
- Alteração de e-mail da conta e exclusão de conta.
- Upload de avatar (exigiria Supabase Storage).
- Painel administrativo, listagem de membros, qualquer leitura de `profiles` por terceiro.
- Envio de e-mail próprio (SMTP customizado). Quem envia é o Supabase, com os templates dele.
- CSRF token de double submit, pelos motivos registrados na seção de sessão.
