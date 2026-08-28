# Spec 020: A Tela de Senha Volta a Ser Nossa

## Objetivo
Todo membro deste produto tem o **primeiro contato com ele numa página do Google**. O cadastro dispara um
e-mail do Firebase, o link do e-mail leva a `<projeto>.firebaseapp.com/__/auth/action`, e é lá — em cinza,
com a marca do Google e um domínio que ninguém reconhece — que a pessoa digita a senha que vai usar aqui.

A spec 007 escolheu isso, e escolheu de olhos abertos: a decisão 3 dela lista, em tabela, tudo o que
saiu do projeto por causa dessa troca, e escreve entre os custos que **"a identidade visual se
interrompe"**.

Esta spec paga a conta de volta. O `oobCode` volta a chegar nesta API, e a tela onde a senha é digitada
volta a ser do produto.

O que muda aqui são **três endpoints públicos e uma linha de configuração no console**. A tela é a 020 do
front, e as duas entram juntas.

---

## Numeração
Os números são iguais nos dois repositórios: 018 é Termos e Privacidade, 019 é Vídeos Assistidos e XP, 020
é esta. No front não existe 006 nem 007, e é a 007 daqui que esta spec reverte em parte.

---

## Dependência de ordem
Esta spec pressupõe a **007** (Firebase Auth, `FirebaseService`, `identityToolkit`) e a **013** (a troca de
e-mail que dispara `VERIFY_AND_CHANGE_EMAIL`). O `LegalAcceptanceGuard` da 018 **não** vale nas rotas
novas, e a decisão 8 explica por que isso é obrigatório e não esquecimento.

---

## Decisões

### 1. A decisão 3 da spec 007 é revertida, e o motivo não é preferência
Aquela decisão comprou uma coisa concreta — nenhuma página, nenhum endpoint, nenhum DTO, nenhum teste, e
uma tela que o fornecedor entrega pronta e correta — e pagou por ela com o que a própria spec listou:
domínio `firebaseapp.com` no meio do cadastro, política de senha fora do nosso controle, e a identidade
visual interrompida.

**O que mudou desde então é a proporção do produto, não a análise.** Em 007 havia landing e um painel; hoje
há diálogo de aceite legal, tela de descadastro, cartão de membro, tela de disparo de e-mails e uma
identidade visual inteira — e o primeiro passo de todo membro novo continua numa página do Google.

Volta o que ela matou, com nomes novos e sem os erros antigos:

| Item da tabela da 007 | Como volta |
|---|---|
| `POST /auth/password` | Volta com o mesmo nome, e agora recebe `oobCode` em vez de token próprio |
| `SetPasswordDto` | Volta como `ConfirmPasswordDto` |
| Página `/definir-senha` | Volta como `/acesso`, uma rota para todos os modos |
| Leitura e limpeza de token da URL | Volta como está descrito na decisão 9 da 020 do front |

**A spec 006 continua sem objeto.** Ela existiu para configurar o Supabase Auth como código, e o
fornecedor mudou — nada aqui a ressuscita.

### 2. O `oobCode` é processado no servidor, e o front continua sem falar com o Google
A alternativa óbvia é instalar o SDK web do Firebase no front e chamar `verifyPasswordResetCode` e
`confirmPasswordReset` de lá. É menos código nosso, e é o que a documentação do Firebase mostra.

**É a decisão da spec 005 sendo desfeita pela porta dos fundos.** O front nunca fala com o provedor de
auth, e a razão não é estética: é o que mantém em um lugar só a superfície que pode emitir e receber
material de sessão. O SDK web no bundle é um segundo caminho de login instalado ao lado do primeiro, e ele
existiria para sempre por causa de uma tela.

O caminho é o mesmo do `signInWithPassword`: a REST do Identity Toolkit, chamada daqui, com a Web API Key
que já vive no `FirebaseService`.

```
front → POST /auth/password  { oobCode, newPassword }
API   → POST accounts:resetPassword?key=<WEB_API_KEY>  { oobCode, newPassword }
```

### 3. Três endpoints, e cada um chama a operação que o nome dele diz
| Endpoint | Identity Toolkit | Devolve |
|---|---|---|
| `POST /auth/password/check` | `accounts:resetPassword` **só com `oobCode`** | `{ email }` |
| `POST /auth/password` | `accounts:resetPassword` com `oobCode` + `newPassword` | `204` |
| `POST /auth/email-action` | `accounts:update` com `oobCode` | `{ email }` |

**Um endpoint só, recebendo o `mode` da query e escolhendo a chamada, foi recusado.** O `mode` chega da
URL do navegador — ele é escrito por quem manda o link, não pelo Firebase — e um `switch` sobre ele aqui
seria a API deixando o cliente escolher qual operação executar sobre uma credencial.

