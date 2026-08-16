# Fase 01: Fundação do Firebase []
Branch: `feat/007-firebase-fundacao`

Nenhum endpoint muda de comportamento. Ao fim desta fase o Admin SDK está de pé e o Supabase continua
respondendo por tudo.

- [] Task 01 (usuário): Criar (ou confirmar) os projetos no Firebase — um de desenvolvimento e um de
  produção, pelo ponto em aberto 1 do `context.md`. Em cada um: ligar Email/Password em Authentication
  > Sign-in method, criar o Firestore em **modo de produção** (nunca em modo de teste, que deixa a
  base aberta), e gerar a chave de serviço em Project settings > Service accounts.
- [] Task 02 (usuário): Guardar `FIREBASE_SERVICE_ACCOUNT_JSON` (o JSON inteiro em uma linha) e
  `FIREBASE_WEB_API_KEY` no `.env` local, com as credenciais do projeto de **desenvolvimento**, e no
  painel da Vercel com as de **produção**. Objetivo: a chave de serviço é credencial de administrador
  — quem a tem emite token de qualquer usuário e lê qualquer documento, ignorando as security rules. A
  Web API Key não é segredo (decisão 1).
- [x] Task 03: Instalar `firebase-admin` e remover `@supabase/supabase-js` e `jose`. Arquivo:
  `package.json`. Objetivo: o `verifyIdToken` do Admin SDK substitui a verificação manual de JWKS.
  Some junto o motivo do `import()` dinâmico do `fix/deploy-jose-esm` — o `firebase-admin` é CommonJS.
- [x] Task 04: Reescrever a validação de ambiente. Arquivo: `src/config/env.validation.ts`. Objetivo:
  exigir `FIREBASE_SERVICE_ACCOUNT_JSON` e `FIREBASE_WEB_API_KEY`, validando que o JSON parseia e tem
  `project_id`, `client_email` e `private_key`. Remover todo o bloco `SUPABASE_*`, o `DATABASE_URL` e
  os dois `DATABASE_SSL_*`. Sem essa validação, chave malformada só aparece como erro de PEM inválido
  três camadas abaixo.
- [x] Task 05 (TDD): Escrever a spec do `FirebaseService`. Arquivo:
  `src/auth/firebase.service.spec.ts`. Objetivo: cobrir a normalização do `private_key` (`\\n` literal
  virando quebra de linha real, a armadilha da decisão 9), a idempotência do `initializeApp` sob
  reaproveitamento de processo, e o erro claro quando o JSON não parseia.
- [x] Task 06: Implementar o `FirebaseService`. Arquivo: `src/auth/firebase.service.ts`. Objetivo:
  substituir `supabase.service.ts`. Expõe `auth()`, `firestore()` e os helpers de REST do Identity
  Toolkit que as Fases 03 e 04 consomem. `initializeFirestore` com `preferRest: true`, com o motivo em
  comentário: gRPC em function serverless pendura a primeira requisição depois de um período ocioso
  (decisão 10). A chave de serviço fica confinada aqui, como a service role key estava confinada no
  `SupabaseService`.

# Fase 02: Firestore no lugar do SQL []
Branch: `feat/007-firestore`

A fronteira do repository é o que faz esta fase caber em duas classes. Os services não mudam.

- [x] Task 01: Trocar as entidades por tipos com converter. Arquivos:
  `src/waitlist/entities/waitlist-entry.entity.ts`, `src/profile/entities/profile.entity.ts`.
  Objetivo: sair dos decoradores do TypeORM e virar tipo simples mais `FirestoreDataConverter`. A
  conversão de `Timestamp` para `Date` mora no converter, num lugar só — é o que preserva a
  preocupação de fuso que a migration da spec 004 documentou (decisão 7).
- [x] Task 02 (TDD): Reescrever a spec do `WaitlistRepository`. Arquivo:
  `src/waitlist/waitlist.repository.spec.ts`. Objetivo: `findByEmail` vira `doc(email).get()` e
  `create` usa `create()`, não `set()`, para falhar com `ALREADY_EXISTS` quando o documento existe. O
  contrato `{ found, entry }` não muda.
- [x] Task 03: Implementar o `WaitlistRepository` sobre Firestore. Arquivo:
  `src/waitlist/waitlist.repository.ts`. Objetivo: e-mail normalizado como ID do documento (decisão
  6). `normalizeEmail` deixa de só comparar e passa a endereçar, o que merece comentário no ponto de
  uso.
