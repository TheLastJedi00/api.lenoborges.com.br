# Spec 015: Encontrar um Membro

## Objetivo
A spec 009 criou `GET /admin/users` e resolveu a pergunta "quem se cadastrou". A lista devolve uma página
do Firebase Auth por vez, na ordem que o Auth quiser, sem busca, sem filtro e sem total — e isso bastava
para uma comunidade que cabia numa tela.

Não basta mais. **O admin não abre a lista para ler a lista: ele abre para achar uma pessoa.** "Quem
travou no onboarding esta semana", "quem está no Ultra", "quem parou na quarta insígnia", "o fulano do
e-mail que respondeu ontem" — nenhuma dessas perguntas tem resposta hoje, e todas terminam no `Ctrl+F` do
navegador depois de clicar "Carregar mais" quatro vezes.

Esta spec faz três coisas:

1. **Buscar e filtrar** a base inteira — por texto, por onboarding pendente, por tier e por faixa de
   insígnia — com o total do recorte à vista.
2. **Abrir um membro** e ver o que ele preencheu sobre si: nome, telefone, bio, redes, tier, etapa, estado
   da conta e estado de recebimento de e-mail.
3. **Escrever um e-mail para aquela pessoa**, dali mesmo, pelo mesmo caminho de envio que a spec 014
   construiu para a campanha.

O par desta spec no front é a **015**, e as duas entram juntas: o recorte não existe sem os campos que o
montam, e o e-mail direto não existe sem a tela que o escreve.

---

## Numeração
Os números são iguais nos dois repositórios: 013 é Meu Perfil, 014 é Disparo de E-mails, 015 é esta.
No front não existe 006 nem 007, e aqui não existe 008 — a divergência é antiga e não muda nada.

---

## Dependência de ordem
Esta spec pressupõe a **014** no código: o e-mail direto reusa `EmailCampaignService`, `MailerService`,
`AudienceService` e a coleção `email_campaigns`, e o detalhe do membro mostra `emailOptOut`,
`emailOptOutReason` e `emailOptOutAt`, que são campos da 014. Pressupõe também a **013**, de onde vêm
`linkedin` e `instagram` no perfil.

As Fases 01 a 03 daqui (busca, filtros e detalhe) **não** dependem de nenhuma das duas e podem entrar
antes; as Fases 04 e 05 esperam a 014 subir. Está escrito na primeira linha do `tasks.md`.

---

## O problema que decide o desenho inteiro

A lista de hoje é uma página do Auth. Filtrar uma página é **filtrar errado**: com 213 membros e um filtro
de "onboarding pendente", uma página de 50 devolveria os pendentes que por acaso caíram nos primeiros 50
`uid`s, e a tela diria "3 membros" com toda a confiança do mundo. O número estaria errado, a lista estaria
incompleta, e nada na tela denunciaria.

Então ou o filtro acontece **antes** da paginação, ou ele não acontece. E isso obriga a escolher a fonte:

| Fonte | Por que não serve / serve |
|---|---|
| Consulta ao Firestore com `where` | **Não serve.** `profiles` só tem documento de quem terminou o onboarding — filtrar por "onboarding pendente" no Firestore é procurar a pessoa exatamente onde ela não está. E o Firestore não tem busca por trecho de texto: `where('name','>=',q)` é prefixo, não `contains`, e não acha "Borges" digitando "borges" nem "Leno" digitando "eno" |
| Varrer o Auth inteiro e cruzar com os perfis | **Serve**, e é o que a decisão 1 escolhe |

A segunda tem um custo, ele é conhecido, e a decisão 4 escreve o número.

---

## Decisões

### 1. A lista deixa de ser uma página do Auth e passa a ser a base inteira, recortada em memória
`GET /admin/users` passa a percorrer `listUsers` até o fim (páginas de 1000), cruzar com `profiles` por
`getAll` de caminho, e só então aplicar busca, filtros, ordenação e recorte de página.

A junção é a que o `AdminUsersService.list` já faz e a que o `AudienceService` da spec 014 faz — **é a
mesma varredura, e ela passa a ter um dono só**. Se as duas ainda estiverem duplicadas quando esta spec
entrar, é aqui que elas se encontram.

