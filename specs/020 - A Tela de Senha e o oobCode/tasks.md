> # Spec 020 — ENCERRADA em 2026-08-28
>
> | Fase | Estado |
> |---|---|
> | 00 — Marcar a spec superada | **entregue** |
> | 01 — A tradução compartilhada | **entregue** |
> | 02 — Os três endpoints | **entregue** |
> | 03 — O console e a documentação | **encerrada sem as Tasks 10 e 11** — o Firebase recusa a action URL |
> | 04 — Fechar | **encerrada sem a Task 15** — a prova à mão depende da Task 10 |
> | 05 — O SMTP do Firebase Auth | **encerrada sem executar** — conserta a metade visível de um problema cuja outra metade o console não deixa consertar |
>
> As tasks abertas ficam com `[ ]` e com o motivo escrito ao lado, e **não são pendências desta
> spec**: nenhuma delas é código, e nenhuma delas é possível pelo console. Elas são requisitos da
> spec que gerar o link pelo Admin SDK.

# Fase 00: Marcar a spec superada [x]

Feita junto com o levantamento, e não durante a execução: a regra 6 do `clauderc.md` é que a spec antiga
receba o bloco de `Deprecated` apontando para a nova.

- [x] Task 00: `specs/007 - Firestore e Firebase Auth/context.md`. Objetivo: a **decisão 3** marcada como
  Deprecated, com o bloco registrando três coisas — que a análise de custo dela **continua correta** e é o
  que esta spec cita para se justificar; o que **não** muda (o e-mail continua sendo o do Firebase, o
  `continueUrl` continua sendo `<FRONTEND_URL>/?entrar=1`, a política de senha continua no console, e
  concluir a redefinição continua marcando `emailVerified`); e que a **spec 006 não volta** — é a única
  linha da tabela "o que sai do projeto" que continua sem objeto.

# Fase 01: A tradução compartilhada [x]
Branch: `feat/020-traducao-de-senha`

Refatoração pura, sem endpoint novo e sem mudança de comportamento. Existe primeiro porque dois fluxos
vão precisar da mesma tradução, e duplicá-la é o que faz as duas mensagens divergirem.

- [x] Task 01: Mover a `translatePasswordError`. Arquivos: `src/auth/password-errors.ts` (novo),
  `src/profile/profile.service.ts`. Objetivo: a função sai de `profile.service.ts` para um módulo próprio,
  sem mudar uma palavra das mensagens. **`POST /me/password` continua se comportando exatamente igual** —
  os testes existentes daquele fluxo são a trava, e nenhum deles pode precisar de edição.
- [x] Task 02 (TDD): A tradução do código morto. Arquivo: `password-errors.spec.ts`. Objetivo:
  `translateOobError` na mesma casa — `EXPIRED_OOB_CODE`, `INVALID_OOB_CODE` e `OPERATION_NOT_ALLOWED`
  devolvem **a mesma frase** (decisão 5), e o teste-trava é justamente esse: expirado e inválido são
  indistinguíveis na resposta, porque distinguir informaria a quem colou um código qualquer se ele existiu
  algum dia.

# Fase 02: Os três endpoints [x]
Branch: `feat/020-endpoints-do-oobcode`

- [x] Task 03: Os DTOs. Arquivos: `src/auth/dto/check-oob.dto.ts`, `src/auth/dto/confirm-password.dto.ts`.
  Objetivo: `{ oobCode }` e `{ oobCode, newPassword }`, com `@IsString`, `@IsNotEmpty` e o mínimo de 8 no
  `newPassword`. **Nenhum campo `mode`** — o comentário registra a decisão 3: o `mode` chega da URL do
  navegador, é escrito por quem manda o link, e um `switch` sobre ele aqui seria a API deixando o cliente
  escolher qual operação executar sobre uma credencial.
- [x] Task 04 (TDD + implementação): `checkOobCode`. Arquivos: `src/auth/auth.service.ts`,
  `auth.service.spec.ts`. Objetivo: `accounts:resetPassword` **só com o `oobCode`**, devolvendo
  `{ email }`. O comentário registra a decisão 4 — devolver o e-mail **não** é o oráculo que o `signup`
  evita, porque aqui o requisitante forneceu o `oobCode`, que só chegou por uma caixa de entrada. Falha
  vira `BadRequestException` com a frase da Task 02, e **o código do Google vai para o log**, nunca para a
  resposta.
