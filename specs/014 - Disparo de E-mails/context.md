# Spec 014: Disparo de E-mails

## Objetivo
A spec 012 criou o canal de notificação do produto e o fechou dentro do painel: o aviso só existe para
quem entra. **Um aviso que depende da visita não avisa ninguém** — o vídeo novo continua sendo descoberto
por quem já estava olhando, que é exatamente o problema que a 012 dizia estar resolvendo.

Esta spec abre o primeiro canal que sai do produto e chega em quem não está com a aba aberta: o e-mail.
Ela faz duas coisas, e as duas pelo mesmo caminho de envio:

1. **Vídeo novo vira e-mail**, automaticamente, no mesmo gatilho que já escreve a notificação interna.
2. **O admin escreve um e-mail e dispara**, para todo mundo ou para um recorte por tier e por insígnia.

Com o canal vem o que canal externo obriga: remetente próprio, descadastro em um clique, bounce que se
desliga sozinho e registro do que foi enviado. Nada disso é zelo — é o que separa "e-mail entregue" de
"domínio na lista de spam do Gmail em três semanas".

O par desta spec no front é a **014**, e as duas entram juntas: o disparo manual não existe sem a tela
que escreve, e o descadastro não existe sem a página que confirma.

---

## Numeração
Os números são iguais nos dois repositórios: 012 é Notificações Internas, 013 é Meu Perfil, 014 é esta.
No front não existe 006 nem 007, e aqui não existe 008 — a divergência é antiga e não muda nada.

---

## O que dispara e-mail, e o que não dispara

| Origem | Vira e-mail? | Por quê |
|---|---|---|
| **Vídeo novo numa insígnia** | **Sim** | Evento do produto, raro e previsível: um por semana, escrito pelo admin |
| **Pergunta nova no Mural** | **Não** | Evento de membro. O volume cresce com a comunidade, não com o que é publicado |
| **Disparo manual do admin** | **Sim** | É a metade desta spec |
| Troca de e-mail, senha, verificação | Fora | Continuam sendo os e-mails que o **próprio Firebase** dispara (spec 007, decisão 3) |

A ausência da pergunta é a decisão mais importante da tabela e está justificada na decisão 5.

---

## Decisões

### 1. Resend por HTTP, atrás de um serviço só
Uma dependência (`resend`), um arquivo (`src/emails/mailer.service.ts`), e **nenhum outro lugar do
projeto conhece o provedor**. É a mesma cerca que o `FirebaseService` faz em volta do `firebase-admin`, e
ela já provou o valor quando o Supabase virou Firestore em duas classes.

SMTP foi recusado pelo ambiente: a API roda em função serverless, e conexão SMTP em serverless é o pior
caso possível — handshake por invocação, sem lote, e um disparo em massa vira N conexões abertas por uma
função que pode morrer no meio. A API HTTP tem envio em lote de 100 numa requisição, que é exatamente a
forma do problema aqui.

### 2. O remetente é do domínio próprio, e o domínio precisa estar autenticado antes do primeiro envio
`Liga Dev <comunidade@lenoborges.com.br>`, com `Reply-To` no e-mail do Leno. **SPF, DKIM e DMARC
configurados no DNS antes de qualquer disparo real**, e nunca o domínio de teste do provedor.

Isto está escrito como decisão, e não como tarefa de infra, porque é a única parte desta spec que não dá
para consertar depois: e-mail enviado de domínio não autenticado cai em spam, e uma vez que a base
aprende que o remetente é spam, os envios seguintes já nascem lá — inclusive os bons. Reputação de
domínio se constrói uma vez e se perde uma vez.

### 3. Disparo manual e disparo automático são o mesmo caminho
Os dois produzem um documento `email_campaigns/{id}` e passam pelo mesmo
`EmailCampaignService.send(campaign)`. O que muda entre eles é quem escreve o documento e o que vai
dentro dele; **o envio, o lote, o descadastro, o cabeçalho e o registro são um código só**.