O Auth continua sendo a fonte de quem existe, pela decisão 10 da spec 009, e o motivo continua sendo o
mesmo com mais força: **quem o filtro de "onboarding pendente" procura é justamente quem não tem
documento no Firestore.** Trocar a fonte para o Firestore para ganhar `where` esconderia a pessoa que o
recurso existe para encontrar.

### 2. `pageToken` sai; `offset`, `limit` e `total` entram — e isso é quebra de contrato declarada
A resposta deixa de ter `nextPageToken` e passa a ter `total`, `offset` e `limit`.

Não é preferência de estilo. O `pageToken` é um cursor **do Auth**, e depois da decisão 1 a paginação não
é mais do Auth: é sobre uma lista já filtrada, que o Auth nunca viu. Não existe token para devolver.

O que se ganha de graça é o que faltava: **`total` é o tamanho do recorte**, e ele só existe porque a
varredura é completa. A tela de hoje não consegue dizer "213 membros" porque a fonte dela nunca soube.

O front 015 entra junto e é o único cliente desta rota. A quebra é combinada, não descoberta.

### 3. A ordem passa a ser `createdAt` decrescente
Hoje a ordem é a que o Auth devolve — por `uid`, que é opaco e não significa nada para quem lê. Passa a
ser **os mais recentes primeiro**.

É a ordem da pergunta que o admin faz mais vezes: "quem entrou esta semana". E ela só é possível agora:
ordenar a base inteira exige ter a base inteira, o que a decisão 1 passou a ter.

> **A ordem da audiência de e-mail não muda.** A decisão 4 da spec 014 ordena por `uid` porque o cursor de
> retomada depende de uma ordem **estável entre execuções**, e `createdAt` não é: um membro novo entrando
> no meio de uma campanha reposicionaria a fila. São duas ordens, com dois donos e duas razões, e
> unificá-las quebraria a retomada em silêncio.

### 4. O teto está escrito, e **não existe cache**
Cada requesição desta rota custa `N/1000` chamadas ao Auth mais `N` leituras de documento no Firestore.
Com 200 membros: uma chamada e 200 leituras. Com 5.000: cinco chamadas e 5.000 leituras, **por busca
digitada**.

Está dimensionado para a comunidade de hoje — dezenas de membros — e o sinal de que passou do ponto é a
lista demorar a responder com o admin digitando. Quando incomodar, a saída é um índice de busca ou uma
projeção mantida por escrita, e **é outra spec**.

Nenhum cache em memória entra aqui. A tentação é óbvia e o motivo da recusa também: a API roda em função
serverless, o cache seria por instância, não teria invalidação confiável, e o primeiro sintoma seria o
admin trocar um tier, recarregar a lista e ver o valor antigo — em algumas requisições, e não em outras.
**A única contenção é o atraso de digitação no front** (decisão 4 da spec 015 do front), e ela é
suficiente no tamanho de hoje.

### 5. A busca é `contains` sobre nome e e-mail, com texto normalizado
`q` é comparado contra `name` e `email` depois de **minúsculas e acentos removidos** dos dois lados. "jose"
acha "José", "BORGES" acha "Borges", e "eno" acha "Leno".

Prefixo não serve: quem procura um membro pelo sobrenome, ou pelo domínio do e-mail, digita o meio da
string. E `contains` é possível justamente porque a comparação é em memória — é a vantagem que a decisão 1
comprou com o custo da decisão 4, e não usá-la seria pagar a conta sem levar a compra.

**Telefone não entra na busca.** Não é a chave pela qual alguém procura uma pessoa, e transformar o
telefone de todo mundo em índice de busca é ampliar o uso de um dado pessoal para ganhar um caso que não
acontece.

### 6. "Onboarding pendente" é `profileCompleted === false`, e junta dois estados de propósito
São dois fatos diferentes com a mesma consequência: **não existe documento de perfil**, e **existe
documento com `completedAt` nulo**. O filtro trata os dois como um.

