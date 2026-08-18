# Spec 009: Financeiro, Administração e Trilha

## Objetivo
Tirar o preço da página pública e colocá-lo atrás da conta. O visitante passa a ver **quais tiers
existem e o que cada um entrega**; **quanto custa** só aparece dentro da plataforma, numa aba nova
chamada **Financeiro**.

Junto disso entram as três coisas que a plataforma precisa para deixar de ser só um painel com um
selo:

1. **Um catálogo financeiro autenticado** — quatro tiers, com o **Master Dev Tier** novo a R$ 260,00.
2. **Administração** — quem tem a claim de admin lista os usuários cadastrados e publica os vídeos da
   trilha, com ordem própria dentro de cada insígnia e título próprio na plataforma.
3. **Conteúdo por insígnia, sem tranca** — o aluno escolhe qual insígnia quer conquistar, pode pular,
   e quando a insígnia ainda não tem vídeo a resposta é uma lista vazia, não um erro.

O contrato público da API **não perde nada**. Tudo aqui é adição: `SessionResponseDto` e `ProfileDto`
ganham um campo (`role`), e quatro famílias de rota nascem — `/billing`, `/badges`, `/admin/users`,
`/admin/badges`.

---

## Numeração

**Os números são os mesmos nos dois repositórios, sempre.** Esta spec nasceu numerada 008 aqui e foi
renumerada para 009 antes de qualquer execução, justamente para manter o alinhamento: a **008 é Liga
Dev**, nos dois lados, mesmo que aqui ela não tenha pasta.

O backend pula números com naturalidade — a 008 daqui não existe porque a Liga Dev era quase toda de
front e executou as duas mudanças de backend dela por dentro, o `GRADE_MAX` e o default de `grade`. O
front pulou a 006 e a 007 pelo mesmo motivo invertido. **Número ausente é barato; número que significa
duas coisas, não.**

A consequência prática é boa: as citações a "spec 008" que já existem em `profile.entity.ts`,
`auth.service.spec.ts` e no `README.md` estão **corretas como estão**, porque 008 é Liga Dev aqui
também. A Fase 05 só confirma isso.

O par desta spec no front é a **009**, e a spec seguinte, o Mural de Perguntas, é a **010** nos dois.

---

## Por que o preço sai da landing

A página hoje vende três números antes de vender uma ideia. Quem chega pelo YouTube ou por indicação
lê "R$ 199,99 por mês" numa tabela, sem ter usado nada, sem saber o que é uma insígnia e sem ter visto
uma aula — e o preço vira a primeira objeção em vez de a última.

O que a spec 008 já tinha percebido, na decisão 5b, é que **a tabela de três preços em
sequência faz o terceiro parecer arbitrário**. A conclusão de lá foi melhorar a apresentação. A
conclusão daqui é mais simples: a apresentação que funciona é a que acontece **depois** de a pessoa ter
uma conta, ter visto a trilha e ter conquistado — de graça — as duas primeiras insígnias. Aí o preço
responde a uma pergunta que ela já está fazendo.

Daí sai o CTA público único, que é assunto da spec 009: **começar gratuitamente**. Página sem preço não
pode pedir dinheiro; o único próximo passo honesto que ela tem é a conta grátis.

### O que "tirar o preço" quer dizer, tecnicamente
Não é esconder com CSS, e não é um `@if (logado)` no template.

> **O preço não pode estar no bundle público.** Se o número está no JavaScript que qualquer visitante
> baixa, ele não saiu da landing — só saiu da tela.

Isso decide a decisão 1 inteira e é o motivo de existir um endpoint para uma tabela de quatro linhas
que muda uma vez por semestre.

---

## Decisões

### 1. O preço mora na API, atrás do guard. O nome do tier, não.
Duas fontes, de propósito:

| Dado | Onde mora | Quem vê |
|---|---|---|
| Nome do tier, o que ele entrega, a ordem | conteúdo local do front (`community.service.ts`) | qualquer visitante |
| **Preço**, valor cobrado, moeda, período | `GET /billing/tiers`, atrás do `FirebaseAuthGuard` | quem tem conta |

O catálogo público continua sendo conteúdo estático do front porque **ele é copy**: muda junto com o
texto da página, num commit, e não precisa de rede para renderizar. O preço vira dado de API porque
precisa de uma porta, e porta é coisa de servidor.

A repetição do nome do tier nos dois lados é aceita e é barata — o que **não** pode se repetir é o
preço, e ele existe num lugar só.

