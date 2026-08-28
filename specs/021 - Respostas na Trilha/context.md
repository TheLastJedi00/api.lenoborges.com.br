# Spec 021: Respostas na Trilha

> **Alteração de escopo durante a execução (2026-08-28).** O campo `tab` no
> `CreateBadgeVideoDto` estava escrito na Fase 03, Task 01, e foi **antecipado para a Fase 02,
> Task 02**: a regra do 400 lê `dto.tab`, e sem o campo declarado no DTO a fase não compila. O
> conteúdo é o mesmo — `@IsOptional() @IsIn([...])` e a descrição de Swagger com as três frases —,
> só mudou de fase. A Task 01 da Fase 03 fica como conferência.

## Objetivo
Uma resposta hoje tem **um lugar só**: a aba Perguntas Frequentes da insígnia. Foi a decisão certa da spec
010 — aula se assiste em ordem, resposta se consulta por assunto, e misturar as duas deixaria a trilha com
respostas avulsas no meio da sequência.

Mas nem toda resposta é consulta. Algumas respondem exatamente a dúvida que a aula seguinte pressupõe, e o
lugar delas é **dentro da sequência**, entre a aula que abre a dúvida e a que depende dela resolvida. Hoje
essa resposta ou fica numa aba que ninguém abre no meio de uma trilha, ou não existe.

Esta spec dá ao admin a escolha, **uma vez, na publicação**: um vídeo de resposta entra na aba de respostas,
como sempre, ou entra na trilha e é posicionado com as setas como qualquer aula.

O par desta spec no front é a **021**, e é lá que está o motivo visual — na trilha a resposta **não desenha
um player**: desenha a pergunta com um botão "Ver a resposta", e o vídeo abre num modal. Aqui embaixo está
só o que decide **em qual lista o vídeo vive**.

---

## Numeração
Os números são iguais nos dois repositórios, com a exceção conhecida da 008 (Liga Dev, só no front). 019 é
Vídeos Assistidos e XP, 020 é A Tela de Senha e o oobCode, 021 é esta.

**Esta spec depende da 009, da 010 e da 017 estarem de pé** — `BadgeVideoRepository`, `order` renormalizado
em lote, `kind`, `questionId` e a foto da pergunta. Nada aqui nasce do zero; tudo é emenda em lugares que já
existem.

---

## O problema, com nome

`kind` faz **duas coisas** hoje, e até esta spec ninguém precisou separá-las:

1. **A natureza do vídeo.** Resposta tem pergunta, tem balão, é Short, sai em `retrato`. Aula não tem nada
   disso.
2. **A lista em que ele vive.** `listByBadge(kind)` filtra a aba, `order` é renormalizado dentro de
   `(badgeId, kind)`, e o `PATCH .../order` valida a lista contra os vídeos de um `kind`.

Enquanto as duas andaram juntas, um campo bastou. Esta spec as separa: uma resposta posicionada na trilha
**continua sendo resposta** — continua com a pergunta fotografada, continua em retrato, continua abrindo o
balão — e **passa a viver na lista das aulas**.

A tentação é resolver isso com um booleano (`naTrilha`) e uma consulta que devolva `kind == 'aula'` **ou**
`naTrilha == true`. Ela perde na primeira linha do Firestore: uma disjunção com `orderBy` custa índice novo
e plano imprevisível, e o que se ganha é um campo com nome pior. Ver a decisão 1.

---

## Decisões

### 1. O campo novo é `tab`, e ele é a lista — não um booleano
`tab: 'aula' | 'resposta'` entra na `BadgeVideo` ao lado de `kind`. **`kind` é a natureza, `tab` é o
endereço.** Toda aula tem `tab: 'aula'`; uma resposta tem `tab: 'resposta'` por padrão, e `tab: 'aula'`
quando o admin marcou o toggle.

Três consequências, e as três são o motivo da escolha:

- **A consulta não muda de forma.** `where('badgeId').where('tab').orderBy('order')` é a consulta de hoje
  com outro nome de campo. Um booleano exigiria `Filter.or`, e uma disjunção ordenada no Firestore é índice
  novo, plano imprevisível e uma classe inteira de erro que hoje não existe aqui.
- **A ordem continua sendo 0..n-1 dentro de uma lista, e as listas continuam disjuntas.** Um vídeo está numa
  lista ou na outra, nunca nas duas — então a renormalização em lote da spec 009 continua correta trocando
  `kind` por `tab`, e não ganha um caso especial.
- **O nome diz o que é.** `naTrilha: false` num vídeo que está na trilha de respostas é a frase que confunde
  a próxima pessoa. `tab` responde a única pergunta que o código faz: em qual lista este vídeo aparece.

