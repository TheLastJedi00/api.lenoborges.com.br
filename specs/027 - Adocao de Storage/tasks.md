# Spec 027 (backend): Adoção de Storage — Tasks

> Regra do repositório: **TDD nos services** — o `.spec.ts` vem antes da lógica.
> Repositories devolvem objeto (`{ found, entry }`), nunca `null` cru.
> `create()` e nunca `set()` onde a unicidade é do caminho; documento antigo sempre com fallback no converter.
> Uma branch `feat/` por fase, um commit por task, um push por fase.
> As referências de decisão apontam para o `context.md` desta spec.
> O par no front é a spec 027 de lá, e as duas entram juntas — as Fases 01 a 04 daqui
> precisam estar de pé antes da fase correspondente do front virar tela funcionando.

> **O arquivo sobe por esta API, não do navegador para o bucket** (decisão 1). Quem escreve no
> Storage é o `firebase-admin` que já está aqui. O front não ganha o SDK web do Firebase, e é a
> spec 020 quem já pagou esse preço por inteiro.

---

# Fase 01: O Storage no Admin SDK [x]

Ao fim desta fase a aplicação sabe escrever e apagar um objeto no bucket. Nenhuma rota existe ainda.

- [x] Task 01: `src/config/env.validation.ts` e `.spec.ts` — adicionar `FIREBASE_STORAGE_BUCKET` como
  obrigatória, no mesmo molde de `FIREBASE_WEB_API_KEY`.
  **Obrigatória e não opcional com padrão** (decisão 4): sem a variável, a ausência só apareceria no
  primeiro membro que tentasse trocar a foto, num `500` que ninguém liga ao deploy. O valor é **um por
  projeto**, como tudo que é de console neste repositório — anotar isso no comentário, ao lado da
  mesma advertência que a action URL e os índices compostos já carregam.
- [x] Task 02: `src/auth/firebase.service.ts` — passar `storageBucket` no `initializeApp` (vindo da
  config) e expor `readonly storage: Storage` com `getStorage(this.app)` de `firebase-admin/storage`,
  ao lado de `auth` e `firestore`.
  **O `initializeApp` só roda quando `getApps().length === 0`** — o bucket entra nesse mesmo bloco, e o
  comentário existente sobre reaproveitamento de processo na Vercel continua valendo sem mudança.
- [x] Task 03: `package.json` — adicionar `@types/multer` em `devDependencies`.
  `@nestjs/platform-express` já está nas dependências, então o `FileInterceptor` funciona; o que falta é
  o **tipo** `Express.Multer.File`, e sem ele o parâmetro do controller vira `any` e o `no-unsafe-*` do
  ESLint reclama no lugar errado.
- [x] Task 04: `src/storage/storage.constants.ts` — os limites e caminhos num lugar só (decisão 4):
  `MAX_UPLOAD_BYTES = 5 * 1024 * 1024`, `ALLOWED_IMAGE_TYPES` (`image/jpeg`, `image/png`, `image/webp`),
  `avatarPath(uid)` = `avatars/{uid}` e `trainingResultPath(uid, trainingId)` =
  `trainings/{uid}/{trainingId}`.
  As funções de caminho ficam aqui **para a regra ter um dono só**, como o `trainingCompletionDocId`:
  o caminho é lido na escrita, na remoção e na validação da URL no `complete`, e três literais iguais em
  arquivos diferentes divergem no dia em que alguém muda um.
- [x] Task 05: `src/storage/image-type.ts` e `.spec.ts` — `detectImageType(buffer)` que lê os **bytes
  iniciais** e devolve o tipo detectado ou `null`: `FF D8 FF` (jpeg), `89 50 4E 47` (png), `RIFF....WEBP`
  (webp).
  **Nunca o `mimetype` do multipart nem a extensão do nome** (decisão 4): os dois são campos que quem
  envia escreve, e aceitar o que o cliente afirma sobre o próprio arquivo é o mesmo erro que o
  `includes('linkedin.com')` do `social-url.ts` documenta. Testes: um buffer de cada tipo aceito, um
  buffer de texto, um buffer vazio, e um arquivo cujo `mimetype` diz `image/png` com bytes de outra
  coisa.
