# Spec 011: Sessão que Sobrevive ao F5

## Objetivo
Em produção, **apertar F5 dentro do painel desloga o membro**. O front chama `POST /auth/refresh` na
abertura, a requisição chega aqui **sem o cookie**, e esta API responde 401 — corretamente, porque sem
cookie não há o que renovar.

O defeito não está na lógica de refresh. Está em **como o cookie é gravado e onde esta API mora**, que
são as duas coisas que só este repositório pode consertar.

Junto vai um segundo defeito, encontrado ao investigar o primeiro e mais grave que ele: o
`AuthController.refresh` **apaga o cookie do membro quando qualquer coisa dá errado**, inclusive uma
falha momentânea do Firebase. Uma instabilidade de dois segundos hoje custa a sessão de quem estava
recarregando a página naquele instante, de forma permanente.

O par desta spec no front é a **011**, e as duas entram juntas.

---

## Numeração
Os números são iguais nos dois repositórios: 009 é Financeiro, Administração e Trilha, 010 é o Mural,
011 é esta. No front, o número 011 chegou a ser usado por uma spec de Links Gerenciados que **foi
removida antes de qualquer execução** — está livre, e nada do que estava escrito lá vale.

---

## O que já está certo, e precisa continuar
Vale dizer antes de mexer, porque a reação natural a um bug de sessão é reescrever a autenticação:

- O refresh token vai em **cookie `HttpOnly`**, com `Path=/auth`. Certo, e não muda.
- `AUTH_COOKIE_SAMESITE=none` sem `AUTH_COOKIE_SECURE=true` **derruba a aplicação no boot**
  (`env.validation.ts`). Essa checagem existe porque o navegador descarta esse cookie em silêncio, e o
  login responderia 200 com a sessão nunca persistindo — exatamente o sintoma desta spec, sem nenhum
  erro em log. A validação está certa e fica.
- CORS com `credentials: true` e origem em allowlist, nunca `*`. Certo, e não muda.
- O refresh delega ao `securetoken` do Firebase e nunca guarda refresh token no Firestore. Certo, e não
  muda.

**O F5 falha apesar disso, não por causa disso.**

---

## O problema

### Camada 1: o cookie nunca é enviado (a causa do sintoma)
Esta API responde em `api-lenoborges.vercel.app`. O front é servido do domínio do produto.
`vercel.app` está na **Public Suffix List**, o que significa que ele funciona como um sufixo público:
para o navegador, `api-lenoborges.vercel.app` e o domínio do produto **não são o mesmo site**, e nem
sequer dois `*.vercel.app` seriam.

O `CookieService` grava com `sameSite` vindo de `AUTH_COOKIE_SAMESITE`, com **`lax` como padrão** quando
a variável não está definida. E `Lax` **não envia o cookie em nenhuma requisição cross-site feita por
XHR** — a exceção dele é navegação de topo com método seguro, e `POST /auth/refresh` não é isso.

Então o fluxo em produção é:

| momento | o que esta API faz | resultado |
|---|---|---|
| `POST /auth/login` | 200 + `Set-Cookie: eduleno_rt` | Front recebe a sessão. **Funciona** |
| Requisições do painel | Valida o Bearer no header | Funciona |
| **`POST /auth/refresh` no F5** | `req.cookies` **vazio** → `UnauthorizedException` | **401. Membro deslogado** |

Esta API está se comportando exatamente como deveria. O 401 está certo: não havia cookie. O erro é a
topologia que faz o cookie não chegar.

**Em desenvolvimento não reproduz:** `localhost:4200` e `localhost:3000` são o mesmo site — porta não
separa site —, então `Lax` envia o cookie normalmente.

### Camada 2: o `catch` do refresh apaga a sessão de quem tinha uma válida
Em `auth.controller.ts`:

```ts
try {
  const { session, refreshToken } = await this.authService.refresh(rawToken);
  this.cookieService.setRefreshToken(res, refreshToken);
  return session;
} catch (error) {
  this.cookieService.clearRefreshToken(res);   // <- qualquer erro
  throw error;
}
```

