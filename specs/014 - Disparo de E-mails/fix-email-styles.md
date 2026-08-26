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
