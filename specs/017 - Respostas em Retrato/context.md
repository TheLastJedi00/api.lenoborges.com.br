# Spec 017: Respostas em Retrato

## Objetivo
A spec 010 criou a aba **Perguntas Frequentes** dentro da insígnia, a 016 criou a pauta que diz quais
perguntas esperam vídeo, e nenhuma das duas chegou até o fim do caminho: **o vídeo de resposta não pode ser
publicado pelo painel, e se pudesse a tela não teria o que mostrar em volta dele.**

Três buracos, e os três são pequenos:

1. **O painel recusa link de Shorts.** O vídeo de resposta é curto por natureza — é a dúvida de uma pessoa
   respondida em noventa segundos — e a forma em que ele nasce no YouTube é `youtube.com/shorts/{id}`. O
   `extractYoutubeId` conhece cinco formas de URL e essa não é uma delas: o admin cola o link que o YouTube
   deu e recebe **400 "Não reconheci esse link"**. Hoje não existe contorno decente — o admin teria que
   abrir o vídeo, descobrir que o ID é o mesmo, e colar o ID cru.
2. **O painel não sabe dizer que um vídeo é resposta.** `kind` e `questionId` existem no DTO desde a 010, e
   o formulário do front nunca os enviou. Todo vídeo publicado até hoje é `aula`, e a aba de respostas está
   vazia por construção, não por falta de conteúdo.
3. **A resposta chega sem a pergunta.** O `questionId` é um id e nada mais. A trilha precisa mostrar **a
   pergunta, a data e o autor** acima do vídeo, e nenhuma dessas três coisas está ao alcance de quem lista
   os vídeos de uma insígnia.

O par desta spec no front é a **017**, e é lá que o balão e o retrato aparecem. Aqui embaixo está o que
alimenta os dois.

---

## Numeração
Os números são iguais nos dois repositórios, com a exceção conhecida da 008 (Liga Dev, só no front). 015 é
Encontrar um Membro, 016 é Adiantar e Editar no Mural, 017 é esta.

**Esta spec depende da 009 e da 010 estarem de pé** — `extractYoutubeId`, `BadgeVideoRepository`,
`BadgeVideoService`, `kind`, `questionId` — e passa a ler o `MuralRepository` da 010. Nada aqui nasce do
zero; tudo é emenda.

---

## O problema, com nome

A decisão 6 da spec 009 é boa e é a que aperta aqui:

> A normalização acontece **uma vez, na entrada**, e o que se grava é sempre o ID. Sem este dono único,
> cada tela que monta um player reimplementa a extração, e elas divergem.

O dono único está certo. O que envelheceu foi a **lista** que ele conhece. Quando a 009 foi escrita, vídeo
da trilha era aula gravada em paisagem e a URL vinha do `watch?v=`; a 010 criou a aba de respostas e não
voltou para contar ao extrator que existia uma sexta forma. O resultado é o pior tipo de bug de produto:
**a funcionalidade inteira parece pronta, e a primeira pessoa a tentar usá-la leva um 400 na cara** sem
nenhuma pista do que fazer em seguida.

E há um segundo, mais silencioso. O campo `answerVideoId` está na `MuralQuestion` desde a 010, sai no DTO,
o repositório aceita gravá-lo — e **nada nunca o escreve.** É um campo que existe, é lido, é documentado
como "o vínculo com o vídeo de resposta", e vale `null` em cem por cento dos documentos. Um campo assim não
é neutro: é uma armadilha para quem for confiar nele daqui a seis meses.

---

## O que o balão precisa, e de onde ele vem

O front vai desenhar, acima de cada vídeo de resposta, um balão com **a pergunta, a data e o autor**. Essas
três coisas moram na `mural_questions`, e o vídeo mora na `badge_videos`. Existem dois caminhos, e a escolha
não é de gosto:

**Juntar na leitura.** `listByBadge` devolve N vídeos, o service colhe os `questionId` e faz um `getAll`
sobre eles. Custo: uma leitura a mais por resposta listada, toda vez que alguém abre a aba. E um problema
pior que o custo — o admin pode remover uma pergunta do mural (a rota existe desde a 010), e o balão do
vídeo publicado sumiria com ela, deixando um vídeo de resposta pendurado sem a pergunta que ele responde.

**Fotografar na escrita.** No momento em que o vídeo é publicado, grava-se junto dele o título da pergunta,
o nome de quem perguntou e a data. Custo: uma leitura na publicação — que acontece uma vez por vídeo, e não
uma vez por visita — e o dado não acompanha edições posteriores da pergunta.

A segunda ganha, e ganha com folga. Ver a decisão 3.

---

