# Fase 01: Prova do fluxo de e-mail no projeto real [x]
Branch: `feat/005-prova-do-fluxo`

Esta fase vem **antes** de qualquer código de produção de propósito. Todo o desenho da spec depende
de duas suposições sobre o GoTrue que só o projeto real responde: se ele envia recuperação de senha
para usuário ainda não confirmado, e se verificar esse token confirma o e-mail. Descobrir isso
depois de três fases construídas custaria as três.

- [x] Task 01: Configurar o template de e-mail no painel do Supabase. Local: painel do Supabase,
  Authentication > Email Templates > Reset Password. Objetivo: o corpo apontar para
  `{{ .SiteURL }}/definir-senha?token_hash={{ .TokenHash }}&type=recovery`, para o token chegar na
  query e não no fragmento, já que o front não tem `supabase-js` para interpretar o formato padrão.
- [x] Task 02: Registrar Site URL e Redirect URLs. Local: painel do Supabase, Authentication > URL
  Configuration. Objetivo: `http://localhost:4200` e a origem de produção liberadas, senão o link do
  e-mail é recusado no redirecionamento.
- [x] Task 03: Escrever um script descartável de prova. Arquivo:
  `scratch/prova-fluxo-recovery.ts` (não versionado, apagado ao fim da fase). Objetivo: com a
  service role, criar um usuário com `email_confirm: false`, disparar `resetPasswordForEmail` e
  imprimir o resultado, provando que o e-mail sai para usuário não confirmado.
- [x] Task 04: Verificar o token recebido e conferir a confirmação do e-mail. Arquivo: mesmo script.
  Objetivo: rodar `verifyOtp({ token_hash, type: 'recovery' })` seguido de `updateUser({ password })`
  e conferir no painel que `email_confirmed_at` deixou de ser nulo. É esta task que decide se o
  desenho principal vale ou se entra o plano B.
- [x] Task 05: Registrar o resultado no `context.md`. Arquivo:
  `specs/005 - Autenticacao e Dashboard/context.md`, seção "Risco conhecido, com plano B". Objetivo:
  substituir o risco em aberto pelo que de fato acontece; se o plano B for necessário, marcar a
  alteração de escopo no topo do arquivo conforme a regra 5 do clauderc, e trocar as tasks da Fase 04
  que citam `resetPasswordForEmail` por `inviteUserByEmail`.
- [x] Task 06: Apagar o script de prova. Arquivo: `scratch/`. Objetivo: não deixar código com service
  role solto no repositório; o conhecimento fica no `context.md`, não no `.ts`.

# Fase 02: Fundação (dependências, env, cliente Supabase, globais) []
Branch: `feat/005-fundacao`

- [x] Task 01: Instalar dependências. Arquivo: `package.json`. Objetivo: `@supabase/supabase-js` para
  identidade, `jose` para verificar o JWT localmente e `cookie-parser` (mais `@types/cookie-parser`)
  para ler o refresh token do cookie.
- [] Task 02: Documentar as variáveis novas. Arquivos: `.env.example`, `.env`. Objetivo: acrescentar
  `SUPABASE_ANON_KEY`, `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAMESITE`, `AUTH_COOKIE_MAX_AGE_DAYS` e o
  `SUPABASE_JWT_SECRET` opcional, e **remover** o comentário "Reserved for future use (not currently
  read by API)" de `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, que passou a ser mentira.
- [] Task 03: Exigir as variáveis no boot. Arquivo: `src/config/env.validation.ts`. Objetivo:
  `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` como obrigatórias, e as de cookie
  como opcionais com default, para a aplicação falhar ao subir em vez de na primeira requisição.
- [] Task 04: Extrair a normalização compartilhada. Arquivos: `src/common/normalize.ts` e
  `src/common/normalize.spec.ts`. Objetivo: mover trim com colapso de espaços do nome, dígitos do
  telefone e lowercase do e-mail para um único lugar, com os casos de teste migrados do
  `waitlist.service.spec.ts`.
