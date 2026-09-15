# Spec 025: Melhoria da Arena de Treinamento

## Objetivo
A Arena de Treinamento (introduzida na spec 023) evolui para estimular ainda mais o raciocínio. O modelo passa de uma execução guiada ("passos") para uma estrutura de **Desafio** e **Objetivo** (resultado esperado). O que antes eram passos diretos tornam-se **Dicas** de pensamento lógico (ex: "Precisamos criar uma variável do tipo int para receber a idade do usuário").

As dicas não vêm abertas por padrão. Cada dica revelada pelo membro custará **1 XP**, tornando o uso de dicas uma decisão estratégica. A geração por IA, responsável por criar treinamentos, ganha um novo prompt focado em produzir desafios, objetivos e dicas lógicas em vez de passos procedimentais.

O par desta spec no front é a **025**, e as duas entram juntas. *(Nota: O número 024 foi pulado no backend para manter alinhamento com a spec 024 de frontend, "Abrir a Pergunta do Mural", que não teve par no backend).*

---

## Emendas posteriores

**A spec 027 adicionou os campos de resposta (`mainCode` e `resultImageUrl`) à conclusão.**
O payload de `POST /trainings/:trainingId/complete` e a coleção `training_completions` passam a aceitar esses campos. O envio de `resultImageUrl` é restrito para membros do Great Dev Tier em diante, e o `mainCode` é livre para todos.

---

## Decisões

### 1. Novo Modelo de Treinamento
Os campos do treinamento ganham nova semântica:
- O array `steps` **é renomeado para `hints`**, em código e em banco. Manter o nome antigo guardando dica lógica deixaria o campo mentindo para quem ler o documento daqui a seis meses, e é o tipo de mentira que custa uma tarde.
- Adição do campo `objective` (string), que define o resultado esperado do desafio.
- A `description` foca apenas no cenário/contexto do desafio.

Os documentos em `trainings` passarão a ter:
`title`, `description`, `objective`, `hints` (array de strings), `videoUrl`, `xpAmount`, `position`, etc.

**Não há migração de dados, e não precisa haver.** `hints` não é campo de query -- a listagem filtra por `badgeId` e ordena por `position`, e nada mais -- então o `?? data.steps ?? []` do converter resolve documento antigo por inteiro, ao contrário do `tab` da spec 021, onde o fallback não bastava justamente porque a query não enxerga campo ausente. O `toFirestore` passa a gravar **só `hints`**: o documento antigo continua com o `steps` órfão até a primeira edição, que o reescreve inteiro, e um `steps` sobrando não atrapalha ninguém.

**O piso de uma dica continua valendo.** `hints` mantém o `@ArrayMinSize(1)` que `steps` tinha, e o teto de 30. A razão mudou de lugar mas não sumiu: antes era o modal vazio, agora é que a Arena existe para ensinar raciocínio, e um desafio que não oferece nenhum caminho quando o membro trava é um desafio que só paga quem já sabia. Quem quiser o desafio duro escreve uma dica cara -- o membro decide se gasta o XP nela.

### 2. O Custo das Dicas (Mecânica de XP)
Cada dica revelada "custa" 1 de XP. Para manter a mecânica saudável, esse custo será **descontado do prêmio total (`xpAmount`)** do desafio ao invés de debitar do saldo global do usuário imediatamente (o que poderia frustrar o membro ou deixar o saldo negativo).
Quando o membro concluir o desafio, a rota de conclusão `POST /trainings/:trainingId/complete` passará a receber a quantidade de dicas utilizadas:
- Payload: `{ hintsUsed?: number }`
- O backend calculará o XP ganho: `Math.max(0, xpAmount - Math.min(hintsUsed, hints.length))`.
- Como o `xpAmount` padrão é 30 e os desafios geralmente têm em torno de 5-10 dicas, o membro ainda ganhará bastante XP.

**`hintsUsed` é opcional e nasce zero.** O front e o back entram juntos, mas não sobem no mesmo segundo: entre um deploy e outro existe uma janela em que a tela antiga manda `{}` para a rota nova. Com o campo obrigatório, essa janela é um `400` em cima de quem acabou de concluir um desafio -- e o membro perde o XP de um clique que deu certo. Ausente significa "nenhuma dica revelada", que é exatamente o que a tela antiga fazia.

