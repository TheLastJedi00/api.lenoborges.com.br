# Spec 013: Meu Perfil

## Objetivo
Hoje o membro preenche nome, telefone e bio **uma vez**, no onboarding, e nunca mais toca neles. O
`PATCH /me/profile` existe e aceita edição — mas não há tela que o chame depois da primeira vez. Trocar
de e-mail, trocar de senha ou sair do produto levando os próprios dados: nenhuma das três tem caminho.

Esta spec fecha as três. O backend ganha **um endpoint de e-mail, um de senha e um de exclusão de
conta**, e o `PATCH /me/profile` ganha dois campos opcionais. O que muda de natureza é o assunto: até
aqui este repositório mexia em conteúdo — vídeo, pergunta, voto. Daqui em diante ele mexe em
**credencial e em direito de eliminação**, e as duas coisas têm regras próprias que valem escrever antes
de valer implementar.

O par desta spec no front é a **013**, e as duas entram juntas.

---

## Numeração
Os números são iguais nos dois repositórios: 011 é a Sessão que Sobrevive ao F5, 012 é Notificações
Internas, 013 é esta. No front não existe 006 nem 007, e aqui não existe 008 — a divergência é antiga e
não muda nada.

---

## As quatro operações, e o que cada uma custa

| Operação | Endpoint | Reautentica? | Encerra a sessão? |
|---|---|---|---|
| Editar nome, bio, telefone e redes | `PATCH /me/profile` | não | não |
| Trocar de e-mail | `POST /me/email` | **sim** | quando a troca for confirmada |
| Trocar de senha | `POST /me/password` | **sim** | **sim, na hora** |
| Excluir a conta | `DELETE /me` | **sim** | **sim, e para sempre** |

A primeira linha é dado de perfil e é barata. As três de baixo tocam a credencial, e nenhuma delas
acontece sem a senha atual na mão. É a mesma régua em todas: **quem prova ser o dono é a senha, não o
token** — um ID token roubado vale uma hora, e uma hora é tempo suficiente para trocar o e-mail de acesso
e tomar a conta para sempre.

---

## Decisões

### 1. Redes sociais são dois campos opcionais no perfil, e nada além disso
`linkedin` e `instagram` entram em `profiles/{uid}` como `string | null`, e no `UpdateProfileDto` como
opcionais. Documento antigo não tem os campos — e são todos, no dia em que esta spec sobe —, então o
converter aplica `?? null`, pelo mesmo motivo que `tier` e `completedAt` já aplicam.

Não existe coleção de redes, não existe array de links e não existe `type: 'linkedin' | 'instagram' | …`.
Um array de links genéricos parece mais flexível e é a decisão que custa caro na primeira consulta: com
dois campos, "quem tem LinkedIn" é uma pergunta que se responde; com um array, vira varredura.

**Guardar é URL completa, sempre.** O front aceita `@fulano`, `fulano` ou a URL inteira e normaliza antes
de mandar; a API valida que o que chegou é URL do domínio certo e recusa o resto. Guardar handle e montar
a URL na exibição espalharia a regra de montagem por todo consumidor futuro, e o primeiro deles montaria
errado.

### 2. O e-mail muda pela tela do Firebase, e nunca por aqui
`POST /me/email` **não troca o e-mail**. Ele reautentica, e pede ao Identity Toolkit um
`sendOobCode` com `requestType: VERIFY_AND_CHANGE_EMAIL` — que dispara a confirmação **para o endereço
novo**. Quem troca o e-mail é o Google, quando o link for clicado.

É a decisão 3 da spec 007 aplicada de novo, e pela mesma razão: o `oobCode` não passa por esta API, não
existe tela nossa que o consuma, e o endereço novo só passa a valer depois de a pessoa provar que o
recebe. A alternativa — `auth.updateUser({ email })` pelo Admin SDK — trocaria o e-mail de acesso na
hora, sem que ninguém tivesse provado nada, e um erro de digitação viraria uma conta inalcançável.

