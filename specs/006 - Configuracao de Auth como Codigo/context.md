# Spec 006: Configuração do Supabase Auth como código

## Objetivo
Tirar do painel do Supabase a configuração de auth que hoje decide se o cadastro funciona, e trazer
para o repositório: template do e-mail de recuperação, Site URL e Redirect URLs.

O gatilho é um bug concreto: **o link de definir senha que chega no e-mail de cadastro abre
`localhost:3000`**, que é a porta da API, não a do front. O usuário cria a conta, recebe o e-mail,
clica e cai numa porta onde não existe front nenhum.

Repositório irmão: `../eduleno-front`, spec `005 - Autenticacao e Dashboard`. O fluxo de cadastro
descrito lá depende inteiramente do link que esta spec conserta.

---

## Origem e specs afetadas

### Continuação da spec 005, sem alterar estrutura de dados
Esta spec não cria, altera nem remove tabela. Nada de `profiles` nem de `waitlist_entries` muda.
Pela regra 6 do `clauderc.md`, **nenhuma spec anterior é marcada como Deprecated**.

O que ela mexe é em configuração de serviço e em um arquivo de template. O código de aplicação sofre
no máximo ajuste de constante.

### O achado A6 da spec 005 foi fechado pela metade
O [review da 005](../005%20-%20Autenticacao%20e%20Dashboard/review.md) registrou em A6 que
`resetPasswordForEmail` era chamado sem `redirectTo`, deixando a URL do link inteiramente a cargo do
painel.

Isso foi corrigido em 2026-08-15, na branch `fix/005-recovery-redirect-to` (PR #9 para `dev`, PR #10
para `main`). `AuthService` passou a ler `FRONTEND_URL` e a passar
`{ redirectTo: FRONTEND_URL + '/definir-senha' }`.

**O fix está correto e é inerte.** A documentação do Supabase é explícita: `{{ .SiteURL }}` renderiza
a configuração de Site URL do projeto, e o valor passado em `resetPasswordForEmail` só aparece no
template como `{{ .RedirectTo }}`. O template em uso é:

```
{{ .SiteURL }}/definir-senha?token_hash={{ .TokenHash }}&type=recovery
```

Então o `redirectTo` entra na validação da allow-list, é aceito, e não aparece no link. O e-mail
continua saindo com o Site URL, que segue `http://127.0.0.1:3000`. Esta spec é o que falta para
aquele fix produzir efeito.

---

## Decisões e descobertas (2026-08-15)

