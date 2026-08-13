# Alteração de escopo (2026-08-12) — Fase 06: `PixelButton` ganha destino de rota

Com a segunda rota, o botão da landing que leva para `/comunidade` precisava navegar pelo router
sem recarregar a página. Aplicar `routerLink` no host `<app-pixel-button>` navegaria no clique, mas
o elemento clicável continuaria sendo um `<button>` sem `href`: sem abrir em nova aba, sem menu de
contexto e sem destino visível na barra de status.

Decisão: o `PixelButton` recebe um input `route`, e quando ele existe o componente renderiza
`<a [routerLink]>` em vez de `<button>`. `href` continua para links externos e o `<button>` segue
como padrão. Nenhum uso existente muda.

---

# CTA na landing e Page Dedicada a apresentar comunidade

## Sobre a Comunidade
- A comunidade se chama: Seita Dev.
- A comunidade é um grupo aberto no whatsapp de mesmo nome.
- A comunidade serve pra compartilhar conhecimento
- A comunidade tem um sistema de login em que os assinantes conseguem participar de jogos de conhecimentos e disputar ranking
- A seita tem 33 Graus sendo que não assinantes conseguem disputar gratuitamente até o Grau 5
- Do grau 5 em diante a seita passa a exigir uma assinatura simbólica de R$14.99 e contar com vídeos e materiais de estudo
- Parte do conteúdo da Seita estará no canal do Leno Borges no youtube gratuitamente
- Membros podem assinar pra ter mentoria/aula/correção de exercícios com Leno Borges
- As mentorias são 2h de aula pra 4 alunos, O Conclave. Valor: R$150.00 para um encontro de 2h por semana + feedbacks pessoais em cada exercício realizado na plataforma
- Toda trilha de aprendizado é focada em abolir o comportamento de decorar sintaxe e focar em entender como o mercado funciona e usa as ferramentas da trilha
- visual no estilo timeline focado em mobile first com cada etapa sendo um accordion onde ao abrir aparecem os detalhes da etapa na trilha
- ìcones em SVG das linguagens e tecnologias a serem usadas.
- Exibir que o curso não é uma formalidade com intuito de entregar certificado e sim te tornar capaz de discutir, debater e opinar sobre o assunto que vale mais do que qualquer currículo ou certificado

## Trilha de Aprendizado
1. Stacks
    - O que são?
    - Como se relacionam?
2. Back-End: Lógica de Programação com Java
    - Variáveis
    - Operadores Aritméticos e Relacionais
    - Operadores Lógicos
    - Estruturas condicionais
    - Loops
    - Listas
3. Back-End: Orientação Objetos com Java
    - Abstração
    - Encapsulamento
    - Herança
    - Polimorfismo
    - SOLID
4. Back-End: Banco de Dados
    - SQL vs NoSQL no mercado
    - CRUD com SQL
    - Functions, Procedures e Triggers
5. Git e GitHub
    - Versionamento local
    - Git Flow, GitHub Flow e Trunk-Based
6. Back-End: API
    - Introdução ao SpringBoot: Conceito de MVC
    - Variáveis de Ambiente
    - Do Endpoint ao CRUD no banco
    - Overview de Arquiteturas em uma API
    - Integrações com IA
    - Básico do Docker
7. Cloud Computing: GCP
    - Cloud Run
    - Problemas com container: Custo vs Lucro
    - Serverless e Alternativas para ROI
8. Front-End: HTML e CSS
    - Textos, Imagens e Seletores
    - Div, FlexBox e Grids
    - Forms e Pseudoclasses
    - HTML Semântico
    - Responsividade
    - JavaScript na Web
9. Cloud Computing: Vercel
    - Ambientes e Deploy
10. Front-End: Angular 17+
    - Reaprendendo Lógica com TypeScript
    - Diretivas vs Control Flow Syntax
    - RxJS vs Signals no HTML
    - Rota, Componentização e Workspaces
    - Recomendação pessoal: Dumb Components e Smart Pages
    - Protocolo HTTP
    - Login e Guards
11. Devops
    - GitHub Actions
    - CI/CD
    - Vercel Environments
    - Segregação de Ambientes
12. Backend: NestJS
    - Por que não em Java?
    - Diferenças de sintaxe no backend
    - Olá Guards (de novo)
    - Introdução ao TypeORM
    - Decorators Personalizados
    - Supabase e Firestore para TTM (Time to Market) e ROI

---

# Detalhamento da spec (2026-08-12)

## Decisões de escopo confirmadas com o usuário
1. **A Seita Dev ainda não existe.** Não há grupo de WhatsApp aberto, canal com o conteúdo
   publicado nem plataforma de login. Portanto **nenhum CTA aponta para um link externo**: todos
   abrem um **modal de lista de espera** (nome, telefone e e-mail) prometendo **acesso antecipado
   gratuito** e contato quando a comunidade abrir. O envio é **mockado em um service**, sem API
   real por trás.
