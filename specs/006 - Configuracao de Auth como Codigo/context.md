> **DEPRECATED em 2026-08-16 pela [spec 007](../007%20-%20Firestore%20e%20Firebase%20Auth/context.md).**
>
> Esta spec configura um servico que saiu do projeto. O `config.toml`, o `recovery.html` e o
> `[remotes.main]` foram removidos do repositorio.
>
> **O diagnostico continua valendo, e e ele que justifica a spec 007.** O merge do PR #18 provou que
> o `[remotes]` consertou o que prometia: o passo Configure passou a rodar, e falhou com um 400 do
> Management API dizendo que projeto free tier com o provedor de e-mail embutido nao aceita
> modificacao de template. Restricao de plano, nao de mecanismo, e sem contorno por codigo.
>
> O objetivo desta spec -- fazer o token chegar na query string -- acabou atingido de lado: o link
> do Firebase leva `oobCode` na query. So que para uma tela do Google, nao para uma pagina nossa,
> entao o trabalho daqui nao foi reaproveitado. Fica o aprendizado, nao o codigo.

---

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

### 6. O merge na `main` é o push. Não existe passo manual.
Esta decisão substitui o que a spec dizia antes, que o passo final seria rodar `supabase config push`
à mão. Está errado neste repositório.

`supabase branches list` mostra que o **branching via GitHub está ligado**, com a branch git `main`
apontando para o próprio projeto de produção (`yymyasazpwsmdmpuasjx`, `is_default: true`):

```json
{"name":"main","project_ref":"yymyasazpwsmdmpuasjx","parent_project_ref":"yymyasazpwsmdmpuasjx",
 "is_default":true,"git_branch":"main"}
```

E a [doc de branching](https://supabase.com/docs/guides/deployment/branching) descreve, no deploy
disparado pelo merge, um passo **Configure** que "updates service configurations based on your
`config.toml` file", disponível justamente para branching via GitHub.

Ou seja: **merge na `main` aplica este `config.toml` em produção, sem ninguém digitar comando
nenhum.** O `supabase config push` continua existindo como saída manual, mas aqui ele é redundante e,
se rodado fora de hora, aplica um estado que ainda não foi revisado em PR.

> **Correção, 2026-08-16.** A conclusão acima está certa; o mecanismo, incompleto — e o pedaço que
> faltava é o que fez o primeiro merge não aplicar nada. O passo Configure procura no `config.toml`
> um bloco `[remotes.*]` cujo `project_id` seja o ref do projeto alvo, e **pula a configuração
> inteira, em silêncio, quando não acha**. Branching ligado e branch mapeada não bastam: sem o
> `[remotes]`, o merge só leva migrations, edge functions e storage buckets. O bloco foi adicionado
> no fim do arquivo. Ver `fix.md`.

Duas consequências que reorganizam a Fase 05:

1. **O ponto de decisão é o merge do PR, não um comando depois dele.** É ali que a revisão precisa
   acontecer, porque é ali que produção muda. A Fase 01 Task 03, a conferência do painel, deixa de
   ser recomendação e vira pré-requisito de merge.
2. **A `dev` é segura.** Só a `main` está mapeada como branch do Supabase, então PR e merge em `dev`
   não tocam em produção. Dá para integrar e revisar à vontade antes.

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

---

## Resultado da aplicação (2026-08-15)

Merge do PR #12 (`dev` para `main`) aplicado. O check **Supabase Preview** fechou `success` no commit
`5246a83` da `main`, que é o passo de deploy da integração, o mesmo que roda o Configure com este
`config.toml`. No front, PR #9 mergeado, só documentação.

Conferido depois do merge, pelo `GET /auth/v1/settings`:

> **Correção, 2026-08-16.** A tabela abaixo lê estado pré-existente como efeito de pipeline, e a
> conclusão sobre o `mailer_autoconfirm` está errada. **O campo nunca mudou:** era `false` antes do
> merge do PR #12, continuou `false` depois, e continuava `false` na conferência feita durante a spec
> 007. A divergência da decisão 5 não foi fechada por merge nenhum — ela coincidiu.
>
> É o mesmo erro que o `fix.md` desta spec identificou na evidência 1, cometido uma segunda vez, no
> mesmo documento, poucos parágrafos depois: **"o valor certo está lá" não prova "o pipeline
> escreveu o valor"** quando o valor já estava certo antes. Fica registrado, e não apagado, porque
> repetir o mesmo erro de leitura sabendo dele é o dado mais útil que esta spec produziu.
>
> O que de fato aconteceu naquele merge está no `fix.md`: o passo Configure foi pulado em silêncio,
> por falta do bloco `[remotes]`. Nada foi aplicado.

| Campo | Valor | Leitura |
|---|---|---|
| `mailer_autoconfirm` | `false` | ~~Confere com `enable_confirmations = true`. A divergência da decisão 5 foi fechada sem virar efeito colateral.~~ Ver a correção acima: o campo nunca mudou. |
| `disable_signup` | `false` | Inalterado |
| `external.email` | `true` | Inalterado |

**O que essa conferência não prova.** O endpoint público não expõe `site_url`,
`additional_redirect_urls` nem o template, que são justamente as chaves que motivaram a spec. A
prova real é a Fase 05 Task 04: um cadastro novo, com e-mail que ainda não existe no projeto,
conferindo se o link recebido aponta para `https://edu.lenoborges.com.br/definir-senha`. Links
enviados antes deste merge carregam a URL antiga e não servem.

**Riscos aceitos pelo usuário no momento do merge**, registrados por serem dispensas conscientes e
não esquecimentos: as duas conferências de painel da Fase 05 (o `FRONTEND_URL` de produção, marcado
como Sensitive na Vercel, e o `jwt_expiry` / `otp_expiry`, que o merge sobrescreveu com `3600`) não
foram feitas. A justificativa foi que o projeto não tem usuários e é de teste, e que o ajuste manual
sai depois se preciso.
