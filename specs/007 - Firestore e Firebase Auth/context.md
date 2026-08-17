# Spec 007: Firestore e Firebase Auth

## Objetivo
Tirar o Supabase do projeto e, junto com ele, o SQL. Os dados passam a viver no Firestore e a
autenticação no Firebase Auth, com o Admin SDK rodando na API e a chave de serviço como JSON de uma
linha no `.env`.

O contrato público da API muda em dois pontos, e só nesses dois: **`POST /auth/password` deixa de
existir** (decisão 3) e o `id` do recibo da waitlist deixa de ser UUID (decisão 6). `POST /waitlist`,
`POST /auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /me` e `PATCH /me/profile`
continuam com a mesma forma de entrada e saída. O que muda é quem responde por trás.

**A troca é de uma credencial só.** Hoje a API carrega URL do Supabase, anon key, service role key,
JWT secret, `DATABASE_URL`, CA de TLS e a flag que desliga a verificação do certificado. Depois desta
spec, carrega uma chave de serviço e uma Web API Key. Auth e dados passam a ser o mesmo fornecedor,
autenticados pelo mesmo arquivo.

---

## Por que agora

A spec 006 gastou dois ciclos tentando fazer o Supabase entregar um link de definir senha com o token
na query, e o `fix.md` dela documenta os dois becos. Esta spec ocupa o número que ia ser de um
terceiro ciclo — uma spec de SMTP próprio, escrita e descartada em 2026-08-16 quando o diagnóstico
abaixo mostrou que o problema é de plataforma, não de configuração.

### O diagnóstico que encerra a linha do Supabase
O `[remotes.main]` do último conserto da 006 **funcionou**: o passo Configure parou de ser pulado em
silêncio e passou a rodar. E aí falhou com voz. O merge do PR #18 na `main` (commit `0725b3d`) fechou
o check `Supabase Preview` como `failure`, com a resposta literal do Management API no
`output.summary`:

```
unexpected status 400: {"message":"Email template modification is not available for free tier
projects using the default email provider. Please upgrade your plan or configure a custom SMTP
provider."}
```

Três leituras, todas de evidência direta:

1. **É restrição de plano, não de mecanismo.** `content_path` em projeto hospedado funciona; o CLI
   monta e envia o HTML corretamente. O servidor é que recusa recebê-lo.
2. **A falha é atômica.** O Configure manda um `PATCH /v1/projects/{ref}/config/auth` único, com a
   seção `[auth]` inteira. O 400 derrubou tudo: `site_url`, `additional_redirect_urls`,
   `minimum_password_length`, `max_frequency`. Nada da spec 006 chegou em produção, nunca.
3. **O teto de e-mail é o mesmo obstáculo, por outro lado.** A decisão 4 da 006 já registrava que
   `auth.rate_limit.email_sent = 2` é o limite do provedor embutido — dois e-mails por hora no projeto
   inteiro — e que só sai com SMTP próprio. O mesmo upgrade destrava as duas coisas.

Somando: manter o desenho exigiria contratar SMTP ou pagar plano, para consertar um link.

**A spec 006 fica Deprecated**, referenciada aqui: ela configura um serviço que sai do projeto. O que
sobrevive dela é o diagnóstico, não a solução. Uma consequência prática: o check `Supabase Preview`
continua vermelho em todo merge na `main` até a integração ser desconectada, na Fase 06.

### Por que sem SQL
Um passo intermediário desta spec chegou a ser desenhado com Postgres no Neon, mantendo TypeORM e
migrations. Foi descartado por complexidade que o projeto não usa: duas tabelas, nenhum JOIN, nenhuma
consulta analítica, nenhuma transação entre agregados. O que o SQL cobrava em troca era um segundo
fornecedor, um segundo conjunto de credenciais, configuração de TLS, e um pipeline de migration para
manter — para dois documentos por usuário.

O que se perde ao sair do SQL está declarado na decisão 7, e não é nada: são invariantes que o banco
garantia e que passam a ser responsabilidade da aplicação.