2. **Só apresentação e CTAs.** Login, jogos de conhecimento, ranking, área de assinante e checkout
   de pagamento ficam **fora desta spec**. Os valores (R$ 14,99 e R$ 150,00) aparecem como
   informação de página, não como cobrança.
3. **Rota `/comunidade` dedicada + CTA na landing.** A landing (`/`) segue sendo a página do
   professor particular; ganha uma seção de CTA levando à Seita. O `MenuBar` ganha o item
   "Comunidade" apontando para a nova rota, e não mais só âncoras.

## Consequência: a landing deixa de ser rota única
Hoje `app.routes.ts` tem `''` (landing) e `**` redirecionando para `''`. Passa a ter
`''`, `'comunidade'` (lazy) e `**`. O `MenuBar` hoje só conhece âncoras da mesma página
(`goTo()` com `scrollIntoView`); precisa suportar item de rota (`routerLink`) sem quebrar o
comportamento de âncora, e as âncoras da landing precisam continuar funcionando quando o usuário
estiver em `/comunidade` (o link volta para `/` e depois rola, ou simplesmente não exibimos as
âncoras da landing dentro da página da comunidade).

Decisão: o `MenuBar` recebe um input com os itens (`MenuItem[]` com `href` de âncora **ou**
`route`), a página passa o seu próprio conjunto, e o componente continua dumb. Na comunidade os
itens são as âncoras da própria página mais um link de volta para a landing.

## Estrutura da página `/comunidade` (mobile first)
1. **Hero da Seita** — nome "Seita Dev", tese em uma frase (comunidade aberta para compartilhar
   conhecimento), selo de "em construção" e CTA primário "Quero acesso antecipado" (abre o modal).
2. **O que é a Seita** — 3 a 4 cartões curtos: grupo aberto no WhatsApp, conhecimento compartilhado,
   jogos de conhecimento com ranking, conteúdo gratuito no canal do YouTube do Leno Borges.
3. **Os 33 Graus** — explica a progressão: Graus 1 a 5 livres para qualquer pessoa, do 5 em diante
   a assinatura simbólica de R$ 14,99 destrava vídeos e materiais de estudo. Visual com medidor de
   progressão (5 de 33 destacados), sem tabela pesada.
4. **A trilha de aprendizado** — timeline vertical com as 12 etapas, cada uma um accordion:
   fechado mostra ordem, ícone SVG da tecnologia e título; aberto revela os tópicos. Uma etapa
   aberta por vez não é obrigatório (múltiplas abertas é aceitável e mais simples com `<details>`).
5. **Não é sobre certificado** — bloco de posicionamento: a trilha existe para você discutir,
   debater e opinar sobre o assunto, não para decorar sintaxe nem para colecionar certificado.
6. **O Conclave** — mentoria em grupo: 2h por semana para no máximo 4 alunos, R$ 150,00, com
   feedback pessoal em cada exercício entregue na plataforma. CTA secundário abre o mesmo modal.
7. **Lista de espera / fechamento** — repete o CTA com o texto de acesso antecipado.
8. **Footer** — reaproveita o padrão da landing.

## Modal de lista de espera
- Componente dumb `WaitlistDialog` usando `<dialog>` nativo (`showModal()`), com foco preso pelo
  próprio elemento, fechamento por `Esc` e por botão, e retorno de foco ao gatilho.
- **Nunca disparar `alert`/`confirm`** (regra do ambiente e boa prática); todo feedback é inline.
- Formulário **reativo** (`ReactiveFormsModule`), campos: `nome` (obrigatório, mínimo 2),
  `telefone` (obrigatório, máscara leve/validação de 10 a 11 dígitos após limpar não dígitos),
  `email` (obrigatório, `Validators.email`), e um **checkbox de consentimento obrigatório**.
- Estados: `idle` → `sending` (botão desabilitado com indicador) → `success` (mensagem de
  confirmação substitui o formulário) ou `error` (mensagem com opção de tentar de novo).
- Erros de validação anunciados com `aria-describedby` + `aria-invalid`, e a mensagem de sucesso
  em uma região `aria-live="polite"`.

## Texto legal sobre uso dos dados (LGPD)
Texto curto e verdadeiro dentro do modal, sem inventar política de privacidade que não existe:
- quais dados são coletados (nome, telefone e e-mail);
- finalidade única: avisar sobre a abertura da Seita Dev e liberar o acesso antecipado gratuito;
- base legal: consentimento do titular (art. 7º, I da LGPD), dado pelo checkbox;
- não há compartilhamento com terceiros para fins publicitários;
- o titular pode pedir consulta, correção ou exclusão dos dados a qualquer momento pelo e-mail de
  contato do Leno Borges, e o consentimento pode ser revogado.