- [x] Task 06: `src/storage/storage.service.ts` e `.spec.ts` — **testes primeiro**. O único lugar que
  fala com o bucket:
  - `upload(path, buffer, contentType): Promise<string>` — `file.save(buffer, { contentType, metadata })`,
    `makePublic()`, e devolve a URL pública **com `?v=<Date.now()>`**. O `?v=` é o que faz a foto nova
    aparecer: o caminho é fixo para a troca sobrescrever a velha (decisão do `POST /me/avatar`), e sem o
    parâmetro o navegador serve a antiga do cache com a URL idêntica.
  - `remove(path): Promise<void>` — apaga e **engole o "não existe"**, porque remover o que já não está
    lá é o resultado desejado, não um erro.
  - `isOwnUrl(url, path)` — confere que a URL aponta para o nosso bucket e para aquele caminho exato,
    parseando como `URL` e comparando host e pathname. **Nunca `includes`**, pela razão escrita no
    `isUrlOf` de `src/common/social-url.ts`, que existe porque `https://evil.com/?u=linkedin.com` passa
    por um `includes`.
  - O `.spec.ts` roda contra um duplo do bucket, no molde do `fake-firestore`: o emulador de Storage não
    está no `firebase.json` e esta spec não o adiciona.
- [x] Task 07: `src/storage/storage.module.ts` — módulo que provê e exporta o `StorageService`.
  **Não importa nada**, pelo mesmo desenho do `GamesDataModule` e do `TrainingDataModule`: ele vai ser
  importado pelo `ProfileModule` e pelo `TrainingModule`, e qualquer import de volta aqui fecharia o
  ciclo de arquivos que derruba o boot sem nenhum teste unitário notar.
- [x] Task 08: `storage.rules` na raiz e o bloco `storage` no `firebase.json` — **negar tudo**, com o
  comentário dizendo por quê: só o Admin SDK escreve, exatamente como no Firestore (decisão 1). A
  leitura é pública pelo `makePublic()` do objeto, e não por regra.
  Registrar em `README.md` o comando com **`--project` explícito**
  (`firebase deploy --only storage --project <id>`) e a advertência de sempre: **são dois projetos**, e
  configurar só um é o defeito que nenhum teste pega.


> **Fase 01 concluida.** 1048 testes verdes, lint limpo. O `.env` carregava uma
> `FIREBASE_BUCKET_URL="gs://..."` sem leitor desde a migracao, e a validacao passou a aparar o
> `gs://` por causa dela: quem copiasse aquele valor acertaria o boot e erraria o bucket.

---

# Fase 02: Avatar no perfil e no placar [x]

Ao fim desta fase o membro troca e remove a foto, e o placar acompanha.

- [x] Task 01: `src/profile/entities/profile.entity.ts` e `.spec.ts` — `avatarUrl: string | null` na
  interface, no `ProfileDocument`, no `toFirestore` e no `fromFirestore` com `data.avatarUrl ?? null`.
  **Todo documento é anterior ao campo no dia do deploy**, e é o mesmo fallback que `tier`, `completedAt`
  e `legalAcceptances` já aplicam por essa razão. Testar o round-trip e o documento legado.
- [x] Task 02: `src/profile/profile.repository.ts` e `.spec.ts` — o tipo do `update` aceita
  `avatarUrl?: string | null`. Nenhum método novo: gravar `null` é o caminho da remoção, e um
  `clearAvatar` separado seria um segundo jeito de fazer a mesma escrita.
- [x] Task 03: `src/games/entities/ranking-entry.entity.ts` e `.spec.ts` — `avatarUrl: string | null` na
  interface, no `RankingEntryDocument` e nos dois lados do converter, com `?? null` para o legado.
  Cuidar do `upsert`: ele monta o `next` preservando `previousPosition`, `currentPosition` e
  `positionUpdatedAt` do documento atual, e o `avatarUrl` entra **nessa mesma lista de campos
  preservados** — senão escolher a gamertag ou ganhar XP apagaria a foto de quem já tinha uma, sem erro
  nenhum. É exatamente a armadilha que o comentário do `upsert` já descreve para as posições.
- [x] Task 04: `src/games/ranking.repository.ts` e `.spec.ts` — `updateAvatar(uid, avatarUrl)`, que dá
  `update` **só se a linha existir**.
  **Nunca `set()` e nunca criar o documento**, pela razão já escrita no `addXpToBatch` logo acima: a
  linha do placar nasce quando a pessoa escolhe a gamertag (spec 022, decisão 20), e criar aqui daria ao
  ranking uma linha em branco de quem nunca escolheu nome. Testes: linha existente recebe a URL; membro
  sem linha não cria nada e não estoura.
