# Fix — E-mails caindo na aba de Promoções

**Data:** 2026-08-25  
**Problema:** Os e-mails da aplicação estão excessivamente estilizados (backgrounds, tabelas de layout, etc.), fazendo com que filtros de provedores como o Gmail os classifiquem na aba "Promoções" em vez da "Principal", diminuindo significativamente o alcance e a taxa de abertura.
**Scope reportado:** `EmailsModule → MailerService → renderEmail (email-template.ts)`

---

## 1. Diagnóstico

Atualmente, a arquitetura divide a responsabilidade da seguinte forma:
- **Frontend**: Envia o conteúdo como texto simples (separado por quebras de linha).
- **Backend**: O arquivo `email-template.ts` injeta o texto simples em um template HTML altamente diagramado.

O template atual no backend utiliza a seguinte estrutura:
- Fundo cinza (`#f4f5f7`).
- Estrutura centralizada baseada em `<table role="presentation">`.
- Cartão branco com bordas arredondadas.
- Cabeçalhos, textos e rodapés com diversas marcações inline e classes que configuram um formato "marketing".

Provedores de e-mail (especialmente o Gmail) usam o excesso de tags e proporção imagem/código/texto para classificar a mensagem. E-mails pessoais raramente contêm tabelas estruturais de layout e `background-colors` no `<body>`.

---

## 2. Correção necessária (Backend)

O conserto deve ser feito **exclusivamente no Backend** (no arquivo `src/emails/email-template.ts`), sem alterar contratos ou banco de dados. 
O template HTML deve ser simplificado para se assemelhar ao máximo com um e-mail transacional de texto simples enviado por um humano.

### 2.1. `email-template.ts` — Remoção de tabelas e backgrounds

Remover o embrulho de `<table>` e os fundos cinzas. O novo `html` devolvido por `renderEmail` deve ser algo limpo:

```html
<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #101828; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 24px;">
    <!-- Assunto apenas se desejarmos manter visualmente dentro do e-mail,
         ou remover se quisermos deixar 100% estilo "texto" -->
    <h1 style="font-size: 20px; margin-bottom: 24px;">\${escapeHtml(content.subject)}</h1>
    
    <!-- Parágrafos com espaçamento nativo ou margin simples -->
    \${htmlParagrafos}
    
    <!-- CTA convertido de botão para link simples ou botão minimalista -->
    \${htmlCta}
    
    <hr style="border: none; border-top: 1px solid #eaecf0; margin: 32px 0 24px;">
    
    <!-- Rodapé sem fundo diferenciado -->
    <p style="font-size: 12px; color: #667085;">
      Você recebe este e-mail porque é membro da Liga Dev.<br>
      <a href="\${escapeHtml(content.unsubscribeUrl)}" style="color: #6941c6;">Cancelar inscrição</a>.
    </p>
  </body>
</html>
```

Os botões (`htmlCta`) devem perder paddings exagerados, priorizando texto ancorado com destaque sutil ou botões simples de texto puro, parecendo uma assinatura.

---

## 3. Resumo de Ação

| # | Ação | Arquivo | Prioridade |
|---|---|---|---|
| 1 | Simplificar HTML (remover tabela, body background, etc.) | `src/emails/email-template.ts` | Alta — Recupera engajamento |

---

## 4. Desfecho — 2026-08-26: o diagnóstico acima estava errado

**A simplificação foi feita (commit `58c5bdb`) e o e-mail continuou caindo em Promoções.**

A causa real não estava no HTML e não estava neste repositório: no painel do **Resend**, o *Open Tracking*
e o *Click Tracking* estavam ligados no domínio. Com eles ligados, o provedor injeta um **pixel de imagem
1×1** e **reescreve todo link** para passar por um domínio de rastreamento — tudo isso *depois* de o
template sair do `renderEmail`. O que o Gmail recebia não era mais o HTML que este código gerava, e é por
isso que limpar o HTML não mudou nada. Pixel invisível e link reescrito são dois dos sinais mais fortes de
correio de marketing que existem.

Desligados os dois, o e-mail passou a cair na aba **Principal**.

**Consequência:** o HTML diagramado foi **restaurado** — tabela de layout, cartão branco, botão do CTA. Ele
nunca foi a causa, e a única coisa que a simplificação produziu foi um e-mail mais feio, uma suíte de
testes vermelha no `dev` e uma fase inteira de spec (Fase 08) construída sobre uma premissa falsa.

**O que fica como regra:** o template não é a última coisa que acontece com o e-mail. Entre o `renderEmail`
e a caixa de entrada existe um provedor que pode reescrever o documento. Quando o sintoma for de
classificação, **o painel do provedor se confere antes do código**.

Ver Fase 09 em `tasks.md`.

---

## 5. Desfecho do desfecho — 2026-08-26 (tarde): eram os dois, e o HTML é um deles

**A seção 4 acertou o rastreamento e errou ao declarar o HTML inocente.** Com o *Open Tracking* e o
*Click Tracking* **já desligados** no painel do Resend, os e-mails voltaram a cair em **Promoções** — e
desta vez o suspeito foi medido sozinho, que é o que faltava antes:

