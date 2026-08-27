# Spec 018: Termos de Uso e Política de Privacidade

## Objetivo
O produto cobra assinatura, guarda nome, telefone, bio e e-mail, dispara campanhas para a caixa de
entrada de quem se cadastrou, publica pergunta de aluno em vídeo e leva todo mundo para um grupo de
WhatsApp que não é nosso. Nada disso está escrito em lugar nenhum, e ninguém nunca concordou com nada.

Esta spec escreve os dois documentos e faz o produto **exigir o aceite antes de funcionar**. Não é tela:
é a primeira vez que este backend recusa uma requisição por uma razão que não é sessão, não é papel e não
é tier — é **condição prévia**, e ela tem um código de status próprio.

O par desta spec no front é a **018**, e as duas entram juntas.

---

## Numeração
Os números são iguais nos dois repositórios: 016 é Adiantar e Editar no Mural, 017 é Respostas em
Retrato, 018 é esta. No front não existe 006 nem 007, e aqui não existe 008 — a divergência é antiga e
não muda nada.

---

## Decisões

### 1. O texto mora aqui, junto da versão, e essa é a decisão que evita a única falha grave possível
O texto poderia morar no front — é conteúdo, o front desenha conteúdo, e editá-lo não exigiria subir uma
API. Ele mora aqui mesmo assim, e a razão é uma só: **quem sabe qual é a versão vigente precisa ser quem
guarda o texto.**

Com o texto no front e a versão no backend, existe um estado em que a cláusula de reembolso mudou, o
número não mudou, e **ninguém é chamado a aceitar de novo**. Nada falha, nada aparece no log, e a
descoberta acontece no dia em que alguém pede o reembolso citando um texto que o produto não mostra mais.
É exatamente a classe de erro que a spec 010 evitou no rollover do Mural e a spec 016 evitou no
`promotedTo`: o problema não é o sistema quebrar, é ele continuar respondendo `200` com a resposta
errada.

Com os dois no mesmo módulo, editar o texto e esquecer a versão vira problema de revisão de código — e a
decisão 3 transforma até isso em teste vermelho.

### 2. O documento é estrutura, nunca HTML
`GET /legal/documents/:id` devolve
`{ id, title, version, updatedAt, sections: [{ heading, paragraphs }] }`. Sem tag, sem markdown, sem
`<p>`.

O front renderiza `@for` sobre seções e parágrafos. **Não existe `innerHTML` neste caminho**, e é
proposital: o dia em que o texto virar HTML é o dia em que o front precisa de um
`bypassSecurityTrustHtml` para desenhá-lo, e aquele `bypass` fica no código para sempre — inclusive
quando a fonte deixar de ser uma constante nossa e passar a ser um campo editável por alguém.

Negrito e link dentro do parágrafo ficam de fora por ora (ponto em aberto 4). O texto foi escrito para
não precisar deles.

### 3. A versão é uma data, e o texto é verificado por hash
Cada documento exporta `version` no formato `YYYY-MM-DD` e um `contentHash` — SHA-256 do texto
concatenado, literal no arquivo.

Um teste unitário recalcula o hash e compara. **Editar uma vírgula do texto derruba a suíte**, e o único
jeito de deixá-la verde é escrever o hash novo — o que obriga a olhar a linha da versão, que está logo
acima. É a mesma ideia do caminho como garantia de unicidade, aplicada a conteúdo: a regra vale porque
não existe caminho para violá-la em silêncio.

Data e não `v1`, `v2`: "aceitei em 12/03 a versão de 27/08" é uma frase que se entende sem consultar
tabela nenhuma, e é a frase que a tela de Contratos precisa mostrar.

### 4. Ler é público; aceitar exige sessão
| Rota | Guard |
|---|---|
| `GET /legal/documents` | nenhum |
| `GET /legal/documents/:id` | nenhum |
| `POST /me/legal-acceptances` | `FirebaseAuthGuard` |

