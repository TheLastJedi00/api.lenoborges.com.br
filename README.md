# Eduleno Backend API

API para o serviço da Seita Dev (eduleno-back).

## Funcionalidades
- Endpoint para lista de espera (`POST /waitlist`)
- Integração com Supabase (PostgreSQL): TypeORM para consultas, Supabase CLI para o schema
- Validação de dados (class-validator) e normalização
- Rate limit (`@nestjs/throttler`)
- Documentação de API navegável com Swagger (`/docs`)

## Configuração do Ambiente (.env)

Crie um arquivo `.env` na raiz do projeto com base no `.env.example`:

```env
# Porta da API
PORT=3000
NODE_ENV=development

# Origens permitidas para CORS (separadas por vírgula)
FRONTEND_URL=http://localhost:4200

# Conexão com o banco (PostgreSQL / Supabase), usada pelo TypeORM em runtime
# Use a porta 5432 (conexão direta ou session pooler)
DATABASE_URL=postgresql://postgres:<senha>@<host>:5432/postgres

# TLS do banco. A conexão carrega PII, então a verificação do certificado fica
# ligada por padrão. O host direto do Supabase usa CA própria: baixe o arquivo em
# Settings > Database > SSL Configuration e aponte o caminho abaixo.
DATABASE_SSL_CA_PATH=./certs/prod-ca.crt
# Desliga a verificação. Apenas banco local ou descartável, nunca em produção.
# DATABASE_SSL_REJECT_UNAUTHORIZED=false

# As variáveis abaixo estão reservadas para funcionalidades futuras (Auth/Storage)
# e não são utilizadas atualmente pela API
# SUPABASE_URL=https://<id>.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

## Banco de Dados e Migrations

O schema pertence ao **Supabase**, não ao TypeORM. As migrations são arquivos SQL versionados em
`supabase/migrations/` e aplicadas pelo Supabase CLI. O TypeORM roda sempre com
`synchronize: false` e nunca gera nem aplica migration: ele só mapeia e consulta.

Um `git push` **não** altera o banco. O passo de aplicar é explícito:

```bash
npx supabase login                 # uma vez por máquina
npx supabase link --project-ref <ref>

npm run migration:new <nome>       # cria supabase/migrations/<timestamp>_<nome>.sql
npm run migration:list             # compara local com o remoto
npm run migration:push             # aplica as pendentes
```

Ao mudar a estrutura de uma tabela, altere **os dois lados**: o SQL da migration e a entity
correspondente em `src/**/entities/`. Nada sincroniza um a partir do outro.

### Tabela `waitlist_entries`

- `id` (uuid, Primary Key, default `gen_random_uuid()`)
- `name` (varchar, Not Null)
- `phone` (varchar, Not Null)
- `email` (varchar, Not Null, Unique)
- `consent` (boolean, Not Null)
- `created_at` (timestamptz, Not Null, default `now()`)

`created_at` é `timestamptz` de propósito: como `timestamp` sem fuso, o valor seria gravado no fuso
da sessão do banco e lido no fuso do processo Node, deslocando o `receivedAt` que a API anuncia
como UTC.

## Documentação da API (Swagger)

Com a aplicação rodando, acesse `/docs` no navegador para ver a documentação interativa gerada pelo Swagger.

### `POST /waitlist`

Recebe os dados do formulário de acesso antecipado e armazena no banco de dados.

**Request Body:**
- `name` (string): 2 a 120 caracteres.
- `phone` (string): 10 ou 11 dígitos.
- `email` (string): Formato válido de e-mail.
- `consent` (boolean): Deve ser exatamente `true`.

**Response:**
- `201 Created`: Inscrição recebida. Retorna `{ id, receivedAt }`.
  - *Nota de Idempotência:* Enviar um e-mail já existente não gera erro. A API retorna `201` com o recibo original da primeira inscrição (mesmo `id` e `receivedAt`).
- `400 Bad Request`: Erro de validação ou consentimento ausente.
- `429 Too Many Requests`: Limite de requisições excedido (5 requisições por minuto por IP).
- `500 Internal Server Error`: Erro interno no banco de dados.