- [x] Task 05 (TDD + implementação): `confirmPassword`. Arquivos: `auth.service.ts`, `.spec.ts`.
  Objetivo: `accounts:resetPassword` com `oobCode` + `newPassword`, devolvendo `void`. Dois ramos de erro
  distintos: código morto usa `translateOobError`, senha recusada usa `translatePasswordError`
  (decisão 6). Teste-trava: **o serviço não chama `signInWithPassword`, não emite cookie e não devolve
  token** (decisão 10) — é o que fica vermelho no dia em que alguém "melhorar" o cadastro logando a
  pessoa direto.
- [x] Task 06 (TDD + implementação): `applyEmailAction`. Arquivos: `auth.service.ts`, `.spec.ts`.
  Objetivo: `accounts:update` com `oobCode`, devolvendo `{ email }`. Serve aos três modos de e-mail, e
  **quem decide qual deles é o próprio `oobCode`** — o comentário registra que o Firebase recusa um código
  de reset usado como código de verificação, e deixar a recusa acontecer lá é ter uma regra em vez de duas.
  O `requestType` que a resposta traz é ignorado (ponto em aberto 5).
- [x] Task 07: As rotas. Arquivo: `src/auth/auth.controller.ts`. Objetivo: `POST /auth/password/check`
  (`10/min`), `POST /auth/password` (`5/min`, `@HttpCode(204)`) e `POST /auth/email-action` (`5/min`),
  **os três públicos, sem guard nenhum** (decisão 7). O comentário registra que os limites não protegem o
  `oobCode`, que tem entropia de sobra: eles impedem que a nossa API vire um alvo barato de reflexão
  contra o Identity Toolkit.
- [x] Task 08 (TDD): Spec do controller. Arquivo: `auth.controller.spec.ts`. Objetivo: três teste-trava —
  as três rotas **não têm `FirebaseAuthGuard` nem `LegalAcceptanceGuard`** (decisão 8: um `428` aqui
  trancaria a pessoa fora da conta pela porta que ela usa para entrar, e a saída exigiria a senha que ela
  está tentando definir); `POST /auth/password` responde `204` **sem `Set-Cookie`**; e o corpo com um
  campo `mode` extra é rejeitado pelo `whitelist`, e não silenciosamente aceito.
- [x] Task 09: Swagger. Arquivo: `auth.controller.ts`. Objetivo: os três com `@ApiOperation` e as
  respostas de erro descritas, no mesmo padrão do resto do controller. A descrição do `check` diz por que
  ele devolve o e-mail, com uma frase — é a pergunta que quem lê o `/docs` faz primeiro.

# Fase 03: O console e a documentação [ ] — **ENCERRADA sem as Tasks 10 e 11**

> **Tasks 12 e 13 feitas.** As Tasks 10 e 11 são configuração do console do Firebase, em dois
> projetos, e não têm representação em código — ficam abertas até serem feitas à mão. **Sem a Task 10
> o cadastro continua caindo na tela do Google**, com os três endpoints publicados e ninguém chegando
> neles.
Branch: `feat/020-console-e-readme`

Sem código. É a fase que, esquecida, faz tudo o mais funcionar em preview e quebrar em produção.

- [ ] Task 10: **Configurar a action URL nos dois projetos.** Objetivo: `Authentication > Templates >
  customize action URL` apontando para `<front>/acesso` —
  `https://ligapreview.lenoborges.com.br/acesso` em `dev-liga-dev`, e
  `https://liga.lenoborges.com.br/acesso` no projeto de produção. **Os dois, e não um** (ponto em aberto 1):
  configurar só um produz um cadastro que funciona em preview e manda o membro de produção para a tela do
  Google, verde em todo teste.
  **Impossível pelo console: o Firebase recusa a troca com `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`** —
  ver o bloco de estado no topo do `context.md`. A task fica aberta e sem dono aqui; quem a resolve é
  a spec que gera o link pelo Admin SDK.
- [ ] Task 11: Conferir a política de senha. Objetivo: `Authentication > Settings > Password policy`
  continua com mínimo de 8. Não muda nada nesta spec — a task existe porque a decisão 6 acabou de pôr um
  segundo piso no front, e um segundo piso é o que faz ninguém conferir o primeiro.
- [x] Task 12: `README.md`. Objetivo: quatro mudanças, e a primeira é a que importa.
  - **Sai a instrução "Não configure customize action URL"**, que a decisão 13 torna errada, e entra a
    quarta linha da tabela "o que vive no console" — com a nota de que são **dois** projetos.
  - A seção "A senha é definida fora desta aplicação" vira "A senha é definida na nossa tela", com o
    diagrama novo: `signup → e-mail do Firebase → <front>/acesso → POST /auth/password → /?entrar=1`.
  - **Some a frase "Não existe `POST /auth/password`"** — ele existe de novo, e uma README que nega um
    endpoint publicado é pior que uma sem seção nenhuma.
  - Os três endpoints na lista de "Endpoints da API", com uma linha cada.
