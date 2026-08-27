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
- Query: `kind` (`aula` ou `resposta`, opcional) — a aba. Sem ele, as duas
- Resposta: `200` `{ badgeId, videos: [{ id, badgeId, title, description, youtubeId, kind, questionId,
  question, orientation, devTierFree, order }] }`

**`orientation` é derivada e não gravada** (spec 017). Vale `retrato` (9:16, o Short) nas respostas e
`paisagem` (16:9) nas aulas, e **o cliente consome sem recalcular** — é a mesma forma da `phase` do
Mural. Derivar de `kind` do lado da tela faria a mesma regra existir em template, folha de estilo e
teste, e o dia em que uma resposta for gravada em paisagem o conserto exigiria deploy de front.

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
| `GET` | `/admin/badges/:badgeId/videos?kind` | Vídeos da insígnia. **Sem `kind`, as duas abas juntas** |
| `POST` | `/admin/badges/:badgeId/videos` | Publica; recebe URL (**Shorts inclusive**), grava o ID; entra no fim da ordem da aba |
| `PATCH` | `/admin/badges/:badgeId/videos/order` | Reordena em lote atômico |
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
- `order` (number) — posição dentro da insígnia, inteiro de 0 a n-1
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
índice composto no Firestore de produção. A spec 010 acrescentou o filtro por `kind`, e com ele um
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

**Criados à mão no console em 2026-08-18**, e é assim que eles existem hoje — não há
`firestore.indexes.json` no repositório, então nada os versiona e nada os publica junto com o deploy.

| Coleção | Campos | Consulta que o exige |
|---|---|---|
| `mural_questions` | `weekId` asc + `voteCount` desc + `createdAt` asc | `listByWeek(byVotes: true)` e `findWinner` |
| `mural_questions` | `weekId` asc + `createdAt` asc | `listByWeek(byVotes: false)`, a semana em coleta |
| `badge_videos` | `badgeId` asc + `order` asc | `listByBadge()` **sem** `kind` — a visão da administração |
| `badge_videos` | `badgeId` asc + `kind` asc + `order` asc | `listByBadge(kind)` — as abas Aulas e Perguntas Frequentes |

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
única leitura nova é `mural_questions/{id}` — caminho direto, que não usa índice. O `?kind=` que o
`GET` do admin ganhou usa a quarta linha, que já estava lá.

A terceira linha é fácil de perder de vista, e ela já tinha sido perdida uma vez: `kind` é opcional em
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
