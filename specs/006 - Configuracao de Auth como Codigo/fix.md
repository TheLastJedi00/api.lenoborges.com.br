# Fix: o link chega com sessão no fragmento, e não com `token_hash` na query

Aberto em 2026-08-15, depois da verificação da Fase 05 Task 04.
**Resolvido em 2026-08-16.** A causa não era nenhuma das cinco listadas abaixo. Ela está na
[seção de diagnóstico](#diagnóstico-2026-08-16), no fim do documento; o que vem antes ficou como
estava, porque o erro de leitura da evidência 1 é a parte instrutiva.

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

---

## Diagnóstico (2026-08-16)

### A evidência 1 estava errada, e ela sustentava tudo

A pergunta inteira acima é "por que o template não aplicou, se a URL aplicou". A resposta é que **a
URL também não aplicou**. Ela já estava certa no painel, escrita à mão na spec 005, antes de qualquer
`config.toml` existir. O `edu.lenoborges.com.br` no link não prova que o merge escreveu nada: prova
só que alguém, algum dia, digitou aquilo no painel.

O recorte que parecia estranho — uma seção aplicando pela metade — nunca existiu. **Nada da seção
`[auth]` foi aplicado. O passo Configure não rodou.**

### Por que ele não rodou

A [doc de configuração do branching](https://supabase.com/docs/guides/deployment/branching/configuration)
tem a frase, sobre o merge em persistent branch:

> If no remote is declared or the project ID is incorrect, the configuration step is skipped.

O `config.toml` deste repo não declarava nenhum bloco `[remotes.*]`. O código do CLI confirma o
mecanismo: `GetRemoteByProjectRef` varre `c.Remotes` procurando um `project_id` igual ao ref do
projeto alvo e devolve `no remote found for project_id` quando não acha. Sem esse casamento, não há
config a aplicar, e o passo termina em silêncio — sem erro, sem log de mudança, sem nada que
aparecesse no e-mail que chegou.

O casamento é **por `project_id`**, não pelo nome do bloco nem pela branch git. Nomear o bloco de
`main` não teria bastado sozinho; o que faltava era o ref.

### As cinco causas, resolvidas

- **A. Hospedado não aceita `content_path`** — **falsa.** O `config push` monta e envia
  `mailer_templates_recovery_content` no PATCH de `/v1/projects/{ref}/config/auth`
  (`config-sync/auth.sync.ts`), e lê o HTML do disco antes disso
  (`config-sync.auth-email-content.ts`). Template como código funciona em projeto hospedado. A doc de
  customizing email templates está desatualizada nisto também, exatamente como a decisão 1 do
  `context.md` já tinha flagrado sobre o comando.
- **B. Sintaxe inválida com fallback** — **falsa,** e por dois motivos independentes. Primeiro, as
  expressões citadas no comentário são ações válidas sobre um `map`, e chave ausente em map não é
  erro de parse nem de execução no Go. Segundo, o `html/template` **remove comentários HTML da
  saída**. Nunca houve `templatemailer_template_body_parse_error` a encontrar.
  *Corrigido mesmo assim:* o comentário virou `{{/* ... */}}`. O ponto que a suspeita acertou é real
  — comentário HTML não protege nada do parser, as ações lá dentro são avaliadas de verdade —, e
  deixar expressões vivas num trecho que é só prosa é armadilha esperando data.
- **C. `content_path` resolvido de outro diretório** — **falsa.** O loader resolve caminho relativo a
  partir da raiz do projeto (o pai de `supabase/`), então `./supabase/templates/recovery.html` está
  certo. E arquivo faltando **estoura** (`Invalid config for auth.email.template.recovery.content_path`),
  não cai em fallback silencioso: essa causa nunca poderia produzir este sintoma.
  A contradição no `config.toml` é real, mas é do scaffolding: só as *notifications* têm o fallback
  legado relativo a `supabase/`, e o exemplo do `password_changed_notification` reflete isso.
- **D. O painel nunca teve o template da 005** — **verdadeira, e sem mistério.** Nada nunca escreveu
  template nenhum no painel: nem a 005, nem o merge da 006. Não houve reversão.
- **E. Propagação** — **falsa.** Não havia o que propagar.

### O conserto

`[remotes.main]` com `project_id = "yymyasazpwsmdmpuasjx"` no `config.toml`. Sem nada aninhado: o
bloco existe para ligar o passo Configure neste ref, e a config base já é a de produção.

É o **caminho 1** da seção acima, na variante mais barata — o contrato da spec 005 fica intacto, o
front continua sem falar com o Supabase, e o template continua versionado. O caminho 2 não chega a
ser considerado.

### O que isso custa admitir

A decisão 6 do `context.md` — "o merge na `main` é o push, não existe passo manual" — estava certa na
conclusão e errada no mecanismo, e a parte errada é a que importava: o merge só aplica config se o
`[remotes]` casar. Ela foi corrigida lá, não reescrita.

E a lição que sobra é sobre a evidência 1, não sobre o Supabase: **"o valor certo chegou" não prova
"o pipeline escreveu o valor"** quando o valor já estava certo antes. Um estado pré-existente e
correto é indistinguível de um pipeline funcionando, e foi exatamente essa ambiguidade que mandou a
investigação atrás do template por um dia.

### O que ainda não está provado

Que o Configure agora aplica. Isso só se verifica depois do merge na `main`, com o painel em
Authentication > Email Templates > Reset Password mostrando o nosso HTML, e um cadastro real
chegando com `?token_hash=` na query. Até lá, este conserto é uma hipótese bem sustentada, não um
fato observado.

Se depois do merge o painel continuar no default, o próximo passo é `supabase config push` avulso —
que sabemos que envia o template — para separar "o `[remotes]` não bastou" de "o Configure não
aplica templates".