### 2. Quatro tiers. O Master Dev Tier entra a R$ 260,00.
| Tier | Preço/mês | Entrega |
|---|---|---|
| **Dev Tier** | Gratuito | Insígnias 1 e 2 na plataforma, jogos e ranking daquele trecho, comunidade no WhatsApp, conteúdo público do YouTube |
| **Great Dev Tier** | R$ 19,99 | Tudo acima **+ a plataforma da Insígnia 3 em diante**: trilha até a 8, a Elite Four, os jogos, os vídeos e o ranking completo |
| **Ultra Dev Tier** | R$ 199,99 | Tudo acima **+ a Grinding Arena**: quatro Grindings por mês, ao vivo, turma de no máximo quatro |
| **Master Dev Tier** | **R$ 260,00** | Tudo acima **+ duas aulas de inglês por mês**, focadas em entrevista técnica para vagas que exigem inglês |

Os tiers continuam **cumulativos**, e cada linha do catálogo carrega isso explicitamente no primeiro
item de `perks` ("Tudo do <tier anterior>"). Faixa que parece alternativa em vez de degrau faz o leitor
comparar o que não é comparável — a regra é a mesma da decisão 5 da spec 008, agora com quatro
degraus.

**O Master não é "o Ultra caro".** O que ele acrescenta responde a um problema específico e nomeável:
a vaga que paga melhor pede inglês, e a pessoa trava na entrevista, não no código. Duas aulas por mês
não ensinam inglês do zero e a cópia não pode sugerir que ensinam — elas treinam **a entrevista
técnica em inglês**: apresentar-se, explicar uma decisão de arquitetura, responder a um follow-up sem
perder o raciocínio.

**O salto do Ultra para o Master é de R$ 60,01, e isso é de propósito.** É o menor salto relativo da
tabela (30%) logo depois do maior (10x, do Great para o Ultra). O leitor que chegou ao Ultra já
aceitou a categoria "hora de gente"; o Master vende mais duas horas dessa mesma categoria, e o preço
tem que parecer o que é — um acréscimo, não um novo patamar.

**Os dois tiers de cima têm teto físico.** O Ultra por causa das quatro cadeiras da Grinding Arena; o
Master pelas duas aulas de inglês por assinante, por mês. Isso não vira campo de estoque nesta spec,
mas está registrado aqui porque o dia em que virar, vira nos dois.

### 3. O catálogo é constante de código, não coleção do Firestore.
`src/billing/billing.tiers.ts`, um array `readonly`, servido pelo controller.

Uma coleção custaria: CRUD de admin, tela para editá-lo, validação de quem pode mexer, e um histórico
para responder "quanto custava em março". São quatro linhas que mudam uma vez por semestre e cuja
mudança **já é** um deploy, porque a cópia da landing muda junto.

> **Guardrail:** no dia em que existir cobrança de verdade, o preço deixa de ser cópia e vira
> compromisso — um assinante paga o valor que estava valendo quando assinou. Aí o catálogo vira
> coleção com histórico, e não antes. Enquanto for constante, **nada pode gravar o preço junto do
> perfil**, porque isso criaria um segundo dono da mesma verdade sem o histórico que justificaria.

### 4. Não existe cobrança nesta spec, e `currentTierId` sai de uma função só.
Não há gateway, não há assinatura, não há webhook. `GET /billing/tiers` é **catálogo**, e a resposta
carrega junto qual tier é o do usuário:

```
{ tiers: [...], currentTierId: 'dev-tier' }
```

Hoje `currentTierId` é `'dev-tier'` para todo mundo, e vem de `resolveCurrentTier(profile)` — uma
função de uma linha, com o `TODO` em cima dela. **Existe para haver um lugar só onde essa pergunta é
respondida** quando a assinatura existir. Sem ela, a resposta nasce espalhada em `if`s de controller.

Isto respeita a decisão 5c da spec 008, e vale reescrever a regra aqui porque ela restringe o
futuro: **`grade` é conquista, não aluguel.** Nenhuma implementação de assinatura pode derivar `grade`
do estado de pagamento, nem zerá-lo no cancelamento — e o caminho contrário, derivar acesso a partir de
`grade`, também está errado.

### 5. Admin é custom claim do Firebase Auth. Nunca campo no Firestore.
`role: 'admin'` gravado com `setCustomUserClaims`. O motivo é direto: a claim **viaja dentro do ID
token**, então o `verifyIdToken` que o `FirebaseAuthGuard` já faz devolve o papel de graça. Um campo em
`profiles` custaria uma leitura de Firestore em toda requisição de admin, e criaria dois lugares
capazes de discordar sobre quem manda.