Como o envio é mockado nesta fase, o modal deixa explícito que ainda não há armazenamento em
servidor de produção. Trocar o mock por uma API real é o gatilho para revisar este texto.

## Service mockado (TDD, regra 6 do clauderc)
`WaitlistService` (`providedIn: 'root'`), responsabilidade única: registrar interesse.
- API: `submit(entry: WaitlistEntry): Observable<WaitlistReceipt>` (ou `Promise`), com atraso
  simulado (~600ms) para o estado de envio ser visível.
- `WaitlistEntry`: `{ name, phone, email, consent: true }`. `WaitlistReceipt`:
  `{ id, receivedAt }`.
- Normaliza o telefone (só dígitos) e o e-mail (trim + lowercase) antes de "enviar".
- Rejeita entrada sem consentimento (o formulário já bloqueia, o service não confia no chamador).
- Testes escritos **antes** da implementação: sucesso, normalização, recusa sem consentimento e
  propagação de erro.

## Modelo de dados
Novo arquivo `src/app/models/community.model.ts` (a Seita não é perfil do Leno; não polui
`profile.model.ts`) e novo `CommunityService` (`providedIn: 'root'`) com os dados estáticos:

```ts
export type TrackIconId =
  | 'stacks' | 'java' | 'sql' | 'git-github' | 'spring'
  | 'gcp' | 'html-css' | 'vercel' | 'angular' | 'devops' | 'nestjs';

export interface TrackStage {
  readonly id: string;
  readonly order: number;        // 1..12, dado real, sem lacunas
  readonly area: string;         // "Back-End", "Front-End", "Cloud Computing", "DevOps", "Fundamentos"
  readonly title: string;
  readonly icon: TrackIconId;
  readonly topics: readonly string[];
}

export interface CommunityTier {  // 33 Graus e o que cada faixa libera
  readonly id: string;
  readonly range: string;         // "Grau 1 ao 5", "Grau 5 ao 33"
  readonly price: string;         // "Gratuito", "R$ 14,99"
  readonly summary: string;
  readonly perks: readonly string[];
}

export interface CommunityHighlight { // "O que é a Seita"
  readonly id: string;
  readonly title: string;
  readonly detail: string;
}
```

Os textos de valor (R$ 14,99, R$ 150,00, 33 Graus, 2h para 4 alunos) vivem nesses dados, não
espalhados no template.

## Ícones SVG novos
Já existem: `java`, `sql`, `git-github`, `spring`, `html-css`, `angular`, `nestjs`, `ts-js`,
`caret`. Faltam, no mesmo padrão de `src/app/components/icons/` (traço `currentColor`, 24x24,
`aria-hidden`, sem emoji):
- `icon-stacks` (etapa 1, camadas empilhadas);
- `icon-gcp` (etapa 7, nuvem);
- `icon-vercel` (etapa 9, triângulo);
- `icon-devops` (etapa 11, ciclo de CI/CD);
- `icon-whatsapp` (identidade do grupo, usado no bloco "O que é a Seita");
- `icon-youtube` (conteúdo gratuito no canal).

O `IconCaret` existente é reaproveitado como indicador de abrir/fechar do accordion.

## Reaproveitamento e consistência visual
- Mesma paleta e mesmos tokens de `src/styles.scss`; nenhum token novo de cor além de derivados
  já existentes (`--aurora-*`, `--shadow-glow`).
- Reaproveita `PixelButton`, `PixelPanel`, `MenuBar`, `Reveal`, `StatTile` e o sistema de
  movimento ambiente (auroras, `sheen`, `animate-enter`/`animate-leave`) da spec 002.
- `LessonTrack` (trilha da primeira aula, 4 passos, sem accordion) **não** é reaproveitado: a
  trilha da Seita tem conteúdo expansível e 12 etapas. Nasce um `TrackTimeline` novo, e o
  `LessonTrack` continua na landing como está.
- Mobile first, sem emojis, sem travessões em texto visível, animações em `.scss`,
  `prefers-reduced-motion` respeitado, dumb components com a page fazendo as leituras.

## CTA na landing
Nova seção entre "Prova social" (`#dev`) e "Formação" (`#formacao`), id `#comunidade`:
convite curto para a Seita Dev, citando grupo aberto, 33 Graus e trilha, com botão primário
levando a `/comunidade` (`routerLink`) e um secundário abrindo direto o modal de lista de espera.
O `MenuBar` da landing ganha o item "Comunidade" apontando para a rota.

## Fora de escopo nesta spec
- Login, jogos de conhecimento, ranking e área de assinante.
- Checkout/pagamento da assinatura de R$ 14,99 e do Conclave de R$ 150,00.
- Backend real da lista de espera (o service é mock; a troca por HTTP é spec futura).
- Links reais de WhatsApp e YouTube (não existem ainda; nenhum `href` externo é inventado).
- Página de política de privacidade completa (o modal traz o aviso resumido).
