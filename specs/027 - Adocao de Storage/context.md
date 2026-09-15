# Spec 027: Adoção de Storage

## Objetivo
Introduzir o uso de Storage (armazenamento de arquivos) na aplicação para permitir que os membros personalizem seus perfis com avatares e enriqueçam suas submissões na Arena de Treinamento com fotos dos resultados.
O acesso aos envios na Arena dependerá do Tier do usuário (Dev vs Great Dev+).

O par desta spec no front é a **027**, e as duas entram juntas.

---

## Decisões

### 1. Upload de Avatares (Perfil)
Os membros da liga poderão enviar e atualizar um avatar de perfil.
- O modelo `profiles/{uid}` passará a contar com o campo `avatarUrl` (string | null).
- **O arquivo sobe pela API, e não do navegador para o bucket.** O front manda `multipart/form-data` para uma rota nova, e quem escreve no Storage é o `firebase-admin` que já está aqui, pelo mesmo service account de sempre. **O Client SDK do Firebase não entra no bundle do front**, e essa é a razão principal: a spec 005 decidiu que o front nunca fala com o Firebase, e a spec 020 recusou instalar o SDK web mesmo quando isso custou três rotas públicas nesta API para tratar o `oobCode`. Reabrir essa porta por causa de uma foto instalaria um segundo caminho de autenticação Firebase no navegador, para sempre, e a spec 020 já pagou o preço de não fazer isso.
- **Isso também é o que torna a trava de tier real.** Se a URL chegasse pronta do cliente, a API estaria validando uma string que o próprio cliente escolheu: quem quisesse burlar mandaria qualquer URL. Com o upload aqui, o tier é conferido **antes de o byte entrar no bucket**, e é a API que cunha a URL — não há como um `avatarUrl` apontar para host de terceiro, que seria um `<img src>` para fora entregando o IP de cada membro a quem hospedasse a imagem.
- **Não existe `storage.rules` com conteúdo, e isso é consequência e não esquecimento.** Só o Admin SDK toca no bucket, exatamente como no Firestore, então as regras **negam tudo** — o mesmo arquivo de uma linha e a mesma razão do `firestore.rules`. O bucket é público **para leitura**, porque a URL da foto vai num `<img>` de tela aberta; escrita, nenhuma, por nenhum caminho que não seja esta API.
- **`PATCH /me/profile` não carrega o `avatarUrl`**, e o `UpdateProfileDto` não ganha campo nenhum. Essa rota exige `name`, `phone` e `bio` e estampa o `completedAt`: trocar a foto por ela obrigaria a reenviar o cadastro inteiro. É a mesma razão que fez o `PATCH /me/privacy` nascer rota própria na spec 019, escrita lá com estas palavras — um interruptor que exige reenviar o cadastro é um interruptor que ninguém aciona.
- **Integração com Ranking:** Além de `profiles/{uid}`, a URL do avatar deve ser refletida na coleção `ranking/{uid}` para que o painel de ranking exiba a foto dos membros sem requerer leitura da coleção de perfis.

### 2. Submissão de Treinamento e Restrição por Tier
A conclusão de um treinamento (`POST /trainings/:trainingId/complete`, criado na spec 023) passa a permitir o envio de resultados (código e imagem), com regras baseadas no tier do membro.
- **Dev Tier:** Poderá enviar o código puro da classe `main`. O payload receberá o campo `mainCode` (string opcional). A API aceitará este campo para qualquer tier.
- **Great Dev Tier ou superior:** Poderá enviar uma foto com o resultado visual do treinamento. O payload receberá o campo `resultImageUrl` (string opcional).
- **Validação de Tier:** A API deve validar ativamente o tier do membro. Se um membro do "Dev Tier" (`tier === 'dev-tier'`) tentar enviar o campo `resultImageUrl`, a requisição deve ser rejeitada com erro `403 Forbidden` (ex: "O envio de fotos de resultado é exclusivo para membros Great Dev e superiores").
- **A validação mora no service, não em um guard**, no mesmo molde da trava de comentários da spec 023. Um guard no controller barraria a conclusão inteira, e o Dev Tier tem direito a concluir o desafio e a mandar o `mainCode` — o que ele não tem é a foto. O `403` também carrega a saída, como o do Mural e o dos comentários: um `403` sem caminho é a forma mais cara de perder um upgrade.
- Os campos validados serão persistidos no registro de conclusão do treinamento.