### 2. O padrão é o comportamento de hoje, e ele mora no converter
`tab: data.tab ?? data.kind ?? 'aula'`.

Nenhum documento no banco tem `tab` no dia em que isto sobe, e **nenhum precisa ganhar**: um vídeo antigo lê
`tab` igual ao `kind` dele, que é exatamente onde ele estava. Sem script de migração, sem janela em que
metade da base está num formato e metade no outro, e sem o risco maior — um `undefined` chegando ao
`where('tab', '==', 'aula')`, que devolve **lista vazia com 200**: a trilha inteira some sem ninguém ter
apagado nada.

É a mesma armadilha que o `kind: data.kind ?? 'aula'` da spec 010 evitou, e a terceira vez que este
repositório a encontra. Ela tem teste-trava.

### 3. A aba de destino é escolhida na publicação, e só nela
Sem `PATCH` para mover um vídeo de lista depois. O toggle existe no formulário, uma vez, e o conserto de um
erro é remover e republicar — dois cliques, num fluxo que acontece uma vez por vídeo.

Mover depois **não é uma linha**: é renormalizar duas listas na mesma transação, com o vídeo saindo do meio
de uma e entrando no fim da outra, mais uma tela no painel para acionar isso. É uma spec inteira, e ela só
se paga quando existir a primeira reclamação de quem publicou no lugar errado. Está registrado como ponto em
aberto, não como dívida escondida.

### 4. Aula não pode viver na aba de respostas, e isso é 400
`kind: 'aula'` com `tab: 'resposta'` é o terceiro estado incoerente da família que a spec 017 abriu —
resposta sem pergunta e aula com pergunta são os outros dois. A aba de respostas é a lista das perguntas
respondidas; uma aula ali é um vídeo sem balão numa lista de balões.

O caminho contrário é o que a spec inteira existe para permitir, e não valida nada: `kind: 'resposta'` com
`tab: 'aula'` é o toggle ligado.

Sem `tab` no corpo, o servidor deriva `tab = kind`. **O cliente que não conhece esta spec continua
funcionando sem enviar nada**, e é isso que permite subir a API antes do front.

### 5. `orientation` não muda, e é o que torna o modal necessário
Uma resposta continua saindo em `retrato`, esteja em que lista estiver. A derivação da spec 017 fica intacta:
ela olha `kind`, que continua sendo a natureza do vídeo.

E é justamente por isso que o front não desenha o player dela na trilha. Um 9:16 no meio de uma coluna de
16:9 tem mais de mil pixels de altura numa tela de desktop — a decisão 3 da spec 017 do front já fez essa
conta — e quebra o ritmo da sequência. **A resposta na trilha aparece como pergunta, e o vídeo abre por
cima.** Aqui isso não custa uma linha: a API já diz `retrato`, e quem decide onde pintar é a tela.

### 6. O XP não ganha nada, e essa é a verificação, não a omissão
`PUT /me/watched-videos/:videoId` da spec 019 não olha `kind` nem olhará `tab`: ela lê
`badge_videos/{videoId}`, confirma que o vídeo existe e paga os 10 XP uma vez. Uma resposta posicionada na
trilha conta XP **sem uma linha escrita aqui**, e uma resposta na aba de respostas já contava.

Vale dizer em voz alta porque a leitura contrária é plausível: "vídeo da trilha dá XP" sugeriria uma regra
por lista. Não existe regra por lista, e criar uma seria a primeira vez que este produto teria dois tipos de
vídeo com preços diferentes.

### 7. O `?kind=` das rotas vira `?tab=`, e o nome antigo não fica de alias
Três rotas filtram por aba: `GET /badges/:badgeId/videos`, `GET /admin/badges/:badgeId/videos` e o
`PATCH /admin/badges/:badgeId/videos/order`. Depois desta spec, `?kind=aula` devolveria um vídeo cujo `kind`
é `resposta` — **um parâmetro que mente sobre o campo que ele nomeia**, e o tipo de detalhe que custa uma
tarde a quem for depurar isso em novembro.

O front é o único cliente, as duas specs entram juntas, e um alias temporário seria um segundo nome vivo
para sempre por causa de um deploy. O parâmetro é renomeado e pronto. Continua tolerante do mesmo jeito:
valor desconhecido é tratado como ausente na leitura pública, e como `'aula'` na reordenação.

### 8. O índice troca de campo, e a lista de índices não cresce
`badgeId + kind + order` sai; `badgeId + tab + order` entra. É substituição, não adição: nenhuma consulta
filtra por `kind` depois desta spec.