- [x] Task 05: `src/profile/profile.service.ts` e `.spec.ts` — **testes primeiro**:
  - `setAvatar(uid, file)`: valida tamanho e tipo detectado, sobe por `StorageService.upload` em
    `avatarPath(uid)`, grava a URL no perfil e **chama `ranking.updateAvatar` num `catch` que engole e
    loga** — o mesmo desenho do `upsert` da gamertag vinte linhas acima e do `catch` da notificação da
    spec 012: a foto já está no bucket e no perfil, e um `500` aqui diria que a troca falhou quando ela
    deu certo. O placar é eventualmente consistente por desenho.
  - `removeAvatar(uid)`: apaga o objeto, grava `null` no perfil e `null` no placar, mesmo `catch`.
  - Testes: tipo recusado vira `400` **sem tocar no bucket**; arquivo acima do limite vira `400`;
    sucesso grava nos dois lugares; ranking inexistente não derruba a troca; ranking que estoura não
    derruba a troca.
- [x] Task 06: `src/profile/dto/profile.dto.ts` e `src/profile/dto/avatar.dto.ts` — `avatarUrl` no
  `ProfileDto` (é o `GET /me`, e a tela precisa saber se há foto) e um `AvatarDto` com `{ avatarUrl }`
  para a resposta das rotas novas.
  **`UpdateProfileDto` não é tocado** (decisão 1): a foto não passa por `PATCH /me/profile`, que exige
  nome, telefone e bio e estampa o `completedAt`.
- [x] Task 07: `src/profile/profile.controller.ts` e `.spec.ts` — `POST /me/avatar` com
  `@UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))` e
  `DELETE /me/avatar`.
  O `limits` do multer é a **primeira** barreira, e o service revalida: o interceptor protege a memória
  do processo, e a checagem do service é a que vale quando alguém chamar o método por outro caminho.
  Corpo ausente responde `400` com mensagem que diz o que fazer. Documentar os `ApiResponse` e o
  `@ApiConsumes('multipart/form-data')`.
  **As duas rotas ficam sob o guard de aceite legal**, como todo o resto de `/me` fora das exceções
  listadas na spec 018 — não adicionar exceção nenhuma.
- [x] Task 08: `src/profile/profile.module.ts` — importar o `StorageModule`. Uma linha, e o comentário do
  módulo ganha a frase: é o **sétimo** import que não virou ciclo, porque o `StorageModule` não importa
  nada.


> **Fase 02 concluida.** 1064 testes verdes, lint limpo, build ok. Duas notas:
>
> - **A Task 02 nao precisou de mudanca.** O `update` do `ProfileRepository` recebe
>   `Partial<Omit<Profile, 'id' | 'createdAt'>>`, entao ele passou a aceitar `avatarUrl` no momento em
>   que o campo entrou na interface. O que o compilador cobrou ali foi outra coisa: o `create`, que
>   monta o perfil inteiro e precisou do default `avatarUrl: null` junto dos outros sete.
> - **O compilador apontou o `upsert` do ranking antes de qualquer teste**, e era a armadilha da Task
>   03. Seis fixtures de spec tambem cairam, e sao as que provam que `Profile` ganhou campo
>   obrigatorio em vez de opcional.

---

# Fase 03: Foto de resultado na Arena e a trava de tier [x]

Ao fim desta fase o Great Dev+ sobe a foto do resultado e o Dev Tier manda o código.

- [x] Task 01: `src/training/entities/training-completion.entity.ts` e `.spec.ts` — `mainCode: string | null`
  e `resultImageUrl: string | null` na interface, no documento e nos dois lados do converter, com
  `?? null` para toda conclusão anterior a esta spec.
  O comentário do arquivo já explica por que `xpAwarded` e `hintsUsed` são gravados "como cobrados";
  estes dois entram com a razão própria: **são a prova do que foi entregue**, e é o que o admin abre para
  conferir. Eles não participam da trava de repetição, que continua sendo o `ALREADY_EXISTS` do caminho
  `{uid}__{trainingId}` — e na segunda chamada nada é escrito, então **a submissão gravada segue sendo a
  da primeira**. Dizer isso no comentário, porque é a pergunta que alguém vai fazer.
- [x] Task 02: `src/training/training-completion.repository.ts` e `.spec.ts` — o `create(batch, data)`
  recebe e grava os dois campos novos. **Esta task não pode faltar**: é ele, e não o service, quem chama
  `batch.create`.