- [x] Task 13: `CLAUDE.md`. Objetivo: a frase que resume a decisão 2 — **o `oobCode` chega nesta API, e o
  front continua sem falar com o Firebase**; e a nota de que `POST /auth/password` não cria sessão
  (decisão 10), que é a "melhoria" que alguém tentará fazer.

# Fase 04: Fechar [ ] — **ENCERRADA sem a Task 15**

> **Task 14 feita.** A Task 15 é a prova à mão contra o projeto de preview, e depende da Task 10 e do
> front da 020 rodando.
Branch: `feat/020-fechamento`

- [x] Task 14: `npm run lint` e `npm test`. Suíte verde antes de fechar. **618 testes, 56 suítes, lint limpo e `nest build` passando.**
- [ ] Task 15: O fluxo inteiro contra o projeto de preview, com o front da 020 rodando.
  - Cadastro novo: e-mail chega, link cai em `/acesso`, senha definida, `204`, login com ela funciona.
  - **O mesmo link clicado de novo**: `400` com a frase da decisão 5, e não um erro genérico.
  - Uma senha de 6 caracteres forçada por fora do front: recusada pela política, com a mensagem traduzida
    da decisão 6 — é a única prova de que o piso real ainda existe.
  - Troca de e-mail por Meu Perfil, ponta a ponta: o link do e-mail novo cai em
    `/acesso?mode=verifyAndChangeEmail`, o `POST /auth/email-action` responde, e o login passa a ser com o
    e-mail novo. **Nenhuma linha de código deste repositório mudou para isso acontecer** (decisão 12), e é
    exatamente por isso que ele precisa ser testado à mão.

# Fase 05: O SMTP do Firebase Auth [ ] — **ENCERRADA SEM EXECUTAR**
Branch: `feat/020-smtp-do-firebase-auth`

> ## Estado em 2026-08-28: bloqueada, e o `dev-liga-dev` foi devolvido ao envio padrão
>
> **Por enquanto o e-mail volta a ser o padrão do Firebase, sem SMTP.** O `dev-liga-dev` está com
> `notification.sendEmail.method = DEFAULT`; o bloco `smtp` continua gravado no projeto (host
> `smtp.resend.com`, porta 587, STARTTLS, remetente `acesso@lenoborges.com.br`), então religar é
> trocar o método de volta, e não recadastrar a credencial. **A fase não foi abandonada — foi
> parada com o motivo escrito.**
>
> **O que bloqueia é a Fase 03, e não esta.** A action URL do `dev-liga-dev` continua em
> `https://dev-liga-dev.firebaseapp.com/__/auth/action`, e trocá-la é recusado tanto pelo console
> quanto pela API `admin/v2/projects/dev-liga-dev/config`:
>
> ```
> PATCH ...?updateMask=notification.sendEmail.callbackUri
> {"notification":{"sendEmail":{"callbackUri":"https://ligapreview.lenoborges.com.br/acesso"}}}
> 400 EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED (INVALID_ARGUMENT)
> ```
>
> **Não é permissão e não é o campo**, e isso foi medido e não suposto: gravar no mesmo
> `callbackUri` o valor que já estava lá passa, e gravar em `autodeleteAnonymousUsers` também. O que
> a API recusa é **o valor novo**. A suspeita que sobra é o domínio: `dnsInfo.customDomainState`
> está `NOT_STARTED`, e estar em `authorizedDomains` — `ligapreview.lenoborges.com.br` está — não é
> a mesma autorização que o fluxo de domínio personalizado para e-mails de autenticação.
>
> **O teste foi feito no mesmo dia, e com ele caíram cinco hipóteses** — a tabela está no bloco de
> estado do `context.md`. O `web.app` com caminho customizado é recusado; ligar o `CUSTOM_SMTP` não
> muda nada; o upgrade para `IDENTITY_PLATFORM` não muda nada; desligar a proteção de enumeração de
> e-mail não muda nada. **Não é o domínio, não é o caminho, não é o transporte e não é o tipo do
> projeto** — é a superfície de template de e-mail inteira, travada neste projeto, sem documentação
> pública que explique por quê.
>
> **Não há ordem para retomar, porque não se retoma pelo console.** A Fase 03 depende da Task 10, que
> o Firebase recusa, e esta fase existia para consertar a metade visível de um problema cuja outra
> metade o console não deixa consertar. A saída é gerar o link no Admin SDK e mandá-lo pelo
> `MailerService` da spec 014 — o que torna esta fase **desnecessária**, e não bloqueada.