Três consequências que se erra ao implementar:

- **`FirebaseAuthGuard` passa a copiar `payload.role` para `request.user`.** Sem isso o `AdminGuard`
  teria que verificar o token de novo.
- **A claim só entra em vigor no próximo token.** Com `CHECK_REVOKED = false` (decisão 2 da spec 007),
  o ID token vale até uma hora. Promover alguém a admin não é instantâneo, e a mensagem do script tem
  que dizer isso — senão o próximo passo do usuário é "não funcionou" e uma investigação inútil.
- **`role` entra em `SessionResponseDto` e em `ProfileDto`.** O front precisa saber se mostra o botão
  "Administração", e não deve decodificar o ID token por conta própria para descobrir. É
  `role: 'admin' | null`, achatado, do mesmo jeito que `grade` e `profileCompleted` já são.

> **O botão escondido não é a segurança.** Quem esconde a Administração é cosmética; quem impede é o
> `AdminGuard`. Toda rota de admin passa pelos dois guards, sempre nessa ordem, e nenhuma delas fica
> "protegida" só por não estar linkada.

**Promover é tarefa de terminal, não de tela.** `npm run admin:grant -- email@dominio.com`, um script
em `scripts/grant-admin.ts` usando a mesma chave de serviço. Não existe endpoint que cria admin nesta
spec: o primeiro admin não teria quem o criasse, e um endpoint desses é a superfície mais cara do
projeto para o menor uso — três execuções na vida do produto.

### 6. Vídeo tem título nosso, e o YouTube guarda só o vídeo.
`badge_videos`, coleção nova:

| Campo | Tipo | Por quê |
|---|---|---|
| `badgeId` | string | O `id` da etapa da trilha (`logica`, `poo`, `git-github`, …), o mesmo do `trackStages` do front |
| `title` | string | **Título da plataforma**, obrigatório. Não é o título do YouTube |
| `description` | string \| null | Uma linha opcional sob o título |
| `youtubeId` | string | Só o ID (`dQw4w9WgXcQ`), nunca a URL |
| `order` | number | Posição dentro da insígnia, inteiro de 0 a n-1 |
| `createdAt` / `updatedAt` | Timestamp | Convenção das outras coleções |

**O título é nosso porque o do YouTube é de lá.** Título de vídeo público é escrito para o algoritmo —
carrega "AULA 3 COMPLETA", emoji, nome do canal. Dentro da trilha ele precisa dizer onde a pessoa está
("Herança e composição, na prática"), e precisa poder ser reescrito sem republicar o vídeo. O admin
digita o título; o campo é obrigatório e o formulário não o preenche a partir do YouTube.

**Guarda-se o ID, não a URL.** A URL chega em cinco formas — `watch?v=`, `youtu.be/`, `/embed/`, com
`&t=`, com `?si=` de compartilhamento. Se a forma bruta for gravada, cada tela que monta um player
reimplementa a extração, e elas divergem. O service normaliza na entrada, uma vez, e rejeita o que não
casar. O admin continua colando a URL inteira — a extração é problema nosso.

**O ID do documento é `{badgeId}__{youtubeId}`.** Segue o princípio que o `CLAUDE.md` já defende: o
caminho carrega a garantia. O mesmo vídeo não entra duas vezes na mesma insígnia porque o `create()`
falha com `ALREADY_EXISTS` — e o mesmo vídeo **pode** aparecer em duas insígnias diferentes, que é um
caso real (um vídeo de Git serve à insígnia de Git e à de DevOps).

### 7. Reordenar é uma escrita em lote, e a ordem é normalizada toda vez.
`PATCH /admin/badges/:badgeId/videos/order`, corpo `{ videoIds: [...] }` na ordem desejada.

O service escreve todos num `WriteBatch`: **atômico**, ou entram todas as posições ou nenhuma. A
alternativa — um `PATCH` por vídeo movido — deixa a lista com dois vídeos no `order: 3` se a segunda
requisição falhar, e essa lista fica errada em silêncio, sem ninguém para consertá-la.

A ordem é **renormalizada para 0..n-1 a cada reordenação**. Não há posições fracionárias, nem
espaçamento de 10 em 10 para "abrir espaço no meio". Isso seria a escolha certa para listas grandes com
inserção frequente; aqui são no máximo algumas dezenas de vídeos por insígnia, e a renormalização
dispensa a manutenção do esquema de espaçamento — que é justamente a parte que apodrece quando ninguém
lembra por que os números pulam.

