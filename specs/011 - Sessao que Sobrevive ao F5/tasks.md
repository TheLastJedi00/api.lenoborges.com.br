# Fase 00: Confirmar a causa antes de escrever código [ ]
Branch: nenhuma.

O diagnóstico da spec é firme sobre o mecanismo, mas **as variáveis de ambiente de produção não foram
lidas** — ninguém tinha acesso a elas ao escrever isto. Escrever código antes de conferir é apostar.

- [ ] Task 01: Ler as variáveis do projeto na Vercel. Objetivo: anotar `AUTH_COOKIE_SAMESITE`,
  `AUTH_COOKIE_SECURE`, `FRONTEND_URL`, `NODE_ENV` e `TRUST_PROXY_HOPS`. **`FRONTEND_URL` precisa conter
  a origem exata do front** — com protocolo, sem barra no fim. Se estiver errada, o CORS já recusa o
  refresh e este é o primeiro conserto (ponto em aberto 3).
- [ ] Task 02: Confirmar que a requisição chega sem cookie. Objetivo: em produção, com o DevTools do
  navegador, apertar F5 no painel e olhar o `POST /auth/refresh`: **sem header `Cookie`**, resposta
  **401**. Conferir na aba Application se o `eduleno_rt` foi gravado no login e com quais atributos.
- [ ] Task 03: Registrar o achado no fim deste arquivo. Objetivo: se o cookie **estiver** chegando e a
  resposta ainda for 401, a camada 1 da spec está errada — a execução para e o diagnóstico é reaberto,
  em vez de seguir para a Fase 01 por inércia.

# Fase 01: O cookie vira first-party [ ]
Branch: `fix/011-api-no-subdominio`

Zero código. É a fase que conserta o F5, e o fato de ela não ter código é o argumento da decisão 1.

- [ ] Task 01: Registro DNS de `api.lenoborges.com.br`. Objetivo: apontando para a Vercel.
- [ ] Task 02: Domínio adicionado ao projeto da API na Vercel, servindo o mesmo deploy. **Manter
  `api-lenoborges.vercel.app` respondendo** até o front novo estar no ar — desligar antes vira janela de
  indisponibilidade.
- [ ] Task 03: `AUTH_COOKIE_SAMESITE=lax` e `AUTH_COOKIE_SECURE=true` em produção. Objetivo: com
  same-site, `lax` é o valor certo (decisão 1). `Secure` continua ligado por ser HTTPS. Aplicar
  **depois** de o front apontar para o subdomínio.
- [ ] Task 04: Conferir `FRONTEND_URL` com a origem exata do front, e só ela.

# Fase 02: O cookie só é apagado quando o token é inválido [ ]
Branch: `fix/011-refresh-nao-pune-instabilidade`

É a fase mais importante deste repositório. A Fase 01 conserta um logoff; esta impede a API de destruir
a sessão de quem não fez nada de errado.

- [ ] Task 01 (TDD + implementação): Separar falha de token de falha de infraestrutura. Arquivos:
  `src/auth/auth.service.ts`, `.spec.ts`. Objetivo: o try/catch que vira `UnauthorizedException` cobre
  **só** a chamada do `securetoken`. `getUser` e `ensureProfile` falhando sobem como
  `ServiceUnavailableException`, **nunca como 401** (decisão 2).
- [ ] Task 02 (TDD + implementação): O `catch` do controller deixa de ser cego. Arquivos:
  `src/auth/auth.controller.ts`, `.spec.ts`. Objetivo: `clearRefreshToken` **só** em
  `UnauthorizedException`. Qualquer outro erro **preserva o cookie** e repassa. Teste-trava: **falha do
  `getUser` não apaga o cookie e responde 503.**
- [ ] Task 03: Documentar as respostas no Swagger. Arquivo: `src/auth/auth.controller.ts`. Objetivo:
  `@ApiResponse` do 503 dizendo que o cookie foi preservado e que o cliente **não deve deslogar**. É o
  contrato de que a decisão 2 do front depende, e ele precisa estar onde se lê a API.
- [ ] Task 04: Log de erro na falha de infraestrutura. Arquivo: `src/auth/auth.service.ts`. Objetivo:
  `getUser`/`ensureProfile` falhando viram log de erro com o `uid` quando houver (decisão 5).
  **`securetoken` recusando não vira log** — é rotina, e logar todo token expirado é só ruído.
- [ ] Task 05: Comentário registrando o porquê. Objetivo: no `catch` do controller, escrever que apagar
  o cookie em falha de infraestrutura **destrói permanentemente a sessão de quem tinha uma válida**. É
  um `catch` que parece defensivo e é destrutivo, e sem o comentário alguém o "simplifica" de volta.

# Fase 03: A configuração errada para de ser possível [ ]
Branch: `fix/011-validacao-samesite`

- [ ] Task 01 (TDD + implementação): `none` proibido em produção. Arquivos:
  `src/config/env.validation.ts`, `.spec.ts`. Objetivo: `AUTH_COOKIE_SAMESITE=none` com
  `NODE_ENV=production` **derruba o boot**, com a mensagem da decisão 4 — que diz o que fazer, não só o
  que está errado. A checagem de `none` sem `secure` continua valendo para os outros ambientes.
- [ ] Task 02: Atualizar `.env.example` e o `README.md`. Objetivo: as duas linhas que hoje dizem
  `none em produção` passam a dizer **`lax`, com a API num subdomínio do domínio do front (spec 011)`**.
  Enquanto elas disserem o contrário, a próxima pessoa segue a documentação e reabre o bug.

# Fase 04: Verificação [ ]
Branch: nenhuma.

Nada aqui roda em `localhost`: em desenvolvimento o F5 **já funciona hoje**, com o bug em pé.

- [ ] Task 01: F5 no painel em produção, continuando dentro. **Chrome desktop e Safari do iPhone.** O
  Safari é o passo que prova a decisão 1 — é onde o `SameSite=none` teria falhado.
- [ ] Task 02: Simular falha de infraestrutura no refresh. Objetivo: com o `getUser` falhando, a resposta
  é **503**, o cookie **continua no navegador**, e o F5 seguinte com o Firebase de volta **restaura a
  sessão**. É a Fase 02 inteira num teste só.
- [ ] Task 03: Refresh com cookie inválido. Objetivo: 401, cookie apagado, e o front desloga com aviso.
- [ ] Task 04: `npm test` verde e `npm run lint` limpo.
- [ ] Task 05: Aposentar `api-lenoborges.vercel.app`, só **depois** de a Task 01 passar.

---

## Resultado da execução

_A preencher ao fim, no formato das specs 009 e 010: o que ficou de fora e por quê, e o que a execução
decidiu que vale registrar._
