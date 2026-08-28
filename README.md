# Eduleno Backend API

API para o serviço da Seita Dev (eduleno-back).

## Funcionalidades
- Endpoint para lista de espera (`POST /waitlist`)
- Autenticação com Firebase Auth (`/auth/*`): cadastro por e-mail, login com e-mail/senha, renovação de sessão e logout. **A senha é definida na nossa tela** (`<front>/acesso`), pelo `oobCode` que chega aqui
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

### A senha é definida na nossa tela

Este é o ponto que o código não conta e que costuma surpreender quem lê só os endpoints.

O cadastro (`POST /auth/signup`) cria o usuário com uma senha aleatória descartada na mesma linha, e
dispara o e-mail de definição de senha pelo Firebase. **O corpo do e-mail continua sendo o do
Firebase**, editado no console; o que a [spec 020](specs/020%20-%20A%20Tela%20de%20Senha%20e%20o%20oobCode/context.md)
construiu foi o destino do link: a tela é nossa, no domínio do front, e o `oobCode` chega nesta API.

```
signup -> e-mail do Firebase -> <front>/acesso -> POST /auth/password -> <front>/?entrar=1
```

> **Este fluxo está construído e não está ligado.** A seta do meio depende da *action URL* do console,
> e **o Firebase recusa alterá-la**, nos dois projetos, com `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED` — cinco
> causas foram testadas e derrubadas em 2026-08-28 (tabela no `context.md` da spec 020). Até que o link
> passe a ser gerado pelo Admin SDK nesta API, **o link do e-mail continua abrindo a tela do Google** em
> `<projeto>.firebaseapp.com/__/auth/action`, e `/acesso` e os três endpoints abaixo existem sem
> tráfego. Nada aqui está quebrado — está desligado por fora.

Três valores parecidos, e trocá-los é o erro fácil:

| Valor | Quem define | O que é |
|---|---|---|
| **Action URL** | Console do Firebase, uma vez por projeto | Para onde **o link do e-mail** leva. Deveria ser `<front>/acesso`; **é `<projeto>.firebaseapp.com/__/auth/action` e não pode ser trocada** (ver o aviso acima) |
| **`continueUrl`** | Esta API, em cada `sendOobCode` | Para onde a **tela** manda a pessoa quando termina: `<front>/?entrar=1` |
| **`mode`** | Query da URL, escrita por quem manda o link | Só escolhe qual tela o front desenha. **Não** escolhe qual operação a API executa |

Apontar o `continueUrl` para `/acesso` produz um laço: a tela termina mandando a pessoa de volta
para a tela.

Duas coisas que parecem faltar e não faltam. **A sessão não nasce aqui**: `POST /auth/password`
responde `204` sem token e sem cookie, e a pessoa entra pelo `POST /auth/login` com a senha que
acabou de criar — sessão nasce num caminho só (spec 005, decisão 5). E **`emailVerified` não
precisa ser marcado à mão**: o próprio `accounts:resetPassword` o marca, porque quem provou receber
o e-mail provou ser dono dele. Acrescentar um `updateUser` em qualquer um dos dois casos desfaz uma
decisão sem citá-la.

### O que vive no console, e não no repositório

Cinco configurações não têm representação em código, e todas afetam o fluxo. **Cada ambiente tem seu
próprio projeto do Firebase**, e todas elas são por projeto: configurar só um é o defeito que nenhum
teste pega, porque funciona em preview e quebra em produção.

| Onde | O quê | Por que importa |
|---|---|---|
| Authentication > Templates > **customize action URL** | ~~`https://liga.lenoborges.com.br/acesso` / `https://ligapreview.lenoborges.com.br/acesso`~~ **não configurável** | O Firebase recusa a troca com `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`, no console e na API `admin/v2/.../config`, nos dois projetos. **Não tente de novo**: permissão, domínio, SMTP próprio, upgrade para Identity Platform e proteção de enumeração de e-mail já foram testados e nenhum é a causa (spec 020). Quem resolve é gerar o link pelo Admin SDK. |
| Authentication > Templates > **SMTP settings** | ~~`smtp.resend.com`, porta 587, usuário `resend`~~ **desligado** | Ficou em `DEFAULT`: com a action URL travada, o SMTP próprio entregaria um e-mail do remetente certo cujo link abre a tela do Google. Os valores continuam gravados no `dev-liga-dev`, então religar é trocar o método — mas só vale junto com o link gerado por nós. |
| Authentication > Settings > Password policy | **Mínimo de 8 caracteres** | É o piso real, e nasce em 6. O front voltou a exigir 8 (spec 020), e isso torna a divergência mais fácil de não notar: se alguém baixar o mínimo aqui, a única coisa que recusa 6 caracteres passa a ser um `Validators.minLength` no navegador. |
| Authentication > Templates | Nome público do projeto e remetente | Aparecem no e-mail e na tela onde a senha é digitada. |
| Authentication > Sign-in method | Provedor Email/Password ligado | Sem ele, nada do fluxo funciona. |

O remetente dos e-mails de ação é **`acesso@lenoborges.com.br`**, e não o `comunidade@` da spec 014.
São dois tipos de e-mail com destinos opostos quando o membro se cansa: o da comunidade tem cabeçalho
de descadastro e a pessoa pode sair dele; o de acesso ela nunca pode perder, porque é o que devolve a
conta para ela. Um endereço só carregando as duas coisas faz quem apertou "marcar como spam" num aviso
de vídeo levar junto o e-mail que abre a própria conta.

O domínio do front precisa estar em **Authentication > Settings > Authorized domains**, e ele já está
— é o mesmo `continueUrl` de sempre. Fica escrito porque `UNAUTHORIZED_DOMAIN` já custou um deploy
inteiro a este projeto: o sintoma foi o cadastro respondendo `202` com ninguém recebendo nada.

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