Para o admin a pergunta é uma só — "quem criou conta e não terminou" — e separá-los em dois filtros seria
expor detalhe de implementação numa tela de gestão. O detalhe do membro (decisão 8) mostra a diferença
para quem precisar dela; o filtro, não.

### 7. O recorte é o mesmo da audiência de e-mail, e continua sem virar disparo
Os filtros são `tiers` (lista) e `gradeMin`/`gradeMax` — **a mesma forma que `POST /admin/emails` recebe**,
reusando o `AudienceFilterDto` da spec 014 em vez de um segundo DTO com os mesmos campos e outros nomes.

Isso é coerência com efeito prático: o admin recorta a lista, olha quem é, e digita o mesmo recorte na tela
de e-mails com a certeza de que os dois números batem. Dois DTOs divergiriam na primeira vez que um dos
dois ganhasse um campo.

**E não existe rota que dispare e-mail para o recorte da lista.** A lista filtra para *olhar*; a tela de
e-mails filtra para *enviar*. Juntar as duas põe a operação mais irreversível do produto (decisão 14 da
spec 014) a um clique de um gesto de navegação, sem contagem na frente e sem teste antes.

Pelo mesmo motivo, **`POST /admin/emails` não ganha um filtro `uids`**. Uma lista de `uid`s escolhidos a
dedo é o caminho para mandar para 200 pessoas sem que a tela nunca tenha mostrado o número 200.

### 8. A lista é lista, e o detalhe é rota própria
`GET /admin/users` devolve o que se lê numa linha: identidade, estado e as duas etiquetas. **Telefone, bio,
LinkedIn, Instagram, o motivo do descadastro e a data dele saem só em `GET /admin/users/:id`.**

A regra é imposta pela API, e não pelo CSS. Uma listagem que carrega o telefone e a bio de 200 pessoas para
desenhar 200 linhas trafega dado pessoal que ninguém pediu, guarda-o no estado do navegador e o entrega ao
primeiro `console.log` de depuração. O detalhe é uma requisição a mais no clique, e o clique é raro.

### 9. `tier` volta para o `AdminUserDto` — e isto é conserto, não recurso
A spec 010 fez `PATCH /admin/users/:id` aceitar `tier`, e o `GET` nunca passou a devolvê-lo. O modelo do
front declara `tier: TierId`, a tela lê `user.tier`, e o campo chega `undefined` desde então: o seletor de
tier do editor abre vazio e o admin escolhe às cegas.

A correção entra aqui porque esta spec adiciona **filtro por tier**, e filtrar por um campo que a linha não
mostra é a definição de tela que mente. Está escrita como decisão para não passar por refatoração de
oportunidade num commit de outra coisa.

### 10. O e-mail direto é rota do usuário, e não filtro da campanha
`POST /admin/users/:id/email`, com assunto e corpo. Por dentro ele monta um documento `email_campaigns` com
`kind: 'direto'` e chama o **mesmo** `EmailCampaignService.send`.

É a decisão 3 da spec 014 aplicada pela terceira vez: *o envio, o lote, o descadastro, o cabeçalho e o
registro são um código só*. O que muda entre a campanha de vídeo, a campanha manual e este é quem escreve
o documento — nunca o caminho.

A rota é do usuário, e não da campanha, porque é sobre ele que a ação fala: quem a chama está olhando para
uma pessoa, não montando uma audiência.

### 11. `recipientUid` curto-circuita a audiência **antes** de qualquer filtro
A campanha direta grava `recipientUid`, e `filters` fica com os três campos nulos. Na spec 014, filtro nulo
significa **todos os membros**.

Escrito assim, a armadilha é evidente e é a pior desta spec: uma campanha `direto` que passe pelo caminho
normal de montagem de audiência — uma retomada, um reprocessamento, uma refatoração distraída — monta a
base inteira e manda para todo mundo o e-mail que era para uma pessoa.

Por isso a regra é de ordem, e não de conteúdo: **`buildAudience` olha `recipientUid` primeiro e devolve um
único destinatário; os filtros só são lidos quando ele é nulo.** Tem teste-trava próprio, e o comentário no
código explica o que ele impede — sem o comentário, alguém "simplifica" a função e o teste vira o chato que
quebrou.