O índice da administração (`badgeId + order`, sem filtro de aba) continua igual e continua sendo o que serve
a visão das duas listas juntas.

### 9. A publicação continua notificando, e o texto não muda
O e-mail e o sino da spec 012 saem na publicação, como sempre, e nenhum dos dois menciona a aba. Um "esta
resposta entrou na trilha" seria informação de bastidor: para quem recebe, o que mudou é que o vídeo está
lá — e ele está, com o mesmo link.

---

## O que muda no dado

`badge_videos` ganha **um** campo:

| Campo | Tipo | Nulo? | O que é |
|---|---|---|---|
| `tab` | `'aula' \| 'resposta'` | não | A lista em que o vídeo vive. Não é a natureza dele — essa continua sendo `kind` |

Documento anterior a esta spec não tem o campo e **lê `tab` igual ao `kind`** (decisão 2). Nenhuma escrita de
migração.

---

## Rotas tocadas

| Rota | O que muda |
|---|---|
| `POST /admin/badges/:badgeId/videos` | Aceita `tab`. Sem ele, `tab = kind`. `kind: 'aula'` com `tab: 'resposta'` é 400 |
| `GET /badges/:badgeId/videos` | `?kind=` vira `?tab=`. O DTO ganha `tab` |
| `GET /admin/badges/:badgeId/videos` | `?kind=` vira `?tab=` |
| `PATCH /admin/badges/:badgeId/videos/order` | `?kind=` vira `?tab=`. Valida a lista contra os vídeos da aba |

Nenhuma rota nova, nenhum guard novo, nenhuma coleção nova.

---

## Fora de escopo

- **Mover um vídeo de lista depois de publicado.** Ver a decisão 3.
- **Uma resposta em duas listas ao mesmo tempo.** Foi considerado e sai: o mesmo vídeo em duas sequências é
  duas ordens para manter, o mesmo XP oferecido em dois lugares, e a pessoa assistindo duas vezes sem saber
  que era o mesmo. Uma resposta tem um endereço.
- **Regra de XP por lista.** Ver a decisão 6.
- **Mudar `orientation`, o balão ou a foto da pergunta.** A spec 017 continua inteira.
- **Ordenar automaticamente a resposta perto da aula que ela responde.** Não existe dado que ligue uma
  pergunta a uma aula, e inventar um por heurística de título é o tipo de mágica que erra em silêncio. As
  setas resolvem.
- **Filtrar a pauta do Mural pelo que já virou vídeo.** Continua sendo o ponto em aberto da spec 016.

---

## Specs afetadas

### Spec 009 (Financeiro, Administração e Trilha) — vigente, com uma emenda
A renormalização em lote atômico continua igual em tudo, menos no eixo: era `(badgeId, kind)`, passa a ser
`(badgeId, tab)`. **É a mesma garantia, sobre a lista certa.**

### Spec 010 (Mural de Perguntas) — vigente, com uma emenda
A frase "aula se assiste em ordem, resposta se consulta por assunto" continua sendo o padrão e continua sendo
o argumento. O que esta spec acrescenta é que **o padrão pode ser dispensado por vídeo**, por decisão
explícita de quem publica — e não por uma regra que adivinha.

### Spec 012 (Notificações Internas) — vigente
Nenhuma mudança. Ver a decisão 9.

### Spec 017 (Respostas em Retrato) — vigente, inteira
`orientation`, a foto da pergunta e o `answerVideoId` escrito de volta não mudam. A única frase que envelhece
é a que dizia que resposta vive na aba de respostas: agora ela vive onde o admin disse.

### Spec 019 (Vídeos Assistidos e XP) — vigente, sem uma linha
Ver a decisão 6.

---

## Pontos em aberto

1. **O painel deveria mostrar quantas respostas estão na trilha e quantas na aba?** Escrito como não. A
   contagem é olhar as duas listas, e um número no topo é mais uma coisa para manter certa.
2. **Uma resposta na trilha deveria sair também na aba, marcada como "já está na trilha"?** Não, e é a
   decisão de escopo desta spec: um endereço por vídeo. Se a consulta por assunto sentir falta, o caminho é
   uma busca de verdade, e não uma duplicata.
3. **`tab` deveria admitir um terceiro valor no futuro — um "arquivo", por exemplo?** O tipo é uma união de
   dois, e crescer custa uma linha no tipo e uma no índice. Nada aqui impede, e nada aqui antecipa.
4. **O 400 da decisão 4 deveria ser silencioso, aceitando `tab: 'resposta'` numa aula e ignorando?** Não.
   Ignorar um campo que o cliente mandou é a forma mais barata de esconder um bug de front por seis meses.
