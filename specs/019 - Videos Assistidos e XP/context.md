# Spec 019: Vídeos Assistidos, XP e o Cartão do Membro

## Objetivo
A trilha tem treze insígnias e uma lista de vídeos dentro de cada uma. O membro abre a insígnia, assiste,
volta na semana seguinte — e **a tela não lembra de nada**. Não existe uma marca de onde ele parou, e a
única coisa que o produto sabe sobre o avanço de alguém é o `grade`, que é levantado à mão e conta
insígnias inteiras, nunca vídeos.

Esta spec dá ao membro três coisas que hoje não existem:

| O quê | Onde |
|---|---|
| Marcar um vídeo como visto, à mão, num check abaixo do player | Tela da insígnia |
| Um número que cresce a cada vídeo assistido — 10 XP por vídeo | Painel, acima do contador de insígnias |
| Ver quem é a pessoa que perguntou no Mural | Cartão do membro, ao clicar no nome |

E dá ao membro uma coisa que o cartão obriga a existir: **um interruptor que decide se as redes sociais
dele ficam visíveis para os outros**.

O par desta spec no front é a **019**, e as duas entram juntas.

---

## Numeração
Os números são iguais nos dois repositórios: 017 é Respostas em Retrato, 018 é Termos e Privacidade, 019
é esta. No front não existe 006 nem 007, e aqui não existe 008 — a divergência é antiga e não muda nada.

---

## Dependência de ordem
Esta spec pressupõe a **009** (a trilha e `badge_videos`), a **010** (o Mural e o `authorUid` na
pergunta) e a **013** (`linkedin` e `instagram` no perfil). Nenhuma fase depende da 018, mas o
`LegalAcceptanceGuard` passa a valer nas rotas novas sem nenhuma linha a mais — e é assim que tem de ser
(decisão 14).

---

## Decisões

### 1. O check é do membro, e o produto não tenta adivinhar
A marcação é manual: um check abaixo do iframe, que o membro clica quando quiser. **Não existe detecção
de progresso do player** — sem IFrame API, sem `onStateChange`, sem "assistiu 90%".

A tentação é grande porque a API do YouTube está a um script de distância, e a razão de recusar é que ela
troca uma afirmação do membro por um palpite nosso:

- **O palpite erra dos dois lados.** Quem assiste em 2× no app do YouTube não dispara evento nenhum aqui;
  quem deixa a aba aberta enquanto almoça dispara o vídeo inteiro. Os dois casos produzem um número que o
  membro sabe estar errado — e o número é o produto inteiro desta spec.
- **Carregar a API do YouTube é carregar um script de terceiro que observa o membro**, e a spec 018 acabou
  de escrever, na cláusula 8 da Política, que este produto não faz rastreio entre sites. Um script de
  medição dentro do player é exatamente o parágrafo que passaria a ser mentira.
- **Marcar à mão é uma decisão, e decisão gera comprometimento.** É a mesma razão pela qual o Mural pede
  que a pessoa escolha uma pergunta por semana em vez de aceitar trinta.

O preço está aceito e declarado: dá para marcar sem assistir. Não é fraude contra ninguém — o XP não
desbloqueia conteúdo, não muda tier e não avança insígnia (decisão 12). Quem mente aqui mente para si
mesmo, num número que só ele usa.

### 2. O XP é definitivo, e por isso o registro é um razão, não um estado
Desmarcar um vídeo tira o check e **não tira o XP**. Foi o que ficou decidido, e a consequência decide o
modelo inteiro: **se desmarcar apagasse o registro, remarcar concederia 10 XP de novo**, e o farm seria um
duplo clique repetido — sem bug, sem exploração, usando a tela exatamente como ela foi desenhada.

Então o documento não é apagado nunca. Ele guarda dois fatos diferentes:

```
profiles/{uid}/watched_videos/{videoId}
  badgeId:        string       ← a insígnia, para não haver quem parta o id em pedaços
  watched:        boolean      ← o check de agora. Muda quantas vezes o membro quiser
  firstWatchedAt: Timestamp    ← IMUTÁVEL. É o fato que concedeu os 10 XP, uma vez, para sempre
  updatedAt:      Timestamp
```

`watched` é o interruptor da tela. `firstWatchedAt` é o razão: **existe documento ⇒ o XP daquele vídeo já
foi pago**, e nenhum caminho do código o reescreve. A propriedade que sai daí é a que importa:

> **XP = 10 × (número de documentos em `watched_videos`).** Sempre. Independente de quantos estão
> marcados agora.

Isso é o que separa este desenho de um contador solto. Um campo `xp` que só sabe somar não tem como ser
conferido: se ele divergir — por uma escrita repetida, por um retry, por um bug de qualquer natureza —
**não existe pergunta que revele a divergência**, porque não há nada com que comparar. Aqui existe, é uma
contagem, e a Task 12 a transforma em teste.

### 3. O `xp` no perfil é denormalizado, e nasce com `?? 0`
O número aparece no painel a cada carregamento e no cartão de cada membro que alguém abrir. Contar a
subcoleção nessas horas seria uma leitura por documento, toda vez, para responder uma multiplicação.

Então `profiles/{uid}` ganha `xp: number`, escrito com `FieldValue.increment(10)` **no mesmo `WriteBatch`
do `create()`** do documento do razão. Um lote, e não duas escritas: o `create()` falha inteiro com
`ALREADY_EXISTS` quando o vídeo já foi marcado alguma vez, e **a falha do lote é o que impede o
incremento**. É a atomicidade fazendo o trabalho da trava — sem transação, sem leitura prévia, sem janela
entre conferir e escrever.

> `xp` no converter leva **`?? 0`**. Documento antigo não tem o campo — e são todos, no dia em que isto
> sobe. Sem o fallback o valor chega `undefined`, `undefined + 10` é `NaN`, e o painel passa a exibir
> `NaN XP` para a base inteira. Quarta vez que este produto escreve esta linha, depois de
> `tier ?? 'dev-tier'`, `emailOptOut ?? false` e `legalAcceptances ?? {}`.

### 4. Uma rota só, idempotente, e ela devolve o XP novo
`PUT /me/watched-videos/:videoId`, corpo `{ watched: boolean }`, resposta `200 { videoId, watched, xp }`.

**`PUT` e não `POST`/`DELETE`:** a operação é "deixe este vídeo neste estado", e ela é idempotente por
natureza. Marcar duas vezes é marcar; desmarcar o que não estava marcado é não fazer nada. Um par
`POST`/`DELETE` teria dois caminhos de escrita para a mesma regra de XP, e o segundo é sempre o que
esquece o razão.

**A resposta devolve o `xp`** porque quem marca está na tela da insígnia e o número mora no painel. Sem
ele, atualizar o selo exigiria um `GET /me` a cada check — ou, pior, o front somaria 10 sozinho, que é a
decisão 7 sendo violada no lugar mais fácil de não notar: a soma local acerta no primeiro clique e erra no
vídeo remarcado, que não paga XP nenhum.

### 5. O vídeo precisa existir antes de o XP ser pago
`videoId` chega na URL, é escolhido pelo cliente, e **XP é moeda**. Uma rota que cunha moeda a partir de
uma string do cliente cunha a partir de qualquer string: `PUT /me/watched-videos/qualquer-coisa-1`,
repetido com sufixos diferentes, é XP infinito sem tocar em nenhum vídeo.

Então a primeira marcação lê `badge_videos/{videoId}` e responde `404` se não achar. É **uma leitura por
caminho, só no primeiro check de cada vídeo** — quando o documento do razão já existe, não há XP a pagar e
a conferência não acontece.

E é por isso que a marcação também grava `badgeId`: ele vem do vídeo lido, não de um `split` no id. O id é
`{badgeId}__{youtubeId}` hoje (spec 009), e quem partir a string aqui assina que ele será sempre assim.

