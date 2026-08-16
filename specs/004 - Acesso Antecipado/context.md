> **DEPRECATED em 2026-08-16 pela [spec 007](../007%20-%20Firestore%20e%20Firebase%20Auth/context.md).**
>
> A tabela `waitlist_entries` virou colecao do Firestore, com o e-mail normalizado como ID do
> documento. O `id uuid` gerado pelo banco e o `unique` da coluna `email` deixaram de existir como
> tais: a unicidade passou a ser a do caminho do documento, e o `id` do recibo agora e o e-mail.
>
> O desenho do endpoint, a normalizacao e o tratamento de duplicata continuam valendo. O que mudou
> foi o armazenamento.

---

# Alteração de escopo (2026-08-13) — as migrations passam do TypeORM para o Supabase

Durante o code review ficou claro que **nada aplicava as migrations automaticamente**. Elas viviam
em `src/database/migrations/` e só chegavam ao banco quando alguém rodava `npm run migration:run`
à mão. Não havia pasta `supabase/`, nem CI, nem passo de deploy: um `git push` não tocava no banco,
e uma API subindo em ambiente novo iniciaria bem (`synchronize: false`) e estouraria na primeira
requisição, sem tabela.

Junto disso, o script `typeorm` dependia de `ts-node` (devDependency) e apontava para o `.ts` em
`src/`, então nem rodaria num container instalado com `npm ci --omit=dev`.

Decisão do usuário: **o schema passa a ser do Supabase CLI**. As migrations viram SQL em
`supabase/migrations/`, aplicadas por `supabase db push`. O TypeORM continua responsável por
entidades, repositories e consultas, sempre com `synchronize: false`, e não gera nem aplica
migration. O `clauderc.md` foi atualizado com essa regra.

Consequência prática: alterar estrutura de tabela passa a exigir os **dois lados** editados à mão,
o SQL da migration e a entity correspondente. Nada sincroniza um a partir do outro.

---

# Spec 004: Acesso Antecipado à Seita Dev

## Objetivo
Implementar o backend para o formulário de "Acesso Antecipado à Seita Dev", recebendo os dados do
frontend e armazenando no banco de dados do **Supabase (PostgreSQL)**.

## Escopo Técnico
- Framework: NestJS 11.
- Banco de dados: Supabase (PostgreSQL).
- Entidade/Tabela `waitlist_entries`:
  - `id` (UUID, gerado automaticamente)
  - `name` (text)
  - `phone` (text)
  - `email` (text)
  - `consent` (boolean)
  - `created_at` (timestamp with time zone, default now())
- Endpoint: `POST /waitlist`
  - Recebe os dados do formulário.
  - Valida os dados (class-validator).
  - Salva no banco.
  - Retorna o `WaitlistReceipt` (id e receivedAt).

---

# Detalhamento da spec (2026-08-13)

## Origem: esta spec substitui o mock da spec 003
A spec [003 - Comunidade](../003%20-%20Comunidade/context.md) entregou o modal de lista de espera
no frontend com um `WaitlistService` **mockado**, e deixou explícito em "Fora de escopo":
_"Backend real da lista de espera (o service é mock; a troca por HTTP é spec futura)"_. Esta spec é
essa continuação: cria o backend real que aquele modal vai consumir.

Consequências herdadas da 003 que esta spec precisa respeitar:
- O contrato de dados já existe no frontend: `WaitlistEntry` = `{ name, phone, email, consent: true }`
  e `WaitlistReceipt` = `{ id, receivedAt }`. **O backend não inventa contrato novo**, adota este.
- A 003 normaliza telefone (só dígitos) e e-mail (trim + lowercase) no frontend. O backend
  **repete** a normalização, porque não confia no chamador.
- A 003 recusa envio sem consentimento no service. O backend também recusa (400).
- O texto de LGPD do modal diz que "ainda não há armazenamento em servidor de produção". A própria
  003 registrou que a troca do mock por API real é o gatilho para revisar esse texto. **Autorizado
  pelo usuário em 2026-08-13: esta spec altera esse texto**, no repositório irmão. Detalhes na
  seção "Alteração no frontend".

