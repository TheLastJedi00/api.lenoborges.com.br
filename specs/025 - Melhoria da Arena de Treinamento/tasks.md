# Spec 025 (backend): Melhoria da Arena de Treinamento — Tasks

> Regra do repositório: **TDD nos services** — o `.spec.ts` vem antes da lógica.
> Repositories devolvem objeto (`{ found, entry }`), nunca `null` cru.
> Uma branch `feat/` por fase, um commit por task, um push por fase.
> As referências de decisão apontam para o `context.md` desta spec.
> O par no front é a spec 025 de lá, e as duas entram juntas — a Fase 01 e a Fase 02 daqui
> precisam estar de pé antes da fase correspondente do front virar tela funcionando.

---

# Fase 01: O novo formato do Treinamento [x]

Ao fim desta fase, a entidade `Training` tem `objective` e `hints` no lugar de `steps`, e o converter lê documento antigo sem quebrar.

- [x] Task 01: `src/training/entities/training.entity.ts` — atualizar a interface `Training` removendo `steps` e adicionando `objective: string` e `hints: string[]`.
  No `FirestoreDataConverter`, o `toFirestore` grava **só `hints`** (nunca os dois), e o `fromFirestore` migra o legado: `objective: data.objective ?? ''` e `hints: data.hints ?? data.steps ?? []`.
  O `TrainingDocument` ganha `hints` e `objective`, e mantém `steps?: string[]` **apenas para o lado da leitura tipar o fallback** — com o comentário dizendo que é resquício e que nada escreve nesse campo.
  Reescrever o comentário do campo explicando o que mudou: não é mais o passo a passo da execução, é a dica de raciocínio que custa 1 XP para abrir.
- [x] Task 02: `src/training/entities/training.entity.spec.ts` — testar o round-trip do converter, o fallback de `steps` para `hints` em documento anterior a esta spec, o `objective` ausente virando `''`, e que o `toFirestore` **não** emite `steps`.
- [x] Task 03: `src/training/dto/create-training.dto.ts` — substituir `steps` por `hints` (`@IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @IsString({ each: true }) @Length(1, 500, { each: true })`, com o mesmo `@Transform` que apara cada item) e adicionar `objective` (`@IsString() @Transform(trim) @Length(3, 300)`).
  **O `@ArrayMinSize(1)` fica** (decisão 1), mas o texto do `ApiProperty` muda junto com a razão: não é mais "um desafio sem passo abre num modal vazio", é que um desafio sem nenhuma saída quando o membro trava só paga quem já sabia.
- [x] Task 04: `src/training/dto/update-training.dto.ts` — confirmar que o `PartialType(CreateTrainingDto)` já cobre os campos novos; nenhuma validação sobrescrita a mudar, só o comentário se ele citar passos.
- [x] Task 05: `src/training/dto/training.dto.ts` — expor `objective` e `hints` no `TrainingDto`, removendo `steps`, com os `ApiProperty` atualizados (o exemplo de `hints` precisa ser dica de raciocínio, não comando de terminal).
- [x] Task 06: `src/training/training.service.ts` e `.spec.ts` — **é aqui que os campos novos entram de verdade**: `create` e `update` montam o `Training` com `objective` e `hints` vindos do DTO, e o `toDto` privado passa a devolvê-los. Sem esta task, as quatro anteriores compilam e a API continua servindo `steps`.
- [x] Task 07: `src/training/admin-training.controller.spec.ts` e `training.controller.spec.ts` — atualizar os fixtures que montam treinamento com `steps`.

---

# Fase 02: O Custo das Dicas (Completion e XP) [ ]

Ao fim desta fase, concluir um treinamento desconta do prêmio as dicas reveladas.

- [ ] Task 01: `src/training/entities/training-completion.entity.ts` e `.spec.ts` — adicionar `hintsUsed: number` na interface, no `toFirestore` e no `fromFirestore` com `data.hintsUsed ?? 0` para os legados.
  O comentário diz por que ele é gravado: **explicar numa auditoria por que um desafio de 30 pagou 27**, ao lado do `xpAwarded` que já é gravado "como pago" e nunca recalculado. **Ele não é a trava de repetição** — quem impede o segundo pagamento continua sendo o `ALREADY_EXISTS` do caminho `{uid}__{trainingId}` (decisão 2).
- [ ] Task 02: `src/training/training-completion.repository.ts` e `.spec.ts` — o `create(batch, data)` ganha `hintsUsed` no objeto que recebe e no documento que escreve. **Esta task não pode faltar**: é ele, e não o service, quem chama `batch.create`.
- [ ] Task 03: `src/training/dto/complete-training.dto.ts` — criar o DTO do corpo: `hintsUsed` com `@IsOptional() @IsInt() @Min(0)`.
  **Opcional de propósito** (decisão 2): entre o deploy do back e o do front a tela antiga manda `{}`, e obrigatório transformaria essa janela num `400` em cima de quem concluiu o desafio. O controller normaliza o ausente para `0`.