> **A ordem importa e é o ponto inteiro:** a confirmação vai para o endereço novo, não para o antigo. Um
> fluxo que confirma no endereço antigo prova que a pessoa ainda tem a caixa velha, que é justamente o
> que ela está abandonando.

### 3. E-mail já em uso responde como qualquer outra falha
O Identity Toolkit devolve `EMAIL_EXISTS` quando o endereço já pertence a outra conta. Essa informação
**não sai daqui**: a resposta é a mesma mensagem genérica de qualquer recusa, e o endpoint tem throttle
apertado.

É desconfortável e é deliberado. A spec 005 recusou transformar o cadastro em oráculo de enumeração e
pagou o preço de responder 202 para e-mail conhecido; um `POST /me/email` que responde "esse e-mail já
existe" reabre exatamente o mesmo oráculo, só que atrás de um login — e um login é barato de conseguir.

### 4. Trocar a senha encerra a sessão, e isso não é efeito colateral
`POST /me/password` recebe `{ currentPassword, newPassword }`, reautentica com
`accounts:signInWithPassword`, troca com `accounts:update`, e então:

1. `auth.revokeRefreshTokens(uid)` — mata toda sessão viva, em qualquer aparelho;
2. `clearRefreshToken(res)` — apaga o cookie deste navegador;
3. responde `204`.

Trocar a senha porque se desconfia de invasão e continuar com o invasor logado é não ter trocado a senha.

Há um motivo mecânico junto: **o cookie de refresh vive em `path=/auth`** (spec 005), então uma resposta
de `/me` não consegue lê-lo para rotacioná-lo. Dá para apagá-lo daqui — `Set-Cookie` escreve qualquer
path —, mas não para emitir um par novo. Entre mudar o path do cookie do produto inteiro por causa desta
tela e encerrar a sessão, encerrar é a saída que já era a certa por segurança.

O ID token que a pessoa tem na mão continua válido por até uma hora, porque o guard roda com
`CHECK_REVOKED = false` (decisão 2 da spec 007). A janela é conhecida, está escrita lá, e é o preço já
aceito. Se um dia houver requisito de corte imediato, é aquele booleano que vira.

### 5. Reautenticar é `signInWithPassword`, e o resultado é descartado
As três operações críticas chamam o mesmo helper: `accounts:signInWithPassword` com o e-mail atual e a
senha informada. Se der `INVALID_LOGIN_CREDENTIALS`, é `401`. Se der certo, o `idToken` que voltou é
**usado e jogado fora** — nada dele vira sessão, nada dele vai para cookie.

Isso é reuso do caminho de login que já existe e já é testado, não um segundo mecanismo de credencial.
Um verificador de senha próprio seria o segundo lugar do projeto capaz de dizer "essa senha confere", e
dois lugares assim divergem na primeira exceção.

O `idToken` fresco é carga útil em duas das três: o `accounts:update` da senha e o `sendOobCode` da troca
de e-mail exigem um token do usuário, e o que chega no header pode estar a cinquenta minutos de idade.

### 6. Excluir a conta apaga o que é da pessoa e anonimiza o que é da comunidade
A pergunta do Mural não é só dela: tem votos de outras pessoas, pode ter vencido a semana e pode ter
virado vídeo na trilha. Apagá-la levaria junto o voto de terceiros e deixaria um vídeo respondendo a uma
pergunta que não existe mais.

Então a exclusão tem duas metades:

| Some de verdade | Vira anônimo |
|---|---|
| Usuário do Firebase Auth | `mural_questions` de autoria dela |
| `profiles/{uid}` | |
| `profiles/{uid}/notification_reads/*` | |
| Votos dados por ela, em `{questionId}/votes/{uid}` | |
| `waitlist_entries/{email}`, se houver | |

Anonimizar é um `update` de dois campos: `authorUid` vira `ANONYMOUS_AUTHOR_UID` e `authorName` vira
`'Membro removido'`. O texto da pergunta fica, os votos que ela recebeu ficam, o `answerVideoId` fica.