Nenhuma spec anterior criou a tabela `waitlist_entries`, então não há spec a marcar como
`Deprecated` por alteração de estrutura de dados (regra 6 do clauderc).

## Decisão de arquitetura: TypeORM, não `@supabase/supabase-js`
O `context.md` original pedia `@supabase/supabase-js` com `SUPABASE_SERVICE_ROLE_KEY`. O
`clauderc.md` fixa **TypeORM** e "repositories sempre devolvem objeto" como design da API.
**Decisão confirmada com o usuário (2026-08-13): vale o clauderc.** O backend fala com o Postgres do
Supabase por `DATABASE_URL` via TypeORM.

Motivos:
- Mantém um único padrão de acesso a dados para as próximas specs (a trilha da 003 inclusive
  ensina TypeORM na etapa 12).
- Migrations versionadas no repositório em vez de SQL aplicado à mão no painel do Supabase.
- Sem `service_role` circulando na aplicação: `DATABASE_URL` já é acesso direto ao banco e ignora
  RLS por natureza, então o `SERVICE_ROLE_KEY` deixa de ser necessário nesta spec.

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` continuam no `.env` para uso futuro (Auth, Storage),
mas **não são lidos por nenhum código desta spec**.

### Conexão com o Supabase
- `DATABASE_URL` no formato `postgresql://postgres:<senha>@<host>:<porta>/postgres`.
- SSL obrigatório: `ssl: { rejectUnauthorized: false }` (o Supabase usa certificado próprio).
- Porta **5432** (conexão direta ou session pooler) para rodar migrations. O transaction pooler
  (6543) não suporta prepared statements e quebra migration; se for usado em runtime, exige
  `extra: { max: 1 }` e não serve para o passo de migration.
- `synchronize: false` **sempre**. Schema só muda por migration.

## Contrato do endpoint

### `POST /waitlist`

Request body (`CreateWaitlistEntryDto`):

| campo     | tipo    | regra                                                                 |
|-----------|---------|-----------------------------------------------------------------------|
| `name`    | string  | obrigatório, trim, 2 a 120 caracteres                                 |
| `phone`   | string  | obrigatório, 10 ou 11 dígitos depois de remover não dígitos (BR)      |
| `email`   | string  | obrigatório, `IsEmail`, trim + lowercase                              |
| `consent` | boolean | obrigatório, precisa ser exatamente `true`                            |

Normalização aplicada no service antes de persistir:
- `name`: trim e colapso de espaços internos repetidos.
- `phone`: só dígitos (`5511999998888` vira `5511999998888`; `(11) 99999-8888` vira `11999998888`).
- `email`: trim + lowercase.
- `consent`: se não for `true`, o service lança `BadRequestException` mesmo que o DTO já barre.
  O service não confia no chamador (mesma regra da 003).

Response `201`:

```json
{ "id": "0f4c...uuid", "receivedAt": "2026-08-13T18:20:31.412Z" }
```

`receivedAt` é o `created_at` da linha, serializado em ISO 8601 UTC.

Erros:
- `400` validação (array de mensagens do `ValidationPipe`) ou consentimento ausente.
- `429` estouro do rate limit.
- `500` falha de banco (a mensagem original **não** vaza para o cliente; vai para o log).

### Idempotência por e-mail
Decisão confirmada: **e-mail repetido não é erro**. A tabela tem índice único em `email` (já
normalizado em lowercase antes de gravar, então índice simples resolve, sem `lower(email)`).

Comportamento: se o e-mail já existe, o endpoint responde `201` com o **recibo original** (`id` e
`created_at` da primeira inscrição), sem criar linha nova e sem atualizar `name`/`phone`. Quem
clicou duas vezes no botão do modal vê sucesso, não erro. O status é `201` nos dois casos para o
frontend não precisar distinguir os fluxos.

Corrida entre duas requisições simultâneas com o mesmo e-mail: o `INSERT` pode falhar com violação
de unicidade (`23505`) depois do `findByEmail` ter vindo vazio. O service trata esse código
específico refazendo o `findByEmail` e devolvendo o recibo existente.

