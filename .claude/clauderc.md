# Design da API
- MVC Simples
- Firestore pelo Admin SDK (`firebase-admin`) para persistência. Tipos e
  `FirestoreDataConverter` em `src/**/entities/`, acesso só pelos repositories.
- **Não há migrations e não há schema a versionar.** O Firestore não tem DDL. Em troca, o que o
  banco garantia passa a ser responsabilidade da aplicação: unicidade vira ID de documento,
  faixa de valor vira validação, e acesso direto vira `firestore.rules`. Ao mexer em estrutura
  de dado, pergunte qual garantia está sendo assumida pelo código — a spec 007 lista as que
  mudaram de lugar.
- **Repositories sempre devolvem objeto** (`{ found, entry }`, nunca `null` cru). Esta regra é a
  que fez a migração de Postgres para Firestore caber em duas classes: os services não sabiam o
  que tinha embaixo e continuaram sem saber. Vale a pena defendê-la.
- Documentar endpointes e estruturas de dados no [Read Me]("../../../README.md")
- Alterações em estrutura de dados devem marcar specs anteriores que montaram essa table com Deprecated e referenciá-las na spec atual

# Fluxo de Trabalho
1. Ler context.md da spec
2. Aperfeicoar o context.md com mais informação necessária pra levantar a spec
3. Criar um tasks.md divido em fases e fases divididas em tasks atômicas citando os arquivos a serem alterados e objetivo da alteração.
4. Se, somente se, for usado o comando "executar", iniciar a execução das tasks imediatamente após criá-las
5. Se, somente se, no meio da execução de uma spec aparecer alguma alteração de escopo por necessidade pra completar a task, destacar no topo do context.md
6. Usar TDD, criar testes antes da lógica dos services

# Exemplo de tasks.md
```
    # Fase 01:<Título> []
    - [] Tasks 01:<Nome/Objetivo> 
```
- Marcar com [x] tasks e fases concluídas

# Versionamento
1. Abrir uma branch feat/ para cada fase sendo cada task um commit
2. Cada fase é um push
3. Ao fim da spec abrir uma branch release/ unindo todas as feat/ da spec
4. Merge em dev a release
5. PR contra a main (se houver origin, se não, merge de dev contra main local)

# Ambientes e URLs

| Ambiente | API | Front (`FRONTEND_URL`) |
|---|---|---|
| Produção | `https://api.lenoborges.com.br` | `https://liga.lenoborges.com.br` |
| Preview (branch `dev`) | `https://apipreview.lenoborges.com.br` | `https://ligapreview.lenoborges.com.br` |

API e front são **subdomínios do mesmo domínio registrável** (`lenoborges.com.br`) de propósito: o cookie
do refresh token é `HttpOnly; SameSite=Lax`, e `Lax` não acompanha requisição cross-site nenhuma. Sob um
`*.vercel.app` os dois seriam sites diferentes para o navegador (Public Suffix List) e o F5 deslogaria —
é a spec 011 inteira. `FRONTEND_URL` aceita lista separada por vírgula para o CORS; **o retorno tem um
destino só, a primeira da lista**, e é dela que sai o `continueUrl` do `AuthService`.

**Cada ambiente tem seu próprio projeto do Firebase**, e o que vive no console é por projeto:

| Projeto | Front que ele atende | Action URL (spec 020) | `continueUrl` |
|---|---|---|---|
| produção | `liga.lenoborges.com.br` | **travada** em `https://<projeto>.firebaseapp.com/__/auth/action` | `https://liga.lenoborges.com.br/?entrar=1` |
| `dev-liga-dev` | `ligapreview.lenoborges.com.br` | **travada** em `https://dev-liga-dev.firebaseapp.com/__/auth/action` | `https://ligapreview.lenoborges.com.br/?entrar=1` |

**A action URL não é configurável, e isto está fechado.** O Firebase recusa a troca com
`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`, no console e na API, nos dois projetos. Cinco causas foram
testadas e derrubadas em 2026-08-28 — permissão, domínio, falta de SMTP próprio, projeto fora do
Identity Platform e proteção de enumeração de e-mail. **Não repita esses testes**; a tabela está no
`context.md` da spec 020. O caminho que resolve é gerar o link pelo Admin SDK
(`generatePasswordResetLink`, `generateVerifyAndChangeEmailLink`) e enviá-lo pelo `MailerService` da
spec 014 — e ele torna esta linha de console desnecessária em vez de bloqueada.

O **SMTP também é por projeto** (spec 020, Fase 05) e ficou **desligado** (`method = DEFAULT`) pelo
mesmo motivo: sem o link apontando para a nossa tela, ele entregaria um e-mail do remetente certo
cujo link abre a tela do Google. Os valores seguem gravados no `dev-liga-dev` — `smtp.resend.com`,
587, STARTTLS, remetente `acesso@lenoborges.com.br`, separado do `comunidade@` da spec 014 porque o
e-mail que devolve a conta para a pessoa não pode morar no mesmo endereço de que ela pode se
descadastrar.

**Action URL e `continueUrl` são valores diferentes e é fácil trocá-los:** a action URL é do console e diz
para onde **o link do e-mail** leva; o `continueUrl` é desta API, vai em cada `sendOobCode`, e diz para
onde a **tela** manda a pessoa quando termina. Apontar o `continueUrl` para `/acesso` faz um laço.

Ao mexer em qualquer um dos dois, ou em `Authorized domains`, **são sempre dois projetos**. Configurar só
um é o defeito que nenhum teste pega: funciona em preview e quebra em produção. É a mesma classe dos
índices compostos, que existiam só no projeto de produção até 2026-08-28 — e o deploy do Firebase é
sempre com `--project` explícito pelo mesmo motivo.

> Há exemplos e um fixture de teste com `edu.lenoborges.com.br` (`create-campaign.dto.ts`,
> `badge-video.service.spec.ts`). O domínio é `liga.` — os exemplos estão desatualizados.