### 1. O template do e-mail pode viver no código, ao contrário do que a doc diz
A página oficial de [customizing email templates](https://supabase.com/docs/guides/local-development/customizing-email-templates)
afirma que projetos hospedados exigem copiar o template na mão pelo dashboard, e que não há comando
de CLI para isso.

**A página está desatualizada.** O CLI instalado (2.114.0) tem:

```
supabase config push    Push local config to linked project
```

O projeto já está linkado (`supabase/.temp/project-ref` aponta para `yymyasazpwsmdmpuasjx`). Foi o
skill de Supabase, adicionado em `.agents/skills/supabase/`, que mandou verificar o binário em vez de
confiar na doc, e é por isso que esta decisão existe.

### 2. Um projeto Supabase só, servindo dev e produção
O `.env` de desenvolvimento aponta para `https://yymyasazpwsmdmpuasjx.supabase.co`, o **mesmo**
projeto que a produção usa. Não existe stack local em uso: ninguém roda `supabase start` aqui.

Consequência direta: `site_url` é campo único e compartilhado pelos dois ambientes. Com
`{{ .SiteURL }}` no template, é impossível atender dev e produção ao mesmo tempo. Apontar para
produção quebra o link em dev; apontar para localhost quebra o e-mail de quem se cadastra de verdade.

### 3. `{{ .RedirectTo }}` é obrigatório, não preferência
Da decisão 2 segue que o template precisa ser:

```
{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery
```

Sem `/definir-senha` no fim, porque o `redirectTo` que o backend monta já traz o caminho. Assim cada
chamada carrega seu próprio destino, os dois ambientes funcionam simultaneamente, e o Site URL sobra
como rede de segurança para quando o `redirectTo` não bater com a allow-list.

Não há saída por interpolação de ambiente: a [doc do config.toml](https://supabase.com/docs/guides/local-development/cli/config)
só documenta `env(VAR)` para segredos de SMS e OpenAI, não para `site_url` nem
`additional_redirect_urls`.

### 4. O `config push` é uma arma carregada, e o arquivo está apontado para o próprio pé
`config push` não empurra só o template. Ele empurra a seção `[auth]` inteira, e o `config.toml`
deste repo nunca foi tocado desde o `supabase init`: ele carrega os **defaults de stack local**.

Rodar `supabase config push` hoje, sem as tasks desta spec, não corrigiria o bug. Escreveria ele
dentro do projeto hospedado, por cima do que estiver no painel. É comportamento conhecido do CLI,
reportado em [supabase/cli#3208](https://github.com/supabase/cli/issues/3208) e
[#3365](https://github.com/supabase/cli/issues/3365).

**Inventário do que está armado hoje:**

| Chave | Valor no arquivo | Consequência se empurrado assim |
|---|---|---|
| `auth.site_url` | `http://127.0.0.1:3000` | É o bug. Porta da API, não do front. |
| `auth.additional_redirect_urls` | `["https://127.0.0.1:3000"]` | `https` em endereço local, e nenhuma URL real na allow-list. Todo `redirectTo` seria recusado. |
| `auth.email.enable_confirmations` | `false` | **Diverge da produção.** O projeto hospedado está com `mailer_autoconfirm: false`, ou seja, confirmação exigida. Empurrar `false` aqui liga o autoconfirm lá. |
| `auth.email.max_frequency` | `"1s"` | Afrouxa o intervalo entre e-mails de recuperação em produção. |
| `auth.minimum_password_length` | `6` | O front exige 8 (`definir-senha.page.ts`). Empurrar 6 cria um piso mais fraco que a UI promete. |
| `auth.jwt_expiry`, `auth.email.otp_expiry` | `3600` | Não verificável de fora. Conferir no painel antes do primeiro push. |
| `auth.rate_limit.email_sent` | `2` | Nenhuma. Ver abaixo. |

Sobre a última linha: `email_sent = 2` **não** é um default local perigoso, ao contrário do que esta
spec afirmou na primeira redação. A [doc de rate limits](https://supabase.com/docs/guides/auth/rate-limits)
diz que 2 e-mails por hora é justamente o padrão do provedor de e-mail embutido, e que esse limite só
é configurável com SMTP próprio. O arquivo está espelhando a realidade, não a ameaçando.

Isso não torna o número inofensivo para o produto: 2 por hora no projeto inteiro é apertado para
cadastro real. Mas é limitação de plataforma a resolver com SMTP próprio, não com `config push`, e
por isso está em "Fora de escopo".

### 5. Estado do projeto hospedado antes da mudança (Fase 01)
Levantado em 2026-08-15 pelo endpoint público de settings do GoTrue
(`GET /auth/v1/settings`, com a `SUPABASE_ANON_KEY`), que é leitura e não exige o painel:

| Campo (GoTrue) | Produção hoje | Chave equivalente no `config.toml` | Situação |
|---|---|---|---|
| `disable_signup` | `false` | `auth.enable_signup = true` | Bate |
| `external.email` | `true` | `auth.email.enable_signup = true` | Bate |
| `mailer_autoconfirm` | `false` | `auth.email.enable_confirmations = false` | **Diverge** |
| `external.*` (todos os OAuth) | `false` | `[auth.external.*] enabled = false` | Bate |
| `phone_autoconfirm` | `false` | `auth.sms` desligado | Bate |
| `saml_enabled` | `false` | não configurado | Bate |

A divergência do `mailer_autoconfirm` não afeta o cadastro desta aplicação, porque o backend nunca
chama `signUp()`: ele usa `admin.createUser({ email_confirm: false })` e manda recuperação. O flag
governa o fluxo de signup por e-mail direto, que aqui não existe. Ainda assim o `config push` o
alteraria, então o arquivo passa a declarar o valor de produção, e não o default do scaffolding.

**O que continua sem leitura possível:** `site_url`, `additional_redirect_urls`, `jwt_expiry`,
`otp_expiry`, `minimum_password_length`, `max_frequency` e o HTML dos templates. O endpoint público
não os expõe e o CLI não tem `config pull` nem `config diff`, apenas `push`. A Management API os
devolveria, mas exige um token pessoal que não está no ambiente. Esses ficam para conferência visual
no painel, tarefa do usuário, antes do primeiro push.

### 6. O passo manual não desaparece, ele muda de natureza
Antes: clicar em três lugares do painel, sem rastro em lugar nenhum.

Depois: um comando, `supabase config push`, revisável em diff antes de rodar. Continua sendo escrita
na configuração de produção, então continua sendo deliberado e humano. Esta spec não automatiza o
push em CI.

---

## Fluxo depois desta spec

```
1. back   resetPasswordForEmail(email, { redirectTo: FRONTEND_URL + '/definir-senha' })
2. GoTrue valida o redirectTo contra additional_redirect_urls
3. GoTrue renderiza recovery.html com {{ .RedirectTo }} = o valor do passo 1
4. user   recebe link para <front>/definir-senha?token_hash=...&type=recovery
5. front  lê o token da query, limpa da barra de endereço, POST /auth/password
6. back   verifyOtp + updateUser
```

O passo 2 é o que torna a allow-list obrigatória: fora dela, o GoTrue descarta o `redirectTo` e
`{{ .RedirectTo }}` cai de volta no Site URL, reproduzindo o bug com o fix aplicado.

---

## Valores finais

**Site URL** (campo único, recebe o de produção):
```
https://edu.lenoborges.com.br
```

**Redirect URLs** (as duas, uma por ambiente):
```
https://edu.lenoborges.com.br/definir-senha
http://localhost:4200/definir-senha
```

O domínio de produção do front foi confirmado na Vercel: projeto `edu-lenoborges-com-br`, URL de
produção `https://edu.lenoborges.com.br`. O backend responde em `https://api-lenoborges.vercel.app`.

---

## Fora de escopo
- Automatizar `supabase config push` em CI ou em hook de deploy.
- Separar projetos Supabase por ambiente. Resolveria o conflito de Site URL pela raiz, mas é mudança
  de infraestrutura, custo e migração de dados. Se um dia acontecer, esta spec fica mais simples, não
  obsoleta.
- SMTP próprio. Enquanto o envio for pelo SMTP compartilhado do Supabase, o limite real de e-mails é
  o dele, e `auth.rate_limit.email_sent` só tem efeito com SMTP configurado.
- Qualquer alteração em `profiles`, `waitlist_entries` ou migration.
- Mudar o fluxo de cadastro. O desenho da 005 continua: o `token_hash` é a credencial, a senha é o
  resultado.

---

## Pendências para o usuário
1. **Rodar o `supabase config push`.** É o único passo que escreve em produção e fica com o usuário.
2. **Confirmar o `FRONTEND_URL` de produção.** A variável existe no projeto `api-lenoborges` da
   Vercel, mas está marcada como Sensitive: o valor não é legível nem por `vercel env pull`. Se não
   for exatamente `https://edu.lenoborges.com.br`, o `redirectTo` sai errado e nada disso funciona.
3. **Conferir no painel, antes do primeiro push**, as chaves marcadas como "conferir" no inventário
   da decisão 4.
