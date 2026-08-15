# Fix: o link chega com sessão no fragmento, e não com `token_hash` na query

Aberto em 2026-08-15, depois da verificação da Fase 05 Task 04.

## Sintoma

Cadastro real disparado, e-mail recebido. O link levou para o domínio certo, mas a página exibiu
**"Link incompleto ou ausente"** (`definir-senha.page.html:14`, estado `invalid_link`).

A URL recebida, com os tokens truncados:

```
https://edu.lenoborges.com.br/definir-senha#access_token=eyJhbGciOiJFUzI1NiIsImtpZCI6...
&expires_at=1786840923&expires_in=3600&refresh_token=qj4d...&sb=&token_type=bearer&type=recovery
```

> **Higiene:** essa URL foi colada num chat com `access_token` e `refresh_token` vivos. O access
> token expira em uma hora, mas o refresh token não expira sozinho. Revogar pela sessão
> (`session_id` está no payload do JWT) ou por um logout da conta.

## O que o sintoma já prova

Não é especulação, sai da leitura direta da URL:

1. **A URL configuration aplicou.** O domínio é `edu.lenoborges.com.br` e não `127.0.0.1:3000`, e o
   `redirect_to` que o backend passou foi **aceito** pelo GoTrue, o que só acontece se ele estiver na
   `additional_redirect_urls`. As Fases 02 e 03, na parte de URL, funcionaram.
2. **O template não aplicou.** O formato recebido (`access_token` + `refresh_token` +
   `token_type=bearer` no fragmento) é exatamente o que o `{{ .ConfirmationURL }}` **padrão** produz:
   o link vai para `/auth/v1/verify`, o GoTrue verifica o OTP no servidor, cria a sessão e redireciona
   com ela no fragmento. Nosso `recovery.html` produziria `?token_hash=...` na query.
3. **O front agiu como projetado.** `definir-senha.page.ts:66-70` recusa `access_token` de propósito,
   com o motivo escrito no comentário: mandá-lo como `tokenHash` faz o `verifyOtp` do backend falhar,
   e aceitá-lo trocaria um "link inválido" honesto por um erro confuso lá na frente. A tela de link
   incompleto é a resposta correta para essa URL.
4. **O token de recuperação já foi gasto.** O `/auth/v1/verify` consumiu o OTP antes do
   redirecionamento. Não existe `token_hash` a recuperar dessa URL: ele não foi omitido, ele já foi
   usado.

## Causas possíveis

Ordenadas por quanto a evidência sustenta cada uma.