Dois caminhos de envio seria o desenho óbvio — "e-mail transacional é uma coisa, campanha é outra" — e
seria a origem garantida da primeira falha grave: o caminho automático esqueceria o descadastro, porque
quem escreve gatilho não está pensando em lista. Aqui não dá para esquecer: não existe função que envie
sem passar por onde o descadastro é aplicado.

### 4. O envio é sequencial, em lotes de 100, e o progresso é gravado por lote
A audiência é montada, ordenada por `uid`, e enviada em lotes de 100 pela API de lote do provedor. Depois
de cada lote, a campanha grava `cursorUid` e `sentCount`.

O cursor é o que torna a falha recuperável. Se a função morrer no lote sete, a campanha fica
`interrompida` com o cursor no fim do lote seis, e **"Retomar" continua dali** — não do começo. A ordem
por `uid` é o que faz isso funcionar: é estável, é a mesma que o `listUsers` do Auth devolve, e não muda
entre uma tentativa e outra.

> **Um lote pode duplicar.** Se o envio do lote sete for aceito pelo provedor e a gravação do cursor
> falhar logo depois, retomar reenvia aquelas cem pessoas. Está aceito e está escrito: **duplicar um
> e-mail para cem pessoas é um incômodo; perder o envio para as outras mil é o recurso não funcionando.**
> A alternativa — um registro por destinatário — é fan-out de escrita, que a decisão 1 da spec 012
> recusou pelas mesmas razões e com mais força aqui.

### 5. Pergunta nova no Mural **não** vira e-mail
Só "vídeo novo" dispara. A pergunta continua existindo no sino, como a 012 deixou.

O volume é o argumento inteiro. Vídeo é publicado pelo produto — um por semana, e o número não muda quando
a comunidade dobra. Pergunta é escrita por membro — uma por membro por semana, e o número **é** o tamanho
da comunidade. Com cinquenta membros ativos, "pergunta nova vira e-mail" é cinquenta e-mails por semana na
caixa de cada um, e o resultado disso não é engajamento: é a regra de filtro que a pessoa cria para o
remetente, e depois disso o e-mail de vídeo também nunca mais é visto.

O sino aguenta o que a caixa de entrada não aguenta, e é essa a divisão: **o painel avisa do que é
frequente, o e-mail avisa do que é raro.**

### 6. Notificar por e-mail nunca derruba a publicação do vídeo — e agora isso custa mais caro
Vale a decisão 7 da spec 012, sem mudança: o vídeo é criado, a notificação é escrita, o e-mail sai
**depois**, fora da transação, com `catch` próprio e log. Falha de e-mail nunca vira status de erro do
`POST /admin/badges/:badgeId/videos`.

O que muda é o custo: escrever uma notificação é uma escrita e leva milissegundos; disparar e-mail para a
base inteira são N/100 requisições HTTP para fora, e o admin espera por elas. Isso é conhecido e aceito no
tamanho de hoje (decisão 15), e é o número a vigiar.

### 7. A audiência sai do Auth cruzado com os perfis, e três coisas cortam gente de fora
O Firebase Auth é quem sabe **quem existe** e qual é o e-mail; `profiles` é quem sabe **tier** e
**grade**. É a mesma junção que o `AdminUsersService.list` já faz, e ela é reusada — não reescrita.

Sai da audiência, sempre, e sem exceção configurável:

| Corte | Por quê |
|---|---|
| `disabled: true` no Auth | Conta desativada não recebe e-mail do produto |
| `emailVerified: false` | Endereço não confirmado é candidato a erro de digitação, e cada um deles é um bounce que corrói a reputação do domínio (decisão 2) |
| `emailOptOut: true` no perfil | Descadastro (decisão 8) |

E, no disparo automático, sai também **quem publicou** — a decisão 5 da spec 012 aplicada ao e-mail: o
admin não recebe o aviso do vídeo que ele mesmo acabou de publicar.

A decisão 6 da 012 — "quem entrou depois não vê o que veio antes" — **não tem equivalente aqui** e não
precisa ter: o e-mail sai no instante do evento, então não existe pilha para um membro novo herdar.