### 12. Os três cortes valem, e o motivo volta com nome
`disabled`, `emailVerified: false` e `emailOptOut: true` cortam o destinatário do e-mail direto exatamente
como cortam da campanha (decisão 7 da spec 014). Não há exceção para "é só uma pessoa".

O que muda é a resposta: em vez do `400` de audiência zero, a rota devolve **`422` com o motivo nomeado**
(`desativado`, `email-nao-verificado`, `descadastrado`). A tela precisa dizer *por que* não dá, e uma
mensagem em prosa a obrigaria a fazer análise de texto para decidir o que escrever.

O front já desabilita o botão pelo que veio no detalhe (decisão 15 do front). O `422` é a segunda linha,
para o caso de o estado ter mudado entre abrir o detalhe e clicar.

### 13. O e-mail direto **não** ignora o descadastro, e a conversa pessoal tem outro caminho
A decisão 8 da spec 014 é absoluta e continua absoluta: *não existe "e-mail que ignora o descadastro" neste
código*. Nem o de vídeo, nem a campanha, nem este.

Parece severo — "é uma mensagem pessoal para uma pessoa" — e é a leitura errada do que esta rota é. Ela
manda um e-mail **com o remetente, o template e o rodapé do produto**, do endereço da comunidade. Quem
pediu para não receber e-mail do produto pediu para não receber isto. A conversa pessoal existe e tem
caminho: o endereço do membro está no detalhe, e o cliente de e-mail do Leno não passa por aqui.

Pelo mesmo motivo, **o rodapé de descadastro vai neste e-mail também**. Não há caminho no template que
gere e-mail sem ele (Fase 01, Task 05 da spec 014), e isso está certo.

### 14. O trinco de "um disparo por vez" vale aqui também
Se houver campanha com `status: 'enviando'`, `POST /admin/users/:id/email` responde **409**, como
`POST /admin/emails` (decisão 15 da spec 014).

É um incômodo real e aceito: o admin que dispara para a base e lembra de escrever para uma pessoa espera
os poucos segundos do envio. Abrir exceção significaria uma segunda porta para o provedor no mesmo
instante, e o trinco existe para não haver duas.

### 15. O e-mail direto é registro, no mesmo histórico e sem `where`
`kind: 'direto'` grava `recipientUid` e `recipientLabel` — nome ou e-mail **no instante do envio**,
denormalizado como o `authorName` do Mural, porque a conta pode mudar de nome ou deixar de existir e a
linha do histórico precisa continuar legível.

Ele aparece no mesmo `GET /admin/emails` das campanhas. Separar em duas listas exigiria
`where('kind','==',...)` combinado com `orderBy('createdAt')`, que é **índice composto novo em produção** —
exatamente o que a decisão 13 da spec 014 recusou e o que o `CLAUDE.md` registra como a lista que já cresceu
duas vezes sem ninguém perceber.

A consequência é conhecida: com muitos e-mails diretos, eles afogam as campanhas nas 20 linhas do
histórico. É o ponto em aberto 3, com o número que o denuncia.

### 16. Nenhum índice composto novo
Vale a pena escrever de novo, porque é a suposição padrão de toda spec ("spec nova, índice novo") e porque
aqui ela é falsa em todas as rotas:

| Rota | Por que não precisa |
|---|---|
| `GET /admin/users` | Não é consulta: é `listUsers` do Auth mais `getAll` por caminho, e todo o recorte é em memória (decisão 1) |
| `GET /admin/users/:id` | Leitura por caminho, `profiles/{uid}` |
| `POST /admin/users/:id/email` | Escreve uma campanha e lê o trinco, que é `where('status','==','enviando')` — campo único, sem ordenação, já existente |

**A tabela de índices do `README.md` não muda**, e o commit diz isso.

### 17. Desativar, excluir e promover continuam fora
O detalhe é leitura, mais as duas edições que a spec 009 e a 010 já criaram (`grade` e `tier`), mais o
e-mail. Nada mais.