---

## Specs afetadas

Pela regra 6 do `clauderc.md`, spec que montou tabela cuja estrutura muda é marcada Deprecated e
referenciada aqui. As duas tabelas do projeto saem do Postgres, então as duas specs são atingidas.

### Spec 004 — Deprecated
`waitlist_entries` deixa de ser tabela e vira coleção. O `id uuid` gerado pelo banco dá lugar ao
e-mail normalizado como ID do documento (decisão 6), e o `unique` da coluna `email` deixa de existir
como constraint — a unicidade passa a ser a do caminho do documento.

### Spec 005 — Deprecated
`profiles` deixa de ser tabela e vira coleção, com o UID do Firebase como ID do documento. Somem a FK
para `auth.users(id)`, o `on delete cascade`, o `check (grade between 1 and 33)` e o `enable row level
security`.

Some também metade do fluxo que ela desenhou: a página `/definir-senha` e o `POST /auth/password`
saem do projeto, porque o Firebase hospeda a própria tela de definição de senha (decisão 3). A
decisão da 005 de que "o front nunca fala com o provedor de auth" continua valendo para login,
refresh e logout — mas na definição da primeira senha o usuário passa a falar diretamente com o
Google, e não há como preservar as duas coisas ao mesmo tempo.

### Spec 006 — Deprecated
Toda a configuração que ela produz (`supabase/config.toml`, `supabase/templates/recovery.html`,
`[remotes.main]`) sai do repositório com o Supabase.

---

## Decisões

### 1. O login continua sendo do servidor: REST do Identity Toolkit
O Admin SDK **não verifica senha**. Não existe `signInWithPassword` nele — o Firebase espera que o
cliente autentique direto com o Google e mande o ID token para o backend.

Esse desenho contradiz a decisão central da spec 005: o front nunca fala com o provedor de auth, só
com a nossa API. Para preservá-la, a API guarda a **Web API Key** do projeto e chama a REST do
Identity Toolkit no servidor:

```
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<WEB_API_KEY>
  { email, password, returnSecureToken: true }
  -> { idToken, refreshToken, expiresIn, localId }
```

A Web API Key **não é segredo** — ela vai no bundle de qualquer app Firebase web e é pública por
desenho. Identifica o projeto, não autoriza nada sozinha. Fica no `.env` por conveniência de
configuração, não por sigilo, e isso precisa estar escrito para ninguém tratá-la como credencial
depois.

Consequência boa: `POST /auth/login` fica idêntico, o front não muda uma linha, e o Firebase Client
SDK nunca entra no bundle Angular.

### 2. A sessão espelha o desenho que já existe, e o logout muda de escopo
`refreshToken` do Firebase no cookie HttpOnly, ID token devolvido como `accessToken`, guard
verificando o ID token. `CookieService`, `auth.interceptor.ts` e `AuthStore` continuam como estão.

| Operação | Hoje (Supabase) | Depois (Firebase) |
|---|---|---|
| login | `signInWithPassword` | REST `accounts:signInWithPassword` |
| refresh | `refreshSession` | `POST securetoken.googleapis.com/v1/token`, `grant_type=refresh_token` |
| guard | `jose` + JWKS do GoTrue | `admin.auth().verifyIdToken()` |
| logout | `signOut({ scope: 'local' })` | `admin.auth().revokeRefreshTokens(uid)` |

**O custo, declarado e não escondido:** o Firebase revoga refresh tokens **por usuário**, não por
sessão. A spec 005 escolheu escopo `local` de propósito, com o argumento escrito no código: "sair no
computador do laboratório não pode deslogar a mesma pessoa no celular dela". Isso deixa de ser
possível. O logout vira global.

**Segundo custo, menos óbvio:** `revokeRefreshTokens` invalida a renovação, não os ID tokens já
emitidos. Um ID token continua válido até expirar, em no máximo uma hora, a não ser que o guard chame
`verifyIdToken(token, true)` — e o `true` custa uma ida à rede em **toda** requisição autenticada. A
Fase 04 decide isso com o trade-off explícito.