O `oobCode` **carrega o próprio `requestType`**, e o Firebase recusa um código de reset usado como código
de verificação. Deixar essa recusa acontecer no Google, e não num `if` nosso, é ter uma regra em vez de
duas.

O `mode` da query segue existindo e serve para uma coisa só: **o front escolher qual tela desenhar**.

### 4. `check` devolve o e-mail, e isso não é um oráculo
`POST /auth/password/check` responde `{ email: "fulano@exemplo.com" }`, e a tela escreve *"Criando a senha
de fulano@exemplo.com"* acima do formulário.

Parece contrariar a regra que governa o `signup` e o `login` — nunca informar se um e-mail tem conta. Não
contraria, e a diferença é qual segredo prova o quê:

- No `signup`, o requisitante fornece **o e-mail** e quer saber se ele existe. Responder é o oráculo.
- Aqui, o requisitante fornece **o `oobCode`**, que só chegou por uma caixa de entrada. Quem o tem já sabe
  de qual e-mail se trata — foi nela que o link chegou.

É exatamente o que a tela do Firebase mostra hoje no lugar desta. E há um ganho concreto: quem tem duas
contas, ou clicou num link antigo, vê **de qual** conta é a senha que está criando antes de digitá-la.

### 5. Código morto tem uma resposta só, com uma frase que tem saída
`EXPIRED_OOB_CODE`, `INVALID_OOB_CODE` e `OPERATION_NOT_ALLOWED` viram o mesmo `400`, com o mesmo texto:

> *"Esse link não vale mais. Links de senha valem uma vez só e expiram. Peça um novo na tela de entrar."*

**Distinguir expirado de inválido informaria a quem colou um código qualquer se ele existiu algum dia.**
E o caso é comum demais para merecer um erro genérico: o link de quem já definiu a senha uma vez está
morto por definição, e quem clica nele duas vezes é a maior parte das pessoas.

O código do Google fica no log, onde ele é diagnóstico e não oráculo — como já acontece no `login` e no
`changeEmail`.

### 6. A política de senha continua sendo do console, e a API traduz a recusa dela
`WEAK_PASSWORD` e `PASSWORD_DOES_NOT_MEET_REQUIREMENTS` viram `400` com a mensagem que a
`translatePasswordError` já produz em `profile.service.ts` — **e ela sai de lá para um lugar
compartilhado**, porque a partir desta spec dois fluxos precisam da mesma tradução: `POST /me/password`
(logado) e `POST /auth/password` (por link).

O front volta a exigir 8 caracteres (decisão 12 da 020 do front), e **isso não é a garantia**. A garantia
continua sendo `Authentication > Settings > Password policy`, e é a mesma armadilha que a 007 registrou:
sem configurar, o piso do projeto é 6 e o front é a única coisa entre ele e o usuário. A diferença é que
agora existe uma tradução nossa quando o Firebase recusa — antes a mensagem era do Google, na tela do
Google.

### 7. Os três endpoints são públicos, e o `Throttle` é o único controle que resta
Nenhum guard, nenhum token, nenhum cookie. **Eles precisam funcionar para quem nunca esteve logado
naquele navegador** — é a mesma razão do `/descadastro` da spec 014, e é o defeito que só apareceria para
quem está deslogado, ou seja, para todo mundo que os usa.

| Endpoint | Limite | Por quê |
|---|---|---|
| `POST /auth/password/check` | 10/min por IP | Uma tela chama uma vez; 10 cobre recarga e digitação nervosa |
| `POST /auth/password` | 5/min por IP | O `oobCode` é o segredo, e ele não se adivinha por força bruta em 5 tentativas por minuto |
| `POST /auth/email-action` | 5/min por IP | Mesma forma, mesmo risco |

Os limites são apertados de propósito e não protegem o `oobCode` — ele tem entropia suficiente. **Eles
protegem o Identity Toolkit de virar um alvo barato através da nossa API**, que é o que um endpoint
público sem limite é.

### 8. `LegalAcceptanceGuard` **não** vale aqui, e isso precisa estar escrito
A 019 celebrou que o guard passa a valer em rotas novas sem uma linha a mais. **Aqui é o contrário, e é
obrigatório que seja.**

Quem está definindo a senha ainda não tem sessão, e quem está confirmando a troca de e-mail pode ter
`pendingLegal`. Um `428` nesta rota **trancaria a pessoa fora da conta pela porta que ela usa para
entrar** — e a saída seria aceitar os termos, que exige logar, que exige a senha que ela está tentando
definir.

As três rotas ficam no `AuthController`, que já é o lugar onde o guard não entra. Um teste-trava cobre
isso, porque a ausência de um guard é a coisa mais fácil de acrescentar por engano.