**Isto atende à LGPD porque o que sobra deixa de identificar alguém.** O dado pessoal — nome, e-mail,
telefone, bio, e a própria existência da conta — é eliminado; o que resta é o texto de uma pergunta
técnica sem autor. É eliminação, não pseudonimização, desde que nada mais no sistema saiba ligar aquele
registro a uma pessoa. Ver o ponto em aberto 1, que é onde essa condição pode deixar de valer.

### 7. O `uid` sobrevive no caminho do documento, e essa é a parte que precisa estar escrita
O ID da pergunta é `{weekId}__{uid}` (spec 010). Anonimizar os campos **não tira o `uid` do caminho**, e
mover o documento para um caminho novo significaria recriar a pergunta e migrar a subcoleção de votos
inteira — um `create` + N escritas + `delete` por pergunta, com janela de inconsistência no meio.

O `uid` fica. Depois da exclusão ele é uma cadeia opaca que **não resolve para ninguém**: não há usuário
no Auth, não há perfil, não há entrada na lista de espera. É identificador órfão, e identificador órfão
não identifica.

> A condição para isso continuar verdadeiro é uma só: **nenhuma outra coleção pode guardar
> `uid` → pessoa** depois desta spec. Log com uid e e-mail juntos, tabela de analytics, backup de perfil
> "por garantia" — qualquer um desses reata o vínculo e transforma anonimização em pseudonimização. É a
> restrição que a próxima spec que tocar em observabilidade precisa ler antes de escrever a primeira
> linha.

### 8. Os votos saem, e o contador acompanha
Cada voto dado é um documento em `mural_questions/{qid}/votes/{uid}`, e o `uid` está no caminho: sai. O
`voteCount` da pergunta é decrementado no mesmo lote, porque contador que discorda da subcoleção é um
número que ninguém consegue conferir depois.

**Achar os votos é varredura, não consulta.** Não existe consulta que devolva "todos os votos deste uid"
sem índice de collection group, e `mural_questions` é pequeno por construção — uma pergunta por membro
por semana, com a coleção varrida inteira pelo `getAll` de caminhos, como a `findMyVotes` já faz. Criar
índice de collection group para uma operação que acontece uma vez na vida de cada membro é pagar mensal
por evento raro. Ver a decisão 12 da spec 012.

Semana fechada pode mudar de vencedora quando um voto some, e isso é aceito: o vídeo que respondeu à
pergunta é um campo carimbado (`answerVideoId`), não um cálculo, então a trilha não se mexe.

### 9. O Auth é o último a morrer
A ordem da exclusão é fixa e não é arbitrária:

1. reautentica;
2. anonimiza as perguntas;
3. apaga os votos e ajusta contadores;
4. apaga `notification_reads`, depois `profiles/{uid}`;
5. apaga a entrada da lista de espera;
6. **`auth.deleteUser(uid)`**;
7. limpa o cookie e responde `204`.

Não há transação atravessando Firestore e Firebase Auth — não existe uma —, então o que resta é escolher
**qual metade fica de pé quando a outra falha**. Com o Auth por último, uma falha no meio deixa a conta
viva e a pessoa capaz de tentar de novo. Com o Auth primeiro, uma falha no meio deixa dado pessoal órfão
no Firestore, sem conta, sem sessão e sem ninguém com direito de pedir a remoção — o pior resultado
possível para a operação cujo propósito inteiro é remover dado pessoal.

Falha depois do passo 6 não existe: o que vem depois é cookie e status.

### 10. Admin não exclui a própria conta por aqui
`DELETE /me` responde `403` quando `role === 'admin'`.

A claim `role` é aplicada à mão, pelo console (spec 009). Um admin que se exclui não deixa só de existir:
leva junto a única forma de administrar o produto, e devolver isso exige console do Firebase, service
account e alguém que saiba o caminho. É uma porta que só abre por fora.

Não é proteção de segurança, é trava contra tijolo — e está no backend porque o front esconder o botão
seria proteção nenhuma.