### 6. A lista de vídeos passa a dizer o que já foi visto, e sem consulta nenhuma
`GET /badges/:badgeId/videos` ganha `watched: boolean` em cada item.

O jeito óbvio seria `where('badgeId','==',badgeId)` na subcoleção do membro. O jeito escolhido é um
**`getAll` nos caminhos exatos dos vídeos que a resposta já vai listar** —
`profiles/{uid}/watched_videos/{id}`, um por vídeo da página.

São as mesmas N leituras, e três diferenças:

1. **Nenhum índice, nem automático.** É leitura por caminho, do começo ao fim, como tudo neste produto.
2. **Não devolve lixo.** A consulta traria registros de vídeos removidos da insígnia; o `getAll` só
   pergunta pelo que está na tela.
3. **O custo é proporcional ao que se mostra**, e não ao que a pessoa já assistiu naquela insígnia.

Vídeo sem documento é `watched: false`. Não existe "não sei".

### 7. O 10 é do backend, e o front nunca multiplica
`XP_PER_VIDEO = 10` mora em `src/track/track.constants.ts`, ao lado de `BADGE_IDS`. O front recebe `xp`
pronto, em toda resposta que o carrega, e **não conhece o número 10**.

É a mesma regra da `orientation` da spec 017 e da `phase` do Mural: o servidor afirma, a tela obedece. O
dia em que um vídeo valer 20, ou em que a insígnia final valer o dobro, nada no front muda — e nada no
front precisa ser encontrado.

### 8. O cartão do membro é uma rota nova, e ela devolve pouco de propósito
`GET /members/:uid`, com `FirebaseAuthGuard`, devolve exatamente isto:

```
{ id, name, bio, grade, xp, linkedin, instagram }
```

**O que não está aí é a decisão.** Sem e-mail, sem telefone, sem `tier`, sem `role`, sem `completedAt`,
sem `emailOptOut`, sem data de entrada. A regra que fica escrita no DTO e vale para sempre:

> **Campo novo no perfil não entra neste DTO por padrão.** Ele entra se alguém decidir que é público, e a
> decisão é escrita aqui. O `PublicMemberDto` não estende `ProfileDto`, não reusa mapeador e não é montado
> por espalhamento de objeto — os três atalhos que fazem o campo seguinte vazar sem ninguém ter escolhido.

`GET /admin/users/:uid` (spec 015) continua existindo, continua devolvendo tudo e continua atrás do
`AdminGuard`. **São duas rotas com propósitos opostos**, e fundi-las com um `if (role === 'admin')` seria
transformar a diferença entre "o que a comunidade vê" e "o que a operação vê" num ramo dentro de uma
função — o lugar exato onde ela é apagada por engano.

**Exige sessão, e não é pública.** Ler o cartão é ler o perfil de outra pessoa; a landing não precisa
disso, e uma rota pública com `uid` na URL é uma base de nomes e bios enumerável por quem tiver a lista de
uids.

**`404` quando o perfil não existe ou o onboarding não terminou.** Perfil sem `completedAt` é uma conta
pela metade, sem nome e sem bio — um cartão dela seria um cartão vazio, e responder `200` com nada é pior
do que responder que não há.

### 9. As redes sociais nascem invisíveis
`profiles/{uid}` ganha `socialLinksPublic: boolean`, com **`?? false`** no converter, e o
`GET /members/:uid` devolve `linkedin: null, instagram: null` quando ele é falso.

O padrão é `false` e a razão é curta: **quem preencheu o LinkedIn antes desta spec o preencheu num
formulário onde ninguém, além da administração, podia vê-lo.** Publicar esses links para toda a comunidade
no dia do deploy é divulgar um vínculo — este membro é aquela conta — que nenhuma dessas pessoas foi
chamada a autorizar. É a mesma regra da spec 018: o produto não descobre por conta própria o que alguém
teria consentido.