- [] Task 05: Passar o `WaitlistService` a usar o utilitário. Arquivos:
  `src/waitlist/waitlist.service.ts`, `src/waitlist/waitlist.service.spec.ts`. Objetivo: remover a
  normalização duplicada sem alterar comportamento; a suíte da spec 004 continua verde sem edição de
  expectativa.
- [] Task 06: Exportar o `WaitlistRepository`. Arquivo: `src/waitlist/waitlist.module.ts`. Objetivo:
  permitir que o perfil consulte a lista de espera pelo repository existente, em vez de duplicar a
  consulta em outro módulo.
- [] Task 07: Criar o `SupabaseService`. Arquivo: `src/auth/supabase.service.ts`. Objetivo: único
  ponto do projeto que instancia `@supabase/supabase-js`, expondo dois clientes com papéis separados
  (admin com service role, público com anon key), ambos com `persistSession: false` e
  `autoRefreshToken: false`, porque o backend é sem estado.
- [] Task 08: Registrar o `cookie-parser` e ampliar o CORS. Arquivo: `src/main.ts`. Objetivo: ler
  cookies no pipeline, ligar `credentials: true` no CORS (a spec 004 não tinha) e incluir `PATCH` nos
  métodos, mantendo a lista de origens vinda de `FRONTEND_URL` e nunca `origin: true`, que com
  credenciais abriria a API para qualquer site.

# Fase 03: Modelo de dados do perfil []
Branch: `feat/005-modelo-de-dados`

- [] Task 01: Criar a migration da tabela. Arquivo:
  `supabase/migrations/<timestamp>_create_profiles.sql`, gerado por `npm run migration:new
  create_profiles`. Objetivo: criar `public.profiles` com `id` uuid PK referenciando
  `auth.users(id) on delete cascade`, `name`, `phone`, `bio`, `grade smallint not null default 1
  check (grade between 1 and 33)`, `completed_at`, `waitlist_entry_id` com FK opcional para
  `waitlist_entries(id) on delete set null`, e `created_at`/`updated_at` em `timestamptz`.
- [] Task 02: Ligar RLS sem policy na mesma migration. Arquivo: mesma migration da Task 01.
  Objetivo: `enable row level security` sem nenhuma policy, fechando a tabela para o PostgREST e a
  chave anon; a API acessa pela `DATABASE_URL`, que ignora RLS, então nada quebra.
- [] Task 03: Aplicar a migration. Comando: `npm run migration:push`. Objetivo: conferir no painel
  que a tabela existe com as duas FKs e o check do grau, antes de qualquer código depender disso.
- [] Task 04: Criar a entity. Arquivo: `src/auth/entities/profile.entity.ts`. Objetivo: mapear
  `public.profiles` com `@PrimaryColumn('uuid') id`, sem relação para `auth.users` (o TypeORM não
  enxerga o schema `auth`) e com `waitlist_entry_id` como coluna uuid simples, sem `@ManyToOne`, já
  que esta spec grava o id e nunca navega a relação.
- [] Task 05: Criar o repository. Arquivo: `src/profile/profile.repository.ts`. Objetivo: único ponto
  que toca o TypeORM para perfis, com `findById` devolvendo `{ found, entry }`, e `create` e `update`
  devolvendo `{ entry }`, conforme a regra do clauderc de nunca devolver `null` solto.
- [] Task 06: Criar o `ProfileModule`. Arquivo: `src/profile/profile.module.ts`, importado em
  `src/app.module.ts`. Objetivo: registrar entity e repository no container e importar o
  `WaitlistModule` para alcançar o repository exportado na Fase 02.

# Fase 04: Cadastro e definição de senha (TDD) []
Branch: `feat/005-cadastro`