### A. O passo Configure não aplica `content_path` em projeto hospedado
**A mais provável.** A [doc de customizing email templates](https://supabase.com/docs/guides/local-development/customizing-email-templates)
afirma que `content_path` vale para desenvolvimento local e self-hosted, e que projeto hospedado
exige o painel.

A favor: bate com a evidência 1 contra a 2. As chaves de URL da seção `[auth]` foram aplicadas, o
template não. Isso é exatamente o recorte que essa causa prevê.

Contra: **é a mesma página que afirma que `supabase config push` não existe**, e ela está errada
nisso, como a decisão 1 do `context.md` registra. Uma página que erra sobre o comando pode estar
desatualizada sobre o alcance dele também. Não dá para tratar como fato sem confirmar no painel.

### B. Erro de sintaxe no template, com fallback silencioso
A [doc de troubleshooting](https://supabase.com/docs/guides/troubleshooting/email-template-not-updating)
descreve o comportamento: template com sintaxe inválida faz o GoTrue usar um fallback válido, sem
mostrar nenhuma customização e sem erro visível para quem envia.

A favor: produz exatamente o sintoma observado, template padrão no lugar do nosso.

Contra: o `recovery.html` só usa `{{ .RedirectTo }}` e `{{ .TokenHash }}`, ambos documentados. Mas o
arquivo abre com um comentário HTML longo que **cita essas mesmas expressões no texto**, e comentário
HTML não protege nada do parser de template do Go: aquilo é parseado como ação de template igual ao
resto. Vale suspeitar do comentário antes de suspeitar do corpo.

**Como confirmar:** Auth Logs, procurando `templatemailer_template_body_parse_error`.

### C. `content_path` resolvido a partir de outro diretório
O valor está como `./supabase/templates/recovery.html`, copiado do exemplo da doc do config.

A favor: **o próprio `config.toml` deste repo se contradiz.** O exemplo comentado do `invite` usa
`./supabase/templates/invite.html`, e o da notificação de senha alterada, poucas linhas abaixo, usa
`./templates/password_changed_notification.html`. Um dos dois está errado, e não sabemos qual.

Se o caminho não resolver, o resultado é template ausente, que cai no padrão. Mesmo sintoma.

### D. O painel nunca teve o template da spec 005
A Task 01 da Fase 01 da spec 005 está marcada `[x]`, com o formato `{{ .SiteURL }}/definir-senha`.

Se ele estivesse mesmo lá, o link de hoje teria vindo como
`https://edu.lenoborges.com.br/definir-senha?token_hash=...`, na query, já que o `site_url` agora
está certo. Veio no formato padrão. Ou seja: **ou o painel está no template default desde sempre, ou
alguma coisa o reverteu.** As duas hipóteses mudam o que precisa ser feito.

### E. Propagação
Menos provável, porque a mudança de URL do mesmo push já estava valendo quando o e-mail saiu. Mas
não custa refazer o teste antes de mexer em qualquer coisa.

## Como distinguir, em ordem

1. **Auth Logs**, procurando `templatemailer_template_body_parse_error`. Se aparecer, é **B**, e o
   conserto é no arquivo.
2. **Painel > Authentication > Email Templates > Reset Password.** Se o HTML de lá for o nosso, a
   causa é **B** ou **E**. Se for o default do Supabase, é **A**, **C** ou **D**, e o Configure
   simplesmente não escreveu o template.
3. Se for **A/C/D**, testar o `content_path` alternativo (`./templates/recovery.html`) num
   `supabase config push` avulso e conferir se o painel muda. Isso separa **C** de **A**.

## Objetivo da correção

Que o e-mail chegue com **`token_hash` na query**, preservando o contrato da spec 005: o front nunca
fala com o Supabase, só repassa o token para o backend, que faz `verifyOtp` e grava a senha.

O objetivo **não** é fazer a tela aceitar a URL que chegou hoje.

## Caminhos

### 1. Fazer o template valer (preferido)
Mantém o contrato e o desenho das duas specs. O que muda conforme a causa:

- **B ou C:** conserto de arquivo, dentro do fluxo normal de PR. Se for o comentário, ele sai ou vira
  texto sem chaves.
- **A ou D:** o template passa a ser o único item de configuração que não sobrevive no repositório.
  Nesse caso, ou se cola o HTML no painel e se documenta a exceção com franqueza no README e na
  decisão 1 do `context.md`, ou se usa a Management API (`mailer_templates_recovery_content`) num
  passo próprio. A segunda opção preserva a promessa de config como código, ao custo de precisar de
  um token pessoal.

### 2. Aceitar o fluxo padrão (alternativo, com custo alto)
Front lê `access_token` do fragmento e manda para um endpoint novo, que troca a senha usando aquela
sessão em vez de `verifyOtp`.

Contras, todos registrados para não parecer atalho barato: contradiz a decisão da spec 005 de o front
nunca receber material de sessão do Supabase; coloca um access token no fragmento, portanto no
histórico do navegador; exige endpoint novo e muda o contrato do `POST /auth/password`; e obriga a
página a distinguir dois formatos de link para sempre.

Só vale se o caminho 1 se provar impossível, o que hoje não está demonstrado.

## O que não fazer

**Não aceitar `access_token` como `tokenHash`.** O comentário em `definir-senha.page.ts:66-70` já
explica: o `verifyOtp` do backend falha com ele, e a mudança trocaria um erro honesto e imediato por
um erro confuso e tardio. Além disso, como a evidência 4 mostra, o token de recuperação daquela URL
já foi consumido pelo `/verify`.
