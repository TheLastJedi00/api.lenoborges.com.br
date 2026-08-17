# Fix: `ERR_REQUIRE_ESM` do `jose` na Vercel, agora por dependência transitiva

Aberto em 2026-08-16, depois do push da `dev` (commit `41db260`).

## Sintoma

A function serverless **não sobe**. O processo morre no boot, antes de qualquer requisição:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module
/var/task/node_modules/jose/dist/webapi/index.js
from /var/task/node_modules/jwks-rsa/src/utils.js not supported.

Instead change the require of index.js in /var/task/node_modules/jwks-rsa/src/utils.js
to a dynamic import() which is available in all CommonJS modules.
    at /opt/rust/nodejs.js:2:14275
    at Module.yo (/opt/rust/nodejs.js:2:14653)
    at e.<computed>.dt._load (/opt/rust/nodejs.js:2:14245)
    at s (/opt/rust/bytecode.js:2:1110) { code: 'ERR_REQUIRE_ESM' }

Node.js process exited with exit status: 1.
```

---

## A afirmação errada que abriu este fix

A decisão 11 do `context.md` lista o que sai do repositório e diz, sobre o `jose`:

> Some junto o `jose` carregado por `import()` dinâmico — a gambiarra de
> `fix/deploy-jose-esm`, que existia porque o `jose` 6 é ESM puro e o runtime da Vercel não aceitava
> `require()` de ESM. O **`firebase-admin` é CommonJS e não precisa disso**.

A primeira metade está certa e a segunda está errada, do jeito mais fácil de errar: **`firebase-admin`
é CommonJS, sim, e mesmo assim arrasta o `jose` atrás dele.**

```
firebase-admin@14.2.0
└─ jwks-rsa@4.1.0        (CommonJS, declara jose: ^6.1.3)
   └─ jose@6.2.8         ("type": "module", sem export require)