### 8. O descadastro mora no perfil, tem motivo, e vale para tudo que esta spec dispara
Três campos novos em `profiles/{uid}`: `emailOptOut`, `emailOptOutReason` e `emailOptOutAt`.

**Não existe "e-mail que ignora o descadastro"** neste código. Nem o manual, nem o automático, nem um
futuro "aviso importante". A exceção legítima — e-mail de conta, como redefinição de senha e verificação
de endereço — não passa por aqui: quem os dispara é o Firebase, por outro caminho e por outra razão
(spec 007, decisão 3). Essa separação é o que permite a regra ser absoluta sem prejudicar ninguém.

O motivo existe porque "a pessoa pediu para sair" e "o provedor recusou o endereço" são fatos diferentes
com a mesma consequência, e confundi-los apaga a informação de que existe um endereço quebrado na base.

### 9. Descadastro em um clique, sem login, com token assinado
O link do rodapé carrega `uid` e uma assinatura HMAC-SHA256 sobre ele, com segredo de ambiente. O
endpoint é **público**, não exige sessão, e o token não expira.

Exigir login para descadastrar é a prática que gera denúncia de spam: quem quer sair não vai lembrar a
senha, e o botão que ele encontra primeiro é o "marcar como spam" do próprio cliente de e-mail — que custa
reputação de domínio, ao contrário do descadastro, que não custa nada.

Junto vão os cabeçalhos `List-Unsubscribe` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, com uma
URL que aceita `POST` sem confirmação nenhuma. **Isso é requisito de remetente em massa do Gmail e do
Yahoo desde 2024**, não refinamento: sem eles a entrega degrada por política, independentemente do
conteúdo.

O token não expira porque um link de descadastro morto é pior que qualquer risco que ele carrega — e o
risco é pequeno e nomeado: quem tiver o link descadastra aquele endereço, e o dano máximo é alguém deixar
de receber e-mail que pode religar em `Meu Perfil`.

### 10. Bounce e reclamação de spam desligam o endereço sozinhos
Um webhook do provedor, com assinatura verificada, escuta dois eventos: `email.bounced` (permanente) e
`email.complained`. Os dois escrevem o mesmo descadastro da decisão 8, com o motivo correspondente.

Sem isso, um endereço morto é retentado em toda campanha, para sempre, e a taxa de bounce do remetente
sobe sozinha até o provedor limitar a conta. É o tipo de manutenção que ninguém faz à mão porque ninguém
percebe que precisa — e quando percebe, já é o problema.

**Bounce temporário não desliga nada.** Caixa cheia volta a funcionar; tratar `soft bounce` como
descadastro remove membro válido da lista por causa de uma semana de férias.

### 11. O admin escreve texto, e nunca HTML
O corpo do e-mail é **texto simples com quebras de linha**, mais um botão opcional (rótulo + URL). O
template — cabeçalho, tipografia, rodapé com o descadastro — é do código, e é o mesmo nos dois disparos.

Aceitar HTML do admin significa aceitar que um erro de marcação quebre a renderização em cinco clientes
de e-mail diferentes, e significa sanitizar entrada que vira documento enviado para fora. Texto não tem
esse problema, e a diferença visual entre um e-mail de texto bem diagramado e um HTML escrito à mão é a
favor do texto.

Todo e-mail sai com as duas partes, **HTML e texto puro**, geradas da mesma fonte. Cliente que não
renderiza HTML é minoria, mas e-mail sem alternativa em texto é sinal de spam para os filtros.

### 11-B. O template é diagramado para **não parecer diagramado** — **EM VIGOR (revogada e restabelecida em 2026-08-26)**