**Alteração de escopo, acrescentada depois de as Fases 01 a 04 estarem mergeadas** — ver o bloco no topo
do `context.md`. A tela ficou nossa e o e-mail que leva até ela continuou saindo do remetente do Google.

Sem código, como a Fase 03: é console, nos dois projetos. **O corpo do e-mail continua sendo o template
do Firebase** — o que muda é o transporte e o remetente (decisão 14).

- [ ] Task 16: O remetente separado no Resend. Objetivo: `acesso@lenoborges.com.br` como remetente dos
  e-mails de ação, com `leno@lenoborges.com.br` no reply-to. O domínio `lenoborges.com.br` **já está
  verificado** desde a spec 014, com SPF e DKIM de pé, e nada disso precisa ser refeito — o que entra é
  um endereço novo no domínio que já existe. **Não é o `comunidade@` da 014**, e a decisão 14 diz por
  quê: são dois tipos de e-mail com destinos opostos quando o membro se cansa, e quem apertasse "marcar
  como spam" num aviso de vídeo levaria junto o e-mail que abre a própria conta.
- [ ] Task 17: A credencial de SMTP. Objetivo: uma **API key própria** do Resend para este uso, e não a
  `RESEND_API_KEY` que a API já usa. Os valores são fixos: host `smtp.resend.com`, usuário `resend`,
  senha = a API key. Porta **587 com STARTTLS** (465 é SMTPS implícito, e serve igual — 587 é o que o
  console do Firebase assume). Uma chave separada é o que permite revogar o envio do Firebase sem
  derrubar o disparo da spec 014, que é justamente o caso em que alguém vai querer revogar às pressas.
- [ ] Task 18: **Configurar o SMTP nos dois projetos.** **Feita no `dev-liga-dev` em 2026-08-28 e
  desfeita no mesmo dia** (`method` de volta para `DEFAULT`, valores preservados); produção intocada.
  Na primeira tentativa a porta estava `2465` com `START_TLS` — par inválido, e o Firebase engole falha
  de SMTP em silêncio: nada chegou e nada apareceu no Resend. Corrigida para 587 depois, sem novo teste
  de entrega antes da reversão. Objetivo: `Authentication > Templates > SMTP
  settings` em produção **e** em `dev-liga-dev`, com os valores da Task 17. Terceira vez que esta spec
  pede dois projetos, e a mais fácil de esquecer: diferente da action URL, **este defeito não quebra o
  fluxo** — o e-mail chega, o link funciona, e ninguém percebe até reparar no endereço do remetente.
- [ ] Task 19: O remetente nos templates. Objetivo: nome público e endereço de resposta conferidos em
  `Authentication > Templates`, nos dois projetos, para que o "de" do e-mail diga **Liga Dev** e não o
  nome do projeto do Firebase. É a metade visível da Task 18: sem ela o e-mail sai pelo nosso servidor
  com a aparência do antigo.
  **Não feita**: em 2026-08-28 os templates do `dev-liga-dev` ainda tinham `senderLocalPart: noreply` e
  `replyTo: noreply`, e o `senderLocalPart` **sobrepõe** a parte local do remetente do SMTP — com ele
  assim, o `acesso@` da Task 18 não chegaria a aparecer no "de" nem com o envio ligado.

## Os testes que fecham a fase

- [ ] Task 20: A prova de entrega, **nos dois ambientes**. Objetivo: cadastro novo em preview e em
  produção, e em cada um deles:
  - o e-mail chega, e o remetente é `acesso@lenoborges.com.br` — não `noreply@<projeto>.firebaseapp.com`;
  - ele cai na **caixa de entrada**, e não em Promoções nem em spam;
  - o cabeçalho original mostra **SPF, DKIM e DMARC em `pass`**. É o que o remetente novo pode quebrar,
    e é invisível na tela: um `fail` aqui entrega hoje e para de entregar quando o volume subir;
  - responder ao e-mail chega em `leno@lenoborges.com.br`.
- [ ] Task 21: O fluxo ponta a ponta continua inteiro. Objetivo: **a Task 15 refeita depois do SMTP**, e
  não em vez dela. O link do e-mail novo abre `<front>/acesso`, a senha é definida, o `204` volta, e o
  login com ela funciona. Trocar o servidor de envio não deveria mexer no `oobCode` — e "não deveria" é
  a razão de a prova existir.
- [ ] Task 22: `npm run lint` e `npm test`. Objetivo: suíte verde. **Nenhuma linha de código muda nesta
  fase**, então a suíte é uma trava de que isso é verdade: se algo aqui precisou de código, a fase saiu
  do que ela se propôs a ser.