### 3. O Firebase tem tela própria de definir senha, e ela é usada — `/definir-senha` morre
O Firebase envia o e-mail e **hospeda a tela onde a senha é digitada**, em
`<projeto>.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=...`. Não há SMTP a contratar,
não há template de e-mail a versionar, e o limite de envio é folgado, ao contrário dos dois por hora
do Supabase.

Existe a opção de desviar esse link para uma página nossa (Authentication > Templates > customize
action URL) e continuar processando o `oobCode` na API. **Não é o que esta spec faz.** Manter a tela
própria significaria manter a página, o endpoint, o DTO, os testes e a leitura de token da URL — todo
um caminho de código para reimplementar uma tela que o fornecedor entrega pronta e correta.

O que sai do projeto por causa desta decisão:

| Item | Onde |
|---|---|
| `POST /auth/password` | rota, `AuthController`, `AuthService.setPassword` |
| `SetPasswordDto` | `src/auth/dto/set-password.dto.ts` |
| Página `/definir-senha` | rota, componente, template, estilo e testes no front |
| `SetPasswordRequest` | `src/app/models/auth.model.ts` |
| Leitura e limpeza de token da URL | `extractToken`, `scrubTokenFromUrl` |

**É a spec 006 inteira perdendo objeto.** Ela existiu para fazer o token chegar na query string de uma
página nossa. Sem essa página, a pergunta não se faz — e dois ciclos de trabalho viram apenas o
diagnóstico que justifica esta troca. Vale dizer sem rodeio: o custo daquelas specs não é recuperado
aqui, é reconhecido.

**Para o fluxo não morrer na tela do Google**, o `continueUrl` volta o usuário para o produto. A tela
do Firebase, depois de confirmar a senha, exibe um botão de retorno quando esse valor é passado no
envio:

```
POST .../v1/accounts:sendOobCode?key=<WEB_API_KEY>
  { requestType: "PASSWORD_RESET", email, continueUrl: "<FRONTEND_URL>/?entrar=1" }
```

Sem ele, o usuário define a senha e fica parado numa página do Google, sem caminho de volta. O
`?entrar=1` existe porque o login do front é um diálogo na landing, não uma rota — a Fase 05 abre o
diálogo automaticamente quando esse parâmetro está presente.

Três custos, declarados:

- **O usuário vê um domínio `firebaseapp.com` no meio do cadastro.** Hospedar o action handler em
  domínio próprio exige Firebase Hosting, que está fora de escopo. O que dá para fazer sem isso é
  ajustar o nome público do projeto e o remetente no console, que aparecem no e-mail e na tela.
- **A política de senha sai do nosso controle e precisa ser reconfigurada.** O front exigia 8
  caracteres em `definir-senha.page.ts`; a tela do Firebase aplica a política do projeto, que nasce em
  6. Sem mexer no console (Authentication > Settings > Password policy), o piso cai de 8 para 6 em
  silêncio. É exatamente o mesmo tipo de armadilha que a decisão 4 da spec 006 registrou sobre o
  `minimum_password_length`, e agora sem nenhum código nosso para segurar.
- **A identidade visual se interrompe.** A tela é do Google, com a marca do Google.

`accounts:resetPassword` deixa de ser chamado por nós — quem o chama é a tela do Firebase. A semântica
de confirmação de e-mail continua: concluir a redefinição marca o e-mail como verificado, que é o
mesmo que a 005 obtinha com o `verifyOtp`. Quem provou receber o e-mail, provou ser dono dele.

### 4. Sai o SQL inteiro, e o repository é o que sobrevive
Somem `typeorm`, `pg`, `DatabaseModule`, `src/config/typeorm.config.ts`, as entidades decoradas, as
migrations e o `DATABASE_URL`.

