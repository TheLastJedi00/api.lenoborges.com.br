# Fase 01: Domínio da Seita Dev [x]
- [x] Task 01 (TDD): Spec de `CommunityService` antes da implementação (trilha com 12 etapas, `order` sem lacunas e ids únicos, tiers dos 33 Graus, highlights)
- [x] Task 02: Criar `src/app/models/community.model.ts` com `TrackStage`, `TrackIconId`, `CommunityTier` e `CommunityHighlight`
- [x] Task 03: Criar `CommunityService` (`providedIn: 'root'`) com os dados estáticos da Seita: 12 etapas da trilha com seus tópicos, faixas de Grau (1 a 5 gratuito, 5 a 33 por R$ 14,99), highlights e dados do Conclave

# Fase 02: Lista de espera (service mockado) [x]
- [x] Task 01 (TDD): Spec de `WaitlistService` antes da lógica (sucesso com recibo, normalização de telefone e e-mail, recusa sem consentimento, propagação de erro)
- [x] Task 02: Implementar `WaitlistEntry`/`WaitlistReceipt` e `WaitlistService` com envio mockado e atraso simulado

# Fase 03: Ícones SVG [x]
- [x] Task 01: Criar `IconStacks`, `IconGcp` e `IconVercel` no padrão de `components/icons`
- [x] Task 02: Criar `IconDevops`, `IconWhatsapp` e `IconYoutube` no mesmo padrão, mais `IconRanking` e `IconShare` (os highlights "jogos com ranking" e "conhecimento compartilhado" também precisam de ícone próprio)

# Fase 04: Componentes dumb da Seita [x]
- [x] Task 01: `TrackTimeline` (timeline vertical mobile first, cada etapa um accordion com `<details>`, ícone SVG por etapa e `IconCaret` como indicador)
- [x] Task 02: `GradeLadder` (progressão dos 33 Graus com os 5 gratuitos destacados e o que a assinatura simbólica destrava)
- [x] Task 03: `WaitlistDialog` com `<dialog>` nativo, formulário reativo (nome, telefone, e-mail, consentimento), estados idle/sending/success/error, aviso legal de uso dos dados e acessibilidade (`aria-invalid`, `aria-describedby`, `aria-live`)
- [x] Task 04: `MenuBar` passa a receber os itens por `input()` e a suportar item de rota (`routerLink`) além de âncora, sem quebrar o `goTo()` atual

# Fase 05: Página /comunidade [x]
- [x] Task 01: Registrar a rota `comunidade` com lazy loading e title em `app.routes.ts`
- [x] Task 02: Hero da Seita Dev com selo de "em construção" e CTA de acesso antecipado, mais a seção "O que é a Seita" (grupo aberto, conhecimento compartilhado, jogos com ranking, conteúdo no YouTube)
- [x] Task 03: Seção dos 33 Graus com `GradeLadder` e seção da trilha com `TrackTimeline`
- [x] Task 04: Seção "Não é sobre certificado" e seção do Conclave (2h semanais para 4 alunos, R$ 150,00, feedback por exercício)
- [x] Task 05: Seção final de lista de espera, footer e ligação de todos os CTAs ao `WaitlistDialog` via `WaitlistService`

# Fase 06: CTA na landing [x]
- [x] Task 01: Nova seção `#comunidade` na landing convidando para a Seita, com botão para `/comunidade` e atalho para o modal de lista de espera
- [x] Task 02: Item "Comunidade" no `MenuBar` da landing usando o novo suporte a rota

# Fase 07: Acessibilidade e validação [x]
- [x] Task 01: Revisar contraste, foco visível, navegação por teclado no accordion e no `<dialog>`, e `prefers-reduced-motion` nas novas animações
- [x] Task 02: Rodar `ng test`, validar no Chrome em 390px, 768px e 1440px sem scroll horizontal e sem erro de console
- [x] Task 03: Build de produção (`ng build --configuration production`) e checklist final da spec

## Checklist final
- [x] `ng build --configuration production` sem erros
- [x] `ng test` verde, incluindo as specs TDD de `CommunityService` e `WaitlistService`
- [x] Rota `/comunidade` com lazy loading e CTA na landing levando até ela
- [x] Trilha com as 12 etapas em timeline accordion, cada uma com ícone SVG próprio
- [x] 33 Graus explicados: gratuito até o Grau 5, R$ 14,99 do 5 em diante
- [x] Conclave apresentado com valor, formato e feedback por exercício
- [x] Posicionamento "não é sobre certificado" presente
- [x] Modal de lista de espera funcional com aviso legal de uso dos dados e envio mockado
- [x] Nenhum link externo inventado para WhatsApp ou YouTube
- [x] Sem emojis, sem travessões em texto visível, SVGs componentizados
- [x] Mobile first validado em 390/768/1440px, `prefers-reduced-motion` respeitado

## Validação executada (2026-08-12)
- `ng test` no Chrome real: 28/28 specs verdes (13 anteriores, 9 de `CommunityService`, 6 de `WaitlistService`).
- `ng build --configuration production` sem erros; `comunidade-page` sai em chunk lazy próprio (31,83 kB).
- Playwright em 390px, 768px e 1440px: sem scroll horizontal, sem erro de console, nenhum elemento preso em `reveal-idle`.
- Contraste WCAG dos pares novos entre 4,90:1 e 17,75:1 (mínimo AA de 4,5:1), medindo o stop mais escuro dos gradientes.
- Teclado: accordion abre com Enter, `<dialog>` recebe e devolve o foco, fecha com Esc; foco visível com outline de 3px.
- `prefers-reduced-motion: reduce`: nenhum elemento preso em `opacity: 0`.
- Fluxo da lista de espera ponta a ponta: validação inline, envio, estado de sucesso e fechamento.