O preço está declarado e é real: **no dia do lançamento, todo cartão abre sem redes**, e o recurso parece
morto. A mitigação está no front (decisão 6 da 019 de lá): o interruptor não mora numa aba de Privacidade
distante — ele fica encostado nos próprios campos de LinkedIn e Instagram, de modo que qualquer pessoa que
abra Meu Perfil para mexer nos links o encontra sem procurar. Ver o ponto em aberto 2.

O `?? false` aqui é o oposto do `?? false` do `emailOptOut`: lá o fallback errado esconderia a base
inteira de um disparo; aqui o fallback errado **publicaria** a base inteira. Os dois falham em silêncio, e
por isso os dois têm teste-trava.

### 10. O interruptor não esconde nada do admin, e isso é dito em voz alta
`GET /admin/users/:uid` continua devolvendo `linkedin` e `instagram` independentemente do interruptor.

Fazer o contrário seria criar a aparência de uma garantia que não existe: o administrador deste produto lê
o telefone, o e-mail e a bio de todo mundo, escreve e-mail direto para qualquer um (spec 015) e tem o
console do Firebase. Um campo escondido dele seria teatro — e teatro de privacidade é pior que ausência de
privacidade, porque alguém confia nele.

O rótulo do interruptor, no front, diz o que ele faz de verdade: **visível para os outros membros**. Não
"privado".

### 11. `authorUid` entra no DTO do Mural, e é `null` quando a pergunta é anônima
O cartão abre pelo nome do autor, e o nome é uma string. Para pedir `GET /members/:uid` é preciso o uid, e
hoje ele não sai daqui.

Ele passa a sair. **O uid não é segredo neste produto** — é o caminho de `profiles/{uid}`, é metade do id
de toda pergunta do Mural (`{weekId}__{uid}`) e já viaja em toda sessão. O que protege o dado não é
esconder o identificador, é o `GET /members/:uid` devolver só o que é público (decisão 8).

**E ele é `null` quando o autor é o anônimo.** A spec 013 troca `authorUid` por `ANONYMOUS_AUTHOR_UID` ao
excluir a conta, e a pergunta continua no Mural. Mandar aquele valor sentinela para o front obrigaria a
tela a conhecê-lo e compará-lo — e a primeira comparação errada abre um cartão que responde `404` em cima
de uma pergunta de alguém que pediu para ser esquecido. **`null` é o front não precisar saber que existe
um sentinela.**

### 12. XP não destrava nada, e essa é a única coisa que o torna seguro
O XP não muda `tier`, não avança `grade`, não libera vídeo e não abre insígnia. Ele conta, e só.

`tier` é acesso, `grade` é conquista, e a spec 010 já escreveu que **os dois não se derivam um do outro em
nenhuma direção**. `xp` é o terceiro eixo, e a regra vale igual: derivar acesso de XP tornaria a decisão 1
— marcar à mão, sem verificar nada — uma porta para o conteúdo pago, e a marcação manual deixaria de ser
uma escolha honesta para virar um formulário de auto-serviço.

O dia em que XP valer alguma coisa é o dia em que a decisão 1 precisa ser revista antes, e não depois.

### 13. Excluir a conta apaga `watched_videos`
Quarta vez que este produto esbarra em **subcoleção não some com o pai no Firestore**: votos do Mural
(spec 013), `notification_reads` (spec 012), `legal_acceptances` (spec 018), agora esta.

Ela entra no **passo 4** da ordem de exclusão, junto das outras duas, antes de `profiles/{uid}`. É
histórico de comportamento ligado a um `uid` — a pessoa pediu para ser esquecida, e o que ela assistiu vai
junto.

### 14. Nenhuma isenção nova no guard de aceite, e nenhum índice composto
As três rotas novas são autenticadas e comuns: passam pelo `FirebaseAuthGuard` e pelo
`LegalAcceptanceGuard` como qualquer outra. **Nada aqui é exceção** — quem não aceitou os termos não marca
vídeo, não ganha XP e não abre cartão de ninguém, e nenhuma linha precisou ser escrita para isso ser
verdade. É o desenho da spec 018 pagando por si.