### 9. Confirmar a redefinição verifica o e-mail, e é assim que o cadastro fecha
`accounts:resetPassword` marca `emailVerified` sozinho — é o que a 007 já registrava: *"quem provou
receber o e-mail, provou ser dono dele"*.

Está escrito aqui porque é a coisa que alguém "consertaria": ver `emailVerified: false` logo depois do
`createUser` do signup e acrescentar um `auth.updateUser({ emailVerified: true })` em algum lugar. **Não
há nada a acrescentar** — o próprio ato de definir a senha pelo link é a prova, e forçá-lo à mão
transformaria o cadastro num caminho em que ninguém prova nada.

### 10. A sessão não nasce aqui, e a resposta é `204` por isso
`POST /auth/password` **não devolve token, não emite cookie e não chama o `signInWithPassword`**, mesmo
sendo trivial fazê-lo: a senha nova está no corpo da requisição, e um login logo depois seria uma linha.

É a decisão 5 da spec 005: sessão nasce no `POST /auth/login`, num caminho só. Um segundo emissor do
cookie de refresh seria exercitado apenas no cadastro — o fluxo que menos gente percorre duas vezes, e
portanto aquele em que um defeito de `SameSite` ou de `Domain` ficaria escondido por mais tempo. A spec
011 é a memória de quanto custa descobrir isso tarde.

O front manda a pessoa para `/?entrar=1` e ela entra com a senha que acabou de criar — o que é, de quebra,
a prova de que ela é a senha que a pessoa achou que digitou.

### 11. O `continueUrl` continua sendo `<FRONTEND_URL>/?entrar=1`, e não vira o endereço da tela
Há uma confusão fácil aqui, entre dois valores que parecem o mesmo:

| Valor | Quem define | O que é |
|---|---|---|
| **Action URL** | Console do Firebase, uma vez por projeto | Para onde **o link do e-mail** leva: `<front>/acesso` |
| **`continueUrl`** | Esta API, em cada `sendOobCode` | Para onde a **tela** manda a pessoa quando termina |

O `continueUrl` **não muda** e continua `<FRONTEND_URL>/?entrar=1`, calculado uma vez no construtor do
`AuthService` e usado pelo signup e pela troca de e-mail. O Firebase o repassa na query da action URL, e
a tela o usa como destino — **conferindo a origem antes** (decisão 10 da 020 do front), porque a query é
escrita por quem manda o link.

Apontar o `continueUrl` para `/acesso` produziria um laço: a tela terminaria mandando a pessoa de volta
para a tela.

### 12. `POST /me/password` e `POST /me/email` não mudam
Trocar a senha estando logado continua reautenticando pela senha atual e revogando as sessões (spec 013,
decisão 4). Trocar o e-mail continua disparando `VERIFY_AND_CHANGE_EMAIL` e respondendo `202`.

**A única coisa que muda no fluxo de troca de e-mail é para onde o link leva, e isso não tem uma linha de
código aqui**: é a action URL do console. O membro clica, cai em `/acesso?mode=verifyAndChangeEmail`, a
tela chama `POST /auth/email-action`, e o Google troca o e-mail.

### 13. A README perde a linha que manda não fazer isto
Hoje ela diz, em negrito:

> **Não configure "customize action URL".** Ela desviaria o link para uma página nossa, e a decisão da
> spec 007 é usar a tela do Firebase como está — desfazer isso significa ressuscitar página, endpoint,
> DTO e testes.

A frase está certa sobre o custo e é a instrução errada a partir desta spec. **Ela sai, e a linha nova
entra na tabela "o que vive no console"** — que passa a ter quatro linhas, e a nova é a que, esquecida,
quebra o cadastro inteiro em produção enquanto preview funciona.

---

## Endpoints

### `POST /auth/password/check`
Público. `{ oobCode }` → `200 { email }`. Código morto → `400` com a frase da decisão 5.

### `POST /auth/password`
Público. `{ oobCode, newPassword }` → `204`. Código morto → `400` (decisão 5); senha recusada pela
política → `400` com a tradução da decisão 6. **Não emite cookie e não devolve token** (decisão 10).

### `POST /auth/email-action`
Público. `{ oobCode }` → `200 { email }`. Aplica `VERIFY_AND_CHANGE_EMAIL`, `VERIFY_EMAIL` ou
`RECOVER_EMAIL` — **qual deles, quem decide é o código**, não o corpo da requisição (decisão 3).

---

## Fora de escopo

- **Template de e-mail próprio, com SMTP nosso.** O corpo do e-mail continua sendo o do Firebase, editado
  no console. Esta spec troca a **tela**, não a mensagem. Ligar o disparo da spec 014 a este fluxo é
  outra spec, e ela tem outro assunto.