- [] Task 01: Criar os DTOs de entrada. Arquivos: `src/auth/dto/signup.dto.ts` e
  `src/auth/dto/set-password.dto.ts`. Objetivo: validar `email` com `IsEmail`, `emailConfirmation`,
  `tokenHash` obrigatório e `password` com mínimo de 8 caracteres, sem exigência de símbolo ou
  maiúscula, porque regra decorativa só empurra o usuário para `Senha@123`.
- [] Task 02 (TDD): Escrever a spec do cadastro **antes** da lógica. Arquivo:
  `src/auth/auth.service.spec.ts`. Objetivo: cobrir os casos 1 a 6 e 9 do `context.md` — e-mail novo,
  e-mail já cadastrado devolvendo a mesma resposta, confirmação divergente, normalização antes da
  comparação, vínculo com a lista de espera e ausência de vínculo.
- [] Task 03: Implementar `signup` no `AuthService`. Arquivo: `src/auth/auth.service.ts`. Objetivo:
  normalizar e comparar os e-mails, criar o usuário pelo cliente admin, criar o perfil aproveitando
  `name` e `phone` da waitlist quando o e-mail estiver lá, e disparar o e-mail de redefinição.
- [] Task 04: Garantir a resposta idêntica para e-mail existente. Arquivo:
  `src/auth/auth.service.ts`. Objetivo: e-mail já cadastrado dispara a redefinição e devolve o mesmo
  `202 { status: 'confirmation_sent' }`, porque responder 409 transformaria o endpoint em um oráculo
  de quem tem conta.
- [] Task 05 (TDD): Escrever a spec da definição de senha. Arquivo:
  `src/auth/auth.service.spec.ts`. Objetivo: cobrir os casos 7 a 9 — token válido atualizando a senha
  sem devolver sessão, token inválido com mensagem genérica sem vazar o texto do GoTrue, e senhas
  divergentes barradas sem tocar no Supabase.
- [] Task 06: Implementar `setPassword`. Arquivo: `src/auth/auth.service.ts`. Objetivo:
  `verifyOtp({ type: 'recovery' })` seguido de `updateUser({ password })` pelo cliente público, sem
  emitir sessão, para que um link de e-mail não valha por um login completo.
- [] Task 07: Criar o controller com as duas rotas. Arquivo: `src/auth/auth.controller.ts`.
  Objetivo: `POST /auth/signup` respondendo 202 e `POST /auth/password` respondendo 204 sem corpo.
- [] Task 08: Criar o `AuthModule`. Arquivos: `src/auth/auth.module.ts` e `src/app.module.ts`.
  Objetivo: registrar `SupabaseService`, `AuthService` e o controller, importando o `ProfileModule`
  para alcançar o repository de perfis.

# Fase 05: Login, refresh e logout (TDD) []
Branch: `feat/005-sessao`

- [] Task 01: Criar os DTOs de sessão. Arquivos: `src/auth/dto/login.dto.ts` e
  `src/auth/dto/session.dto.ts`. Objetivo: validar as credenciais e fixar o contrato de saída
  `{ accessToken, expiresIn, user, profileCompleted, grade }`, que é o mesmo no login e no refresh.
- [] Task 02: Criar o `CookieService`. Arquivo: `src/auth/cookie.service.ts`. Objetivo: um único
  lugar que monta e limpa o cookie `eduleno_rt`, lendo `HttpOnly`, `Secure`, `SameSite`, `Path=/auth`
  e `Max-Age` das variáveis de ambiente, para não haver `if (NODE_ENV)` espalhado pelo código.
- [] Task 03 (TDD): Escrever a spec de login. Arquivo: `src/auth/auth.service.spec.ts`. Objetivo:
  cobrir os casos 10 a 12 — login válido devolvendo `profileCompleted` e `grade`, credencial errada e
  usuário inexistente com a **mesma** mensagem, e login de usuário sem perfil criando o perfil na
  hora.
