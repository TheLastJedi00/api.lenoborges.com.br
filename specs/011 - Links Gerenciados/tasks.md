# Fase 01: Modelo e validação []
Branch: `feat/011-links-modelo`

- [] Task 01: Constantes dos slots. Arquivo: `src/links/links.constants.ts`. Objetivo: `SLOT_SLUGS`
  com `whatsapp-pessoal` e `whatsapp-comunidade`, mais o comentário do que a lista significa — são os
  únicos slugs que o **código** pede pelo nome. Qualquer outro é link livre, e a diferença precisa
  estar escrita onde alguém vai ler antes de acrescentar o terceiro.
- [] Task 02 (TDD): Spec do normalizador de slug. Arquivo: `src/links/slug.spec.ts`. Objetivo:
  minúsculas, acento removido, espaço vira hífen, e o resultado é idempotente. Sem isso, `WhatsApp
  Pessoal` e `whatsapp-pessoal` viram dois documentos que o código nunca acha.
- [] Task 03: Implementar o normalizador. Arquivo: `src/links/slug.ts`.
- [] Task 04 (TDD): Spec do validador de URL. Arquivo: `src/links/url.spec.ts`. Objetivo: aceitar
  `https:`, `mailto:` e `tel:`; **recusar `javascript:`**, `data:` e `http:`. O caso do `javascript:`
  é o que importa: este campo vira `[href]` numa tela, e um valor desses cadastrado é XSS armazenado
  com o admin como vetor sem perceber.
- [] Task 05: Implementar o validador. Arquivo: `src/links/url.ts`. Objetivo: a defesa mora aqui, e
  **não no consumidor** — o Angular sanitiza `href`, mas o mesmo dado pode ir para um e-mail ou um
  `window.open` amanhã.
- [] Task 06: Entidade e converter. Arquivo: `src/links/entities/link.entity.ts`. Objetivo: o slug é
  o ID do documento e também campo, redundante de propósito — ler o caminho para descobrir o slug
  obrigaria todo consumidor a saber que o ID *é* o slug.

# Fase 02: Repository e service []
Branch: `feat/011-links-service`

- [] Task 01 (TDD): Spec do `LinkRepository`. Arquivo: `src/links/link.repository.spec.ts`. Objetivo:
  `list` ordena por `order` no servidor; `create` usa `create()` e não `set()`, para o slug repetido
  falhar com `ALREADY_EXISTS`; contrato `{ found, entry }` de sempre.
- [] Task 02: Implementar o `LinkRepository`. Arquivo: `src/links/link.repository.ts`. Objetivo:
  coleção `links`, slug como caminho. Registrar em comentário o índice que a ordenação pede.
- [] Task 03: DTOs. Arquivos: `src/links/dto/link.dto.ts`, `create-link.dto.ts`, `update-link.dto.ts`.
  Objetivo: `LinkDto` carrega `isSlot`, derivado de `SLOT_SLUGS` — a tela precisa marcar quais links
  têm consumidor no código, ou o admin troca o WhatsApp esperando que um botão mude e nada muda.
- [] Task 04 (TDD): Spec do `LinkService`. Arquivo: `src/links/link.service.spec.ts`. Objetivo: slug
  normalizado antes de gravar; URL inválida vira 400; slug repetido vira 409; `isSlot` correto para os
  dois slots e falso para link livre. E o caso que a decisão 5 permite de propósito: **apagar um slot
  é aceito**, e não 400.
- [] Task 05: Implementar o `LinkService`.

# Fase 03: Rotas []
Branch: `feat/011-links-rotas`

- [] Task 01: Controller público. Arquivos: `src/links/links.controller.ts`, `src/links/links.module.ts`,
  e o import em `src/app.module.ts`. Objetivo: `GET /links` **sem guard nenhum**. Link de contato é
  informação pública — está no rodapé de qualquer site —, e a landing precisa dele sem sessão. Exigir
  token aqui obrigaria duas fontes para o mesmo dado, que é o que esta spec veio desfazer.
- [] Task 02: Controller de admin. Arquivo: `src/links/admin-links.controller.ts`. Objetivo: o CRUD
  sob `FirebaseAuthGuard` + `AdminGuard`, em controller separado — o guard vale no controller inteiro
  e não há como esquecer o decorador numa rota nova.
- [] Task 03: e2e. Arquivo: `test/links.e2e-spec.ts`. Objetivo: `GET /links` responde **200 sem
  token**; membro comum recebe 403 no `POST`; `javascript:` recebe 400; slug repetido recebe 409; e o
  slug normalizado é o que aparece no caminho.

# Fase 04: Documentação e release []
Branch: `release/011-links-gerenciados`

- [] Task 01: `README.md`. Objetivo: as cinco rotas, a coleção `links`, a diferença entre slot e link
  livre, e a regra dos esquemas de URL aceitos.
- [] Task 02: `CLAUDE.md`. Objetivo: registrar a validação de URL como garantia que vive no código —
  é a terceira do tipo, junto da unicidade por caminho e da renormalização de ordem.
- [] Task 03: Marcar na spec 010 do front que o ponto em aberto do upgrade foi resolvido aqui.
- [] Task 04 (usuário): Cadastrar `whatsapp-pessoal` e `whatsapp-comunidade` em produção. **É o que
  faz o botão de upgrade parar de apontar para o LinkedIn** — o código já vai estar pronto, e sem
  esses dois documentos ele apenas esconde os botões.
- [] Task 05: `npm run lint`, `npm test` e `npm run test:e2e` limpos; unir as `feat/011-*` na release,
  merge em `dev`, e abrir o PR contra a `main`. **O merge está liberado** (autorizado em 2026-08-18):
  abre e fecha, sem parar para confirmar. Check vermelho segura o merge — a liberação é de aprovação,
  não de qualidade.