Duas validações, e as duas rejeitam com 400:

- `videoIds` que não bate exatamente com o conjunto de vídeos daquela insígnia — faltando um, sobrando
  um, ou repetido. Reordenar não pode criar nem apagar.
- `badgeId` inexistente na trilha.

**O `badgeId` é validado contra uma constante**, `BADGE_IDS` em `src/track/track.constants.ts`, com as
oito insígnias, as quatro Elite Battles e a Battle Frontier. A trilha é fixa e desenhada — a spec 008 do
front define as treze etapas — então um `badgeId` livre só serviria para criar vídeo órfão numa
insígnia com erro de digitação, invisível para sempre.

### 8. Insígnia sem conteúdo responde 200 com lista vazia. Nunca 404.
```
GET /badges/logica/videos  ->  200 { badgeId: 'logica', videos: [] }
```

A trilha **não é presa**: o aluno escolhe qual insígnia quer conquistar e pode pular. A consequência
direta é que insígnia vazia é o **estado normal** do produto agora, não uma exceção — no dia do
lançamento, onze das treze estarão assim.

404 significaria "esse recurso não existe", e o front acabaria tratando conteúdo em preparo como falha
de rede, com tela de erro no lugar do aviso de que o material ainda está sendo preparado. A distinção
que importa para o front é entre **insígnia inexistente** (404, porque é bug ou URL adulterada) e
**insígnia sem vídeo** (200 vazio, porque é terça-feira).

### 9. Nenhum guard de assinatura nas rotas de conteúdo, e isso é uma escolha declarada.
`GET /badges/:badgeId/videos` exige sessão e nada mais. Não confere `grade`, não confere tier.

O motivo é que **não existe estado de assinatura no modelo** — a decisão 5c da spec 008 deixou
isso explicitamente fora de escopo, e continua fora. Um guard escrito agora só teria como chave o
`grade`, e a decisão 5d é clara sobre isso ser o erro mais tentador de programar: derivar acesso a
partir de progresso.

Quando a assinatura existir, o portão é este, e a fórmula já está escrita:

```
tetoDeAvanco = assinaturaAtiva ? 13 : max(2, grade)
```

Registrado aqui para a decisão não ser tomada dentro de um `if` por acidente. **O que esta spec não
pode fazer é o meio-termo** — um guard por `grade` que "quase" funciona seria pior que nenhum, porque
pareceria pronto.

> **Emendado pela spec 010 (Mural de Perguntas).** O Mural criou o primeiro direito que o Dev Tier não
> tem — escrever pergunta —, e com ele o campo `tier` no perfil e a função `resolveCurrentTier` com
> corpo de verdade. **O que a 010 não fez, e continua proibido, é gatear conteúdo por `grade`**: o
> portão dela é o tier, que é acesso, e nunca o `grade`, que é conquista. `GET /badges/:badgeId/videos`
> continua sem guard de assinatura.

### 10. Administrar usuário é ler duas fontes e responder uma.
Quem existe é o **Firebase Auth**; quem a pessoa é são os `profiles`. A listagem junta:

| Do Firebase Auth | Do `profiles` |
|---|---|
| `uid`, `email`, `emailVerified`, `disabled`, `createdAt`, último login, `role` | `name`, `phone`, `grade`, `profileCompleted` |

**A paginação é a do Auth, com `pageToken`** — não a do Firestore. A razão é que o Auth é a fonte de
quem existe: paginar pelo Firestore esconderia todo usuário que ainda não tem documento de perfil, que
é exatamente a pessoa que o admin mais precisa ver (cadastrou e não terminou o onboarding). A leitura
dos perfis da página é um `getAll` por caminho, sem consulta e sem índice.

O que o admin pode mudar nesta spec é **`grade`**, e só. Não há promover a admin pela tela (decisão 5),
não há desativar, não há apagar. Apagar usuário é a operação irreversível do produto e não entra numa
spec junto de outras nove decisões.

> **Guardrail de lockout:** se um dia existir edição de `role` pela tela, ela não pode remover a
> própria claim de quem está logado. Sem essa trava, um clique deixa o produto sem administrador e a
> saída é o terminal.

### 11. As security rules continuam negando tudo.
`badge_videos` nasce dentro do mesmo `match /{document=**}` que já nega leitura e escrita para
qualquer cliente. Quem lê é a API, pelo Admin SDK, que ignora as rules.