### 11. Nada disto entra no `AdminUsersController`
O admin continua sem poder excluir a conta de terceiros, e esta spec não cria esse endpoint. O direito de
eliminação é da pessoa e a operação é irreversível: um `DELETE /admin/users/{id}` acessível por engano em
uma tela de listagem é a diferença entre um produto e um incidente.

Se um dia precisar existir — e vai, no dia em que alguém pedir a exclusão por fora do produto —, é spec
própria, com trilha de auditoria e confirmação por e-mail.

### 12. Nenhum índice composto novo, de novo
As três operações críticas leem por caminho. A varredura de votos lê `mural_questions` inteira sem
`where`. O `PATCH /me/profile` continua sendo um `update` por caminho.

Este produto ainda não tem um índice composto, e a linha só continua verdadeira enquanto for escrita em
toda spec. Ver a decisão 12 da spec 012.

---

## Endpoints

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `PATCH` | `/me/profile` | `name`, `phone`, `bio`, `linkedin?`, `instagram?` | `200` `ProfileDto` |
| `POST` | `/me/email` | `newEmail`, `password` | `202` `{ status: 'confirmation_sent' }` |
| `POST` | `/me/password` | `currentPassword`, `newPassword` | `204`, cookie limpo |
| `DELETE` | `/me` | `password` | `204`, cookie limpo |

Todas atrás do `FirebaseAuthGuard`. Throttle: `POST /me/email` e `POST /me/password` em `3/min`,
`DELETE /me` em `3/min`, `PATCH /me/profile` mantém o `10/min` que já tem.

`202` no e-mail e não `200`, pela mesma razão do `POST /auth/signup`: o pedido foi aceito, a troca ainda
não aconteceu, e o verbo da resposta precisa dizer isso.

### Erros

| Situação | Status | Mensagem |
|---|---|---|
| Senha atual errada, em qualquer das três | `401` | `Senha incorreta.` |
| E-mail novo inválido, igual ao atual, ou já em uso | `400` | `Não foi possível usar este e-mail.` |
| Senha nova recusada pela política do projeto | `400` | o que o Identity Toolkit disser, traduzido |
| Admin tentando `DELETE /me` | `403` | `Contas de administração não podem ser excluídas por aqui.` |
| Perfil inexistente | `404` | `Perfil não encontrado.` |

---

## Modelo

```
profiles/{uid}
  name, phone, bio, grade, tier, completedAt, waitlistEntryId, createdAt, updatedAt
  linkedin: string | null      ← novo
  instagram: string | null     ← novo
```

Nenhuma coleção nova. Nenhuma subcoleção nova.

```
mural_questions/{weekId}__{uid}      depois da exclusão
  authorUid: '__removido__'          ← ANONYMOUS_AUTHOR_UID
  authorName: 'Membro removido'
  title, body, badgeId, voteCount, answerVideoId  ← intactos
```

---

## Fora de escopo

- **Exportar meus dados.** É o outro direito da LGPD e é spec própria: formato, entrega e o que fazer com
  arquivo que contém dado pessoal são três perguntas que esta spec não responde. O que existe hoje é o
  `GET /me`, e ele devolve tudo que o produto guarda da pessoa.
- **Período de carência e desfazer.** A exclusão é imediata. Uma lixeira de 30 dias exigiria manter o
  dado pessoal que a pessoa acabou de pedir para eliminar, e a única forma de fazer isso direito é uma
  conversa com jurídico, não uma decisão de arquitetura.
- **Excluir conta de terceiros pelo admin** (decisão 11).
- **Trocar a foto do perfil.** Não há avatar no produto: nenhuma tela mostra um, e armazenamento de
  imagem é infraestrutura nova.
- **Verificar o e-mail atual.** Quem definiu a senha pelo link do cadastro já tem `emailVerified: true`;
  quem não tem cai no ponto em aberto 2.
