# Eduleno Backend API

API para o serviço da Seita Dev (eduleno-back).

## Funcionalidades
- Endpoint para lista de espera (`POST /waitlist`)
- Integração com Supabase (PostgreSQL) usando TypeORM
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

# Conexão com o banco (PostgreSQL / Supabase) via TypeORM
# Certifique-se de usar a porta 5432 (conexão direta ou session pooler) para migrações
DATABASE_URL=postgresql://postgres:<senha>@<host>:5432/postgres

# As variáveis abaixo estão reservadas para funcionalidades futuras (Auth/Storage)
# e não são utilizadas atualmente pela API
# SUPABASE_URL=https://<id>.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

## Banco de Dados e Migrations

As migrations são versionadas no repositório. Para executar:

```bash
npm run migration:run
```

### Tabela `waitlist_entries`

- `id` (UUID, gerado automaticamente, Primary Key)
- `name` (varchar, Not Null)
- `phone` (varchar, Not Null)
- `email` (varchar, Not Null, Unique Index)
- `consent` (boolean, Not Null)
- `created_at` (timestamp, default `now()`, Not Null)

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
