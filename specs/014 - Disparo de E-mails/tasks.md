# Fase 01: O mailer, o template e a configuração [x]
Branch: `feat/014-mailer`

Nenhum endpoint e nenhum disparo. Ao fim desta fase o projeto sabe montar e enviar um e-mail, e o padrão
de quem roda sem chave é **não enviar nada**.

- [x] Task 01: Dependência e variáveis. Arquivos: `package.json`, `.env.example`, `src/config/env.validation.ts`,
  `.spec.ts`. Objetivo: `resend` nas dependências; `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
  `EMAIL_UNSUBSCRIBE_SECRET` e `RESEND_WEBHOOK_SECRET` documentados no `.env.example` com o porquê de cada
  um. **Teste-trava: em produção, boot sem `RESEND_API_KEY` falha; fora de produção, sobe** (decisão 16).
- [x] Task 02: Módulo e porta. Arquivos: `src/emails/emails.module.ts`, `src/emails/mailer.service.ts`.
  Objetivo: `send(to[], subject, html, text, headers)` e `sendBatch(messages)`. **O `resend` é importado
  aqui e em nenhum outro arquivo** — a mesma cerca do `FirebaseService` em volta do `firebase-admin`
  (decisão 1). Nenhum service de campanha pode conhecer o nome do provedor.
- [x] Task 03 (TDD + implementação): O modo que não envia. Arquivo: `mailer.service.spec.ts`. Objetivo:
  sem `RESEND_API_KEY`, `send` **loga e devolve sucesso**, e o cliente do provedor não é sequer
  instanciado. Teste-trava: nenhuma chamada de rede sai no modo log. Sem isso, uma máquina de
  desenvolvimento apontada para o Firestore de produção manda e-mail para a base inteira (decisão 16).
- [x] Task 04 (TDD + implementação): O template. Arquivos: `src/emails/email-template.ts`, `.spec.ts`.
  Objetivo: uma função que recebe assunto, corpo em texto, botão opcional e a URL de descadastro, e
  devolve **`{ html, text }` gerados da mesma fonte** (decisão 11). Quebra de linha do corpo vira
  parágrafo no HTML. Teste-trava: o corpo é **escapado** — `<b>` digitado pelo admin sai como texto, e
  nunca como marcação.
- [x] Task 05 (TDD + implementação): O rodapé obrigatório. Objetivo: **não existe caminho que gere e-mail
  sem o link de descadastro**. Teste-trava: chamar o template sem a URL de descadastro **lança**, em vez
  de gerar um e-mail sem rodapé. É a garantia da decisão 8 posta onde ela não pode ser esquecida.
- [x] Task 06: Registrar o módulo. Arquivo: `src/app.module.ts`. Objetivo: `EmailsModule` nos imports,
  exportando `MailerService` — as fases 04 e 05 dependem disso.

# Fase 02: Descadastro [x]
Branch: `feat/014-descadastro`

Vem **antes** de qualquer disparo, e a ordem é a decisão: a primeira coisa que precisa funcionar num canal
de e-mail é a saída dele.

- [x] Task 01: Os três campos no perfil. Arquivos: `src/profile/entities/profile.entity.ts`, `.spec.ts`.
  Objetivo: `emailOptOut`, `emailOptOutReason`, `emailOptOutAt` na interface, no `ProfileDocument` e no
  converter. **Teste-trava: documento antigo, sem os campos, é lido como `emailOptOut: false`** — o
  `?? false` é carga útil, e sem ele a base inteira parece descadastrada e o primeiro disparo sai para
  zero pessoa sem erro nenhum.
- [x] Task 02 (TDD + implementação): O token. Arquivos: `src/emails/unsubscribe-token.ts`, `.spec.ts`.
  Objetivo: `sign(uid)` e `verify(token)` com HMAC-SHA256 e `EMAIL_UNSUBSCRIBE_SECRET`. Comparação em
  **tempo constante** (`timingSafeEqual`). Testes-trava: token adulterado não verifica; token assinado com
  outro segredo não verifica.
- [x] Task 03 (TDD + implementação): Gravar o descadastro. Arquivos: `src/profile/profile.repository.ts`,
  `.spec.ts`. Objetivo: `setEmailOptOut(uid, optOut, reason)`. **Idempotente** — descadastrar duas vezes
  não é erro, mesma inversão que a decisão 10 da spec 012 registrou para `notification_reads`, e o
  comentário registra isso.
- [x] Task 04 (TDD + implementação): O endpoint público. Arquivos:
  `src/emails/emails.controller.ts`, `.spec.ts`. Objetivo: `POST /emails/descadastro` **sem guard**,
  token na query, 204 sempre. Testes-trava: token inválido responde **204 e não escreve nada** (a
  distinção seria um oráculo de `uid`); `uid` sem perfil também responde 204.
- [x] Task 05: `@SkipThrottle` não; **throttle sim**. Objetivo: o endpoint é público e escreve — ele fica
  sob o `ThrottlerGuard` já configurado, com limite próprio se necessário. Um endpoint de escrita público
  sem limite é o alvo mais barato que a API tem.
- [x] Task 06 (TDD + implementação): O interruptor do membro. Arquivos: `src/profile/profile.controller.ts`,
  `src/profile/profile.service.ts`, `.spec.ts`. Objetivo: `PATCH /me/emails` com `{ receber: boolean }`,
  sob `FirebaseAuthGuard`, 204. Reusa o repositório da Task 03 com `reason: 'membro'`.
- [x] Task 07 (TDD + implementação): `GET /me` devolve o estado. Arquivos: `src/profile/dto/*.ts`,
  `profile.controller.spec.ts`. Objetivo: `emailOptOut` no DTO do perfil — sem ele o front não tem como
  desenhar o interruptor no estado certo, e ele nasceria sempre ligado.

# Fase 03: A audiência [x]
Branch: `feat/014-audiencia`

Ao fim desta fase o servidor sabe **para quem** um e-mail iria, e ainda não manda nada.

- [x] Task 01 (TDD + implementação): O serviço de audiência. Arquivos:
  `src/emails/audience.service.ts`, `.spec.ts`. Objetivo: percorrer `listUsers` do Auth, cruzar com
  `profiles` por `getAll` de caminho, e devolver `{ uid, email }[]` **ordenado por `uid`** (decisão 4). A
  junção é a mesma do `AdminUsersService.list` — **reusar, não reescrever**; se ela precisar sair de lá
  para um lugar comum, sai nesta task.
- [x] Task 02 (TDD + implementação): Os três cortes. Objetivo: fora quem tem `disabled: true`, quem tem
  `emailVerified: false` e quem tem `emailOptOut: true` (decisão 7). **Testes-trava, um por corte** — os
  três são invisíveis quando quebram, porque a campanha "funciona" e a pessoa simplesmente não recebe.
- [x] Task 03 (TDD + implementação): Os filtros. Objetivo: `tiers` e `gradeMin`/`gradeMax`, aplicados
  **em memória** depois da junção (decisão 13). Teste-trava: filtro ausente significa **todos**, e nunca
  ninguém. Comentário registrando por que não é `where` — cada `where` aqui é um índice composto novo em
  produção.
- [x] Task 04 (TDD + implementação): Excluir o autor. Objetivo: `excludeUid` opcional, usado pelo gatilho
  de vídeo (decisão 7). Teste-trava: quem publicou não está na audiência do próprio anúncio.
- [x] Task 05: DTO dos filtros. Arquivo: `src/emails/dto/audience-filter.dto.ts`. Objetivo: `tiers` com
  `@IsIn(TIER_IDS)` por item, `gradeMin`/`gradeMax` entre `GRADE_MIN` e `GRADE_MAX`. **Nenhum campo de
  pagamento**, e o comentário diz por quê (decisão 12) — é aqui que alguém vai querer "só adicionar" um
  `paymentStatus`.
- [x] Task 06 (TDD + implementação): `POST /admin/emails/audiencia`. Arquivos:
  `src/emails/admin-emails.controller.ts`, `.spec.ts`. Objetivo: `FirebaseAuthGuard` + `AdminGuard`,
  devolve `{ count }`. **Teste-trava: a resposta não contém e-mail nenhum** (decisão 14).

# Fase 04: A campanha e o envio [x]
Branch: `feat/014-campanha`

É a fase que faz o recurso existir, e é a que tem o maior risco: um erro no cursor manda e-mail duplicado
para a base inteira.

- [x] Task 01: Entidade e converter. Arquivos: `src/emails/entities/email-campaign.entity.ts`. Objetivo:
  os campos do modelo, com `Timestamp`, e `videoCampaignId(badgeId, youtubeId)` montando
  `video__{badgeId}__{youtubeId}` — **a regra do ID tem um dono só**, como `badgeVideoDocId` e
  `notificationDocId` (decisão 17).
- [x] Task 02 (TDD + implementação): Repositório. Arquivos: `src/emails/email-campaign.repository.ts`,
  `.spec.ts`. Objetivo: `create()` (nunca `set()`), `updateProgress(id, cursorUid, sentCount)`,
  `finish(id, status, error)`, `listRecent(20)` e `findSending()`. `listRecent` é
  `orderBy('createdAt','desc').limit(20)` e `findSending` é `where('status','==','enviando').limit(1)` —
  **os dois de campo único, nenhum índice composto novo** (decisão 13), e o comentário registra isso.
- [x] Task 03 (TDD + implementação): `ALREADY_EXISTS` engolido na campanha de vídeo. Objetivo: criar
  campanha de vídeo que já existe **não lança e não envia de novo**. Reusar a constante `ALREADY_EXISTS`
  de `waitlist.repository.ts`. É o que impede um retry de rede de anunciar o mesmo vídeo duas vezes para
  a base inteira.
- [x] Task 04 (TDD + implementação): O envio em lotes. Arquivos: `src/emails/email-campaign.service.ts`,
  `.spec.ts`. Objetivo: `send(campaign)` monta a audiência, fatia em lotes de 100, envia pelo
  `MailerService`, e **grava `cursorUid` e `sentCount` depois de cada lote** (decisão 4). Testes-trava:
  (a) audiência de 250 vira três lotes; (b) falha no terceiro lote deixa a campanha `interrompida` com o
  cursor no fim do segundo; (c) `send` de campanha com cursor **começa depois dele**, e não do início.
- [x] Task 05 (TDD + implementação): Cabeçalhos de lista. Objetivo: todo e-mail sai com
  `List-Unsubscribe` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, apontando para o endpoint da
  Fase 02 com o token daquele destinatário. **Teste-trava: o token do cabeçalho e o do rodapé são do
  mesmo `uid`** — trocá-los descadastra a pessoa errada, e nada na tela denunciaria.
- [x] Task 06 (TDD + implementação): O trinco. Objetivo: criar campanha com outra `enviando` responde
  **409** (decisão 15). Teste-trava explícito, porque o sintoma sem ele é e-mail duplicado sob carga —
  o pior bug possível desta spec para reproduzir depois.
- [x] Task 07 (TDD + implementação): Os endpoints do admin. Arquivos: `admin-emails.controller.ts`,
  `.spec.ts`, `src/emails/dto/*.ts`. Objetivo: `POST /admin/emails` (cria e dispara),
  `POST /admin/emails/teste` (envia para o próprio admin, **não cria campanha**),
  `POST /admin/emails/:id/retomar` e `GET /admin/emails`. Testes-trava: audiência zero responde **400**;
  retomar campanha `concluida` responde **409**.
- [x] Task 08: DTO da listagem. Objetivo: `GET /admin/emails` devolve assunto, tipo, contagens, estado e
  datas — **e não devolve `body`** (decisão 17). Comentário dizendo por quê, senão alguém "completa" o
  DTO na primeira vez que quiser ver o que foi enviado.
- [x] Task 09: Swagger. Objetivo: `@ApiTags('emails')`, `@ApiBearerAuth()` nos de admin, e o `POST` de
  descadastro documentado como **público e idempotente**. O `POST /admin/emails` documenta em uma frase
  que **o envio acontece dentro da requisição** e que a resposta é o resultado, não um aceite.

# Fase 05: O gatilho do vídeo [x]
Branch: `feat/014-gatilho-video`

- [x] Task 01 (TDD + implementação): Publicar vídeo dispara a campanha. Arquivos:
  `src/track/badge-video.service.ts`, `.spec.ts`. Objetivo: depois de criar o vídeo e a notificação,
  montar a campanha `kind: 'video'` com `excludeUid` do admin e enviar. **Teste-trava: e-mail falhando, o
  vídeo continua criado e a resposta continua 201** (decisão 6) — o mesmo teste que a spec 012 escreveu
  para a notificação, agora com um segundo efeito colateral mais caro.
- [x] Task 02: O assunto e o corpo do e-mail de vídeo. Objetivo: assunto com o título do vídeo, corpo com
  o nome da insígnia, e botão levando à trilha daquela insígnia. **A URL sai de `FRONTEND_URL` + o
  caminho** — e é a primeira vez que este repositório monta rota do front, o que a decisão 9 da spec 012
  proibia para a API de notificação. O comentário registra a diferença: **e-mail não tem roteador**, então
  o link precisa ser absoluto e alguém tem que montá-lo.
- [x] Task 03: Log na falha. Objetivo: o `catch` do gatilho loga com o id da campanha e o do vídeo. Sem
  ele, "às vezes não avisa" vira investigação sem pista — a mesma razão da Task 03 da Fase 03 da spec 012.
- [x] Task 04: Comentário no gatilho. Objetivo: registrar que o e-mail é **acessório**, que nenhuma falha
  dele pode virar status de erro, e que ele é síncrono **por ora** — com o ponteiro para a decisão 15 e
  para o ponto em aberto 1. É o `try/catch` que parece descuido e é decisão.

# Fase 06: Bounce e reclamação [x]
Branch: `feat/014-webhook`

- [x] Task 01 (TDD + implementação): Verificação de assinatura. Arquivos:
  `src/emails/webhook-signature.ts`, `.spec.ts`. Objetivo: validar a assinatura do provedor com
  `RESEND_WEBHOOK_SECRET`. Teste-trava: assinatura inválida **não** passa, e nada é escrito.
- [x] Task 02: `rawBody` no boot. Arquivo: `src/main.ts`. Objetivo: habilitar o corpo cru **só na rota do
  webhook** — assinatura calculada sobre JSON já reserializado não confere, e o sintoma é "o webhook
  nunca valida" sem nenhuma pista do motivo.
- [x] Task 03 (TDD + implementação): O endpoint. Arquivos: `src/emails/emails.controller.ts`, `.spec.ts`.
  Objetivo: `POST /emails/webhook/resend`, público, 401 sem assinatura válida. `email.bounced`
  permanente e `email.complained` gravam o descadastro com o motivo correspondente (decisão 10).
  **Teste-trava: bounce temporário não descadastra ninguém.**
- [x] Task 04 (TDD + implementação): Do e-mail para o `uid`. Objetivo: o webhook chega com o endereço, e o
  descadastro é por `uid`. Resolver via `getUserByEmail` do Auth; endereço que não existe mais é
  **ignorado em silêncio**, com log. Teste-trava: e-mail desconhecido responde 204 e não escreve nada.
- [x] Task 05: `emailOptOut` no `AdminUserDto`. Arquivos: `src/admin/dto/admin-user.dto.ts`,
  `src/admin/admin-users.service.ts`, `.spec.ts`. Objetivo: o admin vê quem não recebe. Sem isso, "não
  chegou para o fulano" é investigação sem pista.

# Fase 07: Documentação e verificação [ ]
Branch: `feat/014-docs`

- [x] Task 01: `CLAUDE.md`. Objetivo: três linhas novas na lista de garantias que vivem em código — **o
  descadastro é absoluto e não tem exceção configurável**; **o cursor da campanha é o que impede reenvio
  do começo, e a ordem por `uid` é o que o sustenta**; **sem `RESEND_API_KEY` o mailer loga e não envia,
  e esse padrão existe para proteger produção de uma máquina de desenvolvimento**.
- [x] Task 02: `README.md`. Objetivo: os oito endpoints na tabela, a coleção `email_campaigns` e os três
  campos novos do perfil no modelo, e as cinco variáveis de ambiente. **A tabela de índices compostos não
  muda** — e dizer isso explicitamente no commit, porque "spec nova, índice novo" é a suposição padrão.
- [x] Task 03: Autenticação do domínio. Objetivo: registrar no README o que precisa existir no DNS antes
  do primeiro envio real — SPF, DKIM e DMARC — e que **o domínio de teste do provedor não é opção**
  (decisão 2). É a única parte desta spec que não vive no código e a única que não dá para consertar
  depois.
- [x] Task 04 (e2e): O caminho inteiro contra o emulador. Arquivo: `test/emails.e2e-spec.ts`. Objetivo:
  admin cria campanha, o mailer em modo log registra os destinatários, a campanha termina `concluida`, e
  **um membro descadastrado não aparece na lista de destinatários**. É o teste que prova a decisão 8 de
  ponta a ponta, e é o único lugar onde ela é verificável de verdade.
- [ ] Task 05: Envio real de verificação. Objetivo: com a chave ligada, disparar **para o próprio admin
  apenas** — filtro que pega uma pessoa — e conferir no Gmail: remetente autenticado (sem "enviado via"),
  o link de descadastro funcionando, e o "cancelar inscrição" nativo do Gmail aparecendo no topo. Esse
  último é a prova de que os cabeçalhos da Fase 04 estão certos, e nenhum teste automatizado o alcança.

---

# Fase 08: O e-mail limpo [ ]
Branch: `feat/014-email-limpo`

> **De onde esta fase vem.** Os e-mails do produto estão caindo na aba **Promoções** do Gmail. O
> diagnóstico está em `fix-email-styles.md` (aqui) e em `fix.md` (no front, que conclui: nada a fazer lá).
> O commit `58c5bdb` já executou a parte mais óbvia — tirou a `<table>` de layout, o fundo cinza, o cartão
> branco e o botão com `padding` de marketing. **Esta fase é o que ficou de fora dele**, e ela existe
> porque aquele conserto entrou direto no `dev` sem passar por spec, e **deixou a suíte vermelha**.
>
> O princípio que decide todas as tasks abaixo: **um e-mail que quer a aba Principal precisa parecer um
> e-mail que uma pessoa escreveu para outra.** Não é sobre gosto — o Gmail classifica por estrutura, e
> `<table>` de layout, fundo colorido no `<body>` e botão grande são a assinatura de campanha.

- [x] Task 01 (TDD): O teste que a simplificação quebrou. Arquivo: `src/emails/email-template.spec.ts`.
  Objetivo: `npm test` está **vermelho no `dev`** — o teste dos parágrafos casa a string
  `<p style="margin:0 0 16px` e o HTML novo escreve `margin: 0 0 16px`, com espaço. Consertar **mudando o
  que ele afirma, e não a string**: ele deve contar `<p` e não CSS inline. Um teste que casa estilo quebra
  em toda mudança de estilo e não pega defeito nenhum — foi exatamente o que aconteceu aqui, e é por isso
  que a task é a primeira.
- [ ] Task 02: O `<h1>` que repete o assunto. Arquivo: `src/emails/email-template.ts`. Objetivo: **tirar o
  título do corpo.** Nenhum e-mail escrito por uma pessoa começa repetindo o próprio assunto em fonte
  grande; quem faz isso é newsletter, e o filtro sabe disso. O assunto continua no cabeçalho da mensagem,
  que é onde ele já é lido. O `fix-email-styles.md` deixou isso como pergunta em aberto ("ou remover se
  quisermos deixar 100% estilo texto") — esta task é a resposta.
- [ ] Task 03 (TDD): O CTA nunca mais vira botão. Objetivo: teste-trava de que o `htmlCta` sai como
  **link sublinhado**, e não como `<a>` com `background` e `padding`. O botão foi removido no `58c5bdb` e
  vai voltar: é o pedido estético mais natural do mundo ("dá um destaque nesse link"), e ele custa a aba.
  O teste é o que faz a conversa acontecer antes do envio, e não depois.
- [ ] Task 04: O remetente diz um nome de gente. Arquivos: `.env.example`, `README.md`. Objetivo: hoje o
  `EMAIL_FROM` é `Liga Dev <comunidade@lenoborges.com.br>`. **Nome de marca no remetente é sinal de massa**,
  e o par natural dele é o `EMAIL_REPLY_TO`, que já aponta para uma pessoa (`leno@`). Documentar o formato
  recomendado — `Leno Borges <comunidade@lenoborges.com.br>` — e por quê. **Não é troca de código**: é uma
  variável de ambiente e uma linha de README, e a decisão é de quem opera.
- [ ] Task 05: Nada de imagem, e nada de segundo link. Arquivo: `email-template.ts`. Objetivo: registrar em
  comentário que **o único link do template é o descadastro** (mais o CTA, quando existir), e que imagem
  nenhuma entra — proporção imagem/texto é um dos sinais mais fortes de Promoções, e um logo no topo é a
  próxima coisa que alguém vai querer adicionar. É comentário, e não código: o código já não tem imagem, e
  o que falta é o motivo escrito onde a mudança aconteceria.
- [ ] Task 06: Os dois `fix*.md` entram na spec. Arquivos: `specs/014 - Disparo de E-mails/context.md`,
  `fix-email-styles.md`. Objetivo: o diagnóstico vira uma **decisão numerada** no `context.md` — hoje ele é
  um documento solto ao lado do `context.md` e do `tasks.md`, e uma terceira fonte de verdade é como as
  três divergem. O `fix-email-styles.md` fica como registro datado do incidente, com um link para a
  decisão nova.
- [ ] Task 07 (verificação): A única prova que vale. Objetivo: mandar o e-mail de teste
  (`POST /admin/emails/teste`) para uma conta **do Gmail** e conferir em qual aba ele caiu. Nenhum teste
  automatizado responde esta pergunta — a classificação acontece do outro lado, e ela é o motivo desta
  fase existir. Se ainda cair em Promoções, o próximo suspeito **não é mais o HTML**: é reputação de
  domínio e volume (ver "Antes do primeiro envio real: o DNS", no README).

---

# Fase 09: Achar o que realmente decide a aba [ ]
Branch: `fix/014-promocoes`

> **O HTML foi simplificado e o e-mail continuou em Promoções.** Isso é informação, e ela custa caro de
> ignorar: significa que o suspeito estava errado, ou que ele era só um entre vários. A suspeita nova é o
> `List-Unsubscribe`, e ela é plausível — aquele cabeçalho é literalmente o que declara a mensagem como
> correspondência de lista.
>
> **Mas nenhuma destas tasks é "mudar e torcer".** A aba do Gmail é decidida do outro lado, por sinais que
> não se leem no código, e é personalizada por destinatário. A única forma de saber é **trocar uma coisa
> por vez e mandar de verdade**, e é para isso que a Task 01 existe.
>
> Ordem dos suspeitos, do mais provável ao menos, e ela não é palpite: é o que sobra depois de o HTML ter
> sido descartado como causa.

- [x] Task 01: O interruptor. Arquivos: `src/emails/email-campaign.service.ts`, `.spec.ts`,
  `.env.example`. Objetivo: `EMAIL_LIST_UNSUBSCRIBE=off` desliga os dois cabeçalhos, **ausente significa
  ligado**, e só o `off` explícito desliga — erro de digitação na variável não pode virar envio sem
  cabeçalho. O link do rodapé não depende dela, e tem teste-trava dizendo isso. **O objetivo é medir, e o
  padrão continua sendo ligado.**
- [ ] Task 02 (medição): O rastreamento do provedor. **Este é o primeiro lugar a olhar, e ele não está no
  código.** No painel do Resend, por domínio, existem *Open Tracking* e *Click Tracking*. Com eles ligados,
  o provedor **injeta um pixel de imagem 1×1** e **reescreve todo link** para passar por um domínio de
  rastreamento — depois de o template ter saído daqui. Isso explica exatamente o sintoma: limpar o HTML no
  código não mudou nada, porque o que o Gmail recebe não é mais o HTML que este código gerou. Pixel
  invisível e link reescrito são dois dos sinais mais fortes de correio de marketing que existem.
  **Conferir e, se estiverem ligados, desligar os dois.**
- [ ] Task 03 (medição): O teste A/B do `List-Unsubscribe`. Objetivo: com o rastreamento já resolvido,
  mandar `POST /admin/emails/teste` para **a mesma conta do Gmail**, uma vez com `EMAIL_LIST_UNSUBSCRIBE`
  ausente e outra com `off`, e registrar em que aba cada um caiu. Uma variável por vez — mudar as duas
  juntas responde "melhorou", que não é uma resposta.
- [ ] Task 04: O remetente e o rodapé, se as duas primeiras não resolverem. Objetivo: `EMAIL_FROM` é
  `Liga Dev <comunidade@lenoborges.com.br>` — **nome de marca mais endereço de função é a assinatura de
  correio em massa**. E o rodapé diz "Você recebe este e-mail porque é membro da Liga Dev", que é a frase
  de rodapé de newsletter mais reconhecível que existe. Trocar o nome por `Leno Borges` é uma variável de
  ambiente; encurtar o rodapé é uma linha do template — **e o link de descadastro fica**, sempre.
- [ ] Task 05: Aceitar o que não é código. Objetivo: registrar no `context.md` que, esgotadas as tasks
  acima, o que resta **não se conserta com marcação**: domínio novo não tem reputação, e a aba do Gmail é
  personalizada pelo comportamento de cada destinatário — quem nunca abriu, responde ou marca como
  importante ensina o filtro a mandar para Promoções. O caminho aí é engajamento e tempo, e a frase que
  fecha esta fase é: **"o e-mail está limpo; o que falta agora é histórico."**