- [x] Task 04: Trocar o tratamento de corrida no service. Arquivo: `src/waitlist/waitlist.service.ts`.
  Objetivo: o `catch` do código `23505` do Postgres vira `catch` do `ALREADY_EXISTS` do Firestore.
  Mesma corrida, mesmo tratamento, mesma releitura — o comentário que explica a corrida fica, com o
  erro atualizado. Aqui também some o UUID do recibo: `WaitlistReceiptDto.id` passa a ser o e-mail
  normalizado, com o exemplo do Swagger corrigido.
- [x] Task 05 (TDD + implementação): Trocar o `ProfileRepository`. Arquivos:
  `src/profile/profile.repository.spec.ts`, `src/profile/profile.repository.ts`. Objetivo: UID do
  Firebase como ID do documento (decisão 5). `findById` vira leitura por caminho; `update` usa
  `update()` e relê. O `id` deixa de ser campo do documento e passa a ser o caminho — quem monta o
  `ProfileDto` precisa recolocá-lo a partir do UID.
- [x] Task 06: Escrever as security rules. Arquivo: `firestore.rules`. Objetivo: negar tudo. Só a API
  toca no Firestore, sempre pelo Admin SDK, que ignora as rules. Sem rules explícitas, a base fica
  aberta para qualquer navegador que tenha a Web API Key, que é pública (decisão 8). Versionado no
  repositório e aplicado pelo Firebase CLI.
- [x] Task 07: Arrancar o TypeORM. Arquivos: `package.json`, `src/app.module.ts`, remoção de
  `src/database/` e `src/config/typeorm.config.ts`. Objetivo: saem `typeorm`, `@nestjs/typeorm` e
  `pg`, e com eles o `require('pg')` literal da `fix/deploy-driver-pg-vercel` e a configuração de TLS
  do banco, que existiam só por causa do driver de Postgres na Vercel.
- [] Task 08 (usuário): Migrar `waitlist_entries` do Supabase para o Firestore do projeto de
  produção. Objetivo: ali há inscrição de gente de verdade. O e-mail normalizado de cada linha vira o
  ID do documento, e linhas que colidirem depois da normalização precisam ser resolvidas na mão — se
  houver, é sinal de que o `unique` do Postgres estava sendo respeitado por um `email` não normalizado
  e o dado tem sujeira anterior a esta spec. `profiles` **não** é migrada (ponto em aberto 3).
- [] Task 09: Rodar a suíte contra o emulador. Objetivo: `npm test` e `npm run test:e2e` verdes com o
  Firestore no lugar do Postgres, antes de qualquer mudança de auth. Separa "quebrou por causa do
  banco" de "quebrou por causa do Firebase Auth", que é o que as Fases 03 e 04 vão mexer. Exige o
  passo do emulador da Fase 07 Task 04 já configurado.

# Fase 03: Cadastro [x]
Branch: `feat/007-cadastro`

TDD: teste antes da lógica, pela regra 6 do `clauderc.md`. Esta fase encolheu: a definição de senha
saiu do projeto pela decisão 3, e o que sobra é disparar o e-mail e apagar o que sobrou.

- [] Task 01 (usuário): Configurar o console de **cada** projeto Firebase. Objetivo: em
  Authentication > Templates, ajustar o nome público do projeto e o remetente, que aparecem no e-mail
  e na tela de senha hospedada pelo Google. Em Authentication > Settings > Password policy, exigir 8
  caracteres — o front garantia esse piso e deixa de existir; sem essa configuração ele cai para 6 em
  silêncio (decisão 3). **Não** configurar Action URL customizada: a tela do Firebase é o desenho
  escolhido.
- [x] Task 02 (TDD): Reescrever a spec do `signup`. Arquivo: `src/auth/auth.service.spec.ts`.
  Objetivo: `admin.createUser` com senha aleatória descartada, criação de `profiles/{uid}` lendo
  `waitlist_entries/{email}`, e `accounts:sendOobCode` com `requestType: PASSWORD_RESET` **e
  `continueUrl`**. Preservar o comportamento de e-mail já cadastrado: erro engolido, 202 sempre, para
  não virar oráculo de enumeração de e-mail.