O que **não** muda é a fronteira. A regra do `clauderc.md` de que repository sempre devolve objeto
(`{ found, entry }`, nunca `null` cru) é o motivo de essa troca caber em duas classes: `ProfileService`
e `WaitlistService` não sabem o que tem embaixo, e continuam sem saber. Os `*.repository.ts` trocam de
implementação e mantêm a assinatura.

As entidades decoradas viram tipos simples com `FirestoreDataConverter`, que é onde a conversão de
`Timestamp` para `Date` acontece — em um lugar só, e não espalhada pelos services.

Somem junto três remendos de deploy que só existiam por causa do driver de Postgres na Vercel: o
`require('pg')` literal da `fix/deploy-driver-pg-vercel`, o `DATABASE_SSL_CA_PATH` (que existia porque
o host do Supabase apresentava certificado de CA própria) e o `DATABASE_SSL_REJECT_UNAUTHORIZED`, que
era um jeito documentado de rodar sem verificar o servidor numa conexão que carrega PII.

**As regras 2 e 3 do `clauderc.md` são reescritas.** A 2 manda usar TypeORM para entidades,
repositories e consultas. A 3 declara o Supabase dono do schema e proíbe migration do TypeORM. As duas
descrevem um mundo que acaba aqui. A parte da 3 que sobrevive, em espírito, é a outra: schema não muda
por inferência no boot. No Firestore não há schema para mudar, e é justamente por isso que a decisão 7
existe.

### 5. `profiles/{uid}` — o UID resolve o que a FK resolvia
O ID do documento é o UID do Firebase. Não existe coluna `id`, não existe FK, e não é preciso
inventar uma: "existe perfil para este usuário" vira uma leitura por caminho, `profiles/{uid}`, sem
consulta nem índice.

Um desenho anterior desta spec, sobre Postgres, registrava como dívida o perfil órfão — sem
`auth.users` no mesmo banco, nada garantiria o `on delete cascade`. Com o UID como caminho, essa
dívida não nasce: o Firebase Auth é a fonte de verdade de quem existe, e o documento é endereçado por
essa verdade.

Continua havendo o caso de usuário sem perfil, que já existe hoje e já é tratado: `login` e `refresh`
criam o perfil preguiçosamente quando não acham. Esse código fica.

### 6. `waitlist_entries/{email}` — a unicidade vira o caminho do documento
O Firestore não tem constraint `UNIQUE`. O único lugar onde ele garante unicidade é o ID do
documento, e é ali que a garantia vai morar: **o e-mail normalizado é o ID**.

Isso não é detalhe de arrumação. `waitlist.service.ts` tem hoje um `catch` explícito no código de erro
`23505` do Postgres, com um comentário descrevendo a corrida entre o `findByEmail` e o `create` —
duas pessoas enviando o mesmo e-mail no formulário ao mesmo tempo. Alguém pensou nisso com cuidado, e
a garantia é load-bearing. Com o e-mail como ID:

- `findByEmail` vira `doc(email).get()`: leitura por caminho, sem consulta e sem índice.
- `create()` (e não `set()`) falha com `ALREADY_EXISTS` quando o documento já existe, e esse erro
  ocupa exatamente o lugar do `23505` — mesma corrida, mesmo tratamento, mesma releitura.

**A consequência no contrato, que é a exceção anunciada no objetivo:** `WaitlistReceiptDto.id` deixa
de ser um UUID e passa a ser o e-mail normalizado. O front não usa esse campo para nada além de exibir
recibo, e quem recebe a resposta é justamente quem acabou de digitar o e-mail — não há vazamento para
terceiro. Mas o exemplo do Swagger muda, e um `id` que é PII merece estar escrito e não descoberto
depois em log.

O e-mail normalizado é ID válido no Firestore: `@` e `.` são permitidos dentro do ID; o que é proibido
é `/`, um ID que seja exatamente `.` ou `..`, e o padrão `__*__`. Nenhum e-mail cai nesses casos. A
normalização já existe em `src/common/normalize.ts` e passa a ter uma segunda função — antes só
comparava, agora endereça.