> **Ela foi revogada de manhã e restabelecida à tarde, e as duas datas ficam.** A revogação dizia que a
> causa da aba de Promoções era só o rastreamento do Resend (*Open Tracking* e *Click Tracking*, que
> injetam um pixel 1×1 e reescrevem todo link *depois* de o template sair do `renderEmail`). Aquilo era
> verdade e não era tudo: **com o rastreamento já desligado, o e-mail voltou a cair em Promoções**, e o
> teste com um suspeito por vez fechou a conta —
>
> | Envio de teste, mesma conta do Gmail, rastreamento desligado | Aba |
> |---|---|
> | Template diagramado (tabela, fundo, cartão, `<h1>`, botão) | **Promoções** |
> | Template limpo (só `<p>`, `<hr>`, links) | **Principal** |
>
> **Eram duas causas, e esta é a segunda.** O erro da revogação não foi a medição, foi a conclusão tirada
> dela: *"desligar o rastreamento resolveu"* virou *"o HTML nunca foi a causa"*, e essa segunda frase
> ninguém tinha medido. O template está limpo outra vez, agora **com teste-trava** em
> `email-template.spec.ts` — `style=`, `<table>`, `<img>`, `background`, `border-radius` e `padding`
> fazem a suíte falhar, e o `<h1>` com o assunto também.
>
> **As duas regras valem juntas:** o template não é a última coisa que acontece com o e-mail — entre o
> `renderEmail` e a caixa de entrada existe um provedor que pode reescrever o documento, e o painel dele
> se confere antes do código — **e** quando um suspeito cai e o sintoma fica, o próximo suspeito é o que
> ainda não foi medido isolado. Ver Fase 10 em `tasks.md` e a seção 5 do `fix-email-styles.md`.
>
> O texto original da decisão segue abaixo, e ele continua sendo o que vale.

Esta decisão nasceu de um incidente, e não do desenho: os e-mails começaram a cair na aba **Promoções** do
Gmail. O diagnóstico está em `fix-email-styles.md`, e o conserto está na Fase 08.

O template original fazia o que todo template de e-mail faz — `<table role="presentation">` para
centralizar, fundo cinza no `<body>`, cartão branco com borda arredondada, sobrescrito "LIGA DEV" no topo
e o CTA como botão sólido. Cada uma dessas peças é boa prática de e-mail **de marketing**, e juntas elas
são a assinatura que o filtro procura: e-mail que uma pessoa escreve para outra não tem tabela de layout
nem fundo colorido.

**A regra passa a ser: o HTML existe para o texto ser legível, e para mais nada.** Um `<p>` por parágrafo,
um `<hr>` antes do rodapé, e o link de descadastro. Sem imagem, sem logo, sem botão, sem segundo link.

> Isto **não afrouxa a decisão 11** — ele continua valendo inteiro: o admin escreve texto, o template é do
> código, e as duas partes saem da mesma fonte. O que muda é o que o template faz com o texto, e a direção
> é sempre para menos.

E há um limite conhecido: **se depois disto o e-mail continuar em Promoções, o problema não é mais o
HTML.** É reputação de domínio e volume, que a seção do DNS no README já descreve — e nenhuma mudança de
marcação conserta reputação.