- **Firebase Hosting para o action handler.** Não é mais necessário: o handler é o front, no domínio do
  front, que é justamente o que resolve o `firebaseapp.com` no meio do cadastro.
- **Verificação de e-mail obrigatória.** A API passa a saber aplicar um `VERIFY_EMAIL`, e o produto
  continua não exigindo um.
- **Link mágico de login (`signIn`/passwordless).** É um quinto modo, é um caminho novo de criação de
  sessão, e a decisão 10 é a razão de ele não entrar de carona.
- **Expiração configurável do `oobCode`.** É do Firebase e não tem representação em código.
- **Cobrança e troca de plano.** A 020 do front desliga o botão; ligar o que ele deveria fazer é uma spec
  com este repositório inteiro dentro.

---

## Specs afetadas

Pela regra 6 do `clauderc.md`, a decisão superada abaixo recebeu o bloco de `Deprecated` **no próprio
arquivo da spec 007**, apontando para esta. Nenhuma spec inteira cai.

### Spec 007 — decisão 3 **Deprecated**
A tela volta a ser nossa; o front continua sem falar com o Firebase (decisão 2). A tabela do que saiu do
projeto vira a tabela do que voltou, e a README muda em dois lugares (decisão 13).

**A análise de custo daquela decisão continua correta**, e é ela que esta spec cita para se justificar:
o que mudou não foi o cálculo, foi a proporção do produto. O bloco de `Deprecated` lá registra também o
que **não** muda — o e-mail continua sendo o do Firebase, o `continueUrl` continua sendo
`<FRONTEND_URL>/?entrar=1`, a política de senha continua no console, e concluir a redefinição continua
marcando `emailVerified`.

### Spec 006 — continua sem objeto, e nada aqui a ressuscita
Ela configurava o Supabase Auth como código. O fornecedor mudou na 007 e não voltou. É a única linha da
tabela do que saiu que **não** volta com esta spec.

### Spec 005 — vigente, e é ela que segura o desenho
"Sessão só nasce no login" (decisão 10) e "o front nunca fala com o provedor de auth" (decisão 2).

### Spec 013 — vigente, sem uma linha de código alterada
`POST /me/password` e `POST /me/email` não mudam (decisão 12). O que muda é o destino do link, no console.
A `translatePasswordError` sai de `profile.service.ts` para um lugar compartilhado, e é a única alteração
que este arquivo sofre.

### Spec 014 — vigente
Os endpoints novos entram na mesma categoria do descadastro: públicos, sem guard, com `Throttle` próprio.

### Spec 018 — vigente, e a exceção está escrita
O `LegalAcceptanceGuard` **não** alcança estas rotas, e a decisão 8 diz por que ele não pode alcançar.

---

## Pontos em aberto

1. **A action URL é por projeto do Firebase, e existem dois.** `dev-liga-dev` precisa apontar para
   `ligapreview.lenoborges.com.br/acesso` e o projeto de produção para
   `liga.lenoborges.com.br/acesso`. Configurar só um produz o defeito mais confuso do
   repertório: **o cadastro funciona em preview e manda o membro de produção para a tela do
   Google** — verde em todo teste, quebrado só para quem paga. É a mesma classe de armadilha dos
   índices do Firestore, que existiam em produção e não em `dev-liga-dev` (README).
2. **O domínio do front precisa estar em Authorized domains**, e ele já está — é o mesmo `continueUrl` de
   sempre. Fica escrito porque `UNAUTHORIZED_DOMAIN` já custou um deploy inteiro a este projeto (fix.md
   da 007, Fix 2), e o sintoma foi cadastro respondendo `202` com ninguém recebendo nada.
3. **A política de senha continua sem representação em código** (decisão 6). O front volta a ter um piso
   de 8, e isso torna a divergência mais fácil de não notar, não menos: se alguém baixar o mínimo no
   console, a única coisa que recusa 6 caracteres passa a ser um `Validators.minLength` no navegador.
4. **Não há endpoint para pedir outro link.** Quem cai na tela de link morto volta para o diálogo de
   login e usa "Esqueci minha senha", que já chama o `POST /auth/signup`. Funciona, e é estranho de ler:
   o botão de recuperar senha chama o endpoint de cadastro. Vale um nome melhor um dia, e não vale uma
   rota nova hoje.
5. **`accounts:update` com `oobCode` devolve `requestType`, e nós o ignoramos.** Devolvê-lo ao front
   permitiria uma confirmação mais específica ("seu e-mail agora é X") em vez de uma genérica. Fica fora
   porque a tela desenha o modo que veio na URL, e passar a ter duas fontes para a mesma informação é
   passar a ter duas para divergirem.