- [x] Task 03: `src/training/dto/complete-training.dto.ts` — `mainCode` (`@IsOptional() @IsString()`
  `@Transform(trim)` `@MaxLength(20000)`) e `resultImageUrl` (`@IsOptional() @IsString()`
  `@MaxLength(500)`), mantendo o `hintsUsed` da spec 025.
  O teto de 20000 no código existe porque o campo é um `Ctrl+V` de classe inteira e um documento do
  Firestore tem limite de 1 MiB: sem teto, a conclusão falharia no `create` com um erro que não fala de
  tamanho. **Os dois seguem opcionais** pela mesma razão que o `hintsUsed` é — a janela entre os dois
  deploys, escrita no comentário do arquivo, em que a tela antiga manda `{}`.
- [x] Task 04: `src/training/training.service.ts` e `.spec.ts` — **testes primeiro**. O
  `uploadResultImage(uid, trainingId, file)`:
  - Lê o perfil e **rejeita `tier === 'dev-tier'` com `403`** antes de tocar no bucket (decisão 2), com a
    mensagem que oferece a saída — o mesmo molde da trava de comentários da spec 023, e a mesma frase
    final: um `403` sem caminho é a forma mais cara de perder um upgrade.
  - Confere que o treinamento existe antes de aceitar o arquivo, pela razão da spec 019: `trainingId` vem
    da URL e é escolhido pelo cliente.
  - Valida tipo e tamanho, sobe em `trainingResultPath(uid, trainingId)` e devolve a URL.
  - **A validação mora no service e não num guard**: um guard no controller barraria a conclusão inteira,
    e o Dev Tier tem direito a concluir e a mandar o `mainCode`.
- [x] Task 05: `src/training/training.service.ts` e `.spec.ts` — o `complete` passa a receber o DTO
  inteiro:
  - `mainCode` entra para qualquer tier.
  - `resultImageUrl` presente com `tier === 'dev-tier'` é `403`.
  - `resultImageUrl` presente que **não é URL nossa daquele membro** é `400` — `isOwnUrl` contra
    `trainingResultPath(uid, trainingId)`. A rota de upload já barrou o tier, mas ela e o `complete` são
    duas chamadas, e sem esta conferência o Dev Tier leva `403` no upload e manda uma URL qualquer no
    `complete` (decisão 2).
  - Testes: Dev Tier com `mainCode` conclui e recebe o XP; Dev Tier com `resultImageUrl` é `403` e
    **nada é escrito**; Great Dev com URL nossa grava os dois campos; URL de outro host é `400`; URL do
    nosso bucket no caminho de **outro uid** é `400`; segunda chamada continua `xpAwarded: 0` sem
    reescrever a submissão.
- [x] Task 06: `src/training/training.controller.ts` e `.spec.ts` —
  `POST /trainings/:trainingId/result-image` com o `FileInterceptor`, e o `complete` passando a repassar
  o DTO inteiro em vez de só o `hintsUsed`. Atualizar o `ApiOperation` do `complete`: o `403` de tier e o
  `400` de URL estranha são contrato agora.
- [x] Task 07: `src/training/training.module.ts` — importar o `StorageModule`. O `TrainingModule` já
  importa o `ProfileModule` para ler o tier de quem comenta, então o tier da foto não custa import novo.
- [x] Task 08: `src/training/dto/training.dto.ts` — expor `mainCode` e `resultImageUrl` na conclusão que
  a API devolve, para o admin poder abrir a submissão. **Não entram no `TrainingDto` do membro**: é a
  resposta da conclusão e a visão do admin que os carregam.


> **Fase 03 concluida.** 1086 testes verdes, lint limpo, build ok. Tres desvios do plano, todos
> deliberados:
>
> - **A Task 08 nao virou visao de admin.** Nao existe rota de admin nem metodo de repository que
>   liste conclusoes, e criar essa tela e feature propria que nenhum dos dois `context.md` pede. Os
>   campos ficam persistidos, que e a parte durave; o que entrou no lugar foi o `submission` em
>   `GET /trainings/:trainingId`, que e de onde a tela tira o que mostrar em leitura quando o desafio
>   concluido reabre. **So no `getOne`, nunca na listagem** -- aquela leitura ja carregava o documento
>   da conclusao e descartava tudo menos o `found`.
> - **O `complete` passou a receber o DTO inteiro**, e os dois testes de controller que afirmavam o
>   contrato antigo (`hintsUsed` extraido) passaram a afirmar que o corpo chega intacto. O `?? 0`
>   desceu para o service, junto da conta que o usa.
> - **A ordem TDD nao foi seguida nas Tasks 04 e 05**: a implementacao do service veio antes dos
>   testes. Para nao deixar teste vacuo passando, a trava de tier do `complete` foi desligada de
>   proposito e a suite rodada de novo -- **exatamente um teste falhou**, e depois foi restaurada.