- **Segundo fator, sessões ativas e histórico de acesso.** Nenhum tem tela para morar.
- **Notificar a troca de e-mail no endereço antigo.** Seria a prática correta e depende de um canal de
  e-mail transacional que o produto não tem — hoje só existem os e-mails que o próprio Firebase dispara.
  Ponto em aberto 3.

---

## Specs afetadas

### Spec 005 (Autenticação e Dashboard) — vigente, estendida
O `PATCH /me/profile` continua sendo o mesmo endpoint do onboarding, agora com dois campos opcionais. O
`completedAt` continua sendo carimbado só na primeira vez; edição de quem já completou não o toca.

### Spec 007 (Firestore e Firebase Auth) — vigente
A decisão 3 de lá — o Firebase hospeda a tela, o `oobCode` não passa por esta API — passa a valer também
para a troca de e-mail (decisão 2 desta). A decisão 2 de lá, o `CHECK_REVOKED = false`, é o que define a
janela de até uma hora depois da troca de senha (decisão 4 desta).

### Spec 010 (Mural de Perguntas) — vigente, com uma consequência nova
A pergunta passa a poder ter autor anônimo. Todo consumidor de `authorName` já trata o campo como texto
livre e não muda; o que muda é que **`authorUid` deixa de ser garantia de que existe um perfil por trás
dele**. Quem for cruzar os dois precisa tolerar a ausência.

A garantia de uma pergunta por membro por semana continua valendo pelo caminho do documento, e continua
valendo depois da anonimização — o caminho não muda (decisão 7).

### Spec 012 (Notificações Internas) — vigente
A subcoleção `notification_reads` já vinha com a instrução de que apagar um perfil precisa apagá-la
explicitamente. Esta spec é quem finalmente apaga um perfil, e é a primeira vez que aquela linha vale
alguma coisa.

Notificações de perguntas de quem se excluiu **não são removidas**: a janela é de 30 dias, elas
carregam `badgeId` e `questionId` e nenhum dado pessoal, e a pergunta ainda existe — anônima.

### Spec 009 (Financeiro, Administração e Trilha) — vigente
`tier` some com o perfil, e não há assinatura para cancelar em lugar nenhum: o pagamento é por fora
(`BillingService.resolveCurrentTier`). No dia em que houver gateway, **cancelar a cobrança entra no passo
5 da decisão 9**, antes do Auth.

---

## Pontos em aberto

1. **O `uid` órfão é mesmo anônimo?** Escrito como sim, e a decisão 7 diz sob qual condição. A condição é
   verificável hoje e frágil amanhã: basta uma spec de observabilidade guardar `uid` ao lado de e-mail
   para que ela deixe de valer. Vale reler esta linha antes de aceitar qualquer log persistente.
2. **`VERIFY_AND_CHANGE_EMAIL` em conta com `emailVerified: false`.** O Identity Toolkit pode recusar. A
   maioria das contas está verificada porque definir a senha pelo link do cadastro marca a verificação,
   mas quem foi criado à mão pelo console pode não estar. Se a recusa aparecer, a saída é disparar antes
   um `VERIFY_EMAIL` no endereço atual — o que reintroduz a caixa velha no caminho, e é exatamente o que
   a decisão 2 queria evitar.
3. **Ninguém avisa o endereço antigo.** Se a conta for tomada, o dono legítimo descobre a troca ao tentar
   entrar. A prática correta é avisar os dois lados, e depende de e-mail transacional próprio.
4. **A varredura de votos não escala para sempre.** `mural_questions` cresce uma linha por membro por
   semana; com cem membros ativos por um ano são cinco mil documentos, e a exclusão passa a ler todos
   eles. Ainda é barato, mas é o número a olhar — quando incomodar, a saída é índice de collection group,
   e aí o custo vira mensal em vez de por evento.
5. **Senha nova igual à atual.** O Identity Toolkit aceita. Recusar exigiria comparar, e comparar exige
   ter as duas — que é o que já acontece na reautenticação. Fica aceito por ora; se virar suporte, a
   comparação é de duas linhas.