```

E o carregamento é **ansioso**, não sob demanda: `firebase-admin/lib/utils/jwt.js:24` faz
`const jwks = require("jwks-rsa")` no topo do módulo. Importar `firebase-admin/auth` basta para
disparar a cadeia. Por isso a falha é no boot e não na primeira verificação de token.

O que eu removi — nosso `import()` dinâmico do `jose` — estava correto remover: aquele código era
nosso e sumiu junto com o `SupabaseAuthGuard`. **O que não sumiu foi o problema de plataforma que ele
contornava.** Ele só trocou de dono: antes era uma dependência direta nossa, agora é de uma
dependência de dependência, que não dá para instrumentar com `import()`.

---

## O que o sintoma já prova

Sai da leitura direta do erro e da árvore de dependências, sem especulação:

1. **A Vercel continua recusando `require()` de ESM.** O stack aponta para `/opt/rust/nodejs.js` e
   `/opt/rust/bytecode.js`, que são o bootstrap próprio do runtime, interceptando `Module._load`. Não
   é o Node puro decidindo isso.
2. **O `jose` 6 não tem saída de CommonJS.** O `package.json` dele é `"type": "module"` e o `exports`
   do pacote traz só `default: ./dist/webapi/index.js`. Não existe entrada `require` para o Node
   escolher. Comparado com o `jose` 5, que tem `require: ./dist/node/cjs/index.js`, a diferença é de
   empacotamento e não de configuração nossa.
3. **A escolha do `jose` 6 vem do `jwks-rsa` 4, não de nós.** Ele declara `jose: ^6.1.3`. Forçar
   `jose` 5 por baixo violaria a faixa declarada e apostaria que a API não mudou entre as majors — não
   é conserto, é torcida.
4. **Nada disso aparece em teste, build ou uso local.** Os 97 testes passam, o `nest build` passa, e
   o cadastro rodou de ponta a ponta no navegador em 2026-08-16. O Node 24 local **aceita**
   `require()` de ESM; o runtime da Vercel não. O ambiente onde tudo funciona é exatamente o ambiente
   que não faz a pergunta.

**Isto é uma repetição, não uma novidade.** A `fix/deploy-jose-esm` da spec 005 já tinha registrado a
mesma incompatibilidade, com a mesma frase — "o Node local aceita `require()` de ESM, mas o runtime da
Vercel não". Eu apaguei aquele comentário junto com o código, tratando a lição como parte da
gambiarra. A gambiarra era descartável; a lição não era.

---

## Causas possíveis

Só uma, e ela está estabelecida. O que resta em aberto é **qual conserto**, não qual causa. As
alternativas abaixo são caminhos, não hipóteses concorrentes.

---

## Caminhos

### 1. Voltar o `firebase-admin` para a 13.x (preferido)
A quebra entrou na major 14:

| `firebase-admin` | `jwks-rsa` | `jose` | CommonJS? |
|---|---|---|---|
| 12.7.0 | `^3.1.0` | `^4.15.4` | **sim** |
| 13.0.0 | `^3.1.0` | `^4.15.4` | **sim** |
| 13.5.0 | `^3.1.0` | `^4.15.4` | **sim** |
| 14.0.0 | `^4.0.1` | `^6.1.3` | não |
| 14.2.0 | `^4.0.1` | `^6.1.3` | não |

O `jose` 4 tem `main: ./dist/node/cjs/index.js`. A cadeia inteira volta a ser CommonJS e o
`require()` resolve sem depender de o runtime suportar ESM.

**A favor:** resolve na raiz, sem `overrides`, sem bundler, sem apostar em comportamento de
plataforma. É a única opção em que a árvore de dependências fica coerente com o que o runtime aceita.

**Contra:** é regressão de versão, e fica presa até o `jwks-rsa` ou a Vercel se moverem. Precisa
confirmar que a 13.x tem tudo que a spec 007 usa: `initializeFirestore` com `preferRest`, `getAuth`,
`verifyIdToken`, `createUser`, `revokeRefreshTokens`, `getUser`. Nenhuma dessas é API nova, mas
"nenhuma é nova" é inferência, e a verificação é rodar a suíte.

### 2. `overrides` forçando `jwks-rsa` 3.x dentro do `firebase-admin` 14
Mantém a major nova e troca só o pedaço quebrado.

**Contra:** o `firebase-admin` 14 subiu para `jwks-rsa` 4 por algum motivo, e forçar a 3 assume que a
API que ele consome não mudou. Se mudou, o sintoma reaparece como erro em tempo de execução na
verificação de token — mais tarde e mais confuso que um boot que morre. Só vale se o caminho 1 se
provar impossível.

### 3. Empacotar a function
Um bundler (`ncc`, `esbuild`) resolveria o `jose` em tempo de build e emitiria CommonJS, tirando o
`require()` de ESM da mesa em tempo de execução.

**Contra:** o projeto compila com `nest build` sem bundling, e o `require('pg')` literal que a
`fix/deploy-driver-pg-vercel` precisou adicionar mostra que este bundle já tem histórico de brigar com
resolução dinâmica. Mudar a estratégia de build inteira para consertar um pacote é resposta grande
demais para o problema — e ela some sozinha se o caminho 1 funcionar.

### 4. Mexer no runtime da Vercel
Fixar `engines.node` numa versão em que `require(esm)` é suportado sem flag (22.12+ / 24).

**Contra, e é forte:** o stack mostra que quem recusa é o bootstrap da Vercel (`/opt/rust/nodejs.js`
interceptando `_load`), não o Node. Subir a versão do Node pode não mudar nada, porque a decisão não é
dele. **É o teste mais barato de todos** — uma linha no `package.json` e um deploy — e por isso vale
executar antes do caminho 1, não porque seja provável, mas porque descarta rápido e informa os outros.

---

## Objetivo da correção

Que a function suba na Vercel. Nada mais desta spec muda: o desenho de auth, o Firestore, o contrato
da API e o fluxo de senha continuam como estão. Este é um problema de empacotamento de dependência,
não de arquitetura.

---

## O que não fazer

**Não reintroduzir `import()` dinâmico como contorno.** Ele funcionava quando o `require` era nosso.
Aqui quem chama é `jwks-rsa/src/utils.js`, dentro de `node_modules`: não há onde colocar o `import()`
sem editar código de terceiro, e patch em `node_modules` não sobrevive a `npm ci` na Vercel.

**Não silenciar o boot.** Um `try/catch` em volta da importação do `firebase-admin` trocaria um erro
claro no deploy por uma API que sobe sem auth e falha em cada requisição.

---

## Pendência descoberta junto

O pacote `supabase` (CLI) continua em `devDependencies` e também puxa `jose@6`. Não tem relação com
esta falha — devDependency não vai para a function — mas é sobra da Fase 06, que removeu o diretório
`supabase/` e esqueceu o pacote. Sai no mesmo PR.

---

## Aplicação (2026-08-16)

**Caminho 1 executado**, sem passar pelo caminho 4. A tabela de versões já dizia onde a quebra
entrava, e testar `engines.node` custaria um deploy para investigar uma hipótese que o próprio stack
contradiz — quem recusa é o bootstrap da Vercel, não o Node.

`firebase-admin` 14.2.0 → **13.10.0**. A árvore depois:

```
firebase-admin@13.10.0
└─ jwks-rsa@3.2.2
   └─ jose@4.15.9    ("type": "commonjs", main: ./dist/node/cjs/index.js)