> **Nota de 2026-08-26.** O parágrafo acima acertou a pergunta e errou a resposta — duas vezes, em
> direções opostas. O e-mail *continuou* em Promoções depois da primeira limpeza, e o problema ali não
> era reputação: era o rastreamento do provedor, que a lista de suspeitos não alcançou porque parou
> dentro do repositório. Mas desligar o rastreamento também não fechou o caso: **com ele desligado, o
> template diagramado ainda ia para Promoções e o limpo não ia**. O limite descrito acima ("se depois
> disto continuar em Promoções, o problema não é mais o HTML") só se cobra quando o HTML já está limpo
> *e* o painel já está conferido — e não antes, porque enquanto houver dois sinais ligados nenhuma
> medição isola nada.

### 12. Os filtros são tier e faixa de insígnia. **Status de pagamento não existe, e a spec não finge**
`POST /admin/emails` aceita `tiers` (lista) e `gradeMin`/`gradeMax`. Ausência dos dois significa
**todos os membros**.

Não há filtro de pagamento porque não há pagamento no produto: não existe gateway, `tier` é campo que o
admin edita à mão, e não existe estado de assinatura — nem em dia, nem atrasado, nem cancelado
(`BillingService.resolveCurrentTier` explica por quê). Inventar `paymentStatus` agora criaria um segundo
dono da verdade de acesso ao lado do `tier`, alimentado à mão pela mesma pessoa, e as duas divergiriam na
primeira semana movimentada.

Quando existir cobrança de verdade, o filtro entra — e entra derivado do gateway, não digitado.

### 13. Nenhum índice composto novo
A audiência não é consulta ao Firestore: ela é `listUsers` do Auth, página a página, cruzado com os
perfis por `getAll` de caminho. **Os filtros de tier e grade acontecem em memória**, depois da junção,
exatamente pelo motivo da decisão 12 da spec 012 — cada `where` combinado com ordenação é um índice
composto novo em produção, e a lista de índices que produção exige já cresceu duas vezes sem ninguém
perceber.

A única consulta nova é o histórico de campanhas: `orderBy('createdAt','desc').limit(20)` sobre
`email_campaigns`, ordenação por um campo só, atendida pelo índice de campo único automático. O trinco da
decisão 15 é `where('status','==','enviando').limit(1)` — filtro por um campo só, sem ordenação, e
também sem índice novo.

### 14. Prévia de audiência e envio de teste, os dois antes do disparo
`POST /admin/emails/audiencia` devolve **só a contagem** para um conjunto de filtros.
`POST /admin/emails/teste` envia o e-mail montado para o próprio admin, sem criar campanha e sem tocar em
ninguém.

Os dois existem pela mesma razão: **disparo de e-mail é a operação mais irreversível do produto**. Excluir
vídeo se republica, moderar pergunta se refaz, `grade` errado se corrige. E-mail que saiu, saiu — não há
edição, não há apagar, e o erro fica na caixa de entrada de todo mundo, com o nome do produto em cima.

A prévia devolve contagem e **não devolve a lista de e-mails**: o admin precisa saber *quantos*, e a tela
já lista os membros em `/dashboard/admin/usuarios`. Uma rota que despeja a base de e-mails a cada mudança
de filtro é um vazamento esperando um bug de autorização.

### 15. Um disparo por vez, e o teto é declarado
Antes de criar campanha, o serviço verifica se existe alguma com `status: 'enviando'`. Se existe,
responde **409** e não começa a segunda.

Dois disparos concorrentes estouram o limite de requisições do provedor, embaralham os dois cursores e,
no pior caso, mandam duas campanhas para a mesma pessoa no mesmo minuto. O trinco é uma consulta por campo
único e resolve os três de uma vez.

**O teto:** o envio é síncrono dentro da requisição. Com lote de 100 e o limite de 2 requisições por
segundo do provedor, mil membros são dez lotes e cerca de cinco segundos; dez mil são cem lotes e quase um
minuto, que é onde a função serverless morre. Está dimensionado para a comunidade de hoje — dezenas de
membros — e o sinal de que passou do ponto é a campanha começar a terminar `interrompida` com frequência.
**Quando isso acontecer, a saída é fila ou cron, e é outra spec** — não é um `timeout` maior.

### 16. Sem chave, o mailer loga e não envia
Sem `RESEND_API_KEY`, o `MailerService` escreve o e-mail no log e devolve sucesso. É o padrão fora de
produção, e em produção o boot exige a chave (`env.validation.ts`).

O perigo real do desenvolvimento não é o e-mail que não sai: é o e-mail que sai. Uma máquina de
desenvolvimento apontada para o Firestore de produção, um teste rodando o gatilho de vídeo, e a base
inteira recebe. O padrão precisa ser inofensivo, e ligar precisa ser um ato deliberado.

### 17. A campanha é o registro, e o registro é o histórico
`email_campaigns/{id}` guarda assunto, corpo, filtros, contagens, status, cursor e erro. Não é log: é o
único lugar onde fica escrito **o que foi enviado, para quantos e quando**.

Ao contrário da notificação interna, que a decisão 4 da 012 deixou sem histórico de propósito, aqui o
histórico é obrigatório — e a diferença é que notificação não lida some sem consequência, enquanto e-mail
enviado é um fato que existe fora do produto e sobre o qual alguém vai perguntar.

O id da campanha de vídeo é **`video__{badgeId}__{youtubeId}`**, com `create()`: é a regra da casa de
novo, e aqui ela impede que um `POST` repetido por retry de rede mande o mesmo anúncio duas vezes para a
base inteira. O `ALREADY_EXISTS` é engolido em silêncio, como na spec 012.

---

## Endpoints

| Método | Rota | Guard | O que faz |
|---|---|---|---|
| `POST` | `/admin/emails/audiencia` | admin | Contagem da audiência para um conjunto de filtros. Só o número (decisão 14) |
| `POST` | `/admin/emails/teste` | admin | Monta e envia o e-mail para o próprio admin. Não cria campanha |
| `POST` | `/admin/emails` | admin | Cria a campanha e dispara. **409** se já houver uma enviando (decisão 15) |
| `POST` | `/admin/emails/:id/retomar` | admin | Retoma uma campanha `interrompida` a partir do `cursorUid` |
| `GET` | `/admin/emails` | admin | As 20 campanhas mais recentes, para o histórico da tela |
| `POST` | `/emails/descadastro` | **público**, token | Descadastra. Idempotente: 204 mesmo se já estava. Aceita `POST` cru, para o one-click (decisão 9) |
| `POST` | `/emails/webhook/resend` | **público**, assinatura | Bounce permanente e reclamação viram descadastro (decisão 10) |
| `PATCH` | `/me/emails` | auth | O membro liga e desliga o recebimento pelo próprio perfil |

`POST /admin/emails` responde:

```jsonc
{
  "id": "8f2c1a...",
  "status": "concluida",        // "enviando" | "concluida" | "interrompida"
  "audienceCount": 42,
  "sentCount": 42,
  "failedCount": 0
}
```

`GET /admin/emails` devolve a mesma forma, mais `subject`, `kind`, `createdAt` e `finishedAt`. **O corpo
do e-mail não volta na listagem** — é peso morto numa lista que existe para responder "o que saiu e para
quantos".

### Erros

| Situação | Resposta |
|---|---|
| Já existe campanha enviando | `409` |
| Filtros que não pegam ninguém | `400`, com a contagem zero na mensagem. Campanha para zero pessoa é sempre engano |
| Token de descadastro inválido | `204` mesmo assim. Um endpoint público que diferencia token válido de inválido é um oráculo de `uid`, e o descadastro não ganha nada com a distinção |
| Assinatura de webhook inválida | `401`, e nada é escrito |
| Campanha `concluida` recebendo `retomar` | `409` |

### Endpoints existentes que mudam

| Endpoint | O que muda |
|---|---|
| `POST /admin/badges/:badgeId/videos` | Passa a disparar a campanha de vídeo depois de criar o vídeo e a notificação. **Contrato inalterado**, e falha ao enviar não muda o status (decisão 6) |
| `GET /admin/users` | `AdminUserDto` ganha `emailOptOut` — o admin precisa ver quem não recebe, senão "não chegou" vira investigação |
| `GET /me` | Devolve `emailOptOut`, para a tela de perfil desenhar o interruptor no estado certo |

---

## Modelo

```
email_campaigns/{video__badgeId__youtubeId | auto-id}
  kind: 'video' | 'manual'
  subject: string
  body: string                  // texto puro, com quebras de linha (decisao 11)
  ctaLabel: string | null
  ctaUrl: string | null
  filters: {
    tiers: TierId[] | null      // null = todos
    gradeMin: number | null
    gradeMax: number | null
  }
  status: 'enviando' | 'concluida' | 'interrompida'
  audienceCount: number
  sentCount: number
  failedCount: number
  cursorUid: string | null      // ultimo uid do ultimo lote confirmado (decisao 4)
  createdBy: string             // uid do admin
  createdAt: Timestamp
  finishedAt: Timestamp | null
  error: string | null

profiles/{uid}                  // tres campos novos
  emailOptOut: boolean
  emailOptOutReason: 'membro' | 'bounce' | 'reclamacao' | null
  emailOptOutAt: Timestamp | null
```

`emailOptOut` ausente em documento antigo — e são todos, no dia em que esta spec sobe — precisa ser lido
como `false` no converter, com `?? false`. É a mesma armadilha do `tier ?? 'dev-tier'`, e aqui ela é pior
em silêncio: `undefined` numa comparação booleana faz a base inteira parecer descadastrada, e o primeiro
disparo sai para zero pessoa sem erro nenhum.

### Variáveis de ambiente

| Variável | Obrigatória | Para quê |
|---|---|---|
| `RESEND_API_KEY` | em produção | Sem ela o mailer loga e não envia (decisão 16) |
| `EMAIL_FROM` | sim | `Liga Dev <comunidade@lenoborges.com.br>` |
| `EMAIL_REPLY_TO` | sim | Para onde vai a resposta de quem responde ao e-mail |
| `EMAIL_UNSUBSCRIBE_SECRET` | sim | Segredo do HMAC do token de descadastro (decisão 9) |
| `RESEND_WEBHOOK_SECRET` | em produção | Verificação de assinatura do webhook (decisão 10) |

---

## Fora de escopo

- **Pergunta nova por e-mail** (decisão 5). É o gatilho que mais parece faltar e o que mais estragaria o
  canal.
- **Campanha para a lista de espera.** `waitlist_entries` guarda e-mail de gente que **não é membro** e
  que consentiu com uma coisa só: ser avisada da abertura. Usar aquela lista para campanha é o começo do
  problema de consentimento que esta spec inteira existe para evitar. A audiência aqui é `profiles`, e só.
- **Métricas de abertura e clique.** Rastrear abertura é pixel invisível na caixa de entrada de terceiros
  — dado pessoal coletado por conveniência de vaidade, num produto que não tem nada para fazer com a
  informação. Entrega e bounce, que são o que decide se o canal funciona, vêm do webhook.
- **Agendamento e recorrência.** Campanha marcada para as 9h de terça exige cron, e o produto recusou cron
  por decisão (rollover do Mural, spec 010). Entra junto com a fila da decisão 15, se entrar.
- **Modelos de e-mail salvos.** Guardar rascunho é banco de conteúdo com edição, versão e dono. Com um
  disparo manual por mês, é manutenção inventada.
- **Editor rico e anexos** (decisão 11). Anexo, além do resto, é o formato que mais derruba
  entregabilidade.
- **E-mail de boas-vindas, de onboarding incompleto e resumo semanal.** Cada um é um gatilho novo com uma
  pergunta própria de frequência. Esta spec entrega o canal; quem usa o canal vem depois.
- **Avisar o endereço antigo na troca de e-mail** (ponto em aberto 3 da spec 013). O canal passa a existir
  e aquele ponto passa a ser resolvível — mas é fluxo de segurança de conta e merece a decisão dele.
- **Preferência por tipo de e-mail.** Um interruptor, não uma tela: com dois tipos de disparo, "quero o
  vídeo mas não a campanha" é configuração que ninguém pediu e que dobra o caminho de cada envio.
- **Internacionalização e horário de envio por fuso.**

---

## Specs afetadas

### Spec 012 (Notificações Internas) — vigente, com uma linha revogada
O "Fora de escopo" de lá diz: *"**E-mail**, push do navegador e WhatsApp. Isto é notificação interna: ela
só existe com o painel aberto. **Canal externo é outra spec, com consentimento, descadastro e reputação de
domínio junto.**"* **Esta é aquela spec**, e ela trouxe as três coisas: descadastro (decisões 8 e 9),
consentimento com saída em um clique, e reputação (decisões 2, 7 e 10).

Push do navegador e WhatsApp continuam fora.

A decisão 7 de lá — notificar não derruba a operação — continua valendo e ganha um segundo caso, mais
caro (decisão 6).

### Spec 009 (Financeiro, Administração e Trilha) — vigente, estendida
Publicar vídeo passa a ter o **segundo** efeito colateral, e este sai do produto. A tela de publicar ganha
um aviso — decisão do front, e é revogação declarada da linha da 012 que dizia que a tela do admin não
mudaria: um sino que toca dentro do painel não precisa de aviso; um e-mail para a base inteira precisa.

`AdminUserDto` ganha um campo, e a Administração ganha uma quarta porta.

### Spec 013 (Meu Perfil) — vigente, estendida
O perfil ganha o interruptor de e-mail, e o "Fora de escopo" de lá — *"Preferências de notificação... a
spec 012 decidiu que dois eventos não sustentam uma tela de configuração"* — **continua valendo como está
escrito**: não há tela de preferências, há **um interruptor**, e ele existe porque canal externo obriga
saída, enquanto canal interno não obrigava.

A decisão 6 da 013 (excluir a conta) ganha um item na lista do que some: os três campos de descadastro vão
junto com o perfil. **E é aqui que aparece a única sobra:** quem excluiu a conta e tinha descadastrado sai
da base de opt-out junto. Não é problema hoje — sem perfil não há audiência, então a pessoa não recebe
nada de qualquer forma — e vira problema no dia em que existir campanha para não-membros, que é
exatamente o que o "Fora de escopo" da lista de espera proíbe.

### Spec 007 (Firestore e Firebase Auth) — vigente
`create()` nunca `set()` continua valendo, e o id da campanha de vídeo é a regra do caminho como unicidade
mais uma vez (decisão 17). Os e-mails de conta continuam sendo do Firebase, e nenhum deles passa por este
código — é o que permite o descadastro ser absoluto (decisão 8).

### Spec 010 (Mural de Perguntas) — vigente
Nada muda. A pergunta não dispara e-mail, e o motivo está na decisão 5.

---

## Pontos em aberto

1. **O envio síncrono tem prazo de validade** (decisão 15). O número que o denuncia é a frequência de
   campanhas terminando `interrompida`. Quando incomodar, a saída é fila, não `timeout` maior — e é spec
   própria, porque fila traz retentativa, ordem e observabilidade junto.
2. **Domínio novo não tem reputação, e volume súbito parece spam.** O primeiro disparo para a base inteira
   é, do ponto de vista do Gmail, um remetente desconhecido mandando centenas de mensagens de uma vez. A
   prática é aquecer — começar pequeno e subir ao longo de semanas. Com dezenas de membros isso é
   irrelevante; com centenas, deixa de ser, e ninguém vai lembrar desta linha na hora.
3. **Vídeo de insígnia trancada continua notificando quem não pode assistir.** É o ponto em aberto 2 da
   spec 012, e por e-mail ele pesa mais: dentro do painel é uma linha na lista; na caixa de entrada é o
   produto mandando propaganda de conteúdo pago para quem não paga. O filtro de tier já existe nesta spec
   para o disparo manual; **aplicá-lo ao gatilho automático é uma linha de código e uma decisão de
   produto**, e está escrita como "não" por ora.
4. **Quantas pessoas descadastram no primeiro disparo?** É o número que diz se o canal é bem-vindo ou
   tolerado, e ele só existe depois do primeiro envio. Acima de 2% em campanha para base própria, o
   problema é o conteúdo ou a frequência, não a entrega.
5. **`failedCount` conta o quê, exatamente?** Hoje conta o que o provedor recusou na hora da requisição de
   lote. Não conta bounce, que chega depois pelo webhook e não volta para a campanha. Ligar os dois
   exigiria guardar o id de cada mensagem enviada — que é o registro por destinatário que a decisão 4
   recusou.
6. **Nada apaga campanha antiga.** Uma por mês são doze documentos por ano, com o corpo do e-mail dentro.
   É irrelevante por muitos anos e fica registrado para não ser "descoberto" como desperdício depois.
