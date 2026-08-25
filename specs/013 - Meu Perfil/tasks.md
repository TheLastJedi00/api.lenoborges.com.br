# Fase 01: As redes sociais no perfil [x]
Branch: `feat/013-redes-sociais`

A metade barata da spec, e a única que não toca em credencial. Ao fim desta fase o perfil guarda LinkedIn
e Instagram, e nada mais mudou.

- [x] Task 01: Os dois campos na entidade. Arquivo: `src/profile/entities/profile.entity.ts`. Objetivo:
  `linkedin: string | null` e `instagram: string | null` na interface, no `ProfileDocument` e nos dois
  lados do converter. **`?? null` no `fromFirestore`** — documento antigo não tem os campos, e são todos
  no dia do deploy. É o mesmo cuidado de `tier` e `completedAt`, e pelo mesmo motivo: sem ele o valor
  chega `undefined` e toda comparação vira falsa em silêncio.
- [x] Task 02 (TDD + implementação): Validar URL de rede social. Arquivos:
  `src/common/social-url.ts`, `.spec.ts`. Objetivo: `isLinkedinUrl` e `isInstagramUrl`, cada uma
  conferindo protocolo `https` e o domínio esperado (`linkedin.com`, `instagram.com`, com ou sem `www`).
  **Nunca regex solta sobre a string inteira** — teste-trava: `https://evil.com/?u=linkedin.com` é
  recusada, e `https://br.linkedin.com/in/fulano` é aceita. Quem valida domínio por `includes` cria um
  campo de link aberto sem perceber.
- [x] Task 03 (TDD + implementação): Os campos no DTO. Arquivo: `src/profile/dto/update-profile.dto.ts`.
  Objetivo: `linkedin` e `instagram` **opcionais**, com `@IsOptional`, `@MaxLength(200)` e o validador da
  Task 02. String vazia é tratada como remoção e vira `null` — a pessoa que apagou o campo quer que ele
  suma, não que fique `''`.
- [x] Task 04 (TDD + implementação): Gravar e devolver. Arquivos: `src/profile/profile.service.ts`,
  `src/profile/dto/profile.dto.ts`. Objetivo: os dois campos entram no patch e saem no `ProfileDto`.
  **Campo ausente no corpo não apaga o valor guardado** — teste-trava: um `PATCH` só com `name`, `phone`
  e `bio` deixa o LinkedIn intacto. É a diferença entre "não mencionei" e "quero apagar", e é o bug que
  todo `update` parcial produz quando ninguém escreve o teste.
- [x] Task 05: `completedAt` continua intocado na edição. Objetivo: teste-trava de que editar o perfil de
  quem já concluiu o onboarding **não** recarimba a data. Está correto hoje; esta spec é a primeira a
  chamar o endpoint duas vezes na vida de um usuário, então é a primeira em que quebrar isso apareceria.

# Fase 02: Reautenticação [x]
Branch: `feat/013-reautenticacao`

Nenhum endpoint novo. Ao fim desta fase existe **um** lugar capaz de dizer "essa senha confere", e as
três fases seguintes o chamam.

- [x] Task 01 (TDD + implementação): `reauthenticate(email, password)`. Arquivos:
  `src/auth/auth.service.ts`, `.spec.ts`. Objetivo: chama `accounts:signInWithPassword` e devolve o
  `idToken` fresco. `INVALID_LOGIN_CREDENTIALS` e `EMAIL_NOT_FOUND` viram `UnauthorizedException` com
  **a mesma mensagem** — "Senha incorreta." —, porque distinguir aqui responderia uma pergunta que quem
  já está logado não deveria conseguir fazer.
- [x] Task 02: O token fresco é carga útil, não sessão. Objetivo: o comentário registra que o `idToken`
  devolvido **nunca vira cookie e nunca vira `SessionResponseDto`** (decisão 5). Ele existe porque o
  `accounts:update` e o `sendOobCode` exigem um token do usuário, e o que chega no header pode ter
  cinquenta minutos. Sem essa linha escrita, o primeiro a mexer aqui "aproveita" o token e cria uma
  segunda porta de login.
- [x] Task 03 (TDD): Reuso, não segundo mecanismo. Objetivo: teste-trava de que `login()` e
  `reauthenticate()` batem no mesmo endpoint do Identity Toolkit. Dois verificadores de senha divergem na
  primeira exceção, e a exceção sempre chega.

# Fase 03: Trocar de e-mail [x]
Branch: `feat/013-trocar-email`

- [x] Task 01: DTO. Arquivo: `src/profile/dto/change-email.dto.ts`. Objetivo: `newEmail` com
  `@IsEmail` e normalização por `normalizeEmail`, `password` obrigatória.
