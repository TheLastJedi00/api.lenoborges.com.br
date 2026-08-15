# Fase 01: Auditoria do que o push vai escrever [x]
Branch: `feat/006-auditoria-do-config`

Fase de leitura, sem alterar comportamento. Existe porque `config push` escreve a seção `[auth]`
inteira e o CLI não oferece `pull` nem `diff`: a comparação é manual e precisa acontecer **antes** de
qualquer push, uma vez.

- [x] Task 01: Levantar o que dá para ler do projeto hospedado sem o painel, pelo endpoint público
  `GET /auth/v1/settings` do GoTrue. Arquivo: `specs/006 - Configuracao de Auth como Codigo/context.md`,
  decisão 5. Objetivo: ter estado anterior escrito antes de sobrescrever qualquer coisa. Achou uma
  divergência real (`mailer_autoconfirm`) e confirmou cinco coincidências.
- [x] Task 02: Conferir contra a documentação as chaves que a spec acusou de perigosas. Arquivo:
  mesma decisão. Objetivo: `auth.rate_limit.email_sent = 2` foi **inocentado**, é o padrão do
  provedor de e-mail embutido e só muda com SMTP próprio. A primeira redação desta spec o chamava de
  o item mais perigoso do inventário, e estava errada.
- [] Task 03 (usuário, bloqueia a Fase 05): Conferir no painel o que nenhuma leitura externa alcança:
  Site URL, Redirect URLs, `jwt_expiry`, `otp_expiry`, `minimum_password_length`, `max_frequency` e o
  HTML atual do template de Reset Password. Objetivo: fechar o inventário antes do push. O endpoint
  público não expõe esses campos, o CLI não tem `config pull`, e a Management API exigiria um token
  pessoal que não está no ambiente.

# Fase 02: Template de recuperação em código [x]
Branch: `feat/006-template-recovery`

- [x] Task 01: Criar o template do e-mail de recuperação. Arquivo: `supabase/templates/recovery.html`.
  Objetivo: link em `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`, sem
  `/definir-senha` no fim, porque o `redirectTo` do backend já traz o caminho. O texto fala em
  "definir sua senha", não em "redefinir": para quem acabou de se cadastrar, é a primeira senha.
  Escrito do zero, porque a Fase 01 Task 03 ficou bloqueada e o HTML atual do painel não pôde ser
  lido. Se houver marca ou assinatura lá que valha preservar, é hora de trazer antes do push.
- [x] Task 02: Registrar o template no config. Arquivo: `supabase/config.toml`, seção nova
  `[auth.email.template.recovery]` com `subject` e `content_path = "./supabase/templates/recovery.html"`.
  Objetivo: o `config push` passar a levar o arquivo da Task 01 junto.

# Fase 03: URL configuration em código [x]
Branch: `feat/006-url-config`

- [x] Task 01: Corrigir o `site_url`. Arquivo: `supabase/config.toml`. Objetivo: trocar
  `http://127.0.0.1:3000` por `https://edu.lenoborges.com.br`, com comentário explicando que o campo
  é único, que o projeto hospedado serve dev e produção, e que por isso ele recebe o valor de
  produção enquanto o destino real de cada link vem do `redirectTo`.
- [x] Task 02: Preencher a allow-list. Arquivo: `supabase/config.toml`. Objetivo: trocar
  `additional_redirect_urls` por `["https://edu.lenoborges.com.br/definir-senha", "http://localhost:4200/definir-senha"]`,
  que são exatamente as duas URLs que o `AuthService` monta a partir do `FRONTEND_URL`. Sem elas o
  GoTrue descarta o `redirectTo` e o link volta a cair no Site URL.
- [x] Task 03: Neutralizar as divergências encontradas na Fase 01 Task 02. Arquivo:
  `supabase/config.toml`. Objetivo: alinhar ao que produção já pratica toda chave em que o arquivo
  carregava default de stack local, com atenção a `auth.rate_limit.email_sent` (hoje `2` por hora, o
  item mais perigoso do inventário) e `auth.email.max_frequency` (hoje `"1s"`).
- [x] Task 04: Subir o `minimum_password_length` para `8`. Arquivo: `supabase/config.toml`. Objetivo:
  fechar a folga entre o piso do servidor e o que a UI promete, já que `definir-senha.page.ts` exige
  8 no front e o backend não revalida tamanho.

# Fase 04: Documentação [x]
Branch: `feat/006-docs`

- [x] Task 01: Reescrever a seção "Configuração no Painel do Supabase". Arquivo: `README.md`.
  Objetivo: ela hoje ensina o template errado (`{{ .SiteURL }}/definir-senha`) e descreve passos de
  painel que passam a viver no repo. Vira "Configuração do Supabase", explicando que a fonte é o
  `config.toml`, que o comando é `supabase config push`, e que o push escreve a seção `[auth]`
  inteira em produção.
- [x] Task 02: Fechar o achado A6 de vez. Arquivo:
  `specs/005 - Autenticacao e Dashboard/review.md`. Objetivo: a nota de correção atual afirma que
  passar `redirectTo` resolve o link, o que só vale com `{{ .RedirectTo }}` no template. Corrigir a
  afirmação e apontar para esta spec.
- [x] Task 03: Ajustar a pendência 2 do context da spec 005 no front. Arquivo:
  `../eduleno-front/specs/005 - Autenticacao e Dashboard/context.md`. Objetivo: ela descreve o
  template com `{{ .SiteURL }}` como o formato desejado. Apontar para o formato desta spec. Commit no
  repositório do front, não neste.

# Fase 05: Push e verificação de ponta a ponta []
Branch: `release/006-config-auth-como-codigo`

Fase com passo humano. As tasks 01 e 02 não são executadas por agente.

- [] Task 01 (usuário): Confirmar que `FRONTEND_URL` em produção é `https://edu.lenoborges.com.br`.
  Local: painel da Vercel, projeto `api-lenoborges`. Objetivo: a variável está marcada como Sensitive
  e não é legível por `vercel env pull`, então a conferência é visual. Com valor errado, o
  `redirectTo` sai errado e o resto da spec não produz efeito.
- [] Task 02 (usuário): Rodar `supabase config push` com o diff revisado. Objetivo: aplicar o
  conteúdo das Fases 02 e 03 no projeto hospedado. É a única escrita em produção desta spec.
- [] Task 03: Verificar o resultado com um cadastro novo, de um e-mail que ainda não existe no
  projeto. Objetivo: confirmar que o link recebido aponta para `https://edu.lenoborges.com.br/definir-senha?token_hash=...&type=recovery`
  e que a senha é aceita. Links de recovery enviados antes do push carregam a URL antiga e não
  servem como prova.
- [] Task 04: Repetir a verificação com o front local em `http://localhost:4200`. Objetivo: provar a
  decisão 3 do context, que os dois ambientes convivem no mesmo projeto Supabase, que é a razão de o
  template usar `{{ .RedirectTo }}` em vez de `{{ .SiteURL }}`.
- [] Task 05: Registrar o resultado das tasks 03 e 04. Arquivo:
  `specs/006 - Configuracao de Auth como Codigo/context.md`, seção nova "Resultado da verificação".
  Objetivo: deixar escrito o que foi provado e em que data, no mesmo padrão da spec 005.