O rodapé da landing aponta para os dois documentos, e quem lê ali ainda não tem conta — **exigir login
para ler o contrato é exigir que a pessoa concorde antes de poder ler**. É a mesma razão pela qual
`/descadastro` é pública (spec 014, decisão 11): a página existe justamente para quem está fora.

### 5. Aceita-se um documento por chamada, e a versão vai no corpo
`POST /me/legal-acceptances` recebe `{ documentId, version }` e responde `204`.

**Um por chamada, e não um "aceito tudo que estiver vigente".** São dois modais, abertos em momentos
diferentes, e cada um tem o próprio check. Um endpoint que aceita o pacote inteiro deixa um bug de front
registrar aceite de um documento que ninguém abriu — e o registro de aceite é a única prova que vai
existir de que alguém concordou.

**A versão vem no corpo e é conferida contra a vigente.** Versão diferente é `409`: significa aba velha,
aberta desde antes do deploy, e o aceite dela é de um texto que não é mais o texto. A resposta diz qual é
a vigente, e o front recarrega o documento.

### 6. O que fica guardado são duas coisas, e a diferença entre elas é o ponto
```
profiles/{uid}
  legalAcceptances: { [documentId]: { version, acceptedAt } }    ← estado atual

profiles/{uid}/legal_acceptances/{documentId}__{version}         ← histórico
  documentId, version, acceptedAt
```

O **mapa no perfil** responde "esta pessoa está em dia" na leitura que a requisição já faz — sem consulta,
sem índice, sem custo novo. É ele que o guard da decisão 8 lê, em todo request.

A **subcoleção** responde "quando ela aceitou a versão de agosto", que é a pergunta que aparece quando
alguém contesta uma cobrança. O mapa perde essa informação na próxima versão, porque sobrescreve.

O caminho `{documentId}__{version}` é a garantia de unicidade de sempre: duplo clique não grava duas
vezes. E é **`create()`, nunca `set()`** — o `ALREADY_EXISTS` aqui significa "já tinha aceitado", que é
sucesso, e é tratado como `204` sem reescrever a data. Reescrever a data seria apagar quando a pessoa
realmente aceitou.

> `legalAcceptances` no converter leva **`?? {}`**, e é o fallback mais caro de perder desta spec.
> Documento antigo não tem o campo — e são todos, no dia em que isto sobe. Sem ele o valor chega
> `undefined`, o guard tenta indexá-lo e a base inteira toma `500` em toda rota. É o mesmo cuidado do
> `emailOptOut ?? false` da spec 014, com a diferença de que este falha ruidosamente em vez de em
> silêncio — o que, aqui, é sorte, não projeto.

### 7. Não guardamos IP nem user-agent
A prática comum é carimbar IP e navegador junto do aceite, como prova. Aqui não.

A pessoa está autenticada: o `uid`, a data e a versão já dizem quem aceitou o quê e quando, e é o
provedor de identidade que responde por "era mesmo ela". IP e user-agent seriam **dado pessoal novo, com
finalidade única de uma disputa que não existe** — e a spec 013 escreveu a condição de que a exclusão de
conta depende: nenhuma coleção nova pode guardar `uid` ao lado de dado pessoal. Um registro de aceite com
IP não quebra aquela condição hoje, porque morre com o perfil; mas é o primeiro passo do caminho que
quebra.

Se um dia a prova precisar ser mais forte que isso, o caminho é outro — carimbo de tempo assinado, não
mais dado pessoal.

### 8. O bloqueio é guard e responde `428`
`LegalAcceptanceGuard` roda depois do `FirebaseAuthGuard` e recusa toda rota autenticada enquanto houver
documento vigente não aceito:

```
428 Precondition Required
{ "error": "legal_acceptance_required",
  "pending": [{ "id": "termos-de-uso", "version": "2026-08-27", "title": "Termos de Uso" }] }
```