### 3. O avatar é público, e isso é uma decisão e não uma consequência
`GET /members/:uid` (spec 019) passa a devolver `avatarUrl`, e o `PublicMemberDto` é o único lugar
deste repositório onde um campo novo **não entra por padrão**: ele é definido pelo que deixa de fora, e
um campo entra ali quando alguém decide que é público. A decisão aqui é sim, e a razão é que a foto já
está no placar, que é tela aberta a toda a liga — esconder no card o que o ranking mostra três linhas
acima seria teatro. O que **não** muda: nada de e-mail, telefone, `tier`, `role` ou `completedAt`, e
o teste de vazamento continua comparando o conjunto de chaves por igualdade.

### 4. Configuração e limites do arquivo
- O bucket vem de `FIREBASE_STORAGE_BUCKET`, **uma por projeto** como tudo que é de console aqui, e a
  validação de boot exige a variável — sem ela a rota de upload só falharia no primeiro membro que
  tentasse trocar a foto.
- **Limite de 5 MB e só `image/jpeg`, `image/png` ou `image/webp`.** O tipo é conferido pelos bytes
  iniciais do arquivo e **nunca pelo `Content-Type` do multipart nem pela extensão do nome**, que são
  dois campos que quem envia escreve. O front já comprime o avatar para 200x200, então o limite existe
  para a foto de resultado e para o cliente que não é o nosso.
- O nome original do arquivo **não é usado em nenhum caminho**: o caminho é derivado de `uid` e
  `trainingId`, e a extensão sai do tipo detectado. Nome de arquivo vindo do cliente dentro de um
  caminho é o `../` de sempre.

---

## Endpoints Modificados

### Membro
- **`POST /me/avatar` (Nova)** — `multipart/form-data`, campo `file`:
  - Valida tipo e tamanho, grava no bucket em `avatars/{uid}` e **persiste a URL em `profiles/{uid}`
    na mesma chamada**, devolvendo `{ avatarUrl }`. Uma rota que só devolvesse a URL obrigaria o front
    a um segundo pedido para gravá-la, e a foto ficaria no bucket sem dono quando o segundo falhasse.
  - **E também em `ranking/{uid}`, junto** (decisão 1). Deixar a segunda escrita para depois é o
    defeito de sempre no Firestore: o perfil mostra a foto nova, o placar mostra a antiga, e não há
    erro em lugar nenhum. A entrada de ranking **pode não existir** — ela nasce quando a pessoa
    escolhe a gamertag (spec 022, decisão 20), não no primeiro XP —, e nesse caso não há o que
    atualizar: o `avatarUrl` entra quando ela for criada, junto com o `nickname` e o `xp`.
  - **O caminho no bucket é `avatars/{uid}`, sem sufixo aleatório, então a foto nova sobrescreve a
    velha.** Um nome por upload deixaria no bucket toda foto que a pessoa já trocou, cobrada para
    sempre e sem nada apontando para ela. Em troca, a URL não muda entre trocas e o cache do
    navegador serviria a antiga, então a resposta carrega um `?v=<timestamp>`.
- **`DELETE /me/avatar` (Nova)**: apaga o objeto e grava `null` nos dois documentos. Sem ela, "tirar a
  foto" não existe — só trocar por outra —, e quem subiu a foto errada não tem saída.
- **`POST /trainings/:trainingId/result-image` (Nova)** — `multipart/form-data`, campo `file`:
  - **É aqui que o tier é conferido**, antes de o arquivo entrar no bucket: `tier === 'dev-tier'`
    responde `403` e nada é gravado. Grava em `trainings/{uid}/{trainingId}` e devolve
    `{ resultImageUrl }`, que o front então manda no `complete`.
  - Confere que o treinamento existe antes de aceitar o arquivo, pelo mesmo motivo que a spec 019
    confere o vídeo antes de pagar XP: `trainingId` vem da URL e é escolhido pelo cliente.
