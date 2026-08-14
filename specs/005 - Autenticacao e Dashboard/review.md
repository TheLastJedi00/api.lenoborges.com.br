# Code review da spec 005 (backend)

Data: 2026-08-14. Repositório: `eduleno-back`, branch `dev`.
Range: `release/004-acesso-antecipado..HEAD`, 43 arquivos, ~3.600 linhas. Documentação fora.

`npm test`: 12 suítes, 55 testes, todos verdes. Nenhum achado abaixo é erro de tipo ou teste
quebrado. Vale registrar o contrário: **o achado A1 passa nos testes**, porque a suíte mocka o
cliente do Supabase e afirma que `signOut` foi chamado, sem poder observar em quem ele bateu.

## O que passou

- `ProfileRepository` devolve `{ found, entry }` e `{ entry }` em todos os métodos, sem `null` solto.
  Regra do clauderc cumprida.
- Migration `20260814121341_create_profiles.sql` está correta: FK para `auth.users` com cascade, FK
  opcional para `waitlist_entries` com `set null`, `check (grade between 1 and 33)`, tudo em
  `timestamptz` e RLS ligada sem policy.
- A entity não mapeia relação para o schema `auth` nem para `waitlist_entries`, como a spec pedia.
- `completed_at` só é preenchido na primeira vez (`profile.service.ts:64`) e `updated_at` fica com o
  `@UpdateDateColumn`, que o `Repository.update` aciona.
- Resposta 202 uniforme no signup, e 401 de mensagem única no login. Sem oráculo de e-mail.
- Normalização extraída para `src/common/normalize.ts` e reusada pelo `WaitlistService` sem mudar
  comportamento.
- Limites por rota conferem com o contrato: 3, 5, 5, 30 e 10 por minuto.

---

## Status das correções

| achado | situação |
|--------|-----------|
| A1, A2, B4 | **corrigidos** em `fix/005-sessao-por-requisicao` |
| A3, B1 | **corrigidos** em `fix/005-guard-aud-iss` |
| A4 | **corrigido** em `fix/005-cookie-env-coerente` |
| A5, A6, B2, B3, B5 | em aberto |

As três branches estão unidas em `release/005-correcoes-do-review`, com a suíte em 70 testes verdes
(eram 55), `npm run lint` e `npm run build` limpos. Toda a exposição de segurança do review está
fechada; o que resta é observabilidade (A5, A6) e limpeza (B2, B3, B5).

**Validação pendente contra o projeto real:** A3 passou a exigir `iss` igual a
`SUPABASE_URL + /auth/v1`. Isso é o que o Supabase hospedado emite, mas precisa de uma conferência
com um token de verdade antes de ir para produção. Se o projeto tiver `GOTRUE_JWT_ISSUER`
customizado, a variável `SUPABASE_JWT_ISSUER` cobre o caso sem mexer em código.

---

## Crítico

### A1. Um logout anônimo derruba a sessão de outro usuário
> **Corrigido em `fix/005-sessao-por-requisicao`.** `SupabaseService` não expõe mais cliente público
> compartilhado: `createUserClient()` devolve uma instância nova por operação de usuário. O `logout`
> passou a carregar a sessão a partir do refresh token do próprio chamador antes do `signOut`, com
> escopo `local`, e cookie forjado não revoga nada. Cobertura nova nos casos 16 a 19 do
> `auth.service.spec.ts` e na spec do `SupabaseService`.
**Arquivos:** `src/auth/supabase.service.ts:24`, `src/auth/auth.service.ts:200`

`SupabaseService` cria **um** `publicClient` no construtor e o compartilha entre todas as
requisições do processo. `persistSession: false` **não** torna o cliente sem estado: em
`@supabase/auth-js` 2.112.3 (`GoTrueClient.js:244-254`), a opção só troca o storage por um adaptador
em memória. `_saveSession` continua gravando a sessão nesse storage a cada
`signInWithPassword`, `refreshSession` e `verifyOtp`.

`logout` chama `publicClient.auth.signOut()`, que em `_signOut` (`GoTrueClient.js:3407`) lê a sessão
guardada nesse storage e chama `admin.signOut(accessToken, 'global')`. Ou seja: ele revoga a sessão
de **quem tiver logado por último naquele processo**, não a de quem pediu logout.

Pior, `POST /auth/logout` não tem guard e não valida o cookie: `logout(refreshToken)` só verifica se
a string existe e depois a ignora por completo.