## Camadas (MVC simples do clauderc)

```
src/
  config/
    typeorm.config.ts          # DataSource compartilhado (app + CLI de migration)
  database/
    database.module.ts         # TypeOrmModule.forRootAsync lendo ConfigService
    migrations/
      <timestamp>-CreateWaitlistEntries.ts
  waitlist/
    waitlist.module.ts
    waitlist.controller.ts     # rota, status, Swagger, throttle
    waitlist.service.ts        # regra: normaliza, valida consentimento, idempotência
    waitlist.repository.ts     # único ponto que toca o TypeORM
    dto/
      create-waitlist-entry.dto.ts
      waitlist-receipt.dto.ts
    entities/
      waitlist-entry.entity.ts
```

### "Repositories sempre devolvem objeto"
Regra do clauderc aplicada assim: **nenhum método do repository devolve `null`, `undefined` ou
primitivo solto**. Sempre um objeto:

```ts
findByEmail(email: string): Promise<{ found: boolean; entry: WaitlistEntry | null }>
create(data: NewWaitlistEntry): Promise<{ entry: WaitlistEntry }>
```

Quem chama nunca precisa checar `null` sem contexto: checa `found`. O service é o único que traduz
isso para o `WaitlistReceipt` da resposta.

## Configuração global em `src/main.ts`
Hoje o arquivo é o bootstrap cru do starter. Passa a ter:

1. `ValidationPipe` global com `whitelist: true`, `forbidNonWhitelisted: true`,
   `transform: true` e `transformOptions: { enableImplicitConversion: false }`.
2. **CORS** liberado para a origem do frontend, lida de `FRONTEND_URL` (aceita lista separada por
   vírgula para cobrir o preview da Vercel). Sem `origin: true` cego. Métodos `POST` e `OPTIONS`,
   sem `credentials` (o endpoint é anônimo).
3. Swagger em `/docs` (`DocumentBuilder` com título "Eduleno API").
4. `app.listen(process.env.PORT ?? 3000)` como já é hoje.

Não entra prefixo global `/api` nesta spec: o contrato acordado é `POST /waitlist` na raiz.

## Rate limit
`@nestjs/throttler` registrado no `AppModule` com um default folgado e um limite apertado no
endpoint público:

- default global: 60 requisições / 60s por IP.
- `POST /waitlist`: **5 requisições / 60s por IP** via `@Throttle`.

Como o serviço vai rodar atrás de proxy (Vercel/Cloud Run), `app.set('trust proxy', 1)` precisa
estar ligado para o throttler enxergar o IP real em vez do IP do proxy.

## Variáveis de ambiente
`.env.example` passa a documentar, além do que já tem:

```
DATABASE_URL=postgresql://postgres:<senha>@<host>:5432/postgres
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:4200
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` permanecem documentados como reservados para features
futuras (Auth/Storage), com comentário dizendo que a API não os lê hoje.

`ConfigModule.forRoot({ isGlobal: true })` com validação: a aplicação **falha no boot** se
`DATABASE_URL` estiver ausente, em vez de estourar na primeira requisição.

**Estado do ambiente (2026-08-13):** o usuário confirmou que o `.env` local já está preenchido com
as credenciais reais do Supabase. Logo, as tasks que dependem de banco de verdade — rodar a
migration e validar o endpoint ponta a ponta — **rodam nesta spec**, não ficam pendentes. Se a
`DATABASE_URL` do `.env` estiver apontando para o transaction pooler (porta 6543), a task da
migration troca para 5432 apenas na execução do CLI, sem alterar o `.env`.

## Testes (TDD, regra 6 do clauderc)
Testes escritos **antes** da lógica do service.