**O teto é o número de dicas do desafio, e é a única desonestidade que dá para barrar.** O servidor não tem como saber quantas dicas foram realmente reveladas: o estado vive no componente, e quem quiser trapacear manda `hintsUsed: 0` e leva o prêmio cheio. Isso é aceito de propósito -- a alternativa seria uma escrita por dica revelada, três vezes mais cara para cobrar 1 XP de quem já está com a tela aberta. O que o `Math.min` impede é o contrário: um número absurdo levando o cálculo para longe do desafio real. O `Math.max(0, ...)` impede o XP negativo.

**O `hintsUsed` é gravado na conclusão junto do `xpAwarded`**, pelo mesmo motivo que o `xpAwarded` já é gravado (spec 023): é o registro do que aconteceu naquele dia, e sem ele nenhuma auditoria explica por que um desafio de 30 pagou 27. Ele **não** impede repetição -- quem impede é o `ALREADY_EXISTS` do `create()` sobre o caminho `{uid}__{trainingId}`, e isso não muda nesta spec. Na segunda chamada nada é escrito: `xpAwarded: 0`, e o `hintsUsed` gravado continua sendo o da primeira.

### 3. Geração de Treinamentos com IA
Assim como nas questões do GYM Challenge (spec 022), a Arena ganha suporte a geração por IA via Gemini.
A integração existirá no backend através de uma rota de admin:
`POST /admin/badges/:badgeId/trainings/generate`
Payload: `{ prompt: string, difficulty: Difficulty, count: number }`, no molde exato do `GenerateQuestionsDto`: `difficulty` é `@IsIn(DIFFICULTIES)` e **não** string livre, reusando `DIFFICULTIES` de `games.constants`. É um import de constante, e não de módulo -- não abre volta de DI nenhuma.

O prompt do modelo (`src/training/gemini.service.ts` - **[DEPRECADO] na spec 026: O modelo não será mais hardcoded no serviço, passando a ser lido pela variável de ambiente GEMINI_MODEL**) deve ser instruído a:
- Dado um tema, o **título da insígnia** (`BADGE_TITLES[badgeId]`, como o de Jogos faz) e a dificuldade, gerar `count` treinamentos.
- Retornar um JSON com `title`, `description` (o desafio), `objective` (o resultado esperado), e `hints` (passos lógicos sem dar o código pronto).
- O backend retornará o rascunho para o admin revisar antes de salvar.

**A conferência do `badgeId` vem antes da chamada paga**, como no `AdminGamesController`: gerar dez treinamentos para uma insígnia que não existe custaria a chamada inteira para responder `404` depois.

**A resposta devolve `{ trainings, discarded }`**, e não só a lista. Treinamento fora do formato é descartado em silêncio, e sem o `discarded` um rascunho de 3 quando se pediu 5 parece limite do produto em vez de um modelo que errou o formato -- a mesma decisão da spec 022.

**Não existe rota de `bulk` para treinamentos, e esta spec não cria uma.** O admin salva os rascunhos aprovados pelo `POST /admin/badges/:badgeId/trainings` que já existe, e a tela dispara as chamadas em `Promise.all`. A rota de criação calcula a `position` no servidor como "última + 1", então salvar em paralelo ordena os rascunhos pela ordem de chegada; se a ordem exata importar, o admin reordena depois pela rota de reorder, que é o caminho normal para isso.

---

## Endpoints Modificados e Novos

### Admin
- **`POST /admin/badges/:badgeId/trainings/generate` (Novo)**: Consome a Gemini com o novo prompt estruturado e devolve `{ trainings, discarded }` — rascunhos **não persistidos**, com objetivo e dicas lógicas. Responde `503` sem `GEMINI_API_KEY` ou quando a IA não responde, como a rota irmã de questões.
- **`POST /admin/badges/:badgeId/trainings` (Modificado)**: Passa a aceitar `objective` e `hints` (no lugar de `steps`).
- **`PATCH /admin/trainings/:trainingId` (Modificado)**: Passa a atualizar `objective` e `hints`.

### Membro
- **`POST /trainings/:trainingId/complete` (Modificado)**: Recebe `{ hintsUsed?: number }` (ausente = 0) e calcula o XP final, `Math.max(0, xpAmount - Math.min(hintsUsed, hints.length))`. O registro de conclusão salva a quantidade de dicas usadas **para explicar o valor pago numa auditoria** — quem impede a repetição continua sendo o `ALREADY_EXISTS` do caminho `{uid}__{trainingId}`.
