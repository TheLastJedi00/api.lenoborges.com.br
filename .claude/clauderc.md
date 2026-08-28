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
| produção | `liga.lenoborges.com.br` | `https://liga.lenoborges.com.br/acesso` | `https://liga.lenoborges.com.br/?entrar=1` |
| `dev-liga-dev` | `ligapreview.lenoborges.com.br` | `https://ligapreview.lenoborges.com.br/acesso` | `https://ligapreview.lenoborges.com.br/?entrar=1` |

**Action URL e `continueUrl` são valores diferentes e é fácil trocá-los:** a action URL é do console e diz
para onde **o link do e-mail** leva; o `continueUrl` é desta API, vai em cada `sendOobCode`, e diz para
onde a **tela** manda a pessoa quando termina. Apontar o `continueUrl` para `/acesso` faz um laço.

Ao mexer em qualquer um dos dois, ou em `Authorized domains`, **são sempre dois projetos**. Configurar só
um é o defeito que nenhum teste pega: funciona em preview e quebra em produção. É a mesma classe dos
índices compostos, que existiam só no projeto de produção até 2026-08-28 — e o deploy do Firebase é
sempre com `--project` explícito pelo mesmo motivo.

> Há exemplos e um fixture de teste com `edu.lenoborges.com.br` (`create-campaign.dto.ts`,
> `badge-video.service.spec.ts`). O domínio é `liga.` — os exemplos estão desatualizados.