Tudo é leitura por caminho. Este produto tem quatro índices compostos, todos anteriores a esta spec, e a
tabela do `README.md` **não ganha linha**.

---

## Endpoints

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `PUT` | `/me/watched-videos/:videoId` | `{ watched: boolean }` | `200` `{ videoId, watched, xp }` |
| `GET` | `/members/:uid` | — | `200` `PublicMemberDto` |
| `PATCH` | `/me/privacy` | `{ socialLinksPublic: boolean }` | `204` |
| `GET` | `/badges/:badgeId/videos` | — | `200`, agora com `watched` em cada item |
| `GET` | `/me` | — | `200`, agora com `xp` e `socialLinksPublic` |

Throttle: `PUT /me/watched-videos/:videoId` em `60/min` — marcar seis vídeos seguidos ao terminar uma
insígnia é uso normal, e o limite existe contra script. `PATCH /me/privacy` em `10/min`. Os `GET` herdam o
padrão global.

### Erros

| Situação | Status | Corpo |
|---|---|---|
| `videoId` inexistente, na primeira marcação | `404` | `Vídeo não encontrado.` |
| Marcar o que já está marcado | `200` | idempotente, `firstWatchedAt` **não** muda, `xp` **não** sobe |
| Desmarcar e marcar de novo | `200` | idempotente, sem XP novo — é a decisão 2 |
| `uid` sem perfil, ou com onboarding incompleto | `404` | `Membro não encontrado.` |

---

## Modelo

```
profiles/{uid}
  ...campos de sempre
  xp: number                        ← novo, ?? 0
  socialLinksPublic: boolean        ← novo, ?? false

profiles/{uid}/watched_videos/{videoId}     ← nova subcoleção
  badgeId: string
  watched: boolean
  firstWatchedAt: Timestamp         ← imutável: é o que pagou os 10 XP
  updatedAt: Timestamp
```

`videoId` é o id do vídeo da trilha, `{badgeId}__{youtubeId}` — sem barra, seguro como caminho de
documento, e é a garantia de unicidade de sempre.

Nenhuma coleção nova de primeiro nível. Nenhum índice.

---

## Fora de escopo

- **Detecção automática de progresso do player.** Decisão 1, e ela é definitiva enquanto a Política de
  Privacidade disser o que diz.
- **XP por qualquer outra coisa.** Nem por pergunta no Mural, nem por voto, nem por insígnia, nem por
  tempo de casa. O XP tem uma fonte só, e uma fonte só é o que torna a decisão 2 verificável.
- **Ranking, placar ou comparação entre membros.** O XP aparece no próprio painel e no cartão de quem for
  aberto. Uma lista ordenada muda o produto de "acompanhe seu avanço" para "compare-se", e essa é uma
  decisão de produto, não uma tela.
- **Retomar o vídeo de onde parou.** Exigiria guardar posição, que exige o player instrumentado.
- **`xp` no detalhe do membro para a administração** (spec 015). É uma linha e é útil, e fica de fora
  porque esta spec já mexe em duas telas e três rotas. Entra quando alguém precisar.
- **`xp` na resposta de sessão.** O número chega no `GET /me`, que o painel já faz ao montar. Pôr o campo
  também na sessão seria uma segunda fonte para o mesmo valor, e elas divergem no primeiro check dado
  antes do refresh.
- **Insígnia concedida automaticamente ao marcar todos os vídeos.** É a decisão 12: `grade` continua sendo
  conquista levantada à mão.

---

## Specs afetadas

### Spec 009 (Trilha) — vigente, estendida
`GET /badges/:badgeId/videos` ganha um campo e passa a depender do `uid` da sessão para respondê-lo. O
guard já estava lá; o que muda é que a resposta deixa de ser igual para todo mundo — e a Task 09 escreve o
teste que garante que o `watched` de um membro nunca aparece na resposta de outro.