- **`POST /trainings/:trainingId/complete` (Modificado)**:
  - O corpo passa a aceitar `mainCode` (string) e `resultImageUrl` (string), ambos opcionais, mantendo `hintsUsed` da spec 025.
  - Verifica o tier: rejeita com `403` caso o `tier` seja `'dev-tier'` e `resultImageUrl` esteja presente.
  - **E confere que a URL é uma que esta API cunhou para este membro** — prefixo do nosso bucket e
    caminho `trainings/{uid}/`. A rota de upload já barrou o tier, mas ela e o `complete` são duas
    chamadas: sem esta conferência, o Dev Tier sobe nada, recebe `403`, e ainda assim manda um
    `resultImageUrl` qualquer no `complete`. É o mesmo cuidado do `isUrlOf` em
    `src/common/social-url.ts`, que existe porque `includes('linkedin.com')` aceita
    `https://evil.com/?u=linkedin.com`.
  - O registro persistido da conclusão passa a guardar `mainCode` e `resultImageUrl` quando preenchidos.

---

## Modelo

```text
profiles/{uid}
  name, phone, bio, grade, tier, completedAt, waitlistEntryId, createdAt, updatedAt
  linkedin, instagram
  avatarUrl: string | null     ← novo
```

```text
ranking/{uid} (spec 022)
  uid, nickname, xp, badgeCount, previousPosition, currentPosition, positionUpdatedAt, updatedAt
  avatarUrl: string | null     ← novo
```

```text
training_completions/{uid}__{trainingId} (spec 023, hintsUsed na 025)
  uid, trainingId, xpAwarded, hintsUsed, completedAt
  mainCode: string | null         ← novo
  resultImageUrl: string | null   ← novo
```

```text
Bucket (novo)
  avatars/{uid}                        foto de perfil, sobrescrita a cada troca
  trainings/{uid}/{trainingId}         foto de resultado da Arena
```

**Leitura pública, escrita só pelo Admin SDK** — `storage.rules` nega tudo, como o `firestore.rules`.

---

## Specs Afetadas

### Spec 005 (Autenticação e Dashboard) — Parcialmente Deprecated
Na seção de **Fora de escopo** da spec 005 constava: "Upload de avatar (exigiria Supabase Storage)."
Esta restrição cai e agora está Deprecated. O storage chegou — pelo Firebase, e não pelo Supabase,
que saiu do projeto na spec 007.

### Spec 013 (Meu Perfil) — Parcialmente Deprecated
Na seção de **Fora de escopo** da spec 013 constava: "Trocar a foto do perfil. Não há avatar no produto: nenhuma tela mostra um, e armazenamento de imagem é infraestrutura nova."
Esta restrição cai e agora está Deprecated. A spec 027 adiciona a infraestrutura de storage para essa funcionalidade. O `PATCH /me/profile` introduzido na 013 ganha o novo campo.

### Spec 019 (Vídeos Assistidos e XP) — Vigente, estendida
O `PublicMemberDto` criado na 019 ganha `avatarUrl` por decisão explícita (decisão 3), e não por
extensão automática — a regra de que um campo novo não entra nesse DTO por padrão continua valendo, e
é justamente ela que obriga esta linha a existir.

### Spec 022 (Jogos, GYM Challenge e Ranking) — Vigente, estendida
A coleção `ranking/{uid}` criada na 022 ganha o campo `avatarUrl` (string | null), escrito em
sincronia com `profiles/{uid}`. O cálculo de posições, o `previousPosition` e o snapshot diário não
mudam: o campo viaja junto com o `nickname` e existe para o placar não precisar ler a coleção de
perfis.

### Spec 023 e 025 (Arena de Treinamento) — Vigentes, estendidas
O endpoint `POST /trainings/:trainingId/complete` introduzido na 023 e modificado na 025 (hintsUsed) passa a receber os novos campos e a validação de tier, mas a lógica core de XP e contabilização permanece intacta.