Promover a admin continua sendo `npm run admin:grant`, pelo motivo da spec 009: não existe endpoint que crie
administrador. Excluir conta de terceiros continua fora pela decisão 11 da spec 013 — *um
`DELETE /admin/users/{id}` acessível por engano* é a operação que essa decisão descreve e recusa. E
desativar não entra de carona numa spec de busca: é ação de moderação, com pergunta própria sobre o que
acontece com a sessão viva de quem foi desativado.

---

## Endpoints

| Método | Rota | Guard | O que faz |
|---|---|---|---|
| `GET` | `/admin/users` | admin | A base inteira, recortada por busca e filtros, paginada por `offset` |
| `GET` | `/admin/users/:id` | admin | Um membro inteiro: perfil, acesso, estado de e-mail e datas |
| `POST` | `/admin/users/:id/email` | admin | Escreve e envia um e-mail para aquele membro. Cria campanha `kind: 'direto'` |
| `PATCH` | `/admin/users/:id` | admin | **Inalterado.** Continua aceitando `grade` e `tier`, e continua exigindo requisições separadas |

### `GET /admin/users`

| Query | Padrão | O que é |
|---|---|---|
| `q` | — | Trecho de nome ou e-mail, sem acento e sem caixa (decisão 5) |
| `onboarding` | — | `pendente` ou `concluido`. Ausente = os dois (decisão 6) |
| `tiers` | — | Lista de `TierId`. Ausente = todos |
| `gradeMin` / `gradeMax` | — | Faixa de etapas concluídas, 0 a 13 |
| `limit` | 50 | Entre 1 e 200 |
| `offset` | 0 | Deslocamento dentro do recorte |

```jsonc
{
  "users": [
    {
      "id": "9b1deb4d…",
      "email": "membro@email.com",
      "emailVerified": true,
      "disabled": false,
      "role": null,
      "createdAt": "2026-08-18T09:00:00.000Z",
      "lastSignInAt": "2026-08-24T10:30:00.000Z",
      "name": "Leno Borges",
      "grade": 4,
      "tier": "great-dev-tier",   // decisao 9: existia no PATCH e faltava aqui
      "profileCompleted": true,
      "emailOptOut": false
    }
  ],
  "total": 213,   // tamanho do RECORTE, nao da base
  "offset": 0,
  "limit": 50
}
```

**`phone` sai da listagem** (decisão 8). Ele estava lá desde a spec 009 e passa a viver só no detalhe — é a
segunda quebra de contrato desta spec, e ela é intencional.

### `GET /admin/users/:id`

Tudo da linha, mais:

```jsonc
{
  "phone": "47999990000",
  "bio": "…",
  "linkedin": "https://linkedin.com/in/…",   // spec 013
  "instagram": "https://instagram.com/…",    // spec 013
  "emailOptOut": true,
  "emailOptOutReason": "bounce",             // 'membro' | 'bounce' | 'reclamacao'
  "emailOptOutAt": "2026-08-20T12:00:00.000Z",
  "waitlistEntryId": "membro@email.com",
  "profileCreatedAt": "2026-08-18T09:02:00.000Z",
  "profileUpdatedAt": "2026-08-24T11:00:00.000Z",
  "canReceiveEmail": true,
  "cannotReceiveReason": null   // 'desativado' | 'email-nao-verificado' | 'descadastrado'
}
```

`canReceiveEmail` é **derivado dos mesmos três cortes** da decisão 12, calculado no mesmo lugar que a
audiência usa. Duas implementações da mesma pergunta é como a tela passa a dizer que dá para enviar
enquanto o envio responde 422.

Usuário sem documento de perfil devolve `200` com os campos de perfil nulos — **não `404`**. Ele existe, e é
justamente quem o filtro de onboarding pendente encontra; um `404` aqui faria a tela dizer "não existe"
sobre a pessoa que ela acabou de listar.

### `POST /admin/users/:id/email`

```jsonc
// corpo
{ "subject": "Sobre a sua dúvida no Mural", "body": "Oi, Leno.\n\nVi sua pergunta…" }

// resposta 201
{ "id": "8f2c1a…", "status": "concluida", "sentCount": 1 }
```