```

**Não sobrou nenhum ESM na cadeia.** O `node_modules/jose` de topo, que era o `jose@6`, desapareceu
junto com o pacote `supabase` das devDependencies (a sobra da Fase 06, removida no mesmo commit). O
que resta é o `jose@4` aninhado sob o `jwks-rsa`, com entrada CommonJS de verdade.

Conferido localmente:

| Verificação | Resultado |
|---|---|
| APIs usadas presentes na 13.x | `initializeApp`, `getApps`, `getApp`, `cert`, `getAuth`, `initializeFirestore`, `getFirestore`, `Timestamp` — todas |
| `tsc --noEmit` | limpo |
| 97 testes, 16 suítes | verdes |
| `nest build` e lint | limpos |
| Boot real + `POST /auth/login` + `GET /me` | 200, com `verifyIdToken` no guard |

**O que essa lista prova, e o que não prova.** Prova que a 13.10.0 não perdeu nenhuma API desta spec e
que o fluxo continua funcionando. **Não prova que o deploy sobe** — nenhum teste local poderia, porque
o Node local aceita `require()` de ESM e por isso nunca faz a pergunta que a Vercel faz. Foi
exatamente essa ilusão que deixou o bug passar na primeira vez.

O que sustenta o conserto não é o teste local: é o fato estrutural de que **não existe mais módulo ESM
sendo requerido por CommonJS na árvore**. A prova real é o próximo deploy subir.

---

## O que este fix deixa registrado (Fix 1)

A spec 006 terminou com a lição de que "o valor certo chegou" não prova "o pipeline escreveu o valor".
Esta acrescenta a irmã dela: **"o código roda aqui" não prova "o código roda lá"**, quando o "aqui"
tem uma capacidade que o "lá" não tem. O `require(esm)` do Node 24 local escondeu, do teste unitário
ao teste de navegador, uma incompatibilidade que já estava documentada no repositório — num comentário
que eu apaguei por achar que descrevia um problema resolvido.

---
---

# Fix 2: o cadastro responde 202 e o e-mail nunca chega

Aberto em 2026-08-17, depois de a function voltar a subir com o Fix 1.

## Sintoma

O front mostra "Verifique sua caixa de entrada". A API responde `202 { status: "confirmation_sent" }`.
O usuário é criado no Firebase Auth e o perfil aparece no Firestore. **O e-mail não chega nunca.**

Nenhum erro, em lugar nenhum: nem no front, nem na resposta, nem no log.

## A causa

O domínio do `continueUrl` não está na allow-list do projeto Firebase. Medido chamando a REST direto,
com o mesmo `FIREBASE_WEB_API_KEY` que a API usa:

| `continueUrl` enviado | Resposta do `accounts:sendOobCode` |
|---|---|
| `http://localhost:4200/?entrar=1` | **200** |
| `https://edu.lenoborges.com.br/?entrar=1` | **400** `UNAUTHORIZED_DOMAIN : Domain not allowlisted by project` |
| nenhum | **200** |