- [] Task 04: Implementar `login`. Arquivo: `src/auth/auth.service.ts`. Objetivo:
  `signInWithPassword` pelo cliente público, buscar ou criar o perfil, e devolver a sessão junto do
  estado do perfil, para o front decidir o destino sem uma segunda ida à rede.
- [] Task 05 (TDD): Escrever a spec de refresh e logout. Arquivo: `src/auth/auth.service.spec.ts`.
  Objetivo: cobrir os casos 13 a 15 — refresh válido devolvendo access **e refresh novos**, refresh
  inválido em 401, e logout sem cookie resolvendo sem erro.
- [] Task 06: Implementar `refresh` e `logout`. Arquivo: `src/auth/auth.service.ts`. Objetivo:
  `refreshSession` propagando o refresh rotacionado, já que sem gravar o novo a segunda renovação
  falharia, e `signOut` idempotente.
- [] Task 07: Ligar as três rotas ao cookie. Arquivo: `src/auth/auth.controller.ts`. Objetivo:
  `POST /auth/login` e `POST /auth/refresh` gravando o cookie e devolvendo 200, `POST /auth/logout`
  limpando e devolvendo 204, e o refresh **limpando o cookie também no 401**, para um cookie inútil
  não provocar erro em toda visita.

# Fase 06: Rotas autenticadas e perfil (TDD) []
Branch: `feat/005-perfil`

- [] Task 01 (TDD): Escrever a spec do guard **antes** do guard. Arquivo:
  `src/auth/guards/supabase-auth.guard.spec.ts`. Objetivo: token válido populando `request.user`, e
  401 para header ausente, token expirado e assinatura de outra chave.
- [] Task 02: Implementar o `SupabaseAuthGuard`. Arquivo:
  `src/auth/guards/supabase-auth.guard.ts`. Objetivo: verificar o JWT localmente com `jose`, por JWKS
  do projeto ou pelo segredo HS256 legado, sem chamar `getUser()` a cada requisição, que colocaria
  uma ida à rede no caminho de toda leitura e derrubaria a API junto com o Auth.
- [] Task 03: Criar o decorator do usuário. Arquivo:
  `src/auth/decorators/current-user.decorator.ts`. Objetivo: entregar `{ id, email }` ao controller
  sem ninguém tocar em `request` diretamente.
- [] Task 04: Criar os DTOs do perfil. Arquivos: `src/profile/dto/update-profile.dto.ts` e
  `src/profile/dto/profile.dto.ts`. Objetivo: validar `name` de 2 a 120, `phone` com 10 ou 11 dígitos
  após limpar não dígitos e `bio` de 10 a 500, e fixar a saída com `grade` e `profileCompleted`.
- [] Task 05 (TDD): Escrever a spec do `ProfileService`. Arquivo:
  `src/profile/profile.service.spec.ts`. Objetivo: cobrir os 6 casos do `context.md` — normalização,
  `completed_at` preenchido na primeira atualização e **não** sobrescrito nas seguintes, bio fora dos
  limites, perfil inexistente e `grade` não alterável por este endpoint.
- [] Task 06: Implementar o `ProfileService`. Arquivo: `src/profile/profile.service.ts`. Objetivo:
  normalizar com o utilitário da Fase 02, gravar `completed_at` só na primeira vez porque a data do
  onboarding é histórico e não "última edição", e mexer em `updated_at` sempre.
- [] Task 07: Criar o controller do perfil. Arquivo: `src/profile/profile.controller.ts`. Objetivo:
  `GET /me` e `PATCH /me/profile` sob `@UseGuards(SupabaseAuthGuard)`, deixando as rotas públicas de
  `/auth` e o `POST /waitlist` da spec 004 anônimos como estão.

# Fase 07: Endurecimento e documentação []
Branch: `feat/005-hardening`

