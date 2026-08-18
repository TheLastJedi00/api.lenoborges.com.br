# Spec 011: Links Gerenciados

## Objetivo
Tirar os links de contato do código e colocá-los numa tela de administração. O admin passa a
cadastrar o WhatsApp pessoal, o do grupo da comunidade e **o que mais precisar**, sem deploy.

O gatilho é concreto: a spec 010 fechou com o botão de upgrade do Financeiro abrindo o LinkedIn,
porque não havia número de WhatsApp em lugar nenhum e `environment.whatsappGroupUrl` estava vazio. A
resposta certa não é preencher a constante — é a constante deixar de existir.

O par desta spec no front é a **011**.

---

## O que está espalhado hoje

| Onde | O quê | Como muda hoje |
|---|---|---|
| `profile.service.ts` (front) | LinkedIn, portfólio, Instagram | commit + deploy |
| `environment.whatsappGroupUrl` | grupo da comunidade | commit + deploy, e está **vazio** |
| `financeiro.page.ts` | destino do "Quero o &lt;Tier&gt;" | commit + deploy, e aponta para o LinkedIn |

Três lugares, três formas de mudar a mesma categoria de coisa, e o mais importante deles — o canal
onde o dinheiro é combinado — é o que está errado.

---

## Decisões

### 1. Coleção `links`, com o slug no caminho
`links/{slug}`, como `waitlist_entries/{email}` e `profiles/{uid}`. O slug é o identificador estável
que o código usa para pedir um link pelo nome, e o caminho garante que ele é único sem consulta e sem
índice.

| Campo | Tipo | Por quê |
|---|---|---|
| `slug` | string | `whatsapp-pessoal`, `whatsapp-comunidade`, `linkedin`… Igual ao ID |
| `label` | string | O que aparece no botão ou na lista |
| `url` | string | Só `https:`, `mailto:` ou `tel:` (decisão 4) |
| `description` | string \| null | Uma linha, opcional |
| `order` | number | Posição na lista de links úteis |
| `updatedAt` | Timestamp | |

O slug é **normalizado na entrada**: minúsculas, sem acento, espaços viram hífen. Sem isso, `WhatsApp
Pessoal` e `whatsapp-pessoal` viram dois documentos que o código nunca acha.

### 2. O código consome link **por nome**, e os nomes que ele conhece são poucos
Existe uma diferença que a tela precisa mostrar, porque ela é a fonte da confusão:

- **Slots conhecidos.** `whatsapp-pessoal` e `whatsapp-comunidade` têm consumidor no código — o botão
  de upgrade do Financeiro e o cartão da comunidade no painel. Trocar a URL deles muda o
  comportamento de uma tela específica.
- **Links livres.** Qualquer outro slug que o admin cadastrar. Eles não têm consumidor nomeado, e
  aparecem numa lista de "Links úteis" no painel.

**Sem a segunda categoria, a tela seria um formulário de dois campos fixos**, e a instrução era "o que
mais precisar". Sem a primeira, todo link cadastrado seria decorativo — e o admin trocaria o WhatsApp
esperando que o botão de upgrade mudasse, sem que nada mudasse.

`SLOT_SLUGS` fica em `src/links/links.constants.ts`, e a tela marca quais são consumidos.

### 3. `GET /links` é público, sem sessão
Link de contato é informação pública por natureza — está no rodapé de qualquer site. Exigir token
para ler uma URL de WhatsApp seria teatro de segurança: a informação existe para ser distribuída.

E há uma razão prática: a landing usa esses links **sem sessão**. Um endpoint autenticado obrigaria
duas fontes para o mesmo dado, que é exatamente o que esta spec veio desfazer.

> **O que continua exigindo admin é a escrita.** `POST`, `PATCH` e `DELETE` passam pelo
> `FirebaseAuthGuard` + `AdminGuard`, como todas as rotas de `/admin`.

### 4. A URL é validada, e `javascript:` é o motivo
Só três esquemas passam: `https:`, `mailto:` e `tel:`.

Este campo vira `[href]` numa tela. Um `javascript:alert(1)` cadastrado ali é XSS armazenado, entregue
para todo visitante, com o admin como vetor sem perceber. O Angular sanitiza `href` por padrão e
transformaria isso em `unsafe:javascript:...`, mas **a defesa não pode depender de o consumidor estar
certo** — o mesmo dado pode ir para um e-mail, um webhook ou um `window.open` amanhã.

`http:` fica de fora junto: link inseguro num botão do produto é um aviso do navegador na cara do
aluno, e não há caso legítimo em 2026.

### 5. Apagar um slot é permitido, e o consumidor degrada
O admin pode apagar `whatsapp-pessoal`. A tela avisa que aquele slug é consumido pelo Financeiro, e
deixa apagar mesmo assim.

Travar a remoção criaria uma lista de documentos impossíveis de limpar no dia em que o código deixar
de consumi-los — e essa lista envelhece calada. O contrato do outro lado é o que resolve: **todo
consumidor de slot esconde o próprio botão quando o link não existe**, em vez de renderizar um `href`
vazio. Ver a decisão 3 da spec 011 do front.

### 6. Sem cache no servidor
A coleção tem meia dúzia de documentos e a leitura é uma consulta ordenada. Um cache aqui pouparia
milissegundos e criaria a pergunta "por que o link que eu acabei de salvar não mudou?" — que é a
pior classe de bug para quem administra, porque parece que a escrita falhou.

Quem cacheia é o front, por sessão, e invalida ao escrever.

---

## Endpoints

| Método | Rota | Guards | O que faz |
|---|---|---|---|
| `GET` | `/links` | **nenhum** | Todos os links, ordenados |
| `GET` | `/admin/links` | auth + admin | Igual, com os campos de administração |
| `POST` | `/admin/links` | auth + admin | Cria. 409 se o slug já existe |
| `PATCH` | `/admin/links/:slug` | auth + admin | Edita label, url, descrição e ordem |
| `DELETE` | `/admin/links/:slug` | auth + admin | Remove |

---

## Fora de escopo

- **Contador de cliques ou analytics.** Um link é um link.
- **Encurtador próprio.**
- **Ícone por link.** Os ícones existentes são componentes SVG, escolhidos por nome no código; deixar
  o admin escolher um exigiria um catálogo de ícones na tela, e o ganho não paga.
- **Migração automática dos links que hoje estão no front.** Eles continuam como conteúdo local e
  fallback (decisão 2 da spec do front); cadastrar os que importam é a Task de usuário da Fase 04.

---

## Specs afetadas

### Spec 010 — vigente, com um ponto em aberto resolvido
O ponto em aberto do front — "o upgrade abre o LinkedIn, não o WhatsApp" — fecha aqui: o destino passa
a ser o slot `whatsapp-pessoal`, cadastrado pelo admin.

### Spec 009 — vigente
A tela de Administração ganha um terceiro cartão. Nada mais muda.

### Specs 005 e 007 — vigentes
`links` é coleção nova. Nenhuma estrutura existente muda de forma, então nada vai a Deprecated.

---

## Pontos em aberto

1. **`whatsapp-comunidade` aponta para o convite do grupo, que expira?** Convites de grupo do
   WhatsApp podem ser revogados. Se isso acontecer com frequência, vale um aviso na tela de admin
   dizendo quando o link foi atualizado pela última vez — o `updatedAt` já está no modelo.
2. **A landing deve usar os links gerenciados ou continuar com os locais?** Escrito na spec do front
   como: usa os gerenciados, com o conteúdo local como fallback, para uma falha de API não apagar os
   contatos da página.