Sem botão de ação (`ctaLabel`/`ctaUrl`) e sem HTML: o corpo é texto puro com quebras de linha, pela decisão
11 da spec 014. Um recado para uma pessoa não precisa de botão, e o único que existiria seria "clique aqui".

### Erros

| Situação | Resposta |
|---|---|
| `uid` que não existe no Auth | `404` |
| Membro desativado, sem e-mail verificado, ou descadastrado | `422`, com `reason` nomeado (decisão 12) |
| Já existe campanha `enviando` | `409` (decisão 14) |
| `gradeMin` maior que `gradeMax` | `400`. É engano de digitação, e um recorte vazio silencioso esconderia isso |
| `limit` acima de 200 | Fixado em 200, sem erro. É paginação, não pedido de dados |

---

## Modelo

Nenhuma coleção nova. Nenhuma subcoleção nova. Nenhum campo novo em `profiles`.

```
email_campaigns/{id}
  kind: 'video' | 'manual' | 'direto'   ← 'direto' e novo
  recipientUid: string | null           ← novo. Preenchido so em 'direto'
  recipientLabel: string | null         ← novo. Nome ou e-mail no instante do envio (decisao 15)
```

`recipientUid` ausente em documento de campanha antiga precisa ser lido como `null` no converter, com
`?? null`. É a mesma armadilha do `tier ?? 'dev-tier'` e do `emailOptOut ?? false`, e aqui ela é a mais
perigosa das três: `undefined` em `recipientUid` faz uma campanha direta antiga parecer campanha de base, e
a decisão 11 deixa de proteger exatamente o caso que ela existe para proteger.

### Variáveis de ambiente
Nenhuma nova. O e-mail direto usa as cinco da spec 014.

---

## Fora de escopo

- **Desativar, excluir ou promover membro pelo painel** (decisão 17). Cada uma é uma pergunta própria, e
  duas delas já foram recusadas com argumento em specs anteriores.
- **Disparar campanha para o recorte da lista** (decisão 7). É a integração mais óbvia entre esta spec e a
  014, e é a que tira a contagem e o teste do caminho de uma ação irreversível.
- **Histórico de e-mails por membro.** "O que já mandei para essa pessoa" é uma pergunta boa, e é barata:
  `where('recipientUid','==',uid)` é campo único, atendido pelo índice automático, com a ordenação em
  memória sobre poucos documentos. **Não entra por escopo, e não por custo** — está escrito aqui para que a
  próxima spec saiba que o campo já existe e que o índice não é problema.
- **Exportar a lista em CSV.** É um arquivo com dado pessoal da base inteira saindo do produto por um
  clique, e o que se faz com esse arquivo depois é a pergunta que a spec 013 já mandou para uma spec
  própria, no "Exportar meus dados".
- **Ver e moderar as perguntas do membro a partir do detalhe.** A moderação mora no Mural, tem tela e tem
  spec (010). Um segundo lugar de moderar é um segundo lugar de errar.
- **Notas do admin sobre um membro** ("conversei com ele em março"). É um CRM, e um CRM tem dono, data,
  edição e uma pergunta sobre o que a pessoa pode ler a respeito de si.
- **Ordenar por outra coisa que não `createdAt`.** Ordenação escolhida pelo usuário é um seletor a mais numa
  tela que acabou de ganhar cinco controles, para responder uma pergunta que a busca já responde melhor.
- **Filtro por "quem não recebe e-mail".** O selo está na linha e o recorte não foi pedido. Se for, é uma
  linha no mesmo lugar dos outros filtros.
- **Registro de acesso do admin aos dados de um membro.** Auditoria de leitura é infraestrutura própria, e o
  produto tem um administrador.

---

## Specs afetadas

### Spec 009 (Financeiro, Administração e Trilha) — vigente, com o contrato da lista alterado
A decisão 10 de lá — *o Auth é a fonte de quem existe, e paginar pelo Firestore esconderia quem não tem
perfil* — **continua valendo e é a razão da decisão 1 daqui**. O que muda é a paginação: `pageToken` sai,
`offset`/`total` entram (decisão 2), e `phone` sai da listagem (decisão 8).