**Por que no backend, e não só no modal do front:** é a decisão 10 da spec 013 de novo, com as mesmas
palavras. Um modal que o navegador descarta é proteção nenhuma, e o propósito inteiro desta spec é que
ninguém use o produto sem ter concordado. Se o bloqueio vivesse só na tela, a frase "todo membro aceitou
os termos" seria falsa e ninguém saberia.

**Por que `428` e não `403`:** `403` diz "você não pode" e não tem continuação; `428` diz "falta uma
condição prévia" e vem com a lista do que falta. O front distingue os dois pelo número, sem procurar
texto dentro de mensagem de erro — que é o acoplamento que quebra na primeira revisão de copy.

A lista de exceções é curta e cada linha tem motivo:

| Livre do guard | Por quê |
|---|---|
| tudo em `/auth` | entrar e sair não podem depender de aceitar nada |
| `GET /me` | é por onde o front descobre o que falta (decisão 9) |
| `POST /me/legal-acceptances` | é a saída do bloqueio |
| `GET /legal/**` | já é público |
| `PATCH /me/emails` | descadastro nunca depende de aceite |

**`PATCH /me/profile` fica de fora da lista, e é o detalhe que faz o onboarding funcionar de graça.**
Aquele é o endpoint que carimba `completedAt`; barrado pelo guard, quem não aceitou não conclui o
onboarding. O bloqueio do membro novo e o do membro antigo passam a ser **a mesma regra, num lugar só** —
sem um `if` extra dentro do `ProfileService` que envelheceria sozinho.

**Admin não é exceção.** Um admin isento seria a única conta do produto capaz de operar sem concordar com
o produto, e a isenção viraria a explicação de por que ninguém testou o fluxo. Ver o ponto em aberto 3,
que é o preço disso.

### 9. `GET /me` passa a dizer o que falta
`ProfileDto` ganha `pendingLegal: LegalDocumentSummary[]` — a mesma lista do corpo do `428`, calculada
pelo mesmo serviço.

Existem os dois caminhos, e não é redundância:

- o `GET /me` avisa **na entrada**, e é por ele que o painel já nasce com o modal por cima, sem esperar
  uma requisição qualquer falhar por acaso;
- o `428` pega a versão publicada **enquanto a pessoa estava com a aba aberta**, que é o caso que
  nenhuma checagem no carregamento alcança.

Um só dos dois deixa um buraco: só o `GET /me`, e quem ficou logado durante o deploy usa o produto a
semana inteira sob o texto antigo; só o `428`, e o bloqueio aparece quando der, depois de uma tela já
meio desenhada.

### 10. O texto não promete nada que o código não faça
Três frases dos documentos são código, e estão escritas para bater com ele:

| O texto diz | O código que sustenta |
|---|---|
| "usamos autenticação de terceiros e não temos acesso à sua senha" | login é Identity Toolkit, senha definida em tela hospedada (specs 005, 007) |
| "o e-mail cadastrado recebe atualizações da comunidade, e você pode sair quando quiser" | `emailOptOut` e `/descadastro` (spec 014) |
| "você pode corrigir seus dados ou apagar sua conta a qualquer momento" | Meu Perfil e `DELETE /me` (spec 013) |

A regra que fica: **nenhuma cláusula futura pode descrever um mecanismo que não existe.** A tentação é
escrever "podemos reter dados por exigência legal por até X anos" quando nada no código retém nada. Texto
jurídico que descreve um sistema imaginário é pior que texto ausente, porque cria obrigação sem
implementação.

Em particular, o opt-out continua **absoluto** (spec 014, decisão 8). A política diz que enviamos e diz
como parar; ela não abre exceção para "comunicado importante", porque o código não tem essa exceção e não
vai ganhar uma por causa de um parágrafo.

### 11. Excluir a conta apaga a subcoleção de aceites — explicitamente
Terceira vez que esta linha aparece (spec 012 para `notification_reads`, spec 013 para os votos, agora
aqui): **subcoleção não some com o pai no Firestore.** `legal_acceptances` entra no passo 4 da ordem de
exclusão da spec 013, junto de `notification_reads` e antes de `profiles/{uid}`.