O Firebase exige que o domínio de `continueUrl` esteja em **Authentication > Settings > Authorized
domains**. De fábrica a lista traz `localhost`, `<projeto>.firebaseapp.com` e `<projeto>.web.app` — e
mais nada. O domínio de produção precisa ser adicionado à mão.

Note a linha do meio contra a de baixo: **o `continueUrl` não é opcional para o envio funcionar, ele é
o que quebra o envio.** Sem ele o e-mail sai; com ele, e com o domínio não autorizado, o envio inteiro
é recusado. Uma decisão tomada para melhorar o fim do fluxo (decisão 3, o botão de retorno) matou o
começo dele.

## Por que ninguém viu

Duas coisas se somaram, e a segunda é nossa:

1. **`localhost` já vem autorizado.** Todo o desenvolvimento e o teste de navegador de 2026-08-16
   rodaram com `FRONTEND_URL=http://localhost:4200`, ou seja, no único valor que a lista de fábrica
   aceita. O problema só podia existir em produção.
2. **O `signup` engolia o erro em silêncio absoluto.** O `catch` vazio existe por uma razão boa e
   documentada — responder diferente para e-mail conhecido transformaria o cadastro em oráculo de
   enumeração. Mas ele engolia *tudo*, e não só o esperado: a resposta é idêntica para "e-mail já
   existe" e para "o Firebase recusou enviar".

O ponto 1 é a repetição, de novo, da lição do Fix 1: **o ambiente onde tudo funciona é o ambiente que
não faz a pergunta.** Duas falhas seguidas, a mesma forma — `require(esm)` que o Node local aceita, e
`localhost` que o Firebase autoriza de graça.

O ponto 2 é o defeito de verdade, e o mais caro: **um erro de configuração ficou indistinguível de um
sucesso.** Anti-enumeração é sobre o que o *cliente* vê, não sobre o que o operador consegue saber.

## O conserto

**Duas partes, e as duas são necessárias.**

### 1. Configuração (usuário)
Adicionar `edu.lenoborges.com.br` em Authentication > Settings > Authorized domains, no projeto
Firebase que **produção** usa. Sem isso, nada no código resolve: o Google recusa o envio.

### 2. Código: separar "não contar ao cliente" de "não contar a ninguém"
`AuthService.signup` passa a registrar no log o que continua engolindo. A resposta HTTP não muda em
nada — 202 para todo mundo, sempre.

- **`createUser`:** `auth/email-already-exists` é o único erro esperado e segue silencioso, para não
  poluir o log com o caminho normal de quem já tem conta. Qualquer outro vira `logger.error`.
- **`sendOobCode`:** não existe erro esperado. Se essa chamada falha, o membro não recebe o link, e
  isso é sempre defeito. Sempre logado, **com o `continueUrl` na mensagem** — sem ele o log diria que
  falhou, mas não qual domínio precisa ser autorizado.

Coberto por dois testes novos (`caso 2c` e `caso 2d`): que a falha de envio vai para o log com o
domínio junto, e que e-mail já cadastrado *não* polui o log. 99 testes verdes.

## O que não fazer

**Não tirar o `continueUrl` para "fazer o e-mail voltar".** Funcionaria, e devolveria o problema que a
decisão 3 resolveu: o usuário define a senha na tela do Google e fica sem caminho de volta. O
`continueUrl` é o fim do fluxo, não um enfeite.

**Não transformar a falha de envio em erro HTTP.** A resposta uniforme é o que impede o cadastro de
virar oráculo de enumeração. O canal certo para essa informação é o log, e agora ele existe.

## O que este fix deixa registrado (Fix 2)

Um `catch` vazio é uma decisão de produto disfarçada de detalhe técnico. O comentário dizia *por que*
não contar ao cliente, e estava certo — mas ninguém tinha perguntado a quem, então, contar. Silêncio
para o cliente é anti-enumeração; silêncio para todo mundo é um bug esperando ficar caro.