A maior parte das leituras é por caminho de documento, mas **não todas**. As listagens de vídeo da
trilha (spec 009) e as do Mural (spec 010) são consultas ordenadas, e cada uma exige um **índice
composto** em produção. Eles não estão no repositório — foram criados à mão no console do Firebase, e
a lista completa está em [Índices compostos que produção exige](#índices-compostos-que-produção-exige).

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
- `linkedin`, `instagram` (string ou null — **URL completa**, nunca handle; spec 013)
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

### `POST /auth/password/check`
- Entrada: `{ oobCode }`
- Resposta: `200` `{ email }`
- Comportamento: Confere o código **sem consumi-lo** e diz de quem é o link, para a tela escrever "criando a senha de fulano@exemplo.com". Devolver o e-mail não é o oráculo que o `signup` evita: aqui o requisitante forneceu o `oobCode`, que só chegou por uma caixa de entrada.
- Público, sem guard. Rate limit: 10 req / 60s

### `POST /auth/password`
- Entrada: `{ oobCode, newPassword }`
- Resposta: `204`, **sem corpo, sem token e sem `Set-Cookie`**
- Comportamento: Define a senha e encerra. A sessão nasce no `POST /auth/login`, num caminho só. Concluir a redefinição também marca `emailVerified`, e é o Firebase quem faz isso.
- Público, sem guard. Rate limit: 5 req / 60s

### `POST /auth/email-action`
- Entrada: `{ oobCode }`
- Resposta: `200` `{ email }`
- Comportamento: Aplica `VERIFY_AND_CHANGE_EMAIL`, `VERIFY_EMAIL` ou `RECOVER_EMAIL`. **Qual deles, quem decide é o próprio código** — ele carrega o `requestType`, e o corpo não tem campo `mode`.
- Público, sem guard. Rate limit: 5 req / 60s

> **Os três são públicos de propósito** e o `Throttle` é o único controle que resta: eles precisam
> funcionar para quem nunca esteve logado naquele navegador. O `LegalAcceptanceGuard` da spec 018
> **não** os alcança, e é obrigatório que não alcance — um `428` aqui trancaria a pessoa fora da conta
> pela porta que ela usa para entrar. Os limites não protegem o `oobCode`, que tem entropia de sobra:
> protegem o Identity Toolkit de virar um alvo barato através desta API.

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
- Entrada: `{ name, phone, bio, linkedin?, instagram? }`
- Resposta: `200` `{ id, email, name, phone, bio, grade, linkedin, instagram, profileCompleted, role, tier }`
- Comportamento: Preenche `completed_at` na primeira execução e não sobrescreve nas seguintes.
  As redes são **opcionais e independentes**: campo ausente deixa o valor guardado intacto, string
  vazia remove. O valor guardado é sempre a URL completa — o front normaliza `@fulano` antes de
  mandar, e a API recusa o que não for do domínio certo.
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
- Query: `tab` (`aula` ou `resposta`, opcional) — a aba. Sem ele, as duas
- Resposta: `200` `{ badgeId, videos: [{ id, badgeId, title, description, youtubeId, kind, tab, questionId,
  question, orientation, devTierFree, order }] }`

**`orientation` é derivada e não gravada** (spec 017). Vale `retrato` (9:16, o Short) nas respostas e
`paisagem` (16:9) nas aulas, e **o cliente consome sem recalcular** — é a mesma forma da `phase` do
Mural. Derivar de `kind` do lado da tela faria a mesma regra existir em template, folha de estilo e
teste, e o dia em que uma resposta for gravada em paisagem o conserto exigiria deploy de front.

**`orientation` sai de `kind`, e não de `tab`** (spec 021): a resposta que o admin posicionou na
trilha continua sendo `retrato`, porque a proporção é da gravação e não da lista. Quem decide não
pintar um 9:16 no meio de uma coluna de 16:9 é a tela — no front ela vira um cartão de pergunta com
um botão, e o vídeo abre num modal.

**O parâmetro chamava-se `?kind=` até a spec 021, e não há alias do nome antigo.** Depois dela
`?kind=aula` devolveria vídeos cujo `kind` é `resposta` — um parâmetro que mente sobre o campo que
nomeia. O front é o único cliente e as duas specs entram juntas.

**`question` é uma foto da pergunta**, tirada no momento da publicação: `{ id, title, authorName,
askedAt }`, com `askedAt` em ISO 8601. É o que a tela usa para desenhar o balão acima do player sem uma
segunda leitura. Ela **não substitui `questionId`** — o id serve para navegar, a foto serve para
desenhar — e é `null` em toda aula e em todo vídeo anterior à spec 017.

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
| `GET` | `/admin/users?q&onboarding&tiers&gradeMin&gradeMax&limit&offset` | Encontra um membro na base inteira. Ver abaixo |
| `GET` | `/admin/users/:id` | Um membro inteiro: perfil, acesso, estado de e-mail e datas |
| `POST` | `/admin/users/:id/email` | Escreve e envia um e-mail para aquele membro (campanha `direto`) |
| `PATCH` | `/admin/users/:id` | Altera `grade` e `tier`, em requisições separadas |
| `GET` | `/admin/badges/:badgeId/videos?tab` | Vídeos da insígnia. **Sem `tab`, as duas abas juntas** |
| `POST` | `/admin/badges/:badgeId/videos` | Publica; recebe URL (**Shorts inclusive**), grava o ID; entra no fim da ordem da aba |
| `PATCH` | `/admin/badges/:badgeId/videos/order?tab` | Reordena uma aba em lote atômico. Sem `tab`, Aulas |
| `PATCH` | `/admin/badges/:badgeId/videos/:videoId` | Edita título e descrição |
| `DELETE` | `/admin/badges/:badgeId/videos/:videoId` | Remove e renormaliza a ordem |

#### `GET /admin/users` — encontrar um membro (spec 015)

**A busca e os filtros são aplicados sobre a base inteira, antes da paginação.** Isso é o desenho, e
não um detalhe: filtrar uma página é filtrar errado. Com 213 membros e um filtro de "onboarding
pendente", uma página de 50 devolveria os pendentes que por acaso caíram nos primeiros 50 `uid`s, a
tela diria "3 membros" com toda a confiança do mundo, e nada denunciaria.

Cada chamada percorre o `listUsers` do Auth até o fim (páginas de 1000) e cruza com `profiles` por
`getAll` de caminho — `N/1000` chamadas ao Auth mais `N` leituras, **por busca digitada**. Não há
cache, e a recusa é deliberada: a API roda em função serverless, o cache seria por instância, e o
primeiro sintoma seria o admin trocar um tier, recarregar e ver o valor antigo em algumas requisições
e não em outras. A única contenção é o atraso de digitação do front.

| Query | Padrão | O que é |
|---|---|---|
| `q` | — | Trecho de **nome ou e-mail**, sem acento e sem caixa. É `contains`, e não prefixo. Telefone não é buscável |
| `onboarding` | — | `pendente` ou `concluido`. `pendente` inclui **quem não tem documento de perfil nenhum**. Ausente traz os dois |
| `tiers` | — | Lista de `TierId`. Ausente significa **todos**, e nunca nenhum |
| `gradeMin` / `gradeMax` | — | Faixa de etapas concluídas, 0 a 13, inclusiva. Mínima maior que máxima responde `400` |
| `limit` | 50 | Teto de 200. Acima disso é fixado no teto, sem erro: é paginação, não pedido de dados |
| `offset` | 0 | Deslocamento **dentro do recorte** |

A resposta traz `users`, `total`, `offset` e `limit`. **`total` é o tamanho do recorte, e não da
base** — com filtro ligado os dois números são diferentes, e a tela precisa escrever a diferença.

Ordem: **os mais recentes primeiro** (`createdAt` decrescente). Não é a ordem da audiência de e-mail,
que é por `uid` porque o cursor de retomada depende de uma ordem estável entre execuções.

`phone`, `bio`, `linkedin`, `instagram`, o motivo do descadastro e as datas do perfil **não saem na
listagem**: eles vivem só em `GET /admin/users/:id`, e a regra é da API e não do CSS. Uma listagem que
carrega isso de 200 pessoas trafega dado pessoal que ninguém pediu.

`GET /admin/users/:id` responde `200` com os campos de perfil nulos para quem não terminou o
onboarding — **nunca `404`**, que diria "não existe" sobre quem a lista acabou de mostrar. Ele
devolve também `canReceiveEmail` e `cannotReceiveReason` (`desativado`, `email-nao-verificado`,
`descadastrado`), derivados da mesma função que corta a audiência de e-mail.

`POST /admin/users/:id/email` recebe `subject` e `body`, cria uma campanha `kind: 'direto'` e envia
pelo **mesmo** caminho da campanha — mesmo template, mesmo lote, **mesmo rodapé de descadastro**.
Responde `404` para `uid` inexistente, `409` se houver disparo em andamento, e `422` com o `reason`
nomeado quando o membro não pode receber.

### Coleção `badge_videos` (spec 009)

**ID do documento: `{badgeId}__{youtubeId}`.**

- `badgeId` (string) — uma das treze etapas de `src/track/track.constants.ts`
- `title` (string) — **o título da plataforma**, obrigatório. Não é o do YouTube
- `description` (string ou null)
- `youtubeId` (string) — só o ID, nunca a URL
- `order` (number) — posição dentro da insígnia **e da lista**, inteiro de 0 a n-1
- `createdAt`, `updatedAt` (Timestamp)

O caminho composto é o que garante que **o mesmo vídeo não entra duas vezes na mesma insígnia** — o
`create()` falha com `ALREADY_EXISTS` —, e ao mesmo tempo permite o mesmo vídeo em duas insígnias
diferentes, que é um caso real: um vídeo de Git serve à insígnia de Git e à de DevOps.

O título é nosso porque o do YouTube é de lá: aquele é escrito para o algoritmo, este diz onde a
pessoa está na trilha e precisa poder ser reescrito sem republicar o vídeo.

Guarda-se o ID e não a URL porque ela chega em seis formas (`watch?v=`, `youtu.be/`, `/embed/`,
`/shorts/`, com `&t=`, com `?si=`). A extração acontece uma vez, na entrada, em
`src/track/youtube-id.ts`, e **essa lista é a lista inteira que o produto aceita** — forma que não está
lá é `400` na cara do admin. A de Shorts esteve de fora até a spec 017, e enquanto isso a aba de
respostas parecia pronta e recusava o único link que o YouTube copia num celular.

Short não precisa de nada além da extração: o ID dele é o mesmo ID de 11 caracteres e o player de embed
serve Short sem tratamento especial. O que muda na tela é só a proporção do iframe, e ela sai do
`orientation` derivado no DTO.

**Esta é a primeira consulta do sistema que não é por caminho**, e por isso a primeira que precisa de
índice composto no Firestore de produção. A spec 010 acrescentou o filtro por aba, e com ele um
segundo índice — os dois estão em [Índices compostos que produção
exige](#índices-compostos-que-produção-exige), que é a lista única.

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

### O adiantamento é um piso, e nunca um estado (spec 016)

**A fase de uma pergunta é o maior entre a conta do relógio e o piso da promoção**, na escala
`coleta < votacao < encerrada`:

```
fase(pergunta, agora) = max( fase natural da semana, promotedTo ?? 'coleta' )
```

O admin adianta **uma** pergunta pelo `PATCH /admin/mural/perguntas/:id/fase`: `votacao` abre o voto
agora, sem esperar domingo, e `encerrada` tira do mural e põe na pauta, para gravar o vídeo hoje.

O relógio continua sendo a autoridade quando está à frente, e é por isso que isto é um piso e não um
`status`: uma pergunta promovida a `votacao` em agosto não fica presa em votação para sempre —
quando a semana dela virar, a conta devolve `encerrada` sozinha. **Nenhum valor gravado pode ficar
velho, porque nenhum valor gravado decide sozinho.**

**A promoção é de mão única** — promover para uma fase igual ou anterior responde 409. Despromover
deixaria a pergunta editável de novo com votos em cima dela, e quem votou votou naquele texto; o
caminho de arrependimento é o `DELETE`, que apaga os votos junto.

**Adiantar custa zero para quem não foi adiantado.** A votação das demais continua como estava, o
ciclo da semana não se move, e a semana continua elegendo a vencedora dela entre as que sobraram — a
adiantada é que fica fora dessa conta, porque ela receberia voto por até 14 dias contra 7 de todas as
outras. A consequência aceita é que a semana com adiantamento pode render dois vídeos.

**Adiantar não abre vaga para uma pergunta nova.** O ID continua sendo `{weekId}__{uid}` e a promoção
não o toca: `canAsk` segue falso para quem já perguntou.

### Endpoints

| Método | Rota | Guards | O que faz |
|---|---|---|---|
| `GET` | `/mural` | auth | Estado do ciclo: semanas, virada, `canAsk`, `myQuestionId` e **`myQuestion` inteira** |
| `GET` | `/mural/perguntas?fase=` | auth | `coleta` ou `votacao`. **A aba sai da fase derivada**, e não do `weekId` |
| `POST` | `/mural/perguntas` | auth + **tier pago** | Cria. 403 para Dev Tier, 409 se já perguntou |
| `PUT` | `/mural/perguntas/:id` | auth + dono | Reescreve, só na semana em coleta |
| `POST` | `/mural/perguntas/:id/voto` | auth | Vota. Só na semana em votação |
| `DELETE` | `/mural/perguntas/:id/voto` | auth | Desfaz. Idempotente |
| `GET` | `/mural/vencedoras` | auth | A pauta: vencedoras **e adiantadas**, cada linha com `origem` |
| `DELETE` | `/admin/mural/perguntas/:id` | auth + admin | Modera. Apaga os votos junto |
| `PATCH` | `/admin/mural/perguntas/:id/fase` | auth + admin | Adianta. Corpo `{ fase }`, `votacao` ou `encerrada`. 409 se não avançar |

### Coleção `mural_questions`

**ID do documento: `{weekId}__{uid}`.**

- `weekId` (string) — data do domingo que abre a semana, `YYYY-MM-DD`
- `badgeId` (string) — uma das treze etapas da trilha
- `authorUid`, `authorName` (string) — o nome é **denormalizado**: listar trinta perguntas não pode
  custar trinta leituras de perfil. O preço é o nome ficar velho se a pessoa mudar depois
- `title` (10 a 140), `body` (string ou null, até 1000) — **texto puro**, sem markdown e sem HTML
- `voteCount` (number) — contador denormalizado, mantido por `FieldValue.increment` em lote
- `answerVideoId` (string ou null)
- `promotedTo` (`votacao`, `encerrada` ou null) — o adiantamento do admin (spec 016). **É piso, e
  nunca estado**: levanta o chão da fase e nunca a segura. Documento anterior à spec 016 não tem o
  campo e lê como `null`
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

### Subcoleção `profiles/{uid}/legal_acceptances/{documentId}__{version}`

O histórico de aceites dos documentos legais (spec 018). O caminho carrega a versão, e é ele que
garante a idempotência: duplo clique não grava duas vezes, retry tampouco. **`create()`, nunca
`set()`** — `ALREADY_EXISTS` aqui significa "já tinha aceitado", que é sucesso, e reescrever apagaria
a data em que a pessoa realmente concordou, que é a única prova que existe.

Ela convive com o mapa `legalAcceptances` no próprio perfil, e a diferença é o ponto: o **mapa**
responde "esta pessoa está em dia" na leitura que a requisição já faz — é o que o
`LegalAcceptanceGuard` lê a cada request, sem consulta e sem índice; a **subcoleção** responde "quando
ela aceitou a versão de agosto", que o mapa perde ao sobrescrever na versão seguinte.

**Não há IP nem user-agent aqui.** A pessoa está autenticada: uid, data e versão já dizem quem aceitou
o quê e quando. IP seria dado pessoal novo, com finalidade única de uma disputa que não existe — e é o
primeiro passo do caminho que quebra a condição da spec 013 (nenhuma coleção nova pode ligar `uid` a
dado pessoal).

> **Terceira subcoleção do produto, e a terceira vez que a mesma regra vale:** apagar um perfil precisa
> apagá-la explicitamente, junto de `notification_reads` e dos votos do Mural.

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
a lista embaralha as duas de uma vez, e é o erro mais provável de quem mexer nisso.

> **Emenda da spec 021.** O eixo dessa ordem passou a ser `(badgeId, tab)`. É a mesma garantia, sobre
> a lista certa: `kind` deixou de ser o endereço do vídeo. E o padrão continua sendo duas listas —
> "aula se assiste em ordem, resposta se consulta por assunto" —, mas **ele passa a poder ser
> dispensado por vídeo, na publicação**, por decisão explícita de quem publica.

**A precedência do `devTierFree` é total**: quando existir gate de conteúdo, ele começa por essa flag
e sai. Existe porque o Mural cria uma armadilha — a melhor pergunta da semana pode ser sobre Angular,
e a resposta nasceria trancada para 90% de quem votou nela.

### A resposta carrega a pergunta dentro dela (spec 017)

`badge_videos` ganha um campo, e ele é um objeto:

- `question` (objeto ou null) — `{ id, title, authorName, askedAt }`, **fotografado na publicação**

Publicar com `kind: resposta` passa a **exigir** `questionId` — a outra metade da simetria que a spec
010 escreveu em comentário e não implementou —, a pergunta é lida uma vez por caminho direto, e id que
não existe responde `404`. Aula com `questionId` continua respondendo `400`.

**Por que uma foto e não uma junção**, em três motivos que se somam:

1. **Não custa leitura por visita.** A alternativa era um `getAll` sobre os `questionId` a cada
   listagem — uma leitura a mais por resposta, toda vez que alguém abre a aba. Aqui é uma leitura por
   vídeo publicado.
2. **Sobrevive à remoção da pergunta.** O admin pode apagar uma pergunta do Mural e o vídeo continua no
   ar. Com junção, o balão sumiria junto e sobraria um vídeo que ninguém entende.
3. **É o que foi perguntado, e não o que a pergunta virou.** O autor edita a pergunta enquanto ela está
   em coleta (spec 016), e o vídeo respondeu a versão antiga.

O preço está aceito e declarado: **editar a pergunta depois não muda o balão.** E `askedAt` é o
`createdAt` da pergunta, nunca o do vídeo — o balão diz quando alguém teve a dúvida, e a data em que o
vídeo foi gravado não é informação de ninguém.

Publicada a resposta, a `MuralQuestion` recebe `answerVideoId` — o campo que existe desde a spec 010 e
que até aqui nada nunca escreveu. Essa escrita vem **por último** e falha em silêncio, com log: quando
ela roda, o vídeo já está gravado, já foi notificado e já foi anunciado, e um `500` aqui perderia o
trabalho do admin por causa de um ponteiro. Nada do lado do aluno quebra quando ela falha, porque **o
balão vem da foto e não do vínculo.**

### A resposta que vive na trilha (spec 021)

`badge_videos` ganha **um** campo:

- `tab` (`'aula' | 'resposta'`) — **a lista em que o vídeo vive**

**`kind` é a natureza do vídeo; `tab` é o endereço dele.** Até esta spec um campo fazia as duas
coisas, porque elas andavam juntas: resposta tinha balão *e* vivia na aba de respostas. Agora uma
resposta posicionada na trilha **continua sendo resposta** — mantém a pergunta fotografada, o balão e
o `retrato` — e **passa a viver na lista das aulas**. Os dois campos divergem em exatamente esse caso.

**Todo documento anterior a esta spec precisa ganhar o campo, por escrita:** `npm run tab:backfill`,
nos **dois projetos**, **antes de o código novo receber tráfego**. Ele grava `tab = kind ?? 'aula'` —
a lista em que o vídeo já estava, então nenhum vídeo muda de lugar — em lotes e de forma idempotente,
com `--dry-run` para conferir antes.

**O fallback do converter (`tab = data.tab ?? data.kind ?? 'aula'`) continua no lugar, e não substitui
o backfill.** A distinção custou uma verificação contra o Firestore real e vale escrever por extenso:
**o converter conserta a LEITURA de um documento que a consulta já devolveu, e a consulta acontece
antes dela.** `where('tab', '==', 'aula')` **não enxerga documento que não tem o campo `tab`** — ele
nunca é devolvido, logo nunca é lido, logo nunca ganha o padrão. Sem o backfill, a trilha responde
**`200` com lista vazia**: some inteira, sem ninguém ter apagado nada e sem erro em log nenhum.

É a mesma armadilha do `promotedTo` da spec 016, descrita mais abaixo nesta página, pelo outro lado:
lá era `== null`, aqui é a ausência do campo. E o fallback tem teste-trava porque continua sendo o
cinto de segurança da leitura — como os de `kind` (010) e `devTierFree` (009) —, e não porque ele
resolva a consulta.

**Não é um booleano `naTrilha`, e a razão é a consulta.** Com ele, listar a trilha viraria
`kind == 'aula'` **ou** `naTrilha == true`, e uma disjunção com `orderBy` no Firestore custa índice
novo e plano imprevisível. Com `tab`, a consulta é a de sempre com outro nome de campo.

A aba de destino é escolhida **na publicação, e só nela**: `POST /admin/badges/:badgeId/videos` aceita
`tab`, e sem ele vale `tab = kind` — o cliente que não conhece esta spec continua funcionando sem
enviar nada, e é isso que permite subir a API antes do front. Não há `PATCH` para mover um vídeo de
lista depois; o conserto de um engano é remover e republicar. Mover depois é renormalizar duas listas
na mesma transação mais uma tela no painel, e isso só se paga quando existir a primeira reclamação.

`kind: 'aula'` com `tab: 'resposta'` é **`400`** — o terceiro estado incoerente da família que a spec
017 abriu, junto de resposta sem pergunta e aula com pergunta. A aba de respostas é a lista das
perguntas respondidas, e uma aula ali é um vídeo sem balão numa lista de balões. O caminho contrário é
o que a spec existe para permitir, e não valida nada.

**O XP não ganha nada, e isso é verificação e não omissão.** `PUT /me/watched-videos/:videoId` lê
`badge_videos/{videoId}`, confirma que o vídeo existe e paga os 10 XP uma vez — não olha `kind` nem
`tab`. Uma resposta posicionada na trilha conta XP sem uma linha escrita, e uma resposta na aba já
contava. Não existe regra de XP por lista.

## Notificações Internas (spec 012)

Dois eventos avisam a comunidade: **vídeo novo numa insígnia** e **pergunta nova no Mural**. A lista
curta é proposital — um canal que começa com sete gatilhos vira ruído antes de virar hábito, e o
primeiro reflexo de quem recebe ruído é ignorar o sino para sempre.

**Uma notificação por evento, nunca uma por pessoa.** Fan-out custaria N escritas por evento e
cresceria com a comunidade; aqui a notificação é um documento global e o que é por pessoa é apenas o
que ela já leu.

| Método | Rota | Guard | O que faz |
|---|---|---|---|
| `GET` | `/notificacoes` | auth | Não lidas dos últimos 30 dias, no máximo 50, mais recentes primeiro |
| `POST` | `/notificacoes/:id/lida` | auth | Marca uma. **Idempotente**: 204 mesmo se já estava |
| `POST` | `/notificacoes/lidas` | auth | Marca todas as que aquela pessoa veria. 204 |

A listagem **já vem filtrada**: sem as do próprio autor, sem as anteriores à entrada do membro, sem as
já lidas. Não existe campo `read` na resposta, e o cliente não peneira nada.

### Coleção `notifications` (spec 012)

**ID do documento: `video__{badgeId}__{youtubeId}` ou `pergunta__{questionId}`.**

- `kind` (`video` | `pergunta`)
- `title` (string) — do vídeo ou da pergunta, cru; abreviar é decisão de layout
- `badgeId` (string)
- `actorUid` (string) — quem publicou, e quem **não** é notificado
- `targetId` (string) — o `youtubeId` ou o id da pergunta
- `createdAt` (Timestamp)

O que cada pessoa leu vive em **`profiles/{uid}/notification_reads/{notificationId}`**, lido com um
`getAll` por caminho como o `findMyVotes` do Mural. Um array no perfil cresceria sem teto, e o perfil é
lido em toda requisição autenticada.

**É a única coleção onde `set()` é correto e `create()` seria errado**: marcar como lida tem dois
chamadores no painel — o modal da notificação e o botão de check da linha — e precisa ser idempotente.
Um 409 em "já li isso" seria um erro sem nada a consertar.

> **Notificar nunca derruba a publicação.** O aviso é escrito depois do vídeo e da pergunta, fora de
> qualquer transação, e a falha vira log. Um `POST` que responde 500 porque a notificação falhou é uma
> API que perde o trabalho de quem publicou por causa de um acessório.

### Índices compostos que produção exige

Esta é a lista única. As seções acima apontam para cá em vez de repeti-la: uma lista de índices
copiada em três lugares diverge dos três.

**Agora eles são código.** `firestore.indexes.json` está no repositório e entra pelo `firebase.json`;
`firebase deploy --only firestore:indexes --project <id>` os publica.

Até 2026-08-28 eles existiam só como criação manual no console de produção, feita em 2026-08-18, e o
preço apareceu no dia em que alguém abriu o projeto de testes: **`dev-liga-dev` nunca os teve**, e as
telas da Trilha e do Mural respondiam "não consegui carregar" — as duas únicas telas do produto que
dependem de consulta ordenada. Nenhum teste falhou, porque o emulador não exige índice; a suíte
continuou verde enquanto metade do produto não abria.

> **O deploy é sempre com `--project` explícito.** Não há `.firebaserc` e não deve haver um: existem
> dois projetos parecidos — `dev-liga-dev` e o de produção — e um projeto padrão implícito é a forma
> mais barata de publicar no lugar errado sem perceber.

| Coleção | Campos | Consulta que o exige |
|---|---|---|
| `mural_questions` | `weekId` asc + `voteCount` desc + `createdAt` asc | `listByWeek(byVotes: true)` e `findWinner` |
| `mural_questions` | `weekId` asc + `createdAt` asc | `listByWeek(byVotes: false)`, a semana em coleta |
| `badge_videos` | `badgeId` asc + `order` asc | `listByBadge()` **sem** `tab` — a visão da administração |
| `badge_videos` | `badgeId` asc + `tab` asc + `order` asc | `listByBadge(tab)` — as abas Aulas e Perguntas Frequentes |

**A spec 012 não acrescentou nenhuma linha a esta tabela, e isso é decisão.** A consulta de
notificações é `orderBy('createdAt', 'desc').limit(50)` — ordenação por um campo só, que o índice de
campo único do Firestore já atende. É por isso que os cortes por autor e por data de entrada acontecem
em memória no service e não em `where`: cada `where` aqui viraria uma linha nova acima. E o
`ordem=recentes` do Mural também não pede índice — inverter **todas** as direções de uma consulta
ordenada usa o mesmo índice `weekId` + `createdAt` da segunda linha. Criar um "por precaução" é pagar
escrita para sempre por uma consulta que não existe.

**A spec 016 também não acrescenta nenhuma linha, e vale dizê-lo em voz alta** porque "spec nova,
índice novo" é a suposição padrão e aqui ela é falsa. A listagem passou a carregar as duas semanas
vivas e a particionar pela fase **em memória**, e a vencedora saiu do `limit(1)` para uma escolha
também em memória — as consultas por semana que pedem índice continuam exatamente as mesmas, com o
mesmo `orderBy`. O caminho oposto — emendar cada aba com um `where` por `promotedTo` — pediria dois
índices novos e ainda cairia na armadilha do `== null`: no Firestore, `where('campo', '==', null)`
**não enxerga documento que não tem o campo**, e todo documento anterior à spec 016 não tem
`promotedTo`. O histórico de vencedoras apareceria vazio para todas as semanas anteriores, sem erro,
com a resposta 200.

**A spec 017 também não acrescenta nenhuma linha**, e pelo motivo mais simples de todos: a foto da
pergunta mora **dentro** do documento do vídeo, o `orientation` é derivado e não existe no banco, e a
única leitura nova é `mural_questions/{id}` — caminho direto, que não usa índice. O filtro de aba que o
`GET` do admin ganhou usa a quarta linha, que já estava lá.

**A spec 021 troca a quarta linha de campo, e não acrescenta linha nenhuma.** `badgeId` + `kind` +
`order` sai e `badgeId` + `tab` + `order` entra — é substituição, porque nenhuma consulta filtra por
`kind` depois dela. **Publique o índice antes de o código novo receber tráfego**: sem ele a consulta
responde erro com o link para criá-lo, e o emulador não avisa porque não exige índice nenhum. O índice
novo **demora alguns minutos construindo** depois do deploy, e enquanto constrói a consulta ainda falha
— com uma mensagem própria, que diz que ele está sendo criado.

**Apague o índice antigo só depois de o código novo estar no ar.** O `firebase deploy` não apaga
índice que sumiu do arquivo a menos que receba `--force`, e esse padrão é o certo aqui: enquanto a
versão publicada ainda consulta por `kind`, apagar `badgeId + kind + order` derruba a trilha em
produção.

A terceira linha é fácil de perder de vista, e ela já tinha sido perdida uma vez: a aba é opcional em
`listByBadge`, então **`badgeId` + `order` é uma consulta de verdade**, não um prefixo da de baixo. O
Firestore não usa um índice de três campos para servir uma consulta de dois.

A coluna da direita existe para que ninguém apague um índice "que ninguém usa". Índice sem consulta é
custo de escrita em toda gravação; consulta sem índice é uma tela que quebra em produção. As duas
perguntas se respondem na mesma tabela.

> **O emulador não exige índice.** A suíte passa verde sem nenhum deles, e por isso a existência de um
> índice em produção **nunca é verificada por teste**. É a mesma forma de falha dos dois fixes da spec
> 007 — o `require(esm)` que o Node local aceita e o `localhost` que o Firebase autoriza de fábrica.
> O ambiente onde tudo funciona é o ambiente que não faz a pergunta.

Para conferir o que existe no projeto linkado, sem depender de memória:

```bash
firebase firestore:indexes    # imprime os índices do projeto, em JSON
```

**Um quinto índice existe no projeto e está marcado para remoção:** `mural_questions` por
`voteCount desc` + `createdAt asc`, **sem o `weekId` na frente**. Nenhuma consulta é assim — os dois
`orderBy('voteCount')` do repositório vêm depois de um `where('weekId', '==', ...)`, e um índice que
não começa pelo campo do filtro de igualdade não serve nenhum deles. Ele encarece toda gravação de
voto, que é a escrita mais frequente do sistema. Se ele reaparecer depois de removido, é rascunho ou
clique em link de erro, não requisito.

---

## Meu Perfil: credencial e exclusão de conta (spec 013)

Até aqui esta API mexia em conteúdo — vídeo, pergunta, voto. Estas quatro operações mexem em
**credencial** e em **direito de eliminação**, e as duas coisas têm regras próprias.

| Operação | Endpoint | Reautentica? | Encerra a sessão? |
|---|---|---|---|
| Editar nome, bio, telefone e redes | `PATCH /me/profile` | não | não |
| Trocar de e-mail | `POST /me/email` | **sim** | quando a troca for confirmada |
| Trocar de senha | `POST /me/password` | **sim** | **sim, na hora** |
| Excluir a conta | `DELETE /me` | **sim** | **sim, e para sempre** |

A régua é a mesma nas três de baixo: **quem prova ser o dono é a senha, não o token.** Um ID token
roubado vale uma hora, e uma hora é tempo suficiente para trocar o e-mail de acesso e tomar a conta
para sempre. Quem confere a senha é um lugar só — `AuthService.reauthenticate`, que bate no mesmo
`accounts:signInWithPassword` do login. Dois verificadores de senha divergem na primeira exceção.

### `POST /me/email`

- Entrada: `{ newEmail, password }` · Resposta: `202` `{ status: 'confirmation_sent' }`
- Rate limit: 3 req / 60s

**Este endpoint não troca o e-mail.** Ele reautentica e pede ao Identity Toolkit um `sendOobCode` com
`VERIFY_AND_CHANGE_EMAIL`; quem troca é o Google, quando o link for clicado. É a mesma decisão da
definição de senha (spec 007): o `oobCode` não passa por esta API e não existe tela nossa que o
consuma. Até o clique, o login continua sendo pelo e-mail antigo.

**A confirmação vai para o endereço novo, não para o antigo**, e essa ordem é o ponto inteiro: um fluxo
que confirma na caixa velha prova que a pessoa ainda tem a caixa que está abandonando.

E-mail inválido, e-mail igual ao atual e e-mail que já pertence a outra conta respondem `400` com a
**mesma mensagem**. É desconfortável e é deliberado: distinguir reabriria, atrás de um login, o oráculo
de enumeração que a spec 005 fechou no cadastro — e um login é barato de conseguir.

### `POST /me/password`

- Entrada: `{ currentPassword, newPassword }` · Resposta: `204`, cookie limpo
- Rate limit: 3 req / 60s

Reautentica, troca com `accounts:update`, **revoga os refresh tokens de todos os aparelhos** e apaga o
cookie deste navegador. Encerrar a sessão não é efeito colateral: trocar a senha por desconfiar de
invasão e seguir com o invasor logado é não ter trocado a senha.

Não há rotação do par de tokens, e o motivo é mecânico: o cookie de refresh mora em `path=/auth`, então
uma resposta de `/me` não consegue lê-lo para rotacioná-lo.

**A revogação não é corte imediato.** O ID token já emitido continua valendo por até uma hora, porque o
guard roda com `CHECK_REVOKED = false` (spec 007). A janela é conhecida e é o preço já aceito lá.

O piso da senha nova é a **política do console** (Authentication > Settings > Password policy), não o
`@MinLength(8)` do DTO — esse é cortesia, para dar erro melhor antes da viagem.

### `DELETE /me` — o que some e o que vira anônimo

- Entrada: `{ password }` · Resposta: `204`, cookie limpo
- Rate limit: 3 req / 60s

**É imediato, irreversível e não tem desfazer.** Não há lixeira de 30 dias: manter o dado que a pessoa
acabou de pedir para eliminar é o contrário do pedido.

| Some de verdade | Vira anônimo |
|---|---|
| Usuário do Firebase Auth | `mural_questions` de autoria dela |
| `profiles/{uid}` | |
| `profiles/{uid}/notification_reads/*` | |
| Votos dados por ela, em `{questionId}/votes/{uid}` | |
| `waitlist_entries/{email}`, se houver | |

A pergunta do Mural não é só de quem perguntou: tem votos de outras pessoas, pode ter vencido a semana e
pode ter virado vídeo na trilha. Apagá-la levaria junto o voto de terceiros e deixaria um vídeo
respondendo a uma pergunta que não existe mais. Então o texto fica e o autor some — `authorUid` vira
`__removido__` e `authorName` vira `Membro removido`. Título, corpo, `badgeId`, `voteCount` e
`answerVideoId` ficam intactos.

Consequência para quem consome: **`authorUid` deixa de ser garantia de que existe um perfil por trás
dele.** Quem cruzar os dois precisa tolerar a ausência.

**A ordem é fixa e o Auth é o último a morrer.** Não existe transação atravessando Firestore e Firebase
Auth, então o que dá para escolher é qual metade fica de pé quando a outra falha. Com o Auth por último,
uma falha no meio deixa a conta viva e a pessoa capaz de tentar de novo. Com o Auth primeiro, deixa dado
pessoal órfão no Firestore — sem conta, sem sessão e sem ninguém com direito de pedir a remoção.

> **A anonimização só continua valendo sob uma condição: nenhuma coleção nova pode guardar `uid` ao lado
> de dado pessoal.** O `uid` sobrevive no caminho do documento da pergunta (`{weekId}__{uid}`) e depois
> da exclusão é uma cadeia opaca que não resolve para ninguém — não há usuário no Auth, não há perfil,
> não há entrada na lista de espera. Um log persistente com uid e e-mail juntos, uma tabela de analytics
> ou um backup de perfil "por garantia" reatam o vínculo e transformam eliminação em pseudonimização. É
> a restrição que a próxima spec de observabilidade precisa ler antes da primeira linha.

**Admin recebe `403`.** A claim `role` é aplicada à mão pelo console, e um admin que se exclui leva
junto a única forma de administrar o produto. Não é proteção de segurança, é trava contra tijolo — e
está no backend porque o front esconder o botão seria proteção nenhuma. Excluir a conta de terceiros
continua não existindo: é spec própria, com trilha de auditoria.

**Nenhum índice composto novo.** As três operações críticas leem por caminho; a anonimização é um
`where('authorUid', '==', uid)` de campo único, que o índice automático já atende; e achar os votos é
varredura de `mural_questions` com `getAll` por caminho, não consulta — índice de collection group seria
custo mensal por um evento que acontece uma vez na vida de cada membro.

---

## Disparo de E-mails (spec 014)

A spec 012 criou o canal de notificação e o fechou dentro do painel: o aviso só existia para quem
entrava. **Um aviso que depende da visita não avisa ninguém.** Esta spec abre o primeiro canal que sai do
produto — e-mail —, e faz duas coisas pelo mesmo caminho de envio: **vídeo novo vira e-mail
automaticamente**, e **o admin escreve e dispara** para todos ou para um recorte.

### O que dispara e-mail, e o que não dispara

| Origem | Vira e-mail? | Por quê |
|---|---|---|
| **Vídeo novo numa insígnia** | **Sim** | Evento do produto: raro, previsível, um por semana |
| **Pergunta nova no Mural** | **Não** | Evento de membro: o volume cresce com a comunidade |
| **Disparo manual do admin** | **Sim** | É a metade desta spec |
| Troca de e-mail, senha, verificação | Fora | São os e-mails que o **próprio Firebase** dispara (spec 007) |

A ausência da pergunta é a decisão mais importante da tabela. Vídeo é publicado pelo produto e o número
não muda quando a comunidade dobra; pergunta é escrita por membro, e o número **é** o tamanho da
comunidade. Com cinquenta membros ativos, "pergunta nova vira e-mail" são cinquenta e-mails por semana na
caixa de cada um — e o resultado não é engajamento, é a regra de filtro que a pessoa cria para o
remetente. Depois disso, o e-mail de vídeo também nunca mais é visto. **O painel avisa do que é
frequente; o e-mail avisa do que é raro.**

### Endpoints

| Método | Rota | Guard | O que faz |
|---|---|---|---|
| `POST` | `/admin/emails/audiencia` | admin | Contagem da audiência para um conjunto de filtros. **Só o número** |
| `POST` | `/admin/emails/teste` | admin | Monta e envia para o próprio admin. Não cria campanha |
| `POST` | `/admin/emails` | admin | Cria a campanha e dispara. **409** se já houver uma enviando |
| `POST` | `/admin/emails/:id/retomar` | admin | Retoma uma `interrompida` a partir do `cursorUid` |
| `GET` | `/admin/emails` | admin | As 20 mais recentes, para o histórico |
| `POST` | `/emails/descadastro` | **público**, token | Descadastra. Idempotente: 204 mesmo se já estava |
| `POST` | `/emails/webhook/resend` | **público**, assinatura | Bounce permanente e reclamação viram descadastro |
| `PATCH` | `/me/emails` | auth | O membro liga e desliga o recebimento pelo próprio perfil |

A prévia devolve contagem e **não devolve a lista de e-mails**: o admin precisa saber *quantos*, e a tela
já lista os membros em `/dashboard/admin/usuarios`. Uma rota que despeja a base a cada mudança de filtro
é um vazamento esperando um bug de autorização.

**`POST /admin/emails` envia dentro da requisição**, e a resposta é o resultado, não um aceite.

| Situação | Resposta |
|---|---|
| Já existe campanha enviando | `409` |
| Filtros que não pegam ninguém | `400` — campanha para zero pessoa é sempre engano |
| Token de descadastro inválido | `204` mesmo assim: distinguir seria um oráculo de `uid` |
| Assinatura de webhook inválida | `401`, e nada é escrito |
| Campanha `concluida` recebendo `retomar` | `409` |

### O descadastro é absoluto

Três campos em `profiles/{uid}`: `emailOptOut`, `emailOptOutReason` (`membro`, `bounce` ou `reclamacao`) e
`emailOptOutAt`.

**Não existe "e-mail que ignora o descadastro" neste código.** Nem o manual, nem o automático, nem um
futuro "aviso importante". A exceção legítima — e-mail de conta, como redefinição de senha e verificação
de endereço — não passa por aqui: quem os dispara é o Firebase, por outro caminho (spec 007). Essa
separação é o que permite a regra ser absoluta sem prejudicar ninguém.

O link do rodapé carrega `uid` e uma assinatura HMAC-SHA256, o endpoint é **público** e o token **não
expira**. Exigir login para descadastrar é a prática que gera denúncia de spam: quem quer sair não vai
lembrar a senha, e o botão que ele encontra primeiro é o "marcar como spam" do cliente de e-mail — que
custa reputação de domínio, ao contrário do descadastro, que não custa nada.

Junto vão os cabeçalhos `List-Unsubscribe` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
**São requisito de remetente em massa do Gmail e do Yahoo desde 2024**, não refinamento: sem eles a
entrega degrada por política, independentemente do conteúdo.

**Bounce permanente e reclamação de spam desligam o endereço sozinhos**, pelo webhook. Bounce temporário
não desliga nada: caixa cheia volta a funcionar, e tratar `soft bounce` como descadastro remove membro
válido por causa de uma semana de férias.

### O envio: lotes de 100 e um cursor

A audiência sai do Firebase Auth cruzado com `profiles`, **ordenada por `uid`**, e é enviada em lotes de
100. Depois de cada lote, a campanha grava `cursorUid` e `sentCount`.

Saem da audiência, sempre e sem exceção configurável: `disabled: true` no Auth, `emailVerified: false`
(endereço não confirmado é candidato a erro de digitação, e cada um é um bounce que corrói a reputação) e
`emailOptOut: true`. No disparo automático sai também **quem publicou**.

O cursor é o que torna a falha recuperável. Se a função morrer no lote sete, a campanha fica
`interrompida` com o cursor no fim do lote seis, e "Retomar" continua dali. **A ordem por `uid` é o que
sustenta isso** — é estável e não muda entre uma tentativa e outra.

> **Um lote pode duplicar, e está aceito.** Se o envio for aceito pelo provedor e a gravação do cursor
> falhar logo depois, retomar reenvia aquelas cem pessoas. Duplicar um e-mail para cem pessoas é um
> incômodo; perder o envio para as outras mil é o recurso não funcionando.

**Um disparo por vez.** Dois concorrentes estouram o limite do provedor, embaralham os dois cursores e,
no pior caso, mandam duas campanhas para a mesma pessoa no mesmo minuto.

**O teto é declarado:** o envio é síncrono dentro da requisição. Mil membros são dez lotes e cerca de
cinco segundos; dez mil são cem lotes e quase um minuto, que é onde a função serverless morre. O sinal de
que passou do ponto é campanha terminando `interrompida` com frequência — e a saída então é **fila ou
cron, em spec própria**, não um `timeout` maior.

### Coleção `email_campaigns` (spec 014)

**ID: `video__{badgeId}__{youtubeId}` para o gatilho automático, auto-id para o manual.** O caminho como
unicidade de novo: com `create()`, um `POST` repetido por retry de rede não consegue anunciar o mesmo
vídeo duas vezes para a base inteira.

- `kind` (`video` | `manual` | `direto`), `subject`, `body` (texto puro), `ctaLabel`, `ctaUrl`
- `filters` (`tiers`, `gradeMin`, `gradeMax` — `null` significa **todos**)
- `recipientUid`, `recipientLabel` (spec 015) — preenchidos **só** em `direto`
- `status` (`enviando` | `concluida` | `interrompida`), `audienceCount`, `sentCount`, `failedCount`
- `cursorUid`, `createdBy`, `createdAt`, `finishedAt`, `error`

**Não é log: é o registro.** É o único lugar onde fica escrito o que foi enviado, para quantos e quando.

**`recipientUid` é lido antes dos filtros na montagem da audiência, e essa ordem é a proteção** (spec
015). Uma campanha `direto` grava `filters` com os três campos nulos, e filtro nulo significa *todos os
membros*: se ela passasse pelo caminho normal de montagem, um recado escrito para uma pessoa sairia para
a base inteira. **`recipientUid` ausente é lido como `null`** no converter, e é o fallback mais perigoso
desta coleção — `undefined` ali faz uma campanha direta antiga parecer campanha de base.

`recipientLabel` é o nome, ou o e-mail quando não houver nome, **no instante do envio**: denormalização
deliberada, como o `authorName` do Mural, porque a conta pode mudar de nome ou deixar de existir e a
linha do histórico precisa continuar legível. Os e-mails diretos aparecem no **mesmo** `GET
/admin/emails` das campanhas — separá-los exigiria `where('kind', ...)` com ordenação, que é índice
composto novo.

`profiles` ganha `emailOptOut`, `emailOptOutReason` e `emailOptOutAt`. **`emailOptOut` ausente é lido
como `false`** no converter — e é o fallback mais caro de perder: `undefined` numa comparação booleana faz
a base inteira parecer descadastrada, e o primeiro disparo sai para zero pessoa sem erro nenhum.

**A tabela de índices compostos não muda.** A audiência não é consulta ao Firestore — é `listUsers` do
Auth cruzado com `getAll` por caminho, e os filtros acontecem em memória. O histórico é
`orderBy('createdAt','desc').limit(20)`, de campo único; o trinco é `where('status','==','enviando')`,
também de campo único. "Spec nova, índice novo" é a suposição padrão, e aqui ela é falsa.

**A spec 015 também não acrescenta nenhuma linha**, e vale escrever rota por rota por quê:
`GET /admin/users` não é consulta (é `listUsers` mais `getAll`, com todo o recorte em memória);
`GET /admin/users/:id` é leitura por caminho; e `POST /admin/users/:id/email` escreve uma campanha e lê
o trinco, que já existia.

### Antes do primeiro envio real: o DNS

**Esta é a única parte desta spec que não vive no código, e a única que não dá para consertar depois.**

O remetente é `EMAIL_FROM`, do **domínio próprio**, e o domínio precisa estar autenticado no DNS antes de
qualquer disparo:

- **SPF** — registro TXT autorizando o provedor a enviar pelo domínio.
- **DKIM** — as chaves que o provedor gera, publicadas como TXT.
- **DMARC** — a política que diz o que fazer com mensagem que falha nas duas acima.

**O domínio de teste do provedor não é opção.** E-mail enviado de domínio não autenticado cai em spam, e
uma vez que a base aprende que o remetente é spam, os envios seguintes já nascem lá — inclusive os bons.
Reputação de domínio se constrói uma vez e se perde uma vez.

Domínio novo também não tem reputação, e volume súbito parece spam: do ponto de vista do Gmail, o
primeiro disparo para a base inteira é um remetente desconhecido mandando centenas de mensagens de uma
vez. Com dezenas de membros isso é irrelevante; com centenas, a prática é aquecer — começar pequeno e
subir ao longo de semanas.

### Variáveis de ambiente

| Variável | Obrigatória | Para quê |
|---|---|---|
| `RESEND_API_KEY` | em produção | Sem ela o mailer **loga e não envia** |
| `EMAIL_FROM` | sim | `Liga Dev <comunidade@lenoborges.com.br>` |
| `EMAIL_REPLY_TO` | sim | Para onde vai a resposta de quem responder ao e-mail |
| `EMAIL_UNSUBSCRIBE_SECRET` | sim | Segredo do HMAC do token de descadastro |
| `RESEND_WEBHOOK_SECRET` | em produção | Verificação de assinatura do webhook |
| `API_PUBLIC_URL` | em produção | Onde esta API responde, em absoluto — **e-mail não tem roteador** |

As três marcadas como "em produção" são checadas no boot. Sem `API_PUBLIC_URL`, todo link de descadastro
aponta para `localhost`: quem quiser sair da lista não consegue, e o que ele aperta em seguida é
"marcar como spam".

---

## Termos de Uso e Política de Privacidade (spec 018)

O produto passou a exigir aceite antes de funcionar. É o terceiro motivo de recusa da API, ao lado de
sessão (`401`) e papel (`403`), e tem código próprio: **`428 Precondition Required`**, com a lista do
que falta no corpo.

### O texto mora no código, junto da versão

`src/legal/documents/` guarda os dois documentos como estrutura — `sections: { heading, paragraphs }[]`,
texto puro, nunca HTML. Cada um traz `version` (uma data, `YYYY-MM-DD`) e `contentHash`.

**Editar uma vírgula do texto derruba a suíte.** `legal.documents.spec.ts` recalcula o SHA-256 e compara
com o literal do arquivo; a versão fica de fora do hash de propósito, senão bumpá-la consertaria o teste
sozinho. O único jeito de deixar verde é escrever o hash novo, e a linha da versão está logo acima.

Essa é a razão de o texto não morar no front: com o texto lá e a versão aqui, existe um estado em que a
cláusula de reembolso mudou, o número não mudou, e **ninguém é chamado a aceitar de novo** — sem erro,
sem log, e a descoberta acontece no dia em que alguém pede reembolso citando um texto que o produto não
mostra mais.

### Rotas

| Método | Rota | Guard |
|---|---|---|
| `GET` | `/legal/documents` | **nenhum** |
| `GET` | `/legal/documents/:id` | **nenhum** |
| `POST` | `/me/legal-acceptances` | `FirebaseAuthGuard` |

Ler é público porque o rodapé da landing aponta para lá e quem lê ali ainda não tem conta — exigir login
para ler o contrato é exigir que a pessoa concorde antes de poder ler. Mesma razão do `/descadastro`.

O aceite é **um documento por chamada**, com a versão no corpo. Versão diferente da vigente é `409` com
a atual na resposta: significa aba aberta desde antes do deploy, e aquele aceite é de um texto que não é
mais o texto. Aceite repetido é `204` e **não** reescreve a data.

### O que o guard deixa passar, e o que não

`LegalAcceptanceGuard` é global e roda depois do `FirebaseAuthGuard`. Isento: tudo em `/auth`
(entrar e sair não podem depender de aceitar nada), `GET /me` (é por onde o front descobre o que falta),
`POST /me/legal-acceptances` (é a saída do bloqueio), `/legal/**` (já é público) e `PATCH /me/emails`
(descadastrar-se nunca depende de concordar com nada).

**`PATCH /me/profile` não está isento, e é o detalhe que faz o onboarding funcionar de graça.** Aquele é
o endpoint que carimba `completedAt`: barrado pelo guard, quem não aceitou não conclui o cadastro. O
bloqueio do membro novo e o do membro antigo são a mesma regra, num lugar só.

**Admin não é exceção.** O preço está assumido: um bug aqui tranca todo mundo do lado de fora, inclusive
quem conserta, e a saída é deploy. Não há flag de emergência — criar uma seria criar uma forma de rodar
o produto com o bloqueio desligado.

### O nada de sempre

Nenhum índice composto novo: o mapa é lido por caminho e a subcoleção é escrita e lida por caminho. A
tabela de índices não ganha linha.

**Toda `createSession` dos e2e passou a aceitar os documentos logo depois do login** — sem isso a
requisição seguinte de qualquer suite responde `428`. Como isso deixaria a suíte verde mesmo se o guard
sumisse, `test/legal.e2e-spec.ts` bate no `428` **antes** de aceitar qualquer coisa, e é ele que cobra a
existência da regra.

## Spec 019 — Vídeos assistidos, XP e o cartão do membro

### O check é do membro, e o produto não tenta adivinhar

A marcação é manual: um check abaixo do player, que o membro clica quando quiser. **Não existe detecção
de progresso do player** — sem IFrame API, sem `onStateChange`, sem "assistiu 90%".

O palpite erraria dos dois lados (quem assiste no app do YouTube não dispara evento nenhum; quem deixa a
aba aberta dispara o vídeo inteiro), e carregar a API do YouTube seria carregar um script de terceiro
que observa o membro — exatamente o que a cláusula 8 da Política de Privacidade diz que este produto não
faz. O preço está aceito: dá para marcar sem assistir, e não é fraude contra ninguém, porque **XP não
destrava nada**.

### O XP é definitivo porque o registro é um razão, e não um estado

`profiles/{uid}/watched_videos/{videoId}` guarda dois fatos que parecem um só: `watched` é o check da
tela, livre para ir e voltar; `firstWatchedAt` é **imutável** e é o fato que concedeu os 10 XP.

**O documento não é apagado nunca**, e é essa a decisão inteira. Se desmarcar apagasse o registro,
remarcar concederia 10 XP de novo — e o farm seria um duplo clique repetido, sem bug e sem exploração,
usando a tela exatamente como ela foi desenhada. Daí sai a propriedade que torna o contador conferível:

> **`xp` = `XP_PER_VIDEO` × (número de documentos em `watched_videos`)** — sempre, independente de
> quantos estão marcados agora.

Um campo `xp` que só soubesse somar não teria com o que ser comparado: uma divergência nele seria
indetectável. Aqui é uma contagem, e `watched-video.service.spec.ts` a executa como teste, contra um
Firestore em memória (`src/track/testing/fake-firestore.ts`) — um `jest.fn()` prova que `batch.create`
foi chamado, não que a segunda chamada falhou e que o incremento não aconteceu por causa dela.

A escrita é **um `WriteBatch` com `create()` do razão e `FieldValue.increment` no perfil**: o
`ALREADY_EXISTS` do `create()` derruba o lote inteiro, e é essa derrubada que impede o incremento. Sem
transação, sem leitura prévia e sem janela entre conferir e escrever.

> `xp ?? 0` no converter é carga útil: todo documento antecede o campo no dia do deploy, e
> `undefined + 10` é `NaN` — o painel exibiria `NaN XP` para a base inteira.

### O vídeo precisa existir antes de o XP ser pago

`videoId` chega na URL e é escolhido pelo cliente. **XP é moeda**, e uma rota que cunha moeda a partir de
uma string do cliente cunha a partir de qualquer string: `PUT /me/watched-videos/qualquer-coisa-1`,
repetido com sufixos diferentes, seria XP infinito sem tocar em nenhum vídeo. A primeira marcação lê
`badge_videos/{videoId}` e responde `404` se não achar — **uma leitura, só no primeiro check de cada
vídeo**, porque remarcar não tem XP a pagar.

É de lá que sai o `badgeId` gravado no razão, e não de um `split` no id: ele é `{badgeId}__{youtubeId}`
hoje, e quem partir a string assina que será sempre assim.

### A listagem diz o que já foi visto, e sem consulta nenhuma

`GET /badges/:badgeId/videos` ganhou `watched`, vindo de um **`getAll` nos caminhos exatos dos vídeos que
a resposta já vai listar** — e não de um `where('badgeId','==',…)` na subcoleção. São as mesmas N
leituras, e três diferenças: nenhum índice (nem automático), nenhum registro de vídeo já removido da
insígnia, e custo proporcional ao que se mostra e não ao que a pessoa já assistiu ali. Vídeo sem
documento é `false`; **não existe "não sei"**.

**A lista deixou de ser igual para todo mundo**, e é a primeira do produto assim: um cache de listagem
colocado sem olhar isso serve o check de uma pessoa para outra, sem falhar em nada.

### `GET /members/:uid`, e o que ele deliberadamente não devolve

O cartão que um membro abre sobre outro: `{ id, name, bio, grade, xp, linkedin, instagram }`. **Sem
e-mail, sem telefone, sem `tier`, sem `role`, sem `completedAt`, sem `emailOptOut`.**

> **Campo novo no perfil não entra neste DTO por padrão.** Ele entra se alguém decidir que é público, e
> a decisão é escrita ali. `PublicMemberDto` **não estende `ProfileDto`, não reusa mapeador e não é
> montado por espalhamento de objeto** — os três atalhos que fazem o campo seguinte vazar sem ninguém
> ter escolhido. O teste de vazamento compara o conjunto de chaves por igualdade, e nunca por
> `toMatchObject`, que passa feliz com um campo a mais.

`GET /admin/users/:uid` (spec 015) continua devolvendo tudo, atrás do `AdminGuard`: **são duas rotas com
propósitos opostos**, e fundi-las com um `if (role === 'admin')` transformaria a diferença entre "o que
a comunidade vê" e "o que a operação vê" num ramo dentro de uma função.

Exige sessão — uma rota pública com `uid` na URL seria uma base de nomes e bios enumerável. E responde
`404` quando o perfil não existe **ou quando `completedAt` é nulo**: conta pela metade não tem nome nem
bio, e `200` com um cartão vazio é pior do que dizer que não há.

### `socialLinksPublic` nasce `false`

O interruptor decide se `linkedin` e `instagram` aparecem no cartão. **O padrão é a decisão**: quem
preencheu o LinkedIn antes desta spec o preencheu num formulário que só a administração lia, e publicar
esses links para a comunidade inteira no dia do deploy divulgaria um vínculo que ninguém foi chamado a
autorizar.

O `?? false` aqui é o oposto do `emailOptOut ?? false`: lá o fallback errado esconderia a base inteira de
um disparo, aqui ele **publicaria** a base inteira. Os dois falham em silêncio, e por isso os dois têm
teste-trava.

**Ele não esconde nada do admin**, e isso é dito em voz alta: `GET /admin/users/:uid` continua trazendo
os dois links, porque a operação já lê telefone e e-mail de todo mundo — um campo escondido dela seria
teatro, e teatro de privacidade é pior que ausência dela, porque alguém confia nele. O rótulo na tela diz
o que ele faz de verdade: **visível para os outros membros**, nunca "privado".

`PATCH /me/privacy` é rota própria e não um campo a mais em `PATCH /me/profile`: aquele exige nome,
telefone e bio e é ele que carimba `completedAt` — um interruptor que exige reenviar o cadastro inteiro é
um interruptor que ninguém liga.

### `authorUid` no Mural, e `null` quando a pergunta é anônima

`MuralQuestionDto` passou a trazer `authorUid`, para a tela abrir o cartão. O uid não é segredo neste
produto — é o caminho de `profiles/{uid}` e metade do id da própria pergunta —, e o que protege o dado é
o `GET /members/:uid` devolver só o que é público.

**A tradução de `ANONYMOUS_AUTHOR_UID` para `null` acontece no service, uma vez.** Mandar o sentinela ao
front obrigaria a tela a conhecê-lo e compará-lo, e a primeira comparação errada abriria um cartão `404`
em cima da pergunta de alguém que pediu para ser esquecido.

### Subcoleção `profiles/{uid}/watched_videos/{videoId}`

**Quarta subcoleção do produto, e a quarta vez que a mesma regra vale:** apagar um perfil precisa
apagá-la explicitamente, junto de `legal_acceptances`, `notification_reads` e dos votos do Mural. Ela
entra no passo 4 da ordem de exclusão da spec 013.

### O nada de sempre

Nenhum índice composto novo — tudo é leitura por caminho, e a tabela de índices não ganha linha. E
nenhuma isenção nova no `LegalAcceptanceGuard`: as três rotas desta spec são autenticadas e comuns, então
quem não aceitou os termos não marca vídeo, não ganha XP e não abre cartão de ninguém — **sem uma linha
escrita para isso ser verdade**.

### Os documentos legais subiram para a versão `2026-08-28`

O cartão exibe bio e, com o interruptor ligado, redes sociais — e a cláusula 3 da Política falava só de
nome e pergunta. Os dois documentos ganharam parágrafos sobre o cartão e sobre o registro dos vídeos
assistidos, e a Política ganhou a linha do interruptor na tabela de direitos.

**Isso custa um novo aceite de toda a base**, pelo desenho da spec 018 — e é o comportamento correto: o
texto mudou, então a concordância anterior é com um texto que não é mais o texto. Os testes que fixavam
`'2026-08-27'` passaram a derivar a versão de `LEGAL_DOCUMENTS`: bumpar já custa um aceite da base
inteira, não pode custar também meia dúzia de testes vermelhos que não dizem nada sobre comportamento.
Quem guarda o texto contra edição silenciosa continua sendo o teste-trava do `contentHash`, e ele
continua sendo o único.