### 7. Sem schema, as invariantes viram código — e essa é a conta a pagar
O Postgres garantia coisas que o Firestore não garante. Elas não somem: mudam de lugar, do banco para
a aplicação. Estão listadas para ninguém descobrir a ausência por acidente.

| Garantia | Como era | Como fica |
|---|---|---|
| E-mail único na waitlist | `unique` na coluna | ID do documento (decisão 6) |
| Perfil pertence a um usuário | FK para `auth.users` + cascade | ID do documento é o UID (decisão 5) |
| `grade` entre 1 e 33 | `check` constraint | Validação na aplicação e nas security rules |
| `consent` booleano, `name` não nulo | tipos e `not null` | `class-validator` no DTO e o converter |
| Acesso direto bloqueado | RLS ligada sem policy | Security rules `deny all` (decisão 8) |
| Fuso do `created_at` | `timestamptz` | `Timestamp` do Firestore, que é UTC por construção |

A linha do `timestamptz` merece nota: o comentário da migration da spec 004 explica que o tipo foi
escolhido de propósito, porque `timestamp` sem fuso seria gravado no fuso da sessão do banco e lido no
fuso do processo Node, deslocando o `receivedAt` que a API anuncia como UTC. A preocupação continua
válida e o `Timestamp` do Firestore a atende sem esforço — mas a conversão para `Date` fica no
converter, num lugar só, e não em cada service.

### 8. Security rules como código, `deny all`
Só a API toca no Firestore, sempre pelo Admin SDK, que **ignora as security rules** por ser
credencial de administrador. Isso significa que as rules podem — e devem — negar tudo.

É o mesmo raciocínio do `enable row level security` sem policy da spec 005, que fechava as tabelas
para o PostgREST e a anon key. Aqui a superfície equivalente é o SDK cliente do Firestore, que fala
direto com o Google a partir de qualquer navegador que tenha a Web API Key — que é pública. **Sem
rules explícitas, um projeto Firestore em modo de teste é uma base de dados aberta na internet.**

`firestore.rules` fica versionado no repositório e é aplicado pelo Firebase CLI. Isso recupera, em
escala pequena, a promessa que a spec 006 tentou cumprir e não conseguiu: configuração de serviço que
vive no git em vez de num painel.