**Isto é fácil de errar por otimização**: vídeo é conteúdo público-ish, e a ideia de "deixar o front ler
direto do Firestore, é mais rápido" aparece sozinha. Ela entrega a lista inteira de vídeos de todas as
insígnias para qualquer navegador com a Web API Key — que é pública por desenho — e torna impossível
qualquer gating futuro.

---

## Endpoints

| Método | Rota | Guards | O que faz |
|---|---|---|---|
| `GET` | `/billing/tiers` | auth | Catálogo com preço e `currentTierId` |
| `GET` | `/badges/:badgeId/videos` | auth | Vídeos da insígnia, já em `order`. Vazio é 200 |
| `GET` | `/admin/users` | auth + admin | Lista paginada, `pageToken` do Auth |
| `PATCH` | `/admin/users/:id` | auth + admin | Altera `grade`, e só |
| `GET` | `/admin/badges/:badgeId/videos` | auth + admin | Igual à pública, mas com os campos de administração |
| `POST` | `/admin/badges/:badgeId/videos` | auth + admin | Cria. Recebe URL, grava `youtubeId`, entra no fim da ordem |
| `PATCH` | `/admin/badges/:badgeId/videos/:videoId` | auth + admin | Edita título e descrição |
| `DELETE` | `/admin/badges/:badgeId/videos/:videoId` | auth + admin | Remove e renormaliza a ordem |
| `PATCH` | `/admin/badges/:badgeId/videos/order` | auth + admin | Reordena em lote |

---

## Fora de escopo, e explicitamente

- **Gateway de pagamento, checkout, webhook, estado de assinatura.** O Financeiro desta spec é uma
  vitrine com preço. O botão de upgrade leva a uma conversa, não a um cartão.
- **Agendamento das aulas de inglês e dos Grindings.** O Master vende duas aulas por mês; combinar
  horário é WhatsApp.
- **Upload de vídeo próprio.** O YouTube hospeda; nós ordenamos e nomeamos.
- **Jogos, ranking e pontuação.** Continuam fora, como estavam.
- **Progressão automática de `grade`.** Assistir vídeo não conquista insígnia. Quem move `grade` é o
  admin, à mão, até existir jogo.
- **Apagar ou desativar usuário.**

---

## Specs afetadas

Pela regra 6 do `clauderc.md`, spec que montou estrutura de dado que muda é marcada Deprecated.
**Nenhuma estrutura existente muda de forma aqui** — `waitlist_entries` e `profiles` ficam como estão, e
`badge_videos` é coleção nova. Então nada vai a Deprecated.

### Spec 007 (Firestore e Firebase Auth) — vigente, estendida
`FirebaseAuthGuard` passa a propagar `payload.role`. A decisão 2 de lá, sobre `CHECK_REVOKED = false`,
ganha uma consequência nova e registrada: **a claim de admin demora até uma hora para entrar em vigor**.
Se um dia isso incomodar, o botão é o mesmo — virar `CHECK_REVOKED` para `true` e pagar a latência.

### Spec 005 (Autenticação e Dashboard) — vigente, estendida
`SessionResponseDto` e `ProfileDto` ganham `role`. Adição de campo, sem quebra: cliente antigo ignora.

### Spec 008 (Liga Dev) — vigente, com emenda
A tabela de tiers da decisão 5 de lá passa de três para quatro linhas, com o Master Dev Tier. A decisão
5b (o salto de 10x) continua valendo e ganha o parágrafo do salto de 30% acima. As decisões 5c e 5d
(assinatura compra avanço, não retenção) continuam **integralmente vigentes** e são a restrição que a
decisão 9 desta spec obedece.

---

## Pontos em aberto

1. ~~**Quem é o primeiro admin?**~~ **Resolvido (2026-08-18): `lenoborges.dev@gmail.com`.** É o e-mail
   do script da Fase 01, nos dois projetos do Firebase.
2. **O upgrade leva para onde?** Está desenhado como WhatsApp, reaproveitando o link de contato que a
   landing já tem. Se houver preferência por e-mail ou por um formulário, muda só a spec 009.
3. **As duas aulas de inglês são com o Leno ou com um parceiro?** Não muda nada no código, muda a cópia
   do Financeiro — "com o Leno" e "com um professor parceiro" são promessas diferentes.
4. **O Master aparece na landing junto dos outros três, ou só dentro?** Escrito aqui como: aparece na
   landing, sem preço, como os outros. É o tier mais fácil de explicar sem número, porque o benefício é
   concreto.
