# Alteração de escopo (2026-08-08) — Fase 08: convite, movimento e público

Revisão do usuário depois da Fase 07: a página estava correta, mas **estática e curricular**. Ela
listava credenciais em cards brancos sobre fundo branco, sem movimento depois da animação de
entrada, e não funcionava como convite a agendar aula ou contratar o serviço. Decisões:

- **Movimento persistente** (novo, além de `animate-enter`/`animate-leave`): auroras que vagam
  atrás do hero e do contato, ponto de status pulsando, brilho atravessando o CTA primário e
  flutuação defasada nos ícones das stacks. Tudo decorativo e coberto por `prefers-reduced-motion`.
- **Timeline dinâmica**: novo componente `LessonTrack`, com traço vertical desenhado conforme o
  scroll (`animation-timeline: view()`, com queda para traço inteiro onde não houver suporte).
  A sequência é dado real (`LessonStep.order`), não numeração decorativa.
- **Hero invertido**: manchete como tese ("Aprenda a programar com quem programa em produção") com
  status de agenda e dois botões diretos, no lugar do cartão de identidade + parágrafo longo. O
  `CtaSplit` completo fica só na seção de contato; o `DialogBox` migra para a seção do professor.
- **Público**: a copy não posiciona mais o Leno como professor de adolescentes. O trabalho vai do
  **pedagógico ao andragógico** (criança, jovem e adulto), e as metas deixam de ser só "vaga no
  mercado" (também portfólio e faculdade).
- **Sem travessões** (`—`) em texto visível: vírgula, dois-pontos ou `·` no lugar.
- **Favicon** passa a ser a marca do Logo (`public/favicon.svg`), com o `.ico` como fallback.
- Paleta **inalterada**: todo o movimento usa os tokens que já existiam (`--accent`, `--violet`),
  mais `--aurora-*` e `--shadow-glow` derivados deles.

Correção de bug encontrada na validação: a barra de navegação empurrava a página no mobile (item
flex sem `min-width: 0`, o que impedia o `overflow-x` do menu de agir) e o brilho do contato
alargava o documento. Ambos corrigidos, sem scroll horizontal em 390px.

---

# Alteração de escopo (2026-08-07, atualizado)

O `clauderc.md` foi atualizado pelo usuário: a regra global 5 agora é "Visual moderno com
gradientes suaves e animações suaves (em .scss)", substituindo em definitivo a antiga "Visual
retrô gamer". Ou seja, o que abaixo era uma decisão só para esta spec passou a ser o padrão do
projeto — não há mais conflito com `clauderc.md`, e este redesign é a primeira spec a aplicá-lo.

Também foi confirmado que a antiga regra "Evitar Blur" (regra 4, removida do arquivo) **não** é
mais restrição: blur/backdrop-filter é permitido com moderação (ex.: header com leve
`backdrop-filter` ao rolar, glassmorphism sutil em cards), desde que não prejudique legibilidade
nem contraste.

Decisões que seguem valendo para esta spec:

- O redesign adota **visual moderno** (gradientes suaves, cantos arredondados, sombras leves,
  blur moderado onde fizer sentido), substituindo o sistema "Cartucho" (LCD de Game Boy, bordas
  duras, acento ciano) que hoje existe em `src/styles.scss` e nos componentes da landing page.
- As demais regras do `clauderc.md` continuam valendo integralmente: sem emojis, SVGs
  componentizados, mobile first, testar no Chrome, animações via `animate-enter`/`animate-leave`,
  dumb components/smart pages.
- A paleta é **recriada do zero** ao redor da cor do [Logo](../../src/app/shared/logo/logo.html)
  (gradiente azul `#488FFF` → `#3986FF`), não apenas uma troca do token `--accent`.
- O conteúdo de desenvolvedor (Tichr, BF Academy, Freelancer, Autônomo) deixa de ter timeline
  própria em destaque e passa a ser prova social condensada, subordinada à narrativa de professor.
- Mesma rota (`/`): esta spec **substitui** a landing page atual, não cria uma página nova.

---

# Redesign completo
- O foco é em apresentar o educador
- Design moderno com animações suaves
- Gradientes suaves
- Usar [Logo](../../src/app/shared/logo/logo.html) como logo do site e sua cor como accent color
- Apresentar como professor de programação particular
- CTA voltada a convidar instituição a entrar em contato
- CTA voltada a convidar estudantes à agendarem uma aula particular
- Apresentar HTML & CSS, Java, TypeScript & JavaScript, SQL, Angular, Spring, NestJS, Git & GitHub
  como as principais stacks de ensino pra estudantes interessados
- Usar ícone SVG de cada stack
- Visual dividido em sections com header

---

# Detalhamento da spec

## Direção visual
- Paleta nova construída a partir do azul do Logo (tons de base, superfícies e texto recalculados
  para contraste — não é só trocar `--accent`).
- Gradientes suaves em fundos de seção/CTA, nunca em texto de leitura longa (contraste garantido
  em qualquer estado).
- Sombras leves (`box-shadow` difuso, não a sombra deslocada 1:1 do sistema anterior), cantos
  arredondados (`--radius` maior que os 4px atuais).
- Blur permitido com moderação (`backdrop-filter` em header/cards), nunca a ponto de comprometer
  legibilidade de texto ou contraste de foco visível.
- Tipografia: pode manter `--font-display` para títulos se ficar legível no tom moderno, ou trocar
  por uma família mais neutra — decisão de implementação, não bloqueia a spec.

