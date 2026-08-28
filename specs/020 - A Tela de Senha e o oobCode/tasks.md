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

# Fase 03: O console e a documentação [ ]
Branch: `feat/020-console-e-readme`

Sem código. É a fase que, esquecida, faz tudo o mais funcionar em preview e quebrar em produção.

- [ ] Task 10: **Configurar a action URL nos dois projetos.** Objetivo: `Authentication > Templates >
  customize action URL` apontando para `<front>/acesso` —
  `https://ligapreview.lenoborges.com.br/acesso` em `dev-liga-dev`, e
  `https://liga.lenoborges.com.br/acesso` no projeto de produção. **Os dois, e não um** (ponto em aberto 1):
  configurar só um produz um cadastro que funciona em preview e manda o membro de produção para a tela do
  Google, verde em todo teste.
- [ ] Task 11: Conferir a política de senha. Objetivo: `Authentication > Settings > Password policy`
  continua com mínimo de 8. Não muda nada nesta spec — a task existe porque a decisão 6 acabou de pôr um
  segundo piso no front, e um segundo piso é o que faz ninguém conferir o primeiro.
- [ ] Task 12: `README.md`. Objetivo: quatro mudanças, e a primeira é a que importa.
  - **Sai a instrução "Não configure customize action URL"**, que a decisão 13 torna errada, e entra a
    quarta linha da tabela "o que vive no console" — com a nota de que são **dois** projetos.
  - A seção "A senha é definida fora desta aplicação" vira "A senha é definida na nossa tela", com o
    diagrama novo: `signup → e-mail do Firebase → <front>/acesso → POST /auth/password → /?entrar=1`.
  - **Some a frase "Não existe `POST /auth/password`"** — ele existe de novo, e uma README que nega um
    endpoint publicado é pior que uma sem seção nenhuma.
  - Os três endpoints na lista de "Endpoints da API", com uma linha cada.
- [ ] Task 13: `CLAUDE.md`. Objetivo: a frase que resume a decisão 2 — **o `oobCode` chega nesta API, e o
  front continua sem falar com o Firebase**; e a nota de que `POST /auth/password` não cria sessão
  (decisão 10), que é a "melhoria" que alguém tentará fazer.

# Fase 04: Fechar [ ]
Branch: `feat/020-fechamento`

- [ ] Task 14: `npm run lint` e `npm test`. Suíte verde antes de fechar.
- [ ] Task 15: O fluxo inteiro contra o projeto de preview, com o front da 020 rodando.
  - Cadastro novo: e-mail chega, link cai em `/acesso`, senha definida, `204`, login com ela funciona.
  - **O mesmo link clicado de novo**: `400` com a frase da decisão 5, e não um erro genérico.
  - Uma senha de 6 caracteres forçada por fora do front: recusada pela política, com a mensagem traduzida
    da decisão 6 — é a única prova de que o piso real ainda existe.
  - Troca de e-mail por Meu Perfil, ponta a ponta: o link do e-mail novo cai em
    `/acesso?mode=verifyAndChangeEmail`, o `POST /auth/email-action` responde, e o login passa a ser com o
    e-mail novo. **Nenhuma linha de código deste repositório mudou para isso acontecer** (decisão 12), e é
    exatamente por isso que ele precisa ser testado à mão.
