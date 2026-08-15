# Eduleno Backend API

API para o serviço da Seita Dev (eduleno-back).

## Funcionalidades
- Endpoint para lista de espera (`POST /waitlist`)
- Autenticação com Supabase Auth (`/auth/*`): cadastro com confirmação de e-mail por redefinição de senha, login com e-mail/senha, renovação de sessão e logout
- Gestão de perfil e onboarding do membro (`/me` e `/me/profile`) com autenticação local de JWT
- Sessão segura: access token em memória e refresh token em cookie `HttpOnly` rotacionado
- Integração com Supabase (PostgreSQL): TypeORM para persistência de dados de negócio, Supabase CLI para migrations de schema
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

# Conexão com o banco (PostgreSQL / Supabase), usada pelo TypeORM em runtime
DATABASE_URL="postgresql://postgres:<senha>@<host>:5432/postgres"

# TLS do banco
DATABASE_SSL_CA_PATH="./certs/prod-ca.crt"
# DATABASE_SSL_REJECT_UNAUTHORIZED=false

# Supabase Auth (spec 005)
SUPABASE_URL="https://seu-id.supabase.co"
SUPABASE_ANON_KEY="sua-chave-anon"
SUPABASE_SERVICE_ROLE_KEY="sua-chave-service-role"

# Verificação local do JWT (JWKS derivado de SUPABASE_URL ou segredo HS256 legado)
# SUPABASE_JWT_SECRET="segredo-legado-hs256"

# Cookie do refresh token
AUTH_COOKIE_SECURE=false          # true em produção (exigido por SameSite=None)
AUTH_COOKIE_SAMESITE=lax          # none em produção (front e API em domínios distintos)
AUTH_COOKIE_MAX_AGE_DAYS=30
```

## Configuração do Supabase Auth

**A fonte é o `supabase/config.toml`, não o painel.** Template do e-mail de recuperação, Site URL e
Redirect URLs vivem no repositório e são aplicados por:

```bash
supabase config push
```

Editar esses valores no painel funciona, mas o próximo `config push` desfaz. Mude no arquivo.

### O que está no repositório

| Onde | O quê |
|---|---|
| `supabase/config.toml`, `[auth]` | `site_url` e `additional_redirect_urls` |
| `supabase/config.toml`, `[auth.email.template.recovery]` | assunto e caminho do template |
| `supabase/templates/recovery.html` | o corpo do e-mail |

O link do e-mail usa `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`. **Não use
`{{ .SiteURL }}`**: ele renderiza a configuração do projeto, não o destino que o
`resetPasswordForEmail` passou. Como Site URL é campo único e este projeto hospedado atende dev e
produção ao mesmo tempo, `{{ .SiteURL }}` só conseguiria servir um dos dois ambientes.

O `token_hash` precisa chegar na query, e não no fragmento, porque o front não tem `supabase-js`
para interpretar o formato padrão: ele só repassa o token para esta API.

As `Redirect URLs` são obrigatórias. O backend passa `redirectTo: FRONTEND_URL + '/definir-senha'`, e
o GoTrue só honra esse destino se ele estiver na allow-list. Fora dela o valor é descartado em
silêncio e o link cai no `Site URL`.

### Antes de rodar o push

`config push` escreve a seção `[auth]` **inteira** no projeto hospedado, não só as chaves que você
mudou, e o CLI não tem `config pull` nem `config diff` para comparar antes. Revise o diff do arquivo
e confira no painel as chaves que nenhuma leitura externa alcança (`jwt_expiry`, `otp_expiry`).
O inventário completo está na [spec 006](specs/006%20-%20Configuracao%20de%20Auth%20como%20Codigo/context.md).

## Banco de Dados e Migrations

O schema pertence ao **Supabase**, não ao TypeORM. As migrations são arquivos SQL versionados em `supabase/migrations/` e aplicadas pelo Supabase CLI. O TypeORM roda sempre com `synchronize: false` e nunca gera nem aplica migration: ele só mapeia e consulta.

```bash
npx supabase login                 # uma vez por máquina
npx supabase link --project-ref <ref>