## Estrutura de seções (header fixo em todas)
1. **Header/nav** — logo + âncoras para as seções abaixo (reaproveita `MenuBar`, restilizado).
2. **Hero** — identidade como professor de programação particular, tagline focada em aula
   particular, dois CTAs lado a lado (instituição / estudante).
3. **Stacks que ensino** — grid com os 8 itens (HTML & CSS, Java, TypeScript & JavaScript, SQL,
   Angular, Spring, NestJS, Git & GitHub), cada um com ícone SVG próprio.
4. **Como as aulas funcionam / credibilidade como educador** — reaproveita as experiências da
   trilha `educator` (ProWay, mentor de bootcamp) já existentes em `profile.service.ts`, em formato
   enxuto (não timeline completa).
5. **Também constrói em produção (prova social dev)** — bloco curto (1–3 stat tiles) citando que o
   que ensina é o que usa em projetos reais, sem listar as empresas em timeline.
6. **Formação** — reaproveita a seção/dados de `education` como está.
7. **Contato final** — repete os dois CTAs (instituição / estudante) + `ContactLinks`.
8. **Footer**.

## CTAs
- **Instituições**: convite a entrar em contato (parceria/turma fechada) — aponta para o mesmo
  canal já usado no hero (ex.: e-mail ou LinkedIn), rotulado de forma institucional
  ("Fale com a minha instituição" → "Quero uma parceria" / "Falar sobre parceria").
- **Estudantes**: convite a agendar aula particular — mesmo canal de contato, rotulado como
  "Agendar aula particular". Não há integração com calendário nesta fase; o CTA leva ao canal de
  contato (link/mensagem), igual ao padrão já usado no hero atual.

## Stacks ensinadas — modelagem
- Lista fixa e distinta da seção `stack` (categorizada por tom) que já existe no `Profile`: HTML &
  CSS, Java, TypeScript & JavaScript, SQL, Angular, Spring, NestJS, Git & GitHub (8 itens, nessa
  ordem).
- Cada item = 1 ícone SVG componentizado (`app-icon-*`, seguindo o padrão de
  `src/app/components/icons/`) + label. Pares (ex. "TypeScript & JavaScript", "Git & GitHub") usam
  um único ícone representativo do par, para não poluir o grid.

## Reaproveitamento de componentes existentes
- Mantém nomes/seletores atuais (`PixelButton`, `PixelPanel`, `MenuBar`, `StatTile`,
  `ContactLinks`, `Reveal`) e apenas restiliza — evita renomear componentes só por causa da
  mudança estética, reduzindo churn.
- `TrainerCard` é redirecionado para a identidade de professor (cargo, tagline, meta), mantendo a
  mesma responsabilidade (cartão de identidade no hero).
- `TimelineEntry` deixa de ser usado na seção de prova social dev (que agora é condensada), mas
  segue em uso na seção de credibilidade como educador.
- `StackGroupCard` (categorizado por tom) não é usado na nova seção "Stacks que ensino" — essa
  seção usa um grid novo de ícone + label.

## Alteração de escopo — descoberta durante a Fase 01 (2026-08-07)
Ao levantar os tokens visuais ficou claro que outros dumb components além dos citados em
"Reaproveitamento de componentes" também dependem do sistema antigo (`--border-w`,
`--shadow-hard*`, `--screen*`, `--paper`) ou carregam imagética retrô específica:
- `PixelPanel`, `StatTile`, `TimelineEntry`, `DialogBox` — usam bordas duras/sombra deslocada.
- `IconCartridge` (sprite de cartucho), `IconPellet` (pastilha do Pac-Man), `IconCaret` (seta em
  blocos) — decorativos e explicitamente retrô.
Decisão: mantém os mesmos nomes/seletores (sem renomear, conforme já registrado acima) e
restilizam-se todos para o visual moderno dentro da Fase 04. `IconCartridge` deixa de representar
um "sprite" e passa a ser um selo/monograma de identidade; `IconPellet` vira um marcador simples
(ponto/check); `IconCaret` vira uma seta fina. `DialogBox` mantém o efeito de texto revelado
progressivamente (não é, por si, um elemento retrô), só perde a moldura de tela dura.

## Alteração de escopo — simplificação na Fase 02 (2026-08-08)
Modelar um tipo `Cta` no domínio (`profile.model.ts`/`ProfileService`) para as duas chamadas
(instituição/estudante) seria indireção sem necessidade: o rótulo e a descrição de cada CTA são
cópia fixa, e o único dado dinâmico é a URL de destino — que já é resolvida a partir de
`identity.links` exatamente como o botão do hero atual faz hoje (`primaryLink`). Decisão: CTAs não
entram no `Profile`/`ProfileService`; viram inputs estáticos do componente dumb `CtaSplit`
(rótulo, descrição, `href` recebido da smart page). Only `TeachingStackItem` (dado real, usado em
`@for`) entra no modelo/serviço nesta fase.

## Alteração de escopo — remoção de código morto (2026-08-08)
A seção "Stacks que ensino" (`teachingStack`) substitui por completo a antiga seção de stack
categorizada por tom, e nenhuma outra rota reaproveita esses dados/componente (a spec substitui a
landing page atual). Logo, o campo `stack: StackGroup[]` do `Profile` e o componente
`StackGroupCard` ficam órfãos após o redesign. Decisão: remover ambos (campo do modelo/dados na
Fase 02, componente na Fase 04) em vez de deixá-los mortos no código.

## Fora de escopo nesta fase
- Agendamento de aula com calendário/integração externa.
- Depoimentos de alunos (sem dados disponíveis ainda).
- Blog/conteúdo educacional além da landing page.