---

# Fase 04: O avatar no card público [x]

- [x] Task 01: `src/profile/dto/public-member.dto.ts` e `.spec.ts` — `avatarUrl` no `PublicMemberDto`.
  **É o único DTO deste repositório onde um campo novo não entra por padrão** (decisão 3): ele é
  definido pelo que deixa de fora. A decisão aqui é que a foto é pública, porque ela já está no placar,
  que é tela aberta a toda a liga — e esconder no card o que o ranking mostra três linhas acima seria
  teatro. Não entra nada além disso: nada de e-mail, telefone, `tier`, `role` ou `completedAt`.
  O teste de vazamento continua comparando **o conjunto de chaves por igualdade**, nunca
  `toMatchObject`, que passa feliz com um campo a mais.
- [x] Task 02: `src/profile/members.controller.spec.ts` e `src/games/ranking.service.spec.ts` — atualizar
  os fixtures que montam perfil e linha de placar, agora com o campo novo.


> **Fase 04 concluida.** 1087 testes verdes. **Os dois testes de vazamento do `PublicMemberDto`
> ficaram vermelhos sozinhos** quando o campo entrou, e foi assim que eles apontaram cada lugar a
> atualizar. E a prova de que a regra de o DTO ser definido pelo que deixa de fora esta viva.
>
> Uma decisao a mais que a task nao previa: **o `socialLinksPublic` nao governa a foto.** Ele existe
> para vinculo a conta de fora, e o avatar ja esta no placar, que e tela aberta. Ha teste para a
> assimetria, porque ela e o oposto do que a simetria sugeriria.

---

# Fase 05: e2e, documentação e fechamento [x]

- [x] Task 01: `test/me.e2e-spec.ts` — `POST /me/avatar` com um PNG mínimo de verdade (buffer com a
  assinatura correta) devolvendo a URL e aparecendo no `GET /me`; um buffer de texto recusado com `400`;
  `DELETE /me/avatar` zerando o campo.
  **O emulador de Storage não entra nesta spec**, então o `StorageService` é substituído por um duplo no
  módulo de teste — é o contrato da nossa rota que está sendo travado aqui, não o upload do Google.
- [x] Task 02: `test/training.e2e-spec.ts` — conclusão com `mainCode` pagando XP normalmente; Dev Tier
  mandando `resultImageUrl` recebendo `403`; Great Dev com URL nossa gravando os dois campos; URL de
  outro host recebendo `400`.
- [x] Task 03: `test/ranking.e2e-spec.ts` e `test/members.e2e-spec.ts` — a foto do membro aparecendo no
  placar e no card público; membro sem gamertag continuando fora do placar depois de trocar a foto.
- [x] Task 04: `README.md` — seção "Spec 027 — Adoção de Storage": as quatro rotas novas, os caminhos do
  bucket, os limites e a lista de tipos, a variável `FIREBASE_STORAGE_BUCKET` na tabela do `.env`, o
  `firebase deploy --only storage --project <id>` com a advertência dos dois projetos, e `avatarUrl` nas
  estruturas de `profiles`, `ranking` e das conclusões.
  **Nenhum índice composto novo**: `avatarUrl`, `mainCode` e `resultImageUrl` não entram em query, e a
  tabela de índices não ganha linha. Dizer isso explicitamente, porque a ausência é informação.
- [x] Task 05: `npm run lint`, `npm test` e `npm run build` limpos antes do merge.
  Sobre o `npm run test:e2e`: a suíte inteira falha por um defeito **pré-existente** de ambiente, já
  registrado na Fase 04 da spec 025 — `FirebaseService.identityToolkit` não honra
  `FIREBASE_AUTH_EMULATOR_HOST`, então todo `createSession` leva `401`. **Não investigar de novo**, e não
  tentar consertar aqui. O que vale no lugar: percorrer a spec contra o `dev-liga-dev` com a API local,
  junto da Fase 05 do front.
- [x] Task 06: Marcar as emendas nas specs afetadas, conferindo que cada uma bate com o que foi
  implementado: a **005** e a **013** com `Deprecated` na recusa do avatar, e a **019**, **022**, **023**
  e **025** com o bloco de emendas no topo do `context.md`. A seção "Specs Afetadas" desta spec já lista
  as seis.