- [x] Task 03: Implementar o `signup`. Arquivo: `src/auth/auth.service.ts`. Objetivo: some o
  `resetPasswordForEmail`, e o `passwordRedirectUrl` montado a partir do `FRONTEND_URL` deixa de
  apontar para `/definir-senha` e vira o `continueUrl` (`<FRONTEND_URL>/?entrar=1`), que é o botão de
  retorno da tela do Firebase. Sem ele o usuário define a senha e fica parado numa página do Google.
- [x] Task 04: Apagar o caminho de definição de senha. Arquivos: `src/auth/auth.controller.ts`,
  `src/auth/auth.service.ts`, `src/auth/dto/set-password.dto.ts`, `src/auth/auth.service.spec.ts`,
  `src/auth/auth.controller.spec.ts`. Objetivo: some a rota `POST /auth/password`, o `setPassword`, o
  DTO e os testes dos dois. É a decisão 3 no código, e é a maior remoção da spec.
- [x] Task 05: Atualizar a documentação da rota de cadastro. Arquivo: `src/auth/auth.controller.ts`.
  Objetivo: o `@ApiOperation` do `signup` diz "dispara e-mail de definição de senha" e continua certo,
  mas a resposta 202 precisa deixar explícito que a senha é definida fora da aplicação. Quem lê o
  Swagger não pode ficar procurando o endpoint que sumiu.

# Fase 04: Sessão [x]
Branch: `feat/007-sessao`

- [x] Task 01 (TDD): Reescrever a spec do `login`. Arquivo: `src/auth/auth.service.spec.ts`.
  Objetivo: REST `accounts:signInWithPassword`, `idToken` virando `accessToken` e `refreshToken` indo
  para o cookie. A criação preguiçosa de perfil quando `profiles/{uid}` não existe **continua** — ela
  cobre o usuário que se cadastrou antes de haver documento para ele.
- [x] Task 02: Implementar o `login`. Arquivo: `src/auth/auth.service.ts`. Objetivo: `expiresIn` do
  Firebase vem como string em segundos, não número — converter, senão o front recebe um tipo que o
  `Session` não declara.
- [x] Task 03 (TDD): Reescrever a spec do `refresh`. Arquivo: `src/auth/auth.service.spec.ts`.
  Objetivo: `POST securetoken.googleapis.com/v1/token` com `grant_type=refresh_token`. A resposta usa
  `snake_case` (`id_token`, `refresh_token`, `user_id`), diferente do `camelCase` do Identity Toolkit
  — são duas APIs do Google com convenções diferentes, e trocar uma pela outra é erro silencioso.
- [x] Task 04: Implementar o `refresh`. Arquivo: `src/auth/auth.service.ts`. Objetivo: o `securetoken`
  devolve `user_id`, não o e-mail. O e-mail do `SessionResponseDto` passa a vir de
  `admin.auth().getUser(uid)`.
- [x] Task 05 (TDD + implementação): Trocar o `logout`. Arquivos: `src/auth/auth.service.spec.ts`,
  `src/auth/auth.service.ts`. Objetivo: `revokeRefreshTokens(uid)` no lugar do
  `signOut({ scope: 'local' })`. **O logout vira global** (decisão 2), e o comentário longo que
  justifica o escopo local precisa ser reescrito para dizer a verdade nova, não apagado — ele explica
  uma decisão que foi perdida, e por quê.
- [x] Task 06 (TDD): Escrever a spec do guard novo. Arquivo:
  `src/auth/guards/firebase-auth.guard.spec.ts`. Objetivo: `verifyIdToken` rejeitando token expirado,
  assinatura inválida e token de outro projeto. Some a verificação manual de `aud`, `iss` e `role` que
  a `fix/005-guard-aud-iss` adicionou — o Admin SDK faz isso por dentro, e refazer à mão duplicaria a
  regra em dois lugares.
- [x] Task 07: Implementar o guard e apagar o antigo. Arquivos:
  `src/auth/guards/firebase-auth.guard.ts`, remoção de `supabase-auth.guard.ts`. Objetivo: decidir o
  `checkRevoked` e escrever a escolha em comentário no código, com o trade-off — sem ele o logout leva
  até uma hora para derrubar o ID token; com ele toda requisição autenticada paga uma ida à rede. É o
  ponto em aberto 5 do `context.md`.
- [x] Task 08: Atualizar os consumidores do guard. Arquivos: `src/auth/auth.module.ts`,
  `src/profile/profile.controller.ts`, `src/app.module.ts`. Objetivo: trocar o provider e o import.
  `GET /me` e `PATCH /me/profile` não mudam de forma.