## Decisões

### 1. Shorts é a sexta forma de URL, e entra no mesmo dono único
`extractYoutubeId` aprende `youtube.com/shorts/{id}`. Nada mais muda: o ID de um Short é o mesmo ID de 11
caracteres do alfabeto base64url, o documento continua sendo `{badgeId}__{youtubeId}`, e a URL de embed
continua sendo `youtube-nocookie.com/embed/{id}` — **o player de embed serve Short sem tratamento
especial.**

A extração é a única coisa que precisava saber, e é por isso que esta spec é pequena. **Se o extrator
tivesse sido escrito como um `if` por tela em vez de uma função, esta decisão seriam seis alterações e uma
divergência.** A decisão 6 da 009 está sendo cobrada agora, e ela paga.

Vale a mesma tolerância que já existe: `youtu.be/{id}` de um Short já funciona hoje e continua funcionando.
O que muda é o link que o botão **Compartilhar** do YouTube copia num celular — que é exatamente o link que
o admin vai colar.

### 2. Não existe campo `orientation` gravado, e a orientação sai derivada
O front precisa saber se o iframe é 16:9 ou 9:16. Três caminhos foram considerados:

| Caminho | Por que sim, por que não |
|---|---|
| O front deriva de `kind` | Espalha uma regra de produto para dentro do template. No dia em que uma resposta for gravada em paisagem, o conserto exige deploy do front. |
| Campo gravado, escolhido pelo admin | Uma decisão a mais no formulário, em cem por cento das publicações, para cobrir um caso que ainda não existe. E um campo gravado pode ficar errado. |
| **Campo derivado no servidor** | **Escolhido.** |

`orientation: 'paisagem' | 'retrato'` sai no DTO, derivado de `kind` no `toDto`, e **não existe no
documento.** É a mesma forma da `phase` da spec 010: um valor que a API afirma, que o cliente consome sem
recalcular, e cujo dono é uma linha só.

O ganho concreto: o dia em que existir uma resposta longa em paisagem, a regra deixa de ser
`kind === 'resposta'` e passa a ser o que for — um campo novo, um parâmetro no formulário, o que for
decidido — **e nenhum front muda.** É barato agora e é a única versão disto que não vira dívida.

### 3. A pergunta é fotografada na publicação, e a foto não envelhece junto
O vídeo de resposta grava, junto de si, `question: { id, title, authorName, askedAt }`.

Não é redundância com `questionId`: é a mesma escolha que a `MuralQuestion` já fez com `authorName`, e pelo
mesmo motivo declarado lá:

> Listar trinta perguntas não pode custar trinta leituras de perfil. O preço é o nome ficar velho se a
> pessoa mudar depois, e ele está aceito e declarado: o nome exibido é o de quando perguntou.

Aqui o argumento é mais forte, porque tem uma segunda perna: **a pergunta pode ser removida do mural e o
vídeo continua no ar.** Um balão que se apaga quando o admin faz faxina no mural é pior que um balão com
texto de três meses atrás — o primeiro deixa um vídeo órfão que ninguém entende, o segundo é história.

E há a terceira perna, que é a que fecha: **o que o balão mostra é o que foi perguntado, não o que a
pergunta virou.** Se o autor editar o título depois — e a 016 deixa ele editar enquanto a pergunta está em
coleta —, o vídeo respondeu a pergunta antiga. A foto é o registro certo.

`askedAt` é o `createdAt` da **pergunta**, e não o do vídeo. São datas diferentes e a que interessa ao balão
é a primeira: o balão diz "isto foi perguntado em tal dia", e a data de publicação do vídeo não é
informação de ninguém.

### 4. Resposta sem pergunta passa a ser 400, fechando a simetria que a 010 declarou e não implementou
O comentário da entidade diz, desde a 010:

> Aula com pergunta e resposta sem pergunta são os dois estados incoerentes.

O código só recusa o primeiro. Esta spec recusa o segundo, e o momento é este porque **agora existe uma
consequência visível**: uma resposta sem `questionId` é um vídeo que a trilha desenha com um balão vazio em
cima. O 400 é mais barato que um `@if` no template cobrindo um estado que nunca deveria existir.

Nada quebra ao apertar: nenhum vídeo `resposta` foi publicado até hoje, porque o formulário do front nunca
mandou `kind`. **Esta é a janela para apertar, e ela fecha na primeira publicação.**

### 5. O `questionId` passa a ser verificado, e pergunta inexistente é 404
Hoje o `questionId` entra como string e ninguém confere. Passa a ser lido — o que a decisão 3 já obriga,
porque a foto sai da leitura — e id que não existe responde **404**, com a mensagem dizendo qual id não foi
encontrado.