| Envio de teste (`POST /admin/emails/teste`), mesma conta do Gmail, rastreamento desligado | Aba |
|---|---|
| Template diagramado (tabela, fundo cinza, cartão branco, `<h1>` do assunto, botão) | **Promoções** |
| Template limpo (só `<p>`, `<hr>`, links) | **Principal** |

Uma variável por vez, e a resposta veio inteira: **o rastreamento do provedor e a marcação eram duas
causas, não uma.** Desligar o rastreamento tirou o pixel 1×1 e a reescrita de link; enquanto o HTML
continuou com cara de campanha, isso não bastou. O erro da seção 4 não foi a medição — foi a conclusão
tirada dela: *"desligar o rastreamento resolveu"* virou *"o HTML nunca foi a causa"*, e a segunda frase
não estava medida.

**O que mudou no código.** O `email-template.ts` volta a ser limpo, e agora com trava:

- Sem `style` inline em lugar nenhum — nem no `<body>`, nem nos parágrafos, nem nos links.
- Sem `<table>` de layout, sem fundo colorido, sem cartão branco.
- **Sem o `<h1>` que repetia o assunto** (a Task 02 da Fase 08, que estava cancelada e voltou): o assunto
  já está no cabeçalho da mensagem, e repeti-lo em fonte grande é abertura de newsletter.
- O CTA é um **link dentro de um parágrafo**, e nunca um botão com `padding` e `background`.
- `email-template.spec.ts` ganhou um **teste-trava** que falha se `style=`, `<table>`, `<img>`,
  `background`, `border-radius` ou `padding` reaparecerem no HTML gerado, e outro que falha se o assunto
  voltar para dentro do corpo. Sem eles, o pedido estético mais natural do mundo — "dá um destaque nesse
  link" — devolve a aba de Promoções em silêncio, porque nada quebra e o envio continua funcionando.

**A regra da seção 4 continua valendo, e ganha uma segunda metade:** o template não é a última coisa que
acontece com o e-mail, *e* o painel do provedor não é a única coisa que decide a aba. Quando um suspeito
some e o sintoma fica, o suspeito seguinte não é o mesmo de antes com outra roupa — **é o que ainda não
foi medido isolado**.

Ver Fase 10 em `tasks.md`, e a decisão 11-B em `context.md`, que deixa de estar revogada.

## 6. Terceiro desfecho — 2026-08-26 (fim do dia): a configuração foi auditada, e o HTML voltou

**Este documento já condenou o HTML duas vezes e o absolveu uma.** A seção 5 fechou com a marcação como
segunda causa; o sintoma continuou se comportando de forma que aquela medição não explica, e a pergunta
que nunca tinha sido feita direito foi feita: **existe configuração pendente, fora deste repositório?**

As duas frentes foram conferidas por API, e não por memória:

| Frente | Estado |
|---|---|
| Domínio `lenoborges.com.br` no Resend | `status: verified`, `sending: enabled` |
| *Open Tracking* / *Click Tracking* | **desligados** nos dois |
| DKIM `resend._domainkey` | `verified` |
| Return-path `send.lenoborges.com.br` (TXT `include:amazonses.com` + MX `feedback-smtp.sa-east-1`) | `verified` |
| DMARC `_dmarc.lenoborges.com.br` | publicado, `p=none;` |
| Zona DNS | registro.br (`d/e.sec.dns.br`) — **a Vercel não gerencia zona deste domínio** |
| Env de produção `api-lenoborges` | as seis variáveis de e-mail presentes |

Duas coisas que a auditoria esclareceu:

1. **O SPF da raiz não menciona o Resend, e isso está correto.** A raiz é
   `v=spf1 include:_spf.firebasemail.com ~all`, do Firebase. O envelope MAIL FROM do Resend é
   `send.lenoborges.com.br`, que tem SPF próprio — o SPF é conferido contra o subdomínio, e ele alinha
   com o DMARC em modo relaxado. **Acrescentar `amazonses` à raiz não conserta nada e mexe no SPF do
   Firebase.**
2. **A única pendência real é inerte, e é perigosa por outro motivo:** há um registro de *Tracking*
   `CNAME liga → links1.resend-dns.com` em `status: "failed"` no painel, sobra de quando o subdomínio de
   rastreamento não era o `mail` de hoje. Com o rastreamento desligado ele não faz nada — mas
   `liga.lenoborges.com.br` é o **domínio de produção do front na Vercel**, e um CNAME de tracking que
   verificasse ali derrubaria o site. Remover no painel.

**Nenhuma pendência de configuração explica a aba de Promoções.** Com o provedor e o DNS limpos e
conferidos, o envio de teste foi refeito e a marcação **não** decidiu a aba. O HTML diagramado voltou, e
as travas da seção 5 saíram, porque elas proibiam exatamente o que voltou.

**A regra que sobra das três voltas** — e é a mais cara deste documento inteiro: *este template é o
suspeito mais fácil de acusar e o mais caro de condenar.* Tirar estilo dele nunca quebra nada. A suíte
fica verde, o envio continua funcionando, e o sintoma se move ou não por conta de outra coisa — o que
torna a "correção" impossível de refutar e o e-mail permanentemente feio. **A ordem certa de
investigação é: painel do provedor, DNS, plataforma, e só então o código.** Ver Fase 11 em `tasks.md`.