npm run migration:new <nome>       # cria supabase/migrations/<timestamp>_<nome>.sql
npm run migration:list             # compara local com o remoto
npm run migration:push             # aplica as pendentes
```

### Tabela `waitlist_entries` (spec 004)
- `id` (uuid, Primary Key, default `gen_random_uuid()`)
- `name` (varchar, Not Null)
- `phone` (varchar, Not Null)
- `email` (varchar, Not Null, Unique)
- `consent` (boolean, Not Null)
- `created_at` (timestamptz, Not Null, default `now()`)

### Tabela `profiles` (spec 005)
- `id` (uuid, Primary Key, FK para `auth.users(id)` com `on delete cascade`)
- `name` (text, nulo até o onboarding)
- `phone` (text, nulo até o onboarding, somente dígitos)
- `bio` (text, nulo até o onboarding)
- `grade` (smallint, Not Null default 1, `check (grade between 1 and 33)`)
- `completed_at` (timestamptz, preenchido na primeira atualização do onboarding)
- `waitlist_entry_id` (uuid, FK opcional para `waitlist_entries(id)` com `on delete set null`)
- `created_at` (timestamptz, Not Null, default `now()`)
- `updated_at` (timestamptz, Not Null, default `now()`)

*RLS:* A tabela `profiles` possui Row Level Security (RLS) habilitada sem policies. Isso bloqueia acesso direto do cliente via PostgREST ou anon key; a API acessa os dados diretamente através da `DATABASE_URL`.

## Arquitetura de Sessão e Segurança

- **Identidade vs Dados de Negócio**: Identidade (criação de usuários, login, envio de e-mails, tokens) é gerenciada via Supabase Auth (`@supabase/supabase-js`). Dados de negócio continuam sob TypeORM. A service role key fica confinada exclusivamente ao `SupabaseService`.
- **Tokens de Sessão**:
  - **Access Token**: Enviado no corpo JSON da resposta (`SessionResponseDto`) para ser mantido em memória no frontend.
  - **Refresh Token**: Gravado em cookie HTTP seguro (`eduleno_rt`) com flags `HttpOnly`, `Path=/auth`, `SameSite` e `Secure` configuráveis por variáveis de ambiente. `AUTH_COOKIE_SAMESITE` aceita só `lax`, `strict` ou `none`, e `AUTH_COOKIE_SECURE` só `true` ou `false`. A combinação `none` sem `true` **derruba a aplicação no boot**: o navegador descarta cookie `SameSite=None` sem `Secure`, e sem essa checagem o login responderia `200` enquanto a sessão nunca persistiria, sem erro em log nenhum.
  - **Rotação de Refresh**: A cada chamada a `POST /auth/refresh`, o Supabase rotaciona o refresh token e a API emite o novo cookie. No caso de refresh inválido (401), o cookie é limpo imediatamente.
- **Autenticação Local**: Rotas sob `/me` são protegidas pelo `SupabaseAuthGuard`, que valida o JWT localmente com `jose` (usando JWKS remoto com cache ou segredo HS256) sem fazer requisições de rede ao GoTrue a cada chamada. A verificação exige assinatura, expiração, `aud` igual a `authenticated`, `iss` igual a `SUPABASE_URL + /auth/v1` (ou `SUPABASE_JWT_ISSUER`, se definido) e `role` igual a `authenticated`. Checar só a assinatura deixaria passar qualquer JWT emitido com a mesma chave, incluindo a `anon key`, que é pública e circula no bundle do frontend.

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

### `POST /auth/password`
- Entrada: `{ tokenHash, password, passwordConfirmation }`
- Resposta: `204 No Content` (sem sessão no corpo)
- Comportamento: Valida OTP no Supabase, grava a senha e confirma o e-mail da conta.
- Rate limit: 5 req / 60s

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