A leitura é uma só, é por caminho direto (`mural_questions/{id}`) e acontece uma vez por publicação. Não
custa índice, não custa consulta, e paga por si: sem ela, um `questionId` digitado errado viraria um vídeo
de resposta com balão vazio que só apareceria na tela do aluno.

### 6. O vídeo não precisa estar na insígnia da pergunta, e isso é de propósito
A pergunta tem `badgeId` e o vídeo tem `badgeId`, e nada obriga os dois a baterem.

Poderia obrigar — o link "Cadastrar o vídeo de resposta" do painel do mural já leva o admin para a insígnia
da pergunta, então na prática eles vão bater quase sempre. Mas **a insígnia da pergunta é o palpite de quem
perguntou**, e quem perguntou frequentemente erra: uma dúvida sobre `async/await` marcada como Lógica é uma
dúvida sobre JavaScript. O vídeo mora onde ele ensina, e a pergunta continua sendo a mesma pergunta.

Travar isso transformaria um palpite errado do aluno numa parede para o admin, e a saída seria editar a
insígnia da pergunta só para poder publicar — mexer no passado para destravar o presente.

### 7. Publicar a resposta fecha o vínculo dos dois lados
Criado o vídeo com `kind: 'resposta'`, a `MuralQuestion` recebe `answerVideoId` com o id do vídeo.

É o campo que existe desde a 010 e nunca foi escrito. Ele passa a ser escrito **depois** de o vídeo estar
gravado, no mesmo lugar e com o mesmo cinto das notificações: `try/catch` que loga e não derruba. A ordem
importa e é a mesma da decisão 7 da spec 012 — **o vídeo já está no ar quando isto roda, e um 500 aqui
perderia o trabalho do admin por causa de um vínculo.**

O que se perde com o `catch`: um vídeo publicado com a pergunta sem `answerVideoId`. O sintoma é a pauta
continuar mostrando uma pergunta já respondida, o conserto é reeditar, e nada do lado do aluno quebra —
**o balão vem da foto do vídeo, e não deste vínculo.** É por isso que este é o lado barato de falhar, e é
por isso que ele é o último a ser escrito.

### 8. Nenhuma notificação e nenhum e-mail novo
Publicar um vídeo já notifica e já dispara campanha, desde a 012 e a 014, e a resposta é um vídeo. Ela entra
nos dois canais que já existem, com o texto que já existe.

O que **não** entra: um aviso ao autor da pergunta dizendo "sua pergunta foi respondida". É a coisa mais
tentadora desta spec e ela fica de fora, porque exige um caminho de notificação dirigida a uma pessoa e
todo o resto do sistema notifica a comunidade. Ver os pontos em aberto.

### 8b. `createdAt` passa a sair na pergunta do Mural
Emenda descoberta na implementação e registrada aqui: o `MuralQuestionDto` nunca expôs a data em que a
pergunta foi feita. Isso não é problema para o balão da trilha — a foto da decisão 3 carrega o `askedAt`
—, mas é para o **painel**: a tela de publicar resposta mostra a pergunta antes de gravar, e ela monta esse
bloco a partir da pauta, não de um vídeo que ainda não existe.

O caminho alternativo era o painel exibir o `weekId`. Ele está ali e é quase a resposta certa, e é
exatamente por isso que seria ruim: **`weekId` é o domingo que abre a semana, e a pergunta pode ter nascido
na quinta.** O admin veria uma data, ela pareceria a data da pergunta, e ela estaria errada em seis dias de
cada sete — sem nada denunciando.

`createdAt` sai em ISO 8601, ao lado dos campos que já existiam. Nenhuma leitura nova: a data já vinha do
documento.

### 9. Nenhuma rota nova
Tudo entra em rotas existentes: `POST /admin/badges/:badgeId/videos` ganha dois campos que já estavam no DTO
e nunca chegavam, `GET /badges/:badgeId/videos` ganha dois campos na resposta, e o `GET` do admin ganha o
`?kind=` que o público já tem.

**Nenhum índice composto novo.** A foto está dentro do documento do vídeo, a orientação é derivada, e a
única leitura nova é por caminho direto.

### 10. As security rules continuam negando tudo
`badge_videos` e `mural_questions` continuam fechadas para o cliente. Toda escrita passa pelo Admin SDK,
sob `FirebaseAuthGuard` + `AdminGuard`. Nenhuma linha muda em `firestore.rules`.

---

## Endpoints

Nenhum caminho novo. O que muda:

| Rota | O que muda |
|---|---|
| `POST /admin/badges/:badgeId/videos` | Aceita link `youtube.com/shorts/{id}`. `kind: 'resposta'` passa a **exigir** `questionId`; `questionId` inexistente responde 404. Grava a foto da pergunta e fecha `answerVideoId`. |
| `GET /badges/:badgeId/videos` | Cada vídeo passa a trazer `orientation` e, nas respostas, o objeto `question`. |
| `GET /admin/badges/:badgeId/videos` | O mesmo, e passa a aceitar `?kind=` — a aba de que o painel precisa para reordenar sem erro. |

O `?kind=` no `GET` do admin não é enfeite: `PATCH .../videos/order` valida a lista contra **uma aba**, e
hoje o painel lista as duas juntas e reordena como se fossem Aulas. Enquanto não existia resposta nenhuma o
bug era invisível; a primeira publicação desta spec o torna real, com 400 em toda seta clicada.

---

## Fora de escopo

- **Player próprio, thumbnail própria ou download.** O vídeo continua no YouTube e o embed continua sendo um
  iframe.
- **Detectar a orientação real pela API do YouTube.** Uma chamada externa na publicação, com chave, cota e
  um modo de falhar novo, para responder uma pergunta que a decisão 2 responde com uma linha.
- **Trocar o `youtubeId` de um vídeo publicado.** Continua sendo criar outro, porque o ID é o caminho do
  documento. A 009 decidiu isso e nada aqui mexe.
- **Vincular uma pergunta a um vídeo já publicado.** O `PATCH` continua editando título, descrição e
  `devTierFree`. Vincular depois é publicar de novo.
- **Mais de uma pergunta por vídeo de resposta.** Uma resposta responde uma pergunta. Duas perguntas
  parecidas na mesma semana são um problema do mural, não do vídeo.
- **Cortar da pauta o que já foi respondido.** Ver o ponto em aberto 2.
- **Notificação dirigida ao autor.** Ver a decisão 8.

---

## Specs afetadas

### Spec 009 (Financeiro, Administração e Trilha) — vigente, com uma emenda
A decisão 6 continua inteira: o dono único da extração continua sendo `extractYoutubeId`. A lista de formas
que ele conhece passa de cinco para seis.

### Spec 010 (Mural de Perguntas) — vigente, com duas emendas
- `answerVideoId` deixa de ser um campo que ninguém escreve.
- "Resposta sem pergunta é incoerente" deixa de ser comentário e vira validação (decisão 4).

### Spec 016 (Adiantar e Editar no Mural) — vigente
A pauta continua igual. O que muda é que agora existe um caminho até o fim dela: a pergunta que espera vídeo
passa a poder receber um.

### Spec 012 (Notificações Internas) e 014 (Disparo de E-mails) — vigentes
A resposta é um vídeo e usa os dois caminhos que já existem, sem texto novo e sem tipo novo.

---

## Pontos em aberto

1. **Avisar o autor pelo sino quando a pergunta dele virar vídeo?** É o aviso mais merecido do produto
   inteiro, e fica de fora desta spec. Todo o `NotificationsService` de hoje escreve para a comunidade; uma
   notificação dirigida é um caminho novo, e ele não cabe numa spec que se propôs a fechar três buracos. Se
   entrar, entra sozinho.
2. **A pauta deveria parar de mostrar a pergunta depois que ela é respondida?** Assumido que sim, e o
   `answerVideoId` da decisão 7 é exatamente o dado que permite fazer esse corte. Fica escrito e não fica
   implementado: a pauta desta versão continua mostrando tudo, e o admin reconhece o que já gravou. O dia em
   que a pauta tiver vinte linhas, o corte é um `filter`.
3. **A foto da pergunta deveria ser atualizável?** Escrito como não. Se a pergunta for editada depois, o
   balão continua mostrando o que foi perguntado — que é a decisão 3, e é o comportamento certo. Se algum
   dia um erro de digitação numa pergunta muito vista incomodar, o conserto é o `PATCH` do vídeo aprender a
   editar a foto, e não uma sincronização automática.
4. **Um Short pode virar aula?** Nada impede: `kind: 'aula'` com um link de Shorts é aceito, e a decisão 2
   faz o iframe sair em paisagem — vídeo em retrato dentro de moldura larga, com tarjas pretas dos dois
   lados. Feio e não quebrado, e não vale um campo para evitar. Se acontecer na prática, é o mesmo gatilho
   do ponto 5.
5. **Quando `orientation` deixar de sair de `kind`, o que a substitui?** A resposta provável é um campo
   gravado com default derivado, para o admin poder corrigir o caso raro sem decidir nada no caso comum. Não
   é agora, e a decisão 2 existe justamente para isso caber sem tocar no front.