`src/waitlist/waitlist.service.spec.ts` (repository mockado):
1. e-mail novo: chama `create` e devolve `{ id, receivedAt }` vindos da entity criada.
2. normaliza telefone (`(11) 99999-8888` vira `11999998888`) antes de persistir.
3. normaliza e-mail (` Fulano@Email.COM ` vira `fulano@email.com`) antes de persistir.
4. normaliza nome (trim e espaços internos colapsados).
5. `consent: false` lança `BadRequestException` e **não** chama o repository.
6. e-mail já existente: **não** chama `create` e devolve o recibo original.
7. violação de unicidade (`23505`) no `create`: refaz o `findByEmail` e devolve o recibo existente.
8. erro genérico do repository: propaga como `InternalServerErrorException` sem vazar a mensagem
   do driver.

`src/waitlist/waitlist.controller.spec.ts`: controller delega ao service e devolve o recibo.

`test/waitlist.e2e-spec.ts` (roda com `npm run test:e2e`, banco real ou sqlite/pg-mem em memória):
- `POST /waitlist` válido devolve 201 com `id` e `receivedAt`.
- corpo inválido (sem `consent`, e-mail malformado, campo extra) devolve 400.
- envio repetido do mesmo e-mail devolve o mesmo `id`.

Lembrete do CLAUDE.md: as duas configs de Jest são separadas (`rootDir: src` para unit, `test/`
para e2e). Spec unitária vai em `src/`, e2e vai em `test/`.

## Documentação (regra 4 do clauderc)
O `README.md` hoje é o README padrão do NestJS. Passa a ter seção própria com:
- variáveis de ambiente exigidas;
- como rodar migrations;
- tabela `waitlist_entries` (colunas, tipos, índice único);
- `POST /waitlist`: request, response 201, erros 400/429/500 e a nota de idempotência;
- link para `/docs` (Swagger).

## Alteração no frontend (repositório `eduleno-front`)
Autorizada pelo usuário. Repositório irmão em `../eduleno-front`, branch `dev`.

### O texto de uso dos dados
Arquivo: `src/app/components/waitlist-dialog/waitlist-dialog.ts`, bloco `.legal` (`id="uso-dos-dados"`).
A frase a corrigir é a última do segundo parágrafo:

> "Enquanto a plataforma está em construção, o envio fica registrado apenas nesta sessão do
> navegador, sem servidor de produção."

Passa a dizer a verdade nova: os dados são enviados e **armazenados no banco de dados do serviço da
Seita Dev (Supabase)**, guardados apenas enquanto durar a lista de espera, e apagados a pedido do
titular. O restante do bloco (finalidade única, base legal do art. 7º I, ausência de
compartilhamento para publicidade, direito de consulta/correção/exclusão e revogação) **continua
igual**, porque continua verdadeiro.

Regra que se mantém: não inventar política de privacidade que não existe. O texto descreve o que o
backend desta spec de fato faz, nada além.

### Acoplamento com a troca do mock por HTTP
O texto novo só é verdadeiro depois que o `WaitlistService` do front parar de ser mock e passar a
chamar `POST /waitlist`. Publicar a frase "armazenamos no banco" enquanto o envio ainda morre em
memória seria trocar uma imprecisão por outra, pior. Por isso **as duas mudanças andam juntas, na
mesma fase**:

- `WaitlistService` (front) troca o `delay` simulado por `HttpClient.post<WaitlistReceipt>()` contra
  `environment.apiUrl + '/waitlist'`, mantendo a assinatura `submit(entry): Observable<WaitlistReceipt>`
  e a normalização que já faz. As specs existentes do service passam a usar
  `HttpTestingController`; os quatro casos já cobertos (sucesso, normalização, recusa sem
  consentimento, propagação de erro) continuam valendo.
- `provideHttpClient()` entra na configuração da aplicação, e `apiUrl` entra nos `environment*.ts`.
- O modal não muda de estados: `idle` → `sending` → `success` | `error` já cobre o fluxo HTTP.

## Fora de escopo
- Autenticação, RLS e qualquer endpoint de leitura ou administração da lista (`GET /waitlist`).
- Envio de e-mail de confirmação para quem se inscreve.
- Deploy, CI/CD e configuração de ambiente na nuvem.
- Página de política de privacidade completa (segue valendo o aviso resumido dentro do modal).
- Uso de `@supabase/supabase-js` (Auth/Storage) em qualquer forma.