Não guardar o aceite depois da exclusão é a escolha certa: ele é dado pessoal, a pessoa pediu para ser
esquecida, e o contrato que ele comprova terminou junto com a conta.

### 12. Nenhum índice composto novo
O mapa é lido por caminho. A subcoleção é escrita por caminho e lida por caminho — a tela de Contratos
mostra o que está no mapa, não o histórico.

Este produto tem quatro índices compostos, todos anteriores a esta spec, e a tabela do `README.md` não
ganha linha. Ver a decisão 12 da spec 013.

---

## Endpoints

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/legal/documents` | — | `200` `LegalDocumentSummaryDto[]` |
| `GET` | `/legal/documents/:id` | — | `200` `LegalDocumentDto` |
| `POST` | `/me/legal-acceptances` | `documentId`, `version` | `204` |

Throttle: `POST /me/legal-acceptances` em `10/min` — são dois aceites por pessoa na vida normal, e o
limite existe só contra script. Os `GET` herdam o padrão global.

### Erros

| Situação | Status | Corpo |
|---|---|---|
| `documentId` desconhecido | `404` | `Documento não encontrado.` |
| Versão diferente da vigente | `409` | `{ error: 'stale_version', current: '2026-08-27' }` |
| Aceite repetido da mesma versão | `204` | idempotente, não reescreve a data |
| Documento vigente não aceito, em rota protegida | `428` | `{ error: 'legal_acceptance_required', pending: [...] }` |

---

## Modelo

```
profiles/{uid}
  ...campos de sempre
  legalAcceptances: { [documentId]: { version: string, acceptedAt: Timestamp } }   ← novo, ?? {}

profiles/{uid}/legal_acceptances/{documentId}__{version}                            ← nova subcoleção
  documentId: string
  version: string
  acceptedAt: Timestamp