- [ ] Task 04: `src/training/training.service.ts` e `.spec.ts` — **testes primeiro**. `complete(uid, trainingId, hintsUsed = 0)`:
  `const cobradas = Math.min(hintsUsed, training.hints.length);` e `const finalXp = Math.max(0, training.xpAmount - cobradas);`.
  O `completions.create` recebe `xpAwarded: finalXp` e `hintsUsed: cobradas`; o `batch.update` do perfil incrementa `finalXp`; o `addXpToBatch` recebe `finalXp` — os três, e não o `xpAmount`.
  Testes: sem dica paga o cheio; duas dicas pagam `xpAmount - 2`; `hintsUsed` maior que `hints.length` é cortado no teto; `xpAmount` menor que as dicas paga `0` e nunca negativo; a **segunda chamada continua respondendo `xpAwarded: 0`** sem escrever nada, inclusive quando manda outro `hintsUsed`.
- [ ] Task 05: `src/training/training.controller.ts` e `.spec.ts` — `POST /trainings/:trainingId/complete` passa a consumir `@Body() dto: CompleteTrainingDto` e repassa `dto.hintsUsed ?? 0`. Atualizar a descrição do `ApiOperation`: o XP pago agora depende das dicas reveladas, e o servidor **não tem como conferir esse número** — o teto é a única defesa, e está escrito na decisão 2.

---

# Fase 03: Geração com IA [ ]

Ao fim desta fase, o admin pede treinamentos à IA como já faz no GYM Challenge.

- [ ] Task 01: `src/training/dto/generate-training.dto.ts` — `GenerateTrainingsDto` no molde do `GenerateQuestionsDto`: `prompt` (`@IsString() @Transform(trim) @Length(10, 2000)`), `difficulty` (`@IsIn(DIFFICULTIES)` com o tipo `Difficulty` importado de `../games/games.constants` — constante, não módulo) e `count` (`@Type(() => Number) @IsInt() @Min(1) @Max(10)`; o teto é 10 e não 30 porque um treinamento é muito maior que uma questão e a resposta tem que caber numa chamada).
  No mesmo arquivo, `GeneratedTrainingsDto` com `trainings` (rascunhos **sem id**, porque nada foi gravado) e `discarded`.
- [ ] Task 02: `src/training/gemini.service.ts` — serviço exclusivo de IA para treinamentos, no molde de `src/games/gemini.service.ts`: `ConfigService` (o `ConfigModule` é global, então não há import de módulo a fazer), `GEMINI_API_KEY` ausente vira `ServiceUnavailableException`, chave **no cabeçalho `x-goog-api-key` e nunca na query**, `temperature: 0.4` e `responseMimeType: 'application/json'`.
  **O Prompt:** recebe tema, `badgeTitle` e dificuldade e pede um array JSON `[{ title, description, objective, hints }]`. A `description` é o cenário do desafio, o `objective` é o resultado esperado, e as `hints` são **raciocínio, nunca código pronto** — o exemplo a colocar no prompt é "Precisamos de uma variável inteira para guardar a idade", e o prompt diz explicitamente para não escrever a solução.
  O `parse` tolera cerca de markdown e **descarta em silêncio** o que não encaixa no formato, contando os descartes — mesma resiliência da spec 022.
- [ ] Task 03: `src/training/gemini.service.spec.ts` — testar o `buildPrompt` (leva tema, título da insígnia, dificuldade e contagem), o `fetch` mockado, o JSON malformado, a cerca de markdown, o item fora do formato entrando no `discarded`, e a ausência da chave virando `503`.
- [ ] Task 04: `src/training/admin-training.controller.ts` e `.spec.ts` — a rota `POST /admin/badges/:badgeId/trainings/generate`, injetando `GeminiService`.
  **Confere o `badgeId` antes da chamada paga** (decisão 3), como o `AdminGamesController` faz: gerar dez treinamentos para uma insígnia inexistente custaria a chamada inteira para responder `404` depois. O `badgeTitle` sai de `BADGE_TITLES[badgeId]`.
  Documentar os `ApiResponse`: `200` com o rascunho, `503` sem chave ou com a IA fora do ar.
- [ ] Task 05: `src/training/training.module.ts` — prover o `GeminiService`. Ele fica injetado **só** no `AdminTrainingController`; nenhuma rota pública o alcança, e o comentário do módulo diz isso.

---

# Fase 04: Testes e2e e fechamento [ ]

- [ ] Task 01: `test/training.e2e-spec.ts` — a conclusão passa a mandar `{ hintsUsed: 2 }` e o teste valida o `xpAwarded` descontado e o `xp` do perfil. Incluir o caso **sem corpo** (`{}`), que precisa continuar pagando o prêmio cheio, e a segunda chamada respondendo `xpAwarded: 0`.
- [ ] Task 02: `test/training-admin.e2e-spec.ts` — criar e editar treinamento com `objective` e `hints`; a rota de `generate` responde `503` na suíte, que roda sem `GEMINI_API_KEY` — é esse o contrato a travar aqui, e não uma chamada real à Gemini.
- [ ] Task 03: `README.md` — registrar a evolução dos `trainings` para desafio-objetivo-dicas e o desconto de 1 XP por dica. **Nenhum índice composto novo**: `hints` não entra em query, e a tabela de índices não ganha linha.
- [ ] Task 04: `npm run lint`, `npm test` e `npm run build` limpos antes do merge.