**Cenário de ataque:** a vítima loga. O atacante envia, de qualquer lugar,
`POST /auth/logout` com o cabeçalho `Cookie: eduleno_rt=qualquer-coisa`. O backend não valida nada,
chama `signOut()` no cliente compartilhado, e a sessão da vítima é revogada globalmente no Supabase.
Repetindo a chamada em laço, ninguém consegue ficar logado. É negação de serviço de sessão, sem
autenticação, com uma requisição de uma linha.

**Efeito colateral do mesmo desenho:** o `_acquireLock` do GoTrueClient serializa as chamadas do
cliente compartilhado, então todos os logins e refreshes de todos os usuários passam por um único
lock no processo.

**Correção:** parar de usar cliente compartilhado em operação que representa um usuário. Ou criar um
cliente por requisição para login, refresh, `verifyOtp` e logout, ou chamar
`adminClient.auth.admin.signOut(accessToken, scope)` com o token do próprio chamador. A segunda
opção exige exigir o access token no logout, o que também conserta A2.

O teste `caso 15` (`auth.service.spec.ts:511`) afirma apenas que `signOut` foi chamado. Ele passa
com o bug presente e continuaria passando depois da correção, então precisa ser reescrito junto.

---

## Sérios

### A2. O logout não invalida a sessão de quem pediu
> **Corrigido junto de A1.** O `refreshToken` do cookie agora é usado de fato, o que também encerra
> B4 (parâmetro morto).

**Arquivo:** `src/auth/auth.service.ts:194-204`

Consequência direta de A1, mas vale como achado próprio: o `refreshToken` recebido é usado só para
decidir se entra no `if`, e nunca é revogado. O cookie é apagado do navegador, o que resolve a
aparência, mas o refresh token continua válido no Supabase por 30 dias.

**Cenário:** alguém usa a Seita num computador compartilhado e clica em Sair. O cookie some da
máquina, mas quem tiver capturado aquele token (log de proxy, extensão, backup do perfil do
navegador) continua renovando sessão por um mês. O `context.md` promete "invalida a sessão no
Supabase (`signOut` com o refresh token)".

### A3. O guard não verifica `aud` nem `iss`
> **Corrigido em `fix/005-guard-aud-iss`.** `jwtVerify` passou a exigir `audience: 'authenticated'` e
> `issuer` derivado de `SUPABASE_URL`, mais `role === 'authenticated'` no payload.
> `SUPABASE_JWT_ISSUER` existe como escapatoria para projeto customizado. Três casos novos na spec do
> guard, incluindo o da chave `anon`. B1 (ternário morto) saiu junto.

**Arquivo:** `src/auth/guards/supabase-auth.guard.ts:57`

`jwtVerify(token, key)` é chamado sem `{ audience, issuer }`. O `context.md` especifica
"verificação local é assinatura, `exp`, `aud` e `iss`".

Hoje o dano é contido por acaso: a checagem de `payload.sub` logo abaixo derruba as chaves `anon` e
`service_role`, que são JWTs assinados com o mesmo segredo legado e não têm `sub`. Ou seja, a chave
pública que o front carrega **quase** vira um token de acesso válido, e o que impede é uma linha
escrita para outro fim. Com `SUPABASE_JWT_SECRET` configurado, isso é uma margem estreita demais.

**Correção:** passar `audience: 'authenticated'` e `issuer: \`${SUPABASE_URL}/auth/v1\`` no
`jwtVerify`, e recusar payload com `role` diferente de `authenticated`.

### A4. Nada impede `SameSite=none` sem `Secure`
> **Corrigido em `fix/005-cookie-env-coerente`.** `AUTH_COOKIE_SAMESITE` e `AUTH_COOKIE_SECURE` viraram
> enums fechados, e a combinação `none` sem `true` derruba a aplicação no boot. `env.validation.spec.ts`
> é novo e cobre os seis casos.

**Arquivos:** `src/config/env.validation.ts`, `src/auth/cookie.service.ts:16-21`

`AUTH_COOKIE_SAMESITE` é validado como string livre e o `CookieService` faz cast direto para
`'lax' | 'strict' | 'none'`. Nenhuma regra liga os dois valores.

**Cenário:** em produção alguém coloca `AUTH_COOKIE_SAMESITE=none` e esquece
`AUTH_COOKIE_SECURE=true`. O navegador **descarta silenciosamente** todo cookie `SameSite=None` sem
`Secure`. O login responde 200, o front guarda o access token, e todo F5 desloga. Não há erro em log
nenhum, dos dois lados. É a mesma falha que o front tem no achado A1 do review de lá, pelo outro
caminho.