```

Nenhuma coleção nova de primeiro nível. Nenhum índice.

---

## Fora de escopo

- **Versionar o texto no banco.** Os documentos são constantes do código e sobem com deploy. Uma tela de
  administração que edita cláusula é publicar contrato sem revisão, por um formulário, às 23h.
- **Histórico legível pelo membro.** A tela de Contratos mostra a versão vigente e a data em que ela foi
  aceita. Listar a subcoleção inteira é uma leitura a mais para uma pergunta que ninguém fez ainda.
- **Aceite de terceiros pelo admin.** Não existe endpoint que registre aceite em nome de outra pessoa, e
  é a definição de aceite que impede.
- **Exportar meus dados.** Continua fora, como na spec 013, e a política **não promete** o que não
  existe: ela aponta o canal de contato, que é o que há.
- **Cookie banner.** Não há cookie de terceiro nem rastreio publicitário neste produto; o que existe é o
  cookie de refresh, estritamente necessário, e um booleano no `localStorage`. A política descreve os
  dois e não pede consentimento para nenhum, porque a lei não pede.
- **Idioma.** Só português.

---

## Specs afetadas

### Spec 005 (Autenticação e Dashboard) — vigente, com uma condição nova
`PATCH /me/profile` continua idêntico. O que muda é que ele passa a poder responder `428` antes de
executar, e o onboarding do front precisa ter recolhido os dois aceites antes de chamá-lo (decisão 8).

### Spec 007 (Firestore e Firebase Auth) — vigente
A frase "não temos acesso à sua senha" nos Termos é a decisão 3 de lá dita em português para quem não lê
código. Se um dia a definição de senha voltar para dentro desta API, **o texto muda junto**.

### Spec 013 (Meu Perfil) — vigente, estendida
Ganha a seção **Contratos** no front. Aqui, ganha uma linha na ordem de exclusão (decisão 11) e a
confirmação de que a decisão 7 daquela spec continua verdadeira: a subcoleção nova guarda `uid` no
caminho e nenhum dado pessoal no corpo, e morre com o perfil.

### Spec 014 (Disparo de E-mails) — vigente, e o texto encosta nela
A política de privacidade descreve o envio programado e o descadastro. **Nada no código muda**, e é isso
que a torna verdadeira. `PATCH /me/emails` entra na lista de isenções do guard porque descadastrar-se não
pode depender de concordar com nada.

### Specs 010 e 016 (Mural) — vigentes
Os Termos passam a dizer, em texto, o que o produto já faz: a pergunta publicada é visível para a
comunidade, pode ser respondida em vídeo na trilha e permanece publicada depois da exclusão da conta,
anonimizada. Nenhuma das três é nova — a spec 013 já as implementou. O que faltava era alguém ter sido
avisado.

---

## Anexo A — Termos de Uso (versão 2026-08-27)

### 1. Aceitação
Ao criar uma conta, assinar um plano ou usar a Liga Dev, você concorda com estes Termos de Uso e com a
Política de Privacidade. Se você não concorda com qualquer ponto, não use a plataforma.

A Liga Dev é operada por Leno Borges, professor particular de programação, com atuação em Blumenau, Santa
Catarina, e atendimento online. O contato oficial é comunidade@lenoborges.com.br.

Se você tem menos de 18 anos, o aceite precisa ser dado por seu responsável legal, que responde por ele.

### 2. O que a plataforma é
A Liga Dev é uma comunidade de estudo com trilha de vídeos, mural de perguntas e um grupo de mensagens
para conversa entre membros. É material de ensino e acompanhamento; não é curso com certificação, não é
consultoria e não é garantia de emprego, aprovação, salário ou qualquer outro resultado.

O conteúdo pode mudar. Vídeos podem ser adicionados, reorganizados ou removidos, e a estrutura da trilha
pode ser revista sem aviso prévio.

### 3. Conta e credenciais
Sua conta é pessoal e intransferível. Você responde por tudo o que acontece nela.

A autenticação é feita por serviço de terceiros. Sua senha é definida e guardada por esse serviço: nós
não a vemos, não a armazenamos e não conseguimos recuperá-la. Perda de acesso por senha esquecida se
resolve pelo fluxo de redefinição, e não por nós.

Compartilhar credenciais, revender acesso ou usar a conta de outra pessoa é motivo de bloqueio imediato.

### 4. Assinatura, pagamento e ausência de reembolso
O acesso a parte do conteúdo depende de assinatura ativa. Os valores e os planos vigentes são os exibidos
na plataforma no momento da contratação.

**Não há reembolso.** Nem parcial, nem proporcional, nem por período não utilizado. Isso vale para
cancelamento por sua iniciativa, para desistência, para inatividade e para encerramento da conta por
descumprimento destes Termos.

Cancelar interrompe as cobranças seguintes; não devolve as anteriores. O acesso permanece até o fim do
período já pago, salvo nos casos de bloqueio previstos na cláusula 6.

O preço pode ser reajustado. O reajuste é comunicado por e-mail com antecedência e vale para os ciclos
seguintes ao aviso.

### 5. Grupo de mensagens e conteúdo de terceiros
O grupo de WhatsApp da comunidade funciona em plataforma de terceiros, sob os termos dessa plataforma, e
é espaço de conversa entre membros.

**Não somos responsáveis pelo que os membros dizem ou compartilham ali.** Não há moderação contínua nem
leitura de tudo o que é publicado. Mensagens, arquivos, links, ofertas, opiniões e combinações feitas no
grupo são de responsabilidade de quem as publica, e qualquer negócio fechado entre membros é entre eles.

O mesmo vale para links externos citados no mural, nos vídeos ou no grupo: eles levam a conteúdo que não
é nosso e que não controlamos.

Se algo no grupo violar estes Termos, avise em comunidade@lenoborges.com.br. Avisos são analisados, mas
não há prazo de resposta garantido.

### 6. Conduta e sanções
É proibido publicar, no grupo, no mural ou em qualquer área da plataforma, conteúdo que seja ilegal ou
que promova ilegalidade — o que inclui material que viole direito autoral, conteúdo sexual envolvendo
menores, discurso de ódio, ameaça, assédio, discriminação, fraude, golpe, dado pessoal de terceiros sem
autorização, malware, credencial vazada e pirataria de qualquer natureza.

Também é proibido divulgar produto ou serviço próprio sem autorização, extrair conteúdo da plataforma em
massa e redistribuir material de aula.

**Conteúdo ilegal no grupo ou no mural resulta em bloqueio da conta, remoção e banimento do grupo da
comunidade e cancelamento da assinatura, sem reembolso de qualquer valor já pago.** A medida é imediata e
não depende de aviso prévio. Casos graves são comunicados às autoridades competentes.

Infrações menos graves podem receber advertência ou suspensão temporária, a nosso critério. A ausência de
sanção em um caso não impede sanção em outro.

### 7. Conteúdo que você publica
As perguntas que você publica no mural são visíveis para os demais membros e podem ser respondidas em
vídeo na trilha, com o texto da pergunta e o seu nome de exibição.

Ao publicar, você nos autoriza a exibir, reproduzir e adaptar esse conteúdo dentro da plataforma e nos
materiais da comunidade, sem prazo e sem contrapartida financeira. Você continua sendo o autor do que
escreveu.

Se você apagar sua conta, suas perguntas permanecem publicadas de forma anônima, sem seu nome — elas
carregam votos de outras pessoas e podem já ter sido respondidas em vídeo.

Publique apenas conteúdo que seja seu ou que você tenha o direito de compartilhar.

### 8. Propriedade intelectual
Os vídeos, textos, exercícios, marca, layout e código da plataforma são de titularidade de Leno Borges ou
de seus licenciadores.

Sua assinatura dá direito de acesso pessoal ao conteúdo. Ela não dá direito de copiar, baixar em massa,
gravar, republicar, revender, exibir publicamente, usar em treinamento de modelo de inteligência
artificial ou criar obra derivada do material.

### 9. Disponibilidade
A plataforma é oferecida no estado em que se encontra. Não garantimos funcionamento ininterrupto,
ausência de erros ou compatibilidade com todo dispositivo e navegador.

Manutenções, atualizações e interrupções por falha de fornecedores podem ocorrer. Períodos de
indisponibilidade não geram crédito nem prorrogação de assinatura.

### 10. Limitação de responsabilidade
Na máxima extensão permitida pela lei aplicável, não respondemos por lucros cessantes, perda de dados,
perda de oportunidade, dano indireto ou dano decorrente do uso ou da impossibilidade de uso da
plataforma, nem por atos de outros membros.

Havendo responsabilidade que não possa ser afastada, ela fica limitada ao valor pago por você nos 3 meses
anteriores ao evento.

### 11. Encerramento
Você pode encerrar sua conta a qualquer momento pela própria plataforma, em Meu Perfil. O encerramento é
imediato e definitivo, e não gera reembolso.

Podemos encerrar ou suspender contas em caso de descumprimento destes Termos, de inadimplência ou de
encerramento do serviço. Se a plataforma for descontinuada por nossa iniciativa, avisaremos por e-mail
com antecedência razoável.

### 12. Alterações destes Termos
Estes Termos podem mudar. Alterações relevantes são comunicadas na plataforma, e o uso passa a exigir um
novo aceite: enquanto ele não for dado, o acesso ao painel fica bloqueado.

Cada versão tem uma data. A data da versão que você aceitou fica registrada na sua conta e pode ser
consultada em Meu Perfil, na seção Contratos.

### 13. Lei aplicável e foro
Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de
Blumenau, Santa Catarina, para dirimir qualquer questão, com renúncia a qualquer outro.

---

## Anexo B — Política de Privacidade (versão 2026-08-27)

### 1. Quem trata seus dados
O responsável pelo tratamento dos dados desta plataforma é Leno Borges, com atuação em Blumenau, Santa
Catarina. Contato para qualquer assunto de privacidade: comunidade@lenoborges.com.br.

Esta política explica o que coletamos, por que, com quem compartilhamos e o que você pode fazer a
respeito.

### 2. Dados que coletamos
**Você nos fornece:** e-mail, nome, telefone, biografia e, se quiser, links de LinkedIn e Instagram;
perguntas e votos publicados no mural.

**Coletamos automaticamente:** dados de uso da plataforma — páginas acessadas, vídeos abertos, progresso
na trilha, data e hora de acesso, tipo de dispositivo e navegador; e dados de entrega dos e-mails que
enviamos, como envio, falha e descadastro.

**Não coletamos** sua senha, dados de cartão, documento de identidade nem localização precisa.

### 3. Para que usamos
- Criar e manter sua conta e dar acesso ao conteúdo contratado.
- Exibir seu nome e sua pergunta no mural para os demais membros.
- Enviar ao e-mail cadastrado comunicações programadas da comunidade: novidades, novos vídeos, avisos e
  informações sobre a Liga Dev. **É uma consequência do cadastro, e você pode sair da lista a qualquer
  momento** — o link de descadastro vai no rodapé de todo e-mail, e o interruptor está em Meu Perfil.
- **Analytics.** Usamos os dados de uso, de forma agregada, para entender como a plataforma é usada,
  quais conteúdos funcionam e onde as pessoas travam, e para decidir o que construir. Esse uso orienta o
  produto; ele não produz decisão automatizada sobre você.
- Cumprir obrigações legais e apurar violações dos Termos de Uso.

E-mails obrigatórios de conta — redefinição de senha e confirmação de endereço — são enviados pelo
provedor de autenticação e não dependem da lista de comunicações.

### 4. Base legal
Tratamos seus dados para executar o contrato entre nós, para atender obrigação legal e com base no
legítimo interesse em melhorar e proteger a plataforma. Quando a base for o consentimento, ele pode ser
retirado a qualquer momento, sem afetar o que já foi feito.

### 5. Autenticação por terceiros
O login é operado por serviço de autenticação de terceiros. **Sua senha é criada e guardada por esse
serviço; nós não temos acesso a ela**, não a armazenamos e não conseguimos lê-la ou recuperá-la.

O tratamento feito por esse serviço segue a política dele. A segurança da sua senha e do dispositivo em
que você a usa é sua responsabilidade.

### 6. Com quem compartilhamos
Compartilhamos o mínimo necessário com fornecedores que operam partes do produto:

- provedor de autenticação e banco de dados, que hospeda sua conta e seus dados de perfil;
- provedor de envio de e-mail, que recebe seu endereço e seu nome para entregar as mensagens;
- provedor de hospedagem, que processa os acessos à aplicação;
- plataforma de mensagens usada pelo grupo da comunidade, sob os termos dela.

Não vendemos seus dados. Não os cedemos para publicidade de terceiros. Podemos divulgá-los por ordem
judicial ou requisição de autoridade competente.

Parte desses fornecedores opera fora do Brasil, o que implica transferência internacional dos dados,
feita com as salvaguardas contratuais oferecidas por eles.

### 7. Grupo de mensagens
O que você publica no grupo da comunidade fica visível para os demais participantes e é tratado pela
plataforma de mensagens, não por nós. Seu telefone fica visível para quem participa do grupo, conforme as
regras dessa plataforma. Não temos como apagar mensagens já lidas ou encaminhadas por terceiros.

### 8. Cookies e armazenamento no navegador
Usamos um cookie de sessão, estritamente necessário para manter você conectado, e guardamos no seu
navegador algumas preferências de interface, como o estado do menu lateral.

Não usamos cookie de publicidade, pixel de rede social nem rastreio entre sites.

### 9. Por quanto tempo guardamos
Seus dados de conta ficam guardados enquanto ela existir. Depois da exclusão, os dados pessoais são
apagados e o que permanece — o texto das perguntas publicadas — deixa de estar ligado a você.

Registros necessários para cumprir obrigação legal ou para defesa em processo podem ser mantidos pelo
prazo exigido pela lei.

### 10. Seus direitos
A Lei Geral de Proteção de Dados garante a você confirmar a existência de tratamento, acessar seus dados,
corrigir dados incompletos ou desatualizados, pedir anonimização ou eliminação, saber com quem
compartilhamos, e revogar consentimento.

Você exerce boa parte deles sozinho, na hora:

| O que você quer | Onde |
|---|---|
| Ver e corrigir seus dados | Meu Perfil |
| Sair da lista de e-mails | Meu Perfil, ou o link no rodapé de qualquer e-mail |
| Trocar e-mail ou senha | Meu Perfil |
| Apagar sua conta e seus dados | Meu Perfil, seção Excluir conta |

Para qualquer pedido que não esteja na tabela, escreva para comunidade@lenoborges.com.br. Respondemos no
prazo legal.

### 11. Segurança
Adotamos medidas técnicas e administrativas razoáveis para proteger seus dados: acesso restrito,
comunicação criptografada e serviços de infraestrutura com práticas reconhecidas de segurança.

Nenhum sistema é totalmente seguro. Em caso de incidente com risco relevante a você, comunicaremos você e
a Autoridade Nacional de Proteção de Dados, nos termos da lei.

### 12. Crianças e adolescentes
O uso por menores de 18 anos depende de autorização e acompanhamento do responsável legal, que responde
pelo cadastro e pelo conteúdo publicado.

### 13. Alterações desta política
Esta política pode mudar. Cada versão tem data, alterações relevantes são comunicadas na plataforma e
passam a exigir novo aceite. A versão que você aceitou e a data do aceite ficam registradas em Meu
Perfil, na seção Contratos.

---

## Pontos em aberto

1. **Nada disto passou por advogado.** O texto foi escrito para descrever com precisão o que o produto
   faz — que é a parte que só quem conhece o código consegue escrever — e para não prometer mecanismo
   inexistente (decisão 10). Revisão jurídica antes de cobrar do primeiro assinante é o passo que falta, e
   ela mexe em texto, não em arquitetura: muda o conteúdo do módulo, a versão e o hash, e nada mais.
2. **Razão social, CNPJ e endereço completo.** O texto identifica o responsável por nome, cidade e
   e-mail. Se houver pessoa jurídica, os dados dela entram na cláusula 1 dos dois documentos — e isso é
   uma edição de texto, com bump de versão, que dispara novo aceite de todo mundo. **Vale resolver antes
   da primeira publicação**, porque republicar duas semanas depois faz a base inteira aceitar duas vezes.
3. **O admin pode se trancar do lado de fora.** Se o `contentHash` de um documento subir com a versão
   errada, ou o guard tiver um bug de comparação, ninguém entra no painel — inclusive quem conserta. A
   saída existe e é a de sempre neste projeto: deploy. Não há flag de emergência, e criar uma seria criar
   uma forma de rodar o produto com o bloqueio desligado, que é precisamente o que não pode existir.
4. **Parágrafo com negrito e link.** Hoje o parágrafo é texto puro (decisão 2). O texto acima foi escrito
   para viver sem formatação, mas as frases que mais importam — a de reembolso e a de sanção — perdem
   ênfase na tela. Se virar necessidade, a saída é uma lista de trechos com marcação
   (`[{ text, strong }]`), e não HTML.
5. **Quem já pagou aceita depois de ter pago.** Todo membro atual assinou sem contrato nenhum. O aceite
   retroativo é o melhor disponível e não vale como contrato prévio para o que já aconteceu. É outra
   razão para a revisão do ponto 1 vir antes do próximo ciclo de cobrança.