# Fase 05: Front [x]
Branch: `feat/007-remover-definir-senha` (no repositório `../eduleno-front`)

Fase de remoção, mais uma adição pequena. O front deixa de participar da definição da primeira senha.

- [x] Task 01: Apagar a página `/definir-senha`. Arquivos: `src/app/app.routes.ts` e o diretório
  `src/app/pages/definir-senha/` inteiro (`.ts`, `.html`, `.scss`, `.spec.ts`). Objetivo: a tela é do
  Firebase agora (decisão 3). Some com ela o `extractToken`, o `scrubTokenFromUrl` e o cuidado de
  tirar o token da barra de endereço — que era correto e deixa de ter token para proteger.
- [x] Task 02: Apagar o que servia a essa página. Arquivos: `src/app/models/auth.model.ts`,
  `src/app/core/auth/auth.service.ts`. Objetivo: somem `SetPasswordRequest` e a chamada de
  `POST /auth/password`, que não existe mais na API.
- [x] Task 03: Abrir o diálogo de login pelo `?entrar=1`. Arquivos:
  `src/app/pages/landing/landing.page.ts`, `src/app/components/auth-dialog/`. Objetivo: é para onde o
  `continueUrl` da Fase 03 Task 03 devolve o usuário depois de definir a senha na tela do Firebase.
  Sem isso ele volta para a landing sem nenhum sinal de que deve entrar agora, e o cadastro termina
  em anticlímax. Limpar o parâmetro da URL depois de abrir, com `replaceUrl`.
- [x] Task 04: Ajustar o texto de confirmação do cadastro. Arquivo:
  `src/app/components/auth-dialog/auth-dialog.ts`. Objetivo: a mensagem depois do `signup` precisa
  preparar o usuário para sair do site — ele vai clicar num link e cair numa tela do Google, e uma
  mensagem que promete "defina sua senha aqui" vira uma surpresa ruim.

# Fase 06: Desligar o Supabase []
Branch: `feat/007-remover-supabase`

Só depois de a Fase 05 estar verde. Enquanto o Supabase estiver de pé, dá para voltar atrás.

- [x] Task 01: Apagar o diretório `supabase/` inteiro. Objetivo: `config.toml`, `templates/`,
  `migrations/` e `.temp/`. As migrations não têm sucessor: no Firestore não há schema a versionar, e
  é a decisão 7 que explica onde as garantias delas foram parar.
- [x] Task 02: Apagar o skill do Supabase. Arquivos: `.agents/skills/supabase/`, `skills-lock.json`.
  Objetivo: ferramenta de um serviço que saiu.
- [] Task 03 (usuário): Desconectar a integração do Supabase no GitHub. Objetivo: enquanto ela ficar
  ligada, todo merge na `main` continua reprovando o check `Supabase Preview` com o 400 do
  `context.md` — um alarme que já não corresponde a nada.
- [] Task 04 (usuário): Remover `SUPABASE_*`, `DATABASE_URL` e `DATABASE_SSL_*` do painel da Vercel.
  Objetivo: service role key viva num painel é credencial ativa esquecida.
- [] Task 05 (usuário, por último): Pausar ou apagar o projeto Supabase. Objetivo: fazer só depois de
  a Fase 08 confirmar o fluxo em produção. É o passo irreversível da spec.

# Fase 07: Documentação [x]
Branch: `feat/007-docs`

- [x] Task 01: Reescrever as regras 2 e 3 do `clauderc.md`. Arquivo: `.claude/clauderc.md`. Objetivo:
  a 2 manda usar TypeORM para entidades, repositories e consultas; a 3 declara o Supabase dono do
  schema. As duas descrevem um mundo que acaba aqui. Passam a descrever Firestore pelo Admin SDK, com
  a regra que sobrevive intacta em destaque: **repository sempre devolve objeto** — é ela que fez esta
  migração caber em duas classes.
- [x] Task 02: Reescrever o `CLAUDE.md`. Arquivo: `CLAUDE.md`. Objetivo: "Project state" e "Commands"
  descrevem Supabase, TypeORM e `supabase db push` em detalhe. Passam a descrever Firestore, Firebase
  Admin e o emulador. Os scripts `migration:*` somem sem substituto.