### Spec 010 (Mural) — vigente, estendida
`MuralQuestionDto` ganha `authorUid: string | null`. Nenhuma regra de fase, voto ou rollover muda.

### Spec 013 (Meu Perfil) — vigente, estendida
Ganha `socialLinksPublic` no perfil e uma linha na ordem de exclusão (decisão 13). A condição da decisão 7
daquela spec continua verdadeira: a subcoleção nova guarda `uid` no caminho, nenhum dado pessoal no corpo,
e morre com o perfil.

### Spec 015 (Encontrar um Membro) — vigente, e deliberadamente não fundida
`GET /admin/users/:uid` não muda. A decisão 8 explica por que a rota nova é outra rota, e a decisão 10 por
que o interruptor não a afeta.

### Spec 017 (Respostas em Retrato) — vigente
O check entra **abaixo do iframe**, embaixo do mesmo `video__frame` retrato ou paisagem. A `orientation`
continua vindo do servidor e continua não sendo derivada de `kind`.

### Spec 018 (Termos e Privacidade) — vigente, e o texto **precisa ser conferido**
A Política de Privacidade diz, na cláusula 2, que coletamos "vídeos abertos, progresso na trilha" — o que
esta spec faz cabe nessa frase, e nenhuma cláusula descreve mecanismo que não exista (decisão 10 da 018).

**Mas a cláusula 3 diz "exibir seu nome e sua pergunta no mural para os demais membros", e o cartão exibe
mais que isso**: bio e, quando o interruptor estiver ligado, redes sociais. Ver o ponto em aberto 1 — **se
o texto precisar de uma frase, ela muda a versão e o `contentHash`, e a base inteira aceita de novo.** É a
decisão que precisa ser tomada antes do deploy, e não depois.

---

## Pontos em aberto

1. **A Política pode precisar de uma frase, e ela custa um novo aceite de todo mundo.** O cartão exibe bio
   e redes de um membro para outro; a cláusula 3 fala só de nome e pergunta. Duas saídas: alargar aquela
   linha para "nome, biografia e, se você permitir, suas redes", com bump de versão e novo aceite; ou
   tratar o interruptor da decisão 9 como o consentimento e alargar só quanto à bio. **Nenhuma das duas é
   decisão de engenharia**, e as duas precisam sair antes desta spec subir — republicar duas semanas
   depois faz a base aceitar duas vezes, que é o que o ponto em aberto 2 da spec 018 já pedia para evitar.
2. **`socialLinksPublic` nasce `false` e o recurso parece morto no lançamento.** Todo cartão abre sem
   redes até alguém entrar em Meu Perfil e ligar o interruptor. A alternativa — nascer `true` — publica um
   vínculo que ninguém autorizou, e por isso não foi escolhida. Se a adoção não acontecer sozinha, a saída
   é um convite explícito (um e-mail da spec 014, uma linha no painel), e **não** trocar o padrão depois:
   trocar o padrão publica retroativamente exatamente as pessoas que não responderam.
3. **Não existe caminho para reconciliar `xp` com o razão.** A decisão 2 torna a divergência *detectável*
   — a contagem existe —, mas ninguém a conta em produção. Um script de conferência, ou um
   `GET /admin/users/:uid` que traga os dois números, é a próxima linha de defesa, e ela só vale a pena no
   dia em que houver suspeita.
4. **O check some para quem tem duas abas abertas.** Marcar na aba A não atualiza a aba B, e a B ainda
   mostra o vídeo desmarcado e o XP antigo. É o comportamento de todo o resto do produto e não vale um
   canal de tempo real; está escrito aqui para não ser descoberto como bug.
5. **Vídeo removido da insígnia deixa o XP pago.** O documento do razão fica, o `getAll` não o pergunta
   mais, e o número não desce. É a leitura certa de "definitivo" — a pessoa assistiu —, e é também a única
   forma de o admin não conseguir tirar XP de ninguém apagando um vídeo.