**Correção:** validar o enum no `env.validation.ts` e falhar no boot quando `none` vier sem
`secure`, no mesmo espírito de já falhar sem `DATABASE_URL`.

### A5. Todo erro do Supabase é engolido sem log
**Arquivo:** `src/auth/auth.service.ts:37`, `:54`, `:84`

`if (!error && data?.user)` descarta silenciosamente qualquer falha do `createUser`, e o retorno de
`resetPasswordForEmail` nem é lido. Não há `Logger` em lugar nenhum do módulo.

**Cenário:** a service role é rotacionada no painel e ninguém atualiza o `.env`. Todo signup passa a
falhar no `createUser`, nenhum e-mail é enviado, e **todos os usuários continuam recebendo 202**
"confirmação enviada". A API parece saudável, o monitoramento não vê nada, e o problema só aparece
quando alguém reclama que o e-mail não chegou.

A resposta uniforme para o cliente é correta e deve continuar. O que falta é distinguir, **no log**,
"e-mail já existe" (esperado, silencioso) de "o Supabase recusou a operação" (incidente).

### A6. `resetPasswordForEmail` sem `redirectTo`
**Arquivo:** `src/auth/auth.service.ts:54`

A chamada não passa `redirectTo`, então o link do e-mail depende inteiramente de o Site URL do painel
estar certo e de o template usar `{{ .SiteURL }}`. Funciona hoje porque a Fase 01 configurou as duas
coisas, mas é um acoplamento invisível: mudar o Site URL para qualquer outro fim quebra o cadastro
sem tocar em código, e nada no repositório denuncia a dependência. Passar
`{ redirectTo: FRONTEND_URL + '/definir-senha' }` deixa a intenção no código.

---

## Menores

### B1. Ternário morto no guard
`src/auth/guards/supabase-auth.guard.ts:55-58`. Os dois ramos do
`typeof this.getKey === 'function' ? ... : ...` chamam exatamente a mesma expressão.

### B2. `SupabaseService` expõe quatro nomes para dois clientes
`src/auth/supabase.service.ts`. `adminClient` e `publicClient` são `readonly` públicos e ainda
existem os getters `admin` e `public`. A spec queria a service role "confinada a este arquivo"; hoje
qualquer classe que injete o service alcança o cliente administrativo por dois caminhos. Expor
métodos de intenção (`createUser`, `sendRecovery`) em vez dos clientes crus resolveria de verdade.

### B3. CORS libera métodos que a API não tem
`src/main.ts:30`. A lista inclui `PUT` e `DELETE`; o contrato da spec é `GET`, `POST`, `PATCH` e
`OPTIONS`.

### B4. `logout` recebe um parâmetro que não usa
`src/auth/auth.service.ts:194`. O `refreshToken` só serve de flag booleana. Some junto com a correção
de A1, mas hoje faz a assinatura mentir sobre o que o método faz.

### B5. A bio é validada duas vezes com regras que divergem
`src/profile/dto/update-profile.dto.ts:44` valida 10 a 500 no texto **cru**;
`src/profile/profile.service.ts:50` revalida depois do `trim`. Uma bio de dez espaços e um caractere
passa no DTO e é recusada no service. O comportamento final está certo (o service manda), mas a
mensagem de erro que chega ao usuário vem de uma regra diferente da que o Swagger documenta. Aplicar
o `@Transform` de trim no DTO, como já é feito no telefone, alinharia os dois.

---

## Ordem sugerida de correção

| # | achado | branch sugerida |
|---|--------|------------------|
| 1 | A1, A2, B4 (mesma raiz: cliente compartilhado) | `fix/005-sessao-por-requisicao` |
| 2 | A3, B1 | `fix/005-guard-aud-iss` |
| 3 | A4 | `fix/005-cookie-env-coerente` |
| 4 | A5, A6 | `fix/005-observabilidade-signup` |
| 5 | B2, B3, B5 | `fix/005-ajustes-menores` |

O item 1 é o único que não deveria esperar release: hoje qualquer pessoa na internet derruba a
sessão de qualquer membro logado com uma requisição sem autenticação.

## Contagem
11 achados: 1 crítico, 5 sérios e 5 menores.

## Relação com o review do front
`A4` daqui e `A1` do [review do front](../../../eduleno-front/specs/005%20-%20Autenticacao%20e%20Dashboard/review.md)
produzem o mesmo sintoma (o cookie de refresh nunca chega ao navegador) por caminhos diferentes:
lá, falta `withCredentials` no login; aqui, falta impedir `SameSite=none` sem `Secure`. Corrigir só
um lado não resolve o F5 em produção.