`AuthService.refresh` faz três coisas que podem falhar por motivos diferentes: troca o token no
`securetoken`, busca o usuário com `firebase.auth.getUser`, e lê o perfil com `ensureProfile`. **Só a
primeira significa "token inválido".** As outras duas podem falhar por instabilidade do Firebase, por
timeout, ou por o Firestore estar lento.

Hoje as três apagam o cookie. Ou seja: um soluço de dois segundos no Firebase, no exato momento em que
alguém apertou F5, **destrói o refresh token daquela pessoa de forma permanente**. Ela precisa logar de
novo, e nada nos logs diz por quê.

Isso é pior que a camada 1. A camada 1 é um logoff que se conserta com configuração; esta é uma API que
pune o membro por uma falha que não foi dele.

---

## Decisões

### 1. A API muda de endereço: `api.lenoborges.com.br`
Mesmo deploy, domínio novo, no **domínio registrável do produto**. Com isso o front e esta API passam a
ser **same-site**, o cookie deixa de ser de terceiro, e `SameSite=Lax` volta a funcionar no F5.

Continua sendo cross-**origin**, então o `enableCors` com `credentials: true` e a allowlist do
`FRONTEND_URL` seguem necessários e inalterados. **Nenhuma linha de código muda por causa desta
decisão** — só DNS, domínio na Vercel e variáveis de ambiente.

> **Por que não `AUTH_COOKIE_SAMESITE=none`.** É a correção de uma variável de ambiente, e é a errada.
> `None` assume o cookie como cookie de terceiro, e cookie de terceiro é o que os navegadores estão
> desligando: o **Safari já bloqueia por padrão**, e nada que este servidor mande muda isso. O Safari é
> o iPhone, e a decisão 11 da spec 010 do front diz que a tela mais tocada do produto é no celular.
>
> `None` conserta o F5 no Chrome de quem for testar e o mantém quebrado no aparelho da maior parte dos
> membros. Consertar de um jeito que parece consertado é pior do que não consertar.

**Depois desta spec, `AUTH_COOKIE_SAMESITE=none` é proibido em produção.** A validação de ambiente ganha
a regra (decisão 4).

### 2. Só "token inválido" apaga o cookie
O `catch` do controller deixa de ser cego.

| o que falhou | o que significa | cookie | resposta |
|---|---|---|---|
| `securetoken` recusa o token | **Refresh token inválido ou expirado** | **Apagado** | 401 |
| `getUser` / `ensureProfile` falham | Instabilidade do Firebase | **Preservado** | **503** |
| Cookie ausente na requisição | Não há sessão | Nada a apagar | 401 |

O `AuthService.refresh` hoje embrulha **só** a chamada do `securetoken` num try/catch que vira
`UnauthorizedException` — isso está certo e é a base da distinção. O que falta é o resto do método
não virar 401 por tabela: `getUser` e `ensureProfile` ficam fora daquele try, e o que escapar deles
**não pode sair como 401**.

Sai como **503**, e é uma escolha: 503 diz "tente de novo", 401 diz "suas credenciais não valem". O
front da spec 011 trata os dois de forma oposta — 401 desloga, 503 mantém a sessão e avisa —, e essa
distinção **só funciona se esta API for honesta sobre qual dos dois aconteceu**.

> Um 401 mentiroso aqui vira logoff lá. É esta linha que faz a decisão 2 do front funcionar.

### 3. O `Path=/auth` continua, e é preciso saber por quê antes de mexer
O cookie tem `Path=/auth`, então o navegador só o envia para `/auth/*`. É proposital: nenhuma outra rota
precisa do refresh token, e limitar o caminho reduz a superfície.

Fica registrado porque **a alternativa 1-B (ponto em aberto 2) quebraria isso em silêncio**: se a API
passar a ser servida sob `/api/*` no domínio do front, o path do cookie precisa virar `/api/auth` no
mesmo commit. Errar isso produz um F5 que falha exatamente como o de hoje, e a investigação recomeça
do zero.

### 4. A validação de ambiente ganha a regra nova
`env.validation.ts` já derruba o boot em `none` sem `secure`. Passa a derrubar também **`none` em
`NODE_ENV=production`**, com a mensagem dizendo o que fazer:

> `AUTH_COOKIE_SAMESITE=none não é aceito em produção (spec 011). A API precisa estar num subdomínio do
> domínio do front para o cookie ser first-party. Use lax.`

Validação de ambiente que explica a decisão é o único lugar onde ela é lida na hora certa: quem estiver
mexendo em variável de ambiente às onze da noite não vai abrir a pasta `specs`.

### 5. O refresh que falha por instabilidade precisa deixar rastro
Hoje um refresh que falha some. `securetoken` recusando é rotina e **não** vira log — seria ruído de
todo token expirado do mundo.

Mas `getUser` ou `ensureProfile` falhando é a API com problema, e isso vira **log de erro**, com o `uid`
quando houver. Sem isso, a decisão 2 conserta o comportamento e mantém o problema invisível: ninguém
descobre que o Firebase andou instável, só que uns membros reclamaram.

---

## Endpoints

Nenhum endpoint novo. O que muda é o contrato de erro de um deles:

| Endpoint | Antes | Depois |
|---|---|---|
| `POST /auth/refresh` | 200, ou **401 para qualquer falha** (cookie sempre apagado) | 200; **401** só com token inválido ou ausente (cookie apagado); **503** em falha de infraestrutura (**cookie preservado**) |
| `POST /auth/login` | — | Sem mudança |
| `POST /auth/logout` | — | Sem mudança. Continua apagando o cookie sempre, e continua global |

---

## Fora de escopo

- **Trocar o Firebase por sessão própria.** Refresh token opaco gerenciado pelo Google continua.
- **Logout por sessão em vez de global.** O `revokeRefreshTokens` derruba todos os aparelhos, é decisão
  da spec 007 e é um incômodo conhecido. Não é este problema.
- **Rotação com detecção de reúso.** O Firebase não expõe isso, e inventar por cima exigiria guardar
  refresh token no Firestore — que é justamente o que a arquitetura evita.
- **Encurtar ou alongar o prazo do cookie.** Os 30 dias ficam.
- **`checkRevoked` por requisição.** Já recusado na spec 007, pelo custo, e nada aqui muda o argumento.

---

## Specs afetadas

### Spec 005 (Autenticação e Dashboard) — vigente, corrigida
A tabela de cookies de lá previa **`SameSite=none` em produção**, com a justificativa "em produção front
e API estão em domínios diferentes". Estava certa sobre o problema e errada sobre a saída: a decisão 1
ataca a premissa — os domínios deixam de ser diferentes — em vez de aceitar o cookie de terceiro.
**Aquela linha fica revogada**, e a decisão 4 impede que ela volte por configuração.

### Spec 007 (Firestore e Firebase Auth) — vigente
O refresh via `securetoken` e o logout global continuam como estão. A decisão 2 desta spec só separa o
que, dentro daquele fluxo, é culpa do token e o que é culpa da infraestrutura.

---

## Pontos em aberto

1. **`api.lenoborges.com.br` pode ser criado?** Depende de um registro DNS e do domínio adicionado ao
   projeto na Vercel. Assumido que sim, por ser o domínio do próprio produto.
2. **Alternativa 1-B, se o subdomínio não for possível:** o front serve a API sob o próprio domínio via
   rewrite (`/api/*` → esta API). O cookie vira first-party de verdade e o CORS deixa de existir. Custa
   um salto de rede e **obriga o `Path` do cookie a virar `/api/auth`** (decisão 3). Mais forte e mais
   cara; é alternativa, não plano A.
3. **O `FRONTEND_URL` de produção tem a origem exata do front?** Não deu para verificar daqui. Se
   estiver errada — barra no fim, protocolo faltando, domínio antigo —, o CORS recusa e o F5 continua
   falhando **depois** da decisão 1, com sintoma idêntico. É o primeiro item a conferir na execução.
4. **503 é o código certo para a falha de infraestrutura?** Escrito como 503 por ser o que diz "tente de
   novo" sem tocar em credenciais. 502 seria defensável. O que **não** é defensável é 401, porque é o
   código que o front usa para deslogar.
