# Fase 01: Fundação (config, banco e globais) [x]
Branch: `feat/004-fundacao`

- [x] Task 01: Instalar dependências — `@nestjs/config`, `@nestjs/typeorm`, `typeorm`, `pg`,
  `class-validator`, `class-transformer`. Arquivo: `package.json`. Objetivo: ter o runtime de
  configuração, ORM e validação disponíveis.
- [x] Task 02: Documentar as variáveis de ambiente. Arquivos: `.env.example`, `.env`. Objetivo:
  acrescentar `PORT`, `NODE_ENV` e `FRONTEND_URL`, corrigir o `DATABASE_URL` de exemplo para o
  formato completo do Supabase (porta 5432) e marcar `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
  como reservados para uso futuro, não lidos pela API.
- [x] Task 03: Registrar `ConfigModule.forRoot({ isGlobal: true })` com validação de env. Arquivo:
  `src/app.module.ts`. Objetivo: a aplicação falhar no boot se `DATABASE_URL` faltar, em vez de
  quebrar na primeira requisição.
- [x] Task 04: Criar o `DataSource` compartilhado entre app e CLI. Arquivo:
  `src/config/typeorm.config.ts`. Objetivo: uma única definição de conexão (URL, SSL com
  `rejectUnauthorized: false`, `synchronize: false`, `entities`, `migrations`) usada tanto pelo
  Nest quanto pelo `typeorm-cli`.
- [x] Task 05: Criar o `DatabaseModule` com `TypeOrmModule.forRootAsync` lendo o `ConfigService`.
  Arquivo: `src/database/database.module.ts`, importado em `src/app.module.ts`. Objetivo: injetar a
  conexão no container do Nest sem duplicar a configuração da Task 04.
- [x] Task 06: Adicionar scripts de migration. Arquivo: `package.json`. Objetivo: `migration:generate`,
  `migration:run` e `migration:revert` apontando para o DataSource da Task 04.
- [x] Task 07: Configurar os globais do bootstrap. Arquivo: `src/main.ts`. Objetivo: `ValidationPipe`
  global (`whitelist`, `forbidNonWhitelisted`, `transform`), CORS restrito às origens de
  `FRONTEND_URL` (lista separada por vírgula) e `trust proxy` ligado para o rate limit enxergar o
  IP real.

# Fase 02: Modelo de dados [x]
Branch: `feat/004-modelo-de-dados`

- [x] Task 01: Criar a entity. Arquivo: `src/waitlist/entities/waitlist-entry.entity.ts`. Objetivo:
  mapear `waitlist_entries` com `id` UUID gerado, `name`, `phone`, `email` (único), `consent`
  booleano e `created_at` com default do banco.
- [x] Task 02: Gerar e revisar a migration. Arquivo:
  `src/database/migrations/<timestamp>-CreateWaitlistEntries.ts`. Objetivo: criar a tabela com
  `gen_random_uuid()` como default do `id`, `created_at` com `now()`, índice único em `email` e um
  `down` que derruba tabela e índice.
- [x] Task 03: Criar o repository. Arquivo: `src/waitlist/waitlist.repository.ts`. Objetivo: único
  ponto que toca o TypeORM, com `findByEmail` devolvendo `{ found, entry }` e `create` devolvendo
  `{ entry }` — nunca `null` nem primitivo solto, conforme o clauderc.
- [x] Task 04: Rodar a migration contra o Supabase (o `.env` já está preenchido) e conferir a tabela.
  Objetivo: validar `DATABASE_URL`, SSL e porta antes de qualquer lógica depender disso. Se a URL
  apontar para o pooler 6543, usar 5432 só na execução do CLI, sem editar o `.env`.

# Fase 03: Endpoint da lista de espera (TDD) []
Branch: `feat/004-waitlist-endpoint`

- [] Task 01: Criar os DTOs. Arquivos: `src/waitlist/dto/create-waitlist-entry.dto.ts` e
  `src/waitlist/dto/waitlist-receipt.dto.ts`. Objetivo: validar `name` (2 a 120), `phone` (10 ou 11
  dígitos após limpar não dígitos), `email` (`IsEmail`) e `consent` (`Equals(true)`), e fixar o
  contrato de saída `{ id, receivedAt }` herdado da spec 003.
- [] Task 02 (TDD): Escrever a spec do service **antes** da lógica. Arquivo:
  `src/waitlist/waitlist.service.spec.ts`. Objetivo: cobrir os 8 casos do context.md — criação,
  normalização de nome/telefone/e-mail, recusa sem consentimento, idempotência por e-mail, corrida
  com violação `23505` e erro genérico sem vazar mensagem do driver.
- [] Task 03: Implementar o `WaitlistService` até a spec da Task 02 passar. Arquivo:
  `src/waitlist/waitlist.service.ts`. Objetivo: normalizar a entrada, recusar `consent` falso,
  reaproveitar o recibo existente e traduzir a entity em `WaitlistReceipt`.
- [] Task 04: Criar o controller e sua spec. Arquivos: `src/waitlist/waitlist.controller.ts` e
  `src/waitlist/waitlist.controller.spec.ts`. Objetivo: `POST /waitlist` respondendo 201 nos dois
  caminhos (novo e já existente) e delegando ao service.
- [] Task 05: Criar o `WaitlistModule` e importá-lo. Arquivos: `src/waitlist/waitlist.module.ts` e
  `src/app.module.ts`. Objetivo: registrar entity, repository, service e controller no container.

# Fase 04: Endurecimento e documentação da API []
Branch: `feat/004-hardening`

- [] Task 01: Instalar e registrar o `@nestjs/throttler`. Arquivos: `package.json`,
  `src/app.module.ts`. Objetivo: default global de 60 req/60s por IP com o guard aplicado
  globalmente.
- [] Task 02: Apertar o limite do endpoint público. Arquivo: `src/waitlist/waitlist.controller.ts`.
  Objetivo: `@Throttle` de 5 requisições por 60s em `POST /waitlist`, devolvendo 429 no estouro.
- [] Task 03: Instalar e configurar o Swagger. Arquivos: `package.json`, `src/main.ts`. Objetivo:
  documentação navegável em `/docs` com título "Eduleno API".
- [] Task 04: Anotar DTOs e controller para o Swagger. Arquivos: `src/waitlist/dto/*.ts`,
  `src/waitlist/waitlist.controller.ts`. Objetivo: `/docs` mostrar o corpo esperado, o exemplo de
  recibo e as respostas 400, 429 e 500.
- [] Task 05: Escrever o teste e2e. Arquivo: `test/waitlist.e2e-spec.ts`. Objetivo: cobrir envio
  válido (201 com `id` e `receivedAt`), corpo inválido (400) e envio repetido devolvendo o mesmo
  `id`.

# Fase 05: Documentação e validação final []
Branch: `feat/004-docs`

- [] Task 01: Reescrever o `README.md`. Arquivo: `README.md`. Objetivo: substituir o README padrão
  do NestJS por documentação do projeto — variáveis de ambiente, como rodar migrations, estrutura da
  tabela `waitlist_entries` e o contrato de `POST /waitlist` com erros e nota de idempotência,
  conforme a regra 4 do clauderc.
- [] Task 02: Atualizar o `CLAUDE.md`. Arquivo: `CLAUDE.md`. Objetivo: remover a afirmação de que o
  repositório ainda é o starter cru e registrar o layout de camadas, o uso de TypeORM e o fluxo de
  migrations.
- [] Task 03: Rodar `npm run lint`, `npm test`, `npm run test:e2e` e `npm run build`. Objetivo:
  suíte verde e build limpo antes de fechar a spec.
- [] Task 04: Validar o endpoint com uma requisição real contra o Supabase e conferir a linha
  gravada. Objetivo: provar o caminho ponta a ponta, incluindo o segundo envio devolvendo o mesmo
  `id`.

# Fase 06: Integração do frontend []
Repositório: `../eduleno-front` (branch base `dev`). Branch: `feat/004-waitlist-http`

- [] Task 01: Expor a URL da API no ambiente. Arquivos: `src/environments/environment.ts` e
  `environment.production.ts` (ou equivalentes do projeto). Objetivo: `apiUrl` apontando para
  `http://localhost:3000` em dev, sem hardcode espalhado.
- [] Task 02: Registrar o `provideHttpClient()`. Arquivo: `src/app/app.config.ts`. Objetivo: dar ao
  `WaitlistService` acesso ao `HttpClient`.
- [] Task 03 (TDD): Reescrever a spec do `WaitlistService` para HTTP **antes** de trocar a lógica.
  Arquivo: `src/app/services/waitlist.service.spec.ts` (ou o caminho atual da spec). Objetivo: usar
  `HttpTestingController` mantendo os quatro casos já cobertos — sucesso com recibo, normalização
  de telefone e e-mail, recusa sem consentimento e propagação de erro — verificando corpo e URL da
  requisição.
- [] Task 04: Trocar o mock por `HttpClient.post<WaitlistReceipt>()`. Arquivo:
  `src/app/services/waitlist.service.ts`. Objetivo: remover o `delay` simulado preservando a
  assinatura `submit(entry): Observable<WaitlistReceipt>` e a normalização existente.
- [] Task 05: Corrigir o texto de uso dos dados. Arquivo:
  `src/app/components/waitlist-dialog/waitlist-dialog.ts`, bloco `.legal`. Objetivo: substituir
  "fica registrado apenas nesta sessão do navegador, sem servidor de produção" pela descrição real
  (armazenamento no banco da Seita Dev, retenção enquanto durar a lista de espera, exclusão a
  pedido), mantendo finalidade, base legal e direitos do titular como estão.
- [] Task 06: Validar a integração ponta a ponta com o backend rodando. Objetivo: `ng test` verde,
  modal enviando de verdade, estado de sucesso aparecendo e a linha chegando no Supabase, sem erro
  de CORS no console.

# Fase 07: Release []
- [] Task 01: Abrir `release/004-acesso-antecipado` unindo as branches `feat/004-*` do backend.
- [] Task 02: Merge da release em `dev` e PR contra a `main` (se houver origin; se não, merge local).
- [] Task 03: Mesmo fluxo no `eduleno-front` para a `feat/004-waitlist-http`.

## Checklist final
- [] Migration aplicada e tabela `waitlist_entries` criada com índice único em `email`
- [] `POST /waitlist` devolve 201 com `{ id, receivedAt }`
- [] E-mail repetido devolve o recibo original, sem linha nova e sem erro
- [] Consentimento ausente ou falso devolve 400
- [] Rate limit de 5 req/60s por IP ativo no endpoint
- [] CORS restrito às origens de `FRONTEND_URL`
- [] Swagger disponível em `/docs`
- [] Specs do service escritas antes da lógica, todas verdes
- [] `npm run lint`, `npm test`, `npm run test:e2e` e `npm run build` sem erro
- [] `README.md` documentando endpoint e estrutura de dados
- [] Nenhum uso de `@supabase/supabase-js` nem leitura de `SUPABASE_SERVICE_ROLE_KEY`
- [] Front chamando `POST /waitlist` de verdade, sem mock e sem erro de CORS
- [] Texto de uso dos dados do modal descrevendo o armazenamento real, sem inventar política