- [x] Task 02 (TDD + implementação): O endpoint. Arquivos: `src/profile/profile.controller.ts`,
  `src/profile/profile.service.ts`. Objetivo: `POST /me/email`, `202`, `{ status: 'confirmation_sent' }`.
  Reautentica (Fase 02), depois `sendOobCode` com `requestType: VERIFY_AND_CHANGE_EMAIL`, o `idToken`
  fresco e o `newEmail`. **Este endpoint não troca o e-mail** — quem troca é o Google, quando o link for
  clicado (decisão 2). O comentário diz isso, porque o nome do endpoint sugere o contrário.
- [x] Task 03 (TDD + implementação): E-mail novo igual ao atual. Objetivo: `400` antes de qualquer ida ao
  Firebase. Disparar confirmação para o endereço em que a pessoa já está é gastar um e-mail para não
  mudar nada.
- [x] Task 04 (TDD + implementação): `EMAIL_EXISTS` não vaza. Objetivo: a resposta é a mesma mensagem
  genérica de qualquer recusa (decisão 3). **Teste-trava: a mensagem de e-mail já cadastrado é
  byte a byte igual à de e-mail inválido.** É a decisão mais fácil de "melhorar" depois em nome da UX, e
  melhorá-la reabre o oráculo de enumeração que a spec 005 fechou.
- [x] Task 05: Throttle. Objetivo: `@Throttle({ default: { limit: 3, ttl: 60000 } })`. Sem ele, a decisão
  4 vira teatro: quem pode tentar mil vezes por minuto enumera do mesmo jeito, só mais devagar.
- [x] Task 06 (TDD): Spec do endpoint. Objetivo: senha errada dá `401` **sem disparar e-mail nenhum** —
  a ordem é reautenticar primeiro, sempre. Sucesso dá `202`. E-mail igual ao atual dá `400`.

# Fase 04: Trocar de senha [x]
Branch: `feat/013-trocar-senha`

- [x] Task 01: DTO. Arquivo: `src/profile/dto/change-password.dto.ts`. Objetivo: `currentPassword` e
  `newPassword`, ambas obrigatórias, `@MinLength(8)` na nova. **O mínimo real é a política do console**
  (Authentication > Settings > Password policy) — o `MinLength` daqui é cortesia para dar erro melhor, e
  o comentário registra qual dos dois manda, senão o próximo a mexer procura o piso no lugar errado.
- [x] Task 02 (TDD + implementação): O endpoint. Arquivos: `src/profile/profile.controller.ts`,
  `src/profile/profile.service.ts`. Objetivo: `POST /me/password`, `204`. Reautentica, chama
  `accounts:update` com o `idToken` fresco e a senha nova.
- [x] Task 03 (TDD + implementação): Encerrar a sessão. Objetivo: `auth.revokeRefreshTokens(uid)` **e**
  `cookieService.clearRefreshToken(res)`, nessa ordem (decisão 4). O comentário registra por que não há
  rotação: o cookie mora em `path=/auth` e uma resposta de `/me` não consegue lê-lo — e por que encerrar
  já era o certo mesmo se conseguisse.
- [x] Task 04 (TDD): A janela de uma hora está documentada, não escondida. Objetivo: o comentário aponta
  para a decisão 2 da spec 007 e para o `CHECK_REVOKED = false`. Quem ler "revogou" e assumir corte
  imediato vai errar a conta de risco.
- [x] Task 05 (TDD): Spec do endpoint. Objetivo: senha atual errada dá `401` e **nada é revogado** —
  teste-trava, porque revogar antes de conferir desloga quem só errou de digitação. Sucesso dá `204`,
  revoga e limpa o cookie.

# Fase 05: Excluir a conta [x]
Branch: `feat/013-excluir-conta`

A fase irreversível. Cada task aqui apaga alguma coisa de verdade, e a ordem entre elas é a decisão 9.

- [x] Task 01 (TDD + implementação): Anonimizar as perguntas. Arquivos:
  `src/mural/mural.repository.ts`, `src/mural/entities/mural-question.entity.ts`, `.spec.ts`. Objetivo:
  `anonymizeAuthor(uid)` — consulta por `authorUid`, e para cada uma `authorUid: ANONYMOUS_AUTHOR_UID` e
  `authorName: 'Membro removido'`, num lote. `ANONYMOUS_AUTHOR_UID` é constante exportada da entidade, e
  não literal repetido. Teste-trava: **texto, `badgeId`, `voteCount` e `answerVideoId` chegam intactos**.