O `PATCH /admin/users/:id` não muda em nada. As duas edições continuam separadas, em requisições separadas,
pelo motivo que aquela spec e a 010 escreveram: `tier` é acesso, `grade` é conquista, e um PATCH com os
dois faz uma edição de acesso escrever o progresso junto.

### Spec 010 (Mural de Perguntas) — vigente, com um esquecimento consertado
Ela fez o `PATCH` aceitar `tier` e não fez o `GET` devolvê-lo. A decisão 9 conserta, e o conserto entra
aqui porque é aqui que o campo passa a ser filtrável.

### Spec 013 (Meu Perfil) — vigente, com uma fronteira nomeada
`linkedin` e `instagram` aparecem no detalhe do membro para o **admin**, e isso **não é** o "perfil público
de membro" que a decisão 13 de lá adiou. Aquela decisão é sobre exposição de rede social **entre membros**,
e continua adiada e intacta: não existe `/dashboard/perfil/:id`, não existe lista de membros para o aluno, e
nada nesta spec é visto por quem não é administrador.

A decisão 11 de lá — nada de `DELETE /admin/users/{id}` — continua valendo (decisão 17).

### Spec 014 (Disparo de E-mails) — vigente, estendida
Ganha um terceiro `kind` e um terceiro produtor de campanha, e **nenhum caminho de envio novo** (decisão 3
de lá, aplicada de novo). A decisão 8 — descadastro absoluto — vale inclusive para o e-mail direto, e a
decisão 13 daqui explica por que isso não é excesso.

O `AudienceService` ganha o curto-circuito da decisão 11, que é a única mudança de comportamento dentro de
código daquela spec.

A decisão 13 de lá (nenhum índice composto novo) **continua verdadeira depois desta spec**, e a decisão 16
daqui lista rota por rota por quê.

### Spec 007 (Firestore e Firebase Auth) — vigente
`create()` nunca `set()` continua valendo para a campanha direta. Ela usa auto-id, e não caminho como
unicidade, porque **duas mensagens diferentes para a mesma pessoa são dois fatos**, e não um repetido — ao
contrário do anúncio de vídeo, cujo id composto existe para impedir o segundo.

---

## Pontos em aberto

1. **A varredura completa tem prazo de validade** (decisão 4). O número que a denuncia é o tempo de resposta
   da lista com o admin digitando. Quando incomodar, a saída é uma projeção mantida por escrita ou um índice
   de busca — e é spec própria, porque as duas trazem sincronização e a pergunta do que fazer quando ela
   atrasa.
2. **A busca é `contains` simples, e não erra bonito.** "Jose Borges" não acha quem está cadastrado como
   "José da Silva Borges" por causa do espaço no meio, e nenhum erro de digitação é tolerado. Quebrar `q` em
   palavras e exigir todas resolveria a maior parte disso em três linhas; está fora por ora porque o
   primeiro uso real é que vai dizer se o caso acontece.
3. **E-mails diretos afogam o histórico de campanhas** (decisão 15). Vinte linhas, e cada recado ocupa uma.
   O número que denuncia é o histórico da tela de e-mails deixar de mostrar a última campanha de vídeo.
   Quando acontecer, o conserto é o filtro por `kind` — e o preço é um índice composto novo, que precisa ser
   decidido e escrito na tabela do README, e não descoberto em produção.
4. **O membro descadastrado por bounce não sabe, e agora o admin sabe.** É o ponto em aberto 3 da spec 014
   do front, e esta spec resolve metade dele: o motivo e a data aparecem no detalhe. A outra metade — alguém
   avisar a pessoa de que o endereço está quebrado — continua sem dono, e agora tem de onde partir.
5. **`total` é do recorte, e a tela precisa dizer isso.** Um número grande sozinho na tela é lido como "o
   tamanho da comunidade". Com filtro aplicado, ele não é — e a responsabilidade de escrever a diferença é do
   front (decisão 6 de lá).
6. **Nada apaga campanha direta antiga.** Vale o ponto em aberto 6 da spec 014, com um agravante de volume:
   recado é mais frequente que campanha, e cada um guarda o texto enviado. Continua irrelevante por muitos
   anos, e continua registrado para não ser "descoberto" como desperdício depois.