- [] Task 01: Aplicar os limites por rota. Arquivos: `src/auth/auth.controller.ts`,
  `src/profile/profile.controller.ts`. Objetivo: `@Throttle` com 3/60s no signup por disparar
  e-mail, 5/60s em senha e login, 30/60s no refresh por ser chamado pelo app e não pelo usuário, e
  10/60s no `PATCH`, mantendo o default global de 60/60s da spec 004 no resto.
- [] Task 02: Anotar tudo para o Swagger. Arquivos: `src/auth/dto/*.ts`, `src/profile/dto/*.ts`,
  `src/auth/auth.controller.ts`, `src/profile/profile.controller.ts`. Objetivo: `/docs` mostrar os
  sete endpoints com corpo, exemplos e as respostas 202, 204, 400, 401 e 429, e as rotas protegidas
  marcadas com `@ApiBearerAuth`.
- [] Task 03: Conferir que segredo nenhum vaza em log ou resposta. Arquivos:
  `src/auth/supabase.service.ts`, `src/auth/auth.service.ts`. Objetivo: service role confinada ao
  `SupabaseService`, mensagem do GoTrue nunca repassada ao cliente e nenhum token em log.
- [] Task 04: Escrever o teste e2e. Arquivo: `test/auth.e2e-spec.ts`. Objetivo: cobrir signup 202,
  confirmação divergente 400, login 401, `GET /me` sem token 401 e o ciclo completo com usuário real,
  conferindo o `Set-Cookie` com `HttpOnly` e o perfil refletido depois do `PATCH`.
- [] Task 05: Documentar no `README.md`. Arquivo: `README.md`. Objetivo: seção de autenticação com as
  variáveis novas, a configuração do template de e-mail no painel, a tabela `profiles`, os sete
  endpoints e o desenho de sessão, conforme a regra 4 do clauderc.
- [] Task 06: Atualizar o `CLAUDE.md`. Arquivo: `CLAUDE.md`. Objetivo: registrar a fronteira nova, que
  identidade passa por `@supabase/supabase-js` e dado de negócio continua em TypeORM, para a
  afirmação da spec 004 não induzir ao erro na próxima spec.
- [] Task 07: Rodar `npm run lint`, `npm test`, `npm run test:e2e` e `npm run build`. Objetivo: suíte
  verde e build limpo antes de liberar o contrato para o front.

# Fase 08: Release []
- [] Task 01: Abrir `release/005-autenticacao` unindo as branches `feat/005-*`.
- [] Task 02: Merge da release em `dev` e PR contra a `main` (se houver origin; se não, merge local).

## Checklist final
- [] Fluxo de e-mail provado no projeto real, com o resultado registrado no `context.md`
- [] Tabela `profiles` criada, com FK para `auth.users`, check do grau e RLS ligada sem policy
- [] `POST /auth/signup` devolve 202 idêntico para e-mail novo e já cadastrado
- [] Perfil de quem estava na lista de espera nasce com nome e telefone aproveitados
- [] `POST /auth/password` grava a senha, confirma o e-mail e **não** devolve sessão
- [] `POST /auth/login` devolve `profileCompleted` e `grade`, com 401 de mensagem única
- [] Cookie `eduleno_rt` com `HttpOnly`, `Path=/auth` e atributos vindos de env
- [] `POST /auth/refresh` grava o refresh rotacionado e limpa o cookie no 401
- [] `SupabaseAuthGuard` verifica o JWT localmente, sem chamar o GoTrue por requisição
- [] `PATCH /me/profile` preenche `completed_at` só na primeira vez e nunca altera `grade`
- [] Service role só existe dentro de `SupabaseService`
- [] CORS com `credentials: true` e origens de `FRONTEND_URL`, sem `origin: true`
- [] Limites por rota ativos e `/docs` mostrando os sete endpoints
- [] `npm run lint`, `npm test`, `npm run test:e2e` e `npm run build` sem erro
- [] `README.md` e `CLAUDE.md` atualizados