- [x] Task 02 (TDD + implementação): Apagar os votos dados. Arquivo: `src/mural/mural.repository.ts`.
  Objetivo: `removeVotesBy(uid)` — varre `mural_questions`, monta os caminhos `{qid}/votes/{uid}`, faz um
  `getAll`, e apaga os que existem **decrementando `voteCount` no mesmo lote** (decisão 8). O comentário
  registra por que é varredura e não consulta: índice de collection group é custo mensal para um evento
  que acontece uma vez na vida de cada membro.
- [x] Task 03 (TDD + implementação): Apagar o perfil e a subcoleção. Arquivo:
  `src/profile/profile.repository.ts`. Objetivo: `remove(uid)` — `listDocuments()` em
  `notification_reads`, apaga tudo, e só então apaga `profiles/{uid}`. **Subcoleção não some com o pai
  no Firestore**: órfã, ela fica invisível, cobrada e impossível de achar. A instrução já estava escrita
  em `notification-read.repository.ts`; esta é a task que a cumpre.
- [x] Task 04 (TDD + implementação): Apagar a entrada da lista de espera. Arquivos:
  `src/waitlist/waitlist.repository.ts`, `src/profile/profile.service.ts`. Objetivo: se
  `waitlistEntryId` não for nulo, apagar `waitlist_entries/{id}`. Ela guarda nome, telefone e e-mail —
  é dado pessoal puro, e é o registro mais fácil de esquecer porque nenhuma tela do painel o mostra.
- [x] Task 05 (TDD + implementação): O endpoint. Arquivos: `src/profile/profile.controller.ts`,
  `src/profile/profile.service.ts`, `src/profile/dto/delete-account.dto.ts`. Objetivo: `DELETE /me`,
  corpo `{ password }`, `204`. Reautentica, executa os passos 2 a 5 da decisão 9, **então**
  `auth.deleteUser(uid)`, **então** limpa o cookie.
- [x] Task 06 (TDD): A ordem é teste, não convenção. Objetivo: teste-trava de que `deleteUser` é a
  **última** chamada, e de que uma falha no Firestore **impede** a exclusão do usuário do Auth (decisão
  9). Invertido, o produto produz dado pessoal órfão sem ninguém com direito de pedir a remoção — que é o
  pior resultado possível da operação cujo propósito é remover dado pessoal.
- [x] Task 07 (TDD + implementação): Admin não se exclui. Objetivo: `403` quando `role === 'admin'`
  (decisão 10). Teste-trava: a checagem acontece **antes** da reautenticação, para o admin não gastar a
  senha descobrindo que não podia.
- [x] Task 08 (TDD): Spec da exclusão, ponta a ponta. Objetivo: com um perfil, uma pergunta própria, um
  voto em pergunta alheia e uma entrada de waitlist — conferir que a pergunta ficou anônima com o texto
  intacto, que o voto sumiu e o `voteCount` alheio caiu em um, que o perfil e a subcoleção sumiram, que
  a waitlist sumiu e que o usuário do Auth sumiu por último.

# Fase 06: Documentação e verificação [ ]
Branch: `feat/013-docs`

- [x] Task 01: Swagger. Objetivo: as quatro operações com `@ApiOperation` e `@ApiResponse` completos. A
  descrição do `POST /me/email` diz explicitamente que **o endpoint não troca o e-mail**, e a do
  `POST /me/password` diz que **a sessão termina**. O Swagger é o primeiro lugar onde alguém procura o
  contrato, e os dois nomes mentem sobre o que fazem.
- [x] Task 02: `README.md`. Objetivo: uma seção curta sobre exclusão de conta — o que some, o que vira
  anônimo, e que é imediato e sem desfazer. É o texto que responde a pergunta de suporte antes de ela
  chegar.
- [x] Task 03: A restrição da decisão 7, onde ela vai ser lida. Objetivo: registrar no
  `mural-question.entity.ts`, junto de `ANONYMOUS_AUTHOR_UID`, que **nenhuma coleção nova pode guardar
  `uid` ao lado de dado pessoal**, sob pena de a anonimização virar pseudonimização. Escrito na spec ele
  é lido uma vez; escrito ali é lido por quem for mexer.
- [x] Task 04: `npm test` verde e `npm run build` limpo.
- [ ] Task 05: Verificação em ambiente real — troca de e-mail. Objetivo: pedir a troca, receber a
  confirmação **no endereço novo**, clicar, e conferir que o login passa a funcionar com o e-mail novo e
  para de funcionar com o antigo. É o único jeito de descobrir o ponto em aberto 2, e ele não aparece em
  teste unitário.
- [ ] Task 06: Verificação em ambiente real — exclusão. Objetivo: com uma conta descartável que tenha
  pergunta, voto e entrada de waitlist, excluir e conferir cada coleção no console do Firebase.
  **Conferir a subcoleção `notification_reads` explicitamente** — é a que some da tela e fica no banco.