- [x] Task 03: Reescrever a seção de auth do `README.md`. Arquivo: `README.md`. Objetivo: sai
  "Configuração do Supabase Auth" e entra a do Firebase. Documentar que a definição da primeira senha
  acontece **fora da aplicação**, na tela do Firebase, e que a política de senha vive no console —
  são as duas coisas que o código não conta mais. Documentar também o modelo de dados do
  `context.md`, já que não há mais migration para servir de referência. E remover `POST /auth/password`
  da lista de endpoints.
- [x] Task 04: Documentar o emulador. Arquivos: `firebase.json`, `README.md`, `package.json`.
  Objetivo: `firebase emulators:start` para Auth e Firestore, com as variáveis
  `FIRESTORE_EMULATOR_HOST` e `FIREBASE_AUTH_EMULATOR_HOST` no `test:e2e`. É o que torna a Fase 02
  Task 09 executável e o que permite testar as security rules.
- [x] Task 05: Marcar as specs anteriores. Arquivos: `specs/004 - Acesso Antecipado/context.md`,
  `specs/005 - Autenticacao e Dashboard/context.md`, `specs/006 - Configuracao de Auth como
  Codigo/context.md`. Objetivo: as três viram Deprecated pelos motivos da seção "Specs afetadas" e
  apontam para esta. Não reescrever o conteúdo delas: o diagnóstico da 006 é o que justifica esta spec
  existir.
- [x] Task 06: Corrigir a "Resultado da aplicação" da spec 006. Arquivo: `specs/006 - Configuracao de
  Auth como Codigo/context.md`. Objetivo: ela afirma que o merge do PR #12 fechou a divergência do
  `mailer_autoconfirm`. O campo nunca mudou — foi lido estado pré-existente como efeito de pipeline, o
  mesmo erro que o `fix.md` da própria 006 identificou na evidência 1. Fica registrado, não apagado.

# Fase 08: Release e verificação em produção []
Branch: `release/007-firestore-e-firebase`

- [x] Task 01: Unir as branches da spec e abrir o PR contra a `dev`. Objetivo: fluxo de versionamento
  do `clauderc.md`. O front tem release próprio, no repositório dele.
- [] Task 02: Publicar as security rules no projeto de produção. Objetivo: `firebase deploy --only
  firestore:rules`. Sem isso, a Task 06 da Fase 02 é um arquivo no git que não protege nada.
- [] Task 03 (usuário): Conferir as env vars na Vercel antes do merge na `main`. Objetivo:
  `FIREBASE_SERVICE_ACCOUNT_JSON` e `FIREBASE_WEB_API_KEY` presentes e apontando para o projeto de
  **produção**; `SUPABASE_*` e `DATABASE_*` ausentes. Deploy com chave faltando morre no boot, pela
  validação da Fase 01 Task 04 — que é o comportamento desejado, mas em produção.
- [] Task 04 (usuário): Aprovar e mergear o PR contra a `main`.
- [] Task 05: Verificar o cadastro de ponta a ponta, com e-mail que nunca existiu no projeto.
  Objetivo: confirmar que o e-mail chega, que o link abre a tela do Firebase, que **uma senha de 7
  caracteres é recusada** ali (prova de que a política da Fase 03 Task 01 valeu), que o botão de
  retorno leva para `<front>/?entrar=1` com o diálogo de login aberto, e que o login funciona. É a
  prova que a spec 006 nunca conseguiu produzir, por um caminho que ela não tinha considerado.
- [] Task 06: Verificar o resto da sessão. Objetivo: `GET /me` com o ID token, `POST /auth/refresh`
  depois de expirar o access token, `POST /auth/logout`, e `GET /me` de novo — confirmando a janela do
  `checkRevoked` decidida na Fase 04 Task 07, seja ela qual for.
- [] Task 07: Verificar a waitlist e o fechamento da base. Objetivo: `POST /waitlist` duas vezes com
  o mesmo e-mail devolve o mesmo recibo e cria um documento só, provando a decisão 6. E uma leitura do
  Firestore por SDK cliente, com a Web API Key, precisa ser **negada** — é a prova de que as rules da
  decisão 8 estão valendo.
- [] Task 08: Registrar o resultado. Arquivo: `specs/007 - Firestore e Firebase Auth/context.md`,
  seção nova "Resultado da verificação". Objetivo: escrever o que foi **observado**, com data,
  separado do que foi inferido. As specs 005 e 006 confundiram as duas coisas, cada uma à sua maneira,
  e foi isso que custou os dois ciclos anteriores.