### 9. A chave de serviço em uma linha tem uma armadilha conhecida: o `private_key`
`FIREBASE_SERVICE_ACCOUNT_JSON` guarda o JSON inteiro numa linha só. O campo `private_key` de dentro
dele contém quebras de linha, que no JSON serializado viram a sequência de dois caracteres `\` + `n`.

Dependendo de como o valor atravessa `.env`, painel da Vercel e `JSON.parse`, essas sequências podem
chegar ao `firebase-admin` como texto literal em vez de quebra de linha real. O sintoma é erro de PEM
inválido no boot, e é o erro mais comum de quem faz exatamente esta configuração.

O `FirebaseService` normaliza explicitamente (`privateKey.replace(/\\n/g, '\n')`) e o
`env.validation.ts` valida que o JSON parseia e tem `project_id`, `client_email` e `private_key` —
para o boot morrer com mensagem clara, e não com PEM inválido três camadas abaixo.

A chave é credencial de administrador do projeto inteiro: quem a tem emite token de qualquer usuário e
lê qualquer documento, ignorando as rules da decisão 8. O `.env.example` recebe o formato, nunca um
valor.

### 10. Serverless: `initializeApp` idempotente e Firestore por REST
Dois cuidados que a Vercel impõe e que não são óbvios:

- **`initializeApp` precisa ser idempotente.** A function reaproveita o processo entre invocações, e
  uma segunda inicialização estoura. O `FirebaseService` confere `getApps().length` antes.
- **O Firestore do Admin SDK fala gRPC por padrão**, e gRPC em function serverless sofre com conexão
  que não sobrevive ao congelamento do processo — o sintoma é a primeira requisição depois de um
  período ocioso pendurar até dar timeout. `initializeFirestore` com `preferRest: true` usa HTTP/1.1 e
  contorna isso. É a configuração adequada para este runtime, e o motivo fica em comentário no código,
  não só aqui.

### 11. O que sai do repositório
| Item | Motivo |
|---|---|
| `@supabase/supabase-js` | Sem uso |
| `jose` | O `verifyIdToken` do Admin SDK substitui a verificação manual de JWKS |
| `typeorm`, `@nestjs/typeorm`, `pg` | Sai o SQL (decisão 4) |
| `src/database/`, `src/config/typeorm.config.ts` | Idem |
| `src/**/entities/*.entity.ts` | Viram tipos com converter |
| `src/auth/supabase.service.ts` | Vira `firebase.service.ts` |
| `src/auth/guards/supabase-auth.guard.ts` | Vira `firebase-auth.guard.ts` |
| `supabase/` inteiro | `config.toml`, `templates/`, `migrations/`, `.temp/` |
| Integração Supabase no GitHub | Se ficar conectada, todo merge na `main` segue reprovando o check |
| `SUPABASE_*`, `DATABASE_URL`, `DATABASE_SSL_*` | Decisões 4 e 11 |
| `.agents/skills/supabase/` | Ferramenta de um serviço que saiu |

Some junto o `jose` carregado por `import()` dinâmico — a gambiarra de `fix/deploy-jose-esm`, que
existia porque o `jose` 6 é ESM puro e o runtime da Vercel não aceitava `require()` de ESM. O
`firebase-admin` é CommonJS e não precisa disso.

> **Correção, 2026-08-16.** A última frase está errada, e derrubou a function no primeiro deploy. O
> `firebase-admin` é CommonJS **e mesmo assim arrasta o `jose`**, por `jwks-rsa@4`, que declara
> `jose: ^6.1.3` e é carregado ansiosamente em `firebase-admin/lib/utils/jwt.js`. Nosso `import()`
> dinâmico saiu corretamente; o problema de plataforma que ele contornava não saiu — só mudou de dono
> para uma dependência que não dá para instrumentar. Ver [`fix.md`](fix.md).

---

## Modelo de dados depois desta spec

```
waitlist_entries/{email-normalizado}
  name: string
  phone: string
  email: string          // igual ao ID, guardado para leitura sem parsear caminho
  consent: boolean
  createdAt: Timestamp

profiles/{uid-do-firebase}
  name: string | null
  phone: string | null
  bio: string | null
  grade: number          // 1..33, validado na aplicacao
  completedAt: Timestamp | null
  waitlistEntryId: string | null   // o e-mail normalizado, ou null
  createdAt: Timestamp
  updatedAt: Timestamp
```

Nenhum índice composto é necessário: as duas leituras são por caminho de documento.

---

## Fluxo depois desta spec

**Cadastro e primeira senha**
```
1. front  POST /auth/signup { email, emailConfirmation }
2. api    admin.createUser({ email, password: <aleatoria descartada> })
3. api    le waitlist_entries/{email}, cria profiles/{uid} com nome e telefone
4. api    REST accounts:sendOobCode { PASSWORD_RESET, email, continueUrl }
5. Google envia o e-mail
6. user   clica e cai na tela do Firebase, define a senha ali
7. user   clica no botao de retorno: <front>/?entrar=1
8. front  abre o dialogo de login
```

Os passos 6 e 7 são inteiramente do Firebase. Nosso código não vê o `oobCode`, não recebe a senha e
não tem endpoint envolvido — é essa ausência que a decisão 3 compra.

O passo 2 cria com senha aleatória forte (`crypto.randomBytes`) descartada na mesma linha, e não sem
senha. `admin.createUser({ email })` cria um usuário sem provedor de senha, e pedir `PASSWORD_RESET`
para uma conta nesse estado é caminho não garantido — o Identity Toolkit trata reset como operação
sobre uma credencial que deveria existir. O efeito colateral vale dizer: entre o cadastro e o clique
no link existe uma conta com senha definida e desconhecida, não adivinhável e não recuperável por
ninguém, inclusive por nós.

**Sessão**
```
login   -> REST signInWithPassword -> idToken (accessToken) + refreshToken (cookie HttpOnly)
refresh -> securetoken.googleapis.com com o refreshToken do cookie
guard   -> admin.auth().verifyIdToken(idToken)
logout  -> admin.auth().revokeRefreshTokens(uid) + limpa o cookie
```

---

## Fora de escopo
- Login social (Google, GitHub) e multi-factor. O Firebase entrega de graça, mas é produto novo, não
  migração.
- Migrar as senhas dos usuários que existem no Supabase. Ver ponto em aberto 1.
- Firebase Hosting, Storage, Functions ou qualquer outro produto além de Auth e Firestore. O Hosting
  é o que permitiria servir a tela de senha em domínio próprio, em vez de `firebaseapp.com` — vale
  uma spec quando a marca importar mais que o custo.
- SMTP próprio para o e-mail do Firebase. É configurável no console e melhoraria o remetente, mas o
  nativo entrega e não bloqueia nada.
- Reimplementar a tela de definir senha com Action URL customizada. É a alternativa que a decisão 3
  descarta, e desfazer essa decisão significa ressuscitar página, endpoint, DTO e testes.
- Mudar o desenho de sessão do front. O interceptor, o `AuthStore` e os guards continuam como estão.
- Backup automatizado do Firestore. Vale existir antes de o projeto ter usuário de verdade, e não é
  esta spec.

---

## Pontos em aberto, para o usuário

Os dois primeiros eu decidi para a spec não travar, com o critério escrito. São reversíveis, e é para
serem contestados na leitura.

1. **Dois projetos Firebase, dev e produção.** *Assumido: sim, dois.* Um projeto só significa que um
   cadastro de teste em `localhost:4200` grava no mesmo Firestore da produção. Com a tela de senha
   sendo do Firebase, o `continueUrl` é passado por requisição e não trava mais nada — mas o banco
   compartilhado sozinho já basta como motivo. É grátis. O custo é dobrar a configuração de console e
   manter dois conjuntos de credenciais.
2. **Emulador do Firebase nos testes.** *Assumido: sim.* Unitários continuam mockando o repository; o
   e2e roda contra `firebase emulators:start`, offline e descartável, e é o único jeito de exercitar
   as security rules da decisão 8. O custo é o Firebase CLI como dependência de desenvolvimento.
3. **Os dados existentes.** A spec 006 registra a sua declaração de que o projeto não tem usuários e é
   de teste. A spec assume isso: **os usuários do Supabase não são migrados** e `profiles` nasce
   vazia. `waitlist_entries` é outra história — ali há inscrição de gente de verdade, e a Fase 02 tem
   uma task de migração. Se ela também for descartável, a task some.
4. **O projeto no Firebase.** Existe um, ou precisa ser criado? O nome define o domínio do remetente
   (`noreply@<projeto>.firebaseapp.com`) e aparece na caixa de entrada do membro.
5. **O `checkRevoked` no guard** (decisão 2). Sem ele, o logout leva até uma hora para derrubar o ID
   token. Com ele, toda requisição autenticada paga uma ida à rede. Para um projeto sem usuários, a
   janela de uma hora me parece aceitável, e é o que a Fase 04 assume — mas é troca de segurança por
   latência, e prefiro que seja escolha e não default silencioso.
6. **O `FRONTEND_URL` de produção.** Continua marcado como Sensitive na Vercel e nunca foi conferido,
   pendência herdada da spec 006, e **volta a ser bloqueante**: ele monta o `continueUrl` da decisão 3
   e governa o CORS. Errado, o botão de retorno da tela do Firebase leva para lugar nenhum.
7. **A política de senha no console.** O piso de 8 caracteres deixa de ser garantido por código
   nosso (decisão 3). Configurar em Authentication > Settings > Password policy, nos dois projetos,
   ou o piso cai para 6 sem aviso.
