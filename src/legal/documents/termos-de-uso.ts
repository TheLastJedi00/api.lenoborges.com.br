import { LegalDocument } from '../entities/legal-document.entity';

/**
 * Termos de Uso da Liga Dev (spec 018, Anexo A).
 *
 * **Tres frases deste texto sao codigo, e estao escritas para bater com ele**
 * (decisao 10):
 *
 * - "nao temos acesso a sua senha" -- login e Identity Toolkit e a senha e
 *   definida em tela hospedada pelo Firebase (specs 005 e 007);
 * - "voce pode sair da lista de e-mails quando quiser" -- `emailOptOut` e
 *   `/descadastro` (spec 014);
 * - "voce pode apagar sua conta a qualquer momento" -- `DELETE /me` (spec 013).
 *
 * A regra que fica: **nenhuma clausula futura pode descrever um mecanismo que
 * nao existe.** Texto juridico que descreve um sistema imaginario e pior que
 * texto ausente, porque cria obrigacao sem implementacao.
 *
 * Editar qualquer paragrafo exige bumpar `version` e `contentHash` -- a suite
 * cobra, e e para isso que ela existe.
 */
export const TERMOS_DE_USO: LegalDocument = {
  id: 'termos-de-uso',
  title: 'Termos de Uso',
  version: '2026-08-28',
  updatedAt: '2026-08-28',
  contentHash:
    '7cdcf91bb90b24e1bd8d7e903f3eac2d37e232f409de56d68629311f0e33be3a',
  sections: [
    {
      heading: '1. Aceitação',
      paragraphs: [
        'Ao criar uma conta, assinar um plano ou usar a Liga Dev, você concorda com estes Termos de Uso e com a Política de Privacidade. Se você não concorda com qualquer ponto, não use a plataforma.',
        'A Liga Dev é operada por Leno Borges, professor particular de programação, com atuação em Blumenau, Santa Catarina, e atendimento online. O contato oficial é comunidade@lenoborges.com.br.',
        'Se você tem menos de 18 anos, o aceite precisa ser dado por seu responsável legal, que responde por ele.',
      ],
    },
    {
      heading: '2. O que a plataforma é',
      paragraphs: [
        'A Liga Dev é uma comunidade de estudo com trilha de vídeos, mural de perguntas e um grupo de mensagens para conversa entre membros. É material de ensino e acompanhamento; não é curso com certificação, não é consultoria e não é garantia de emprego, aprovação, salário ou qualquer outro resultado.',
        'O conteúdo pode mudar. Vídeos podem ser adicionados, reorganizados ou removidos, e a estrutura da trilha pode ser revista sem aviso prévio.',
      ],
    },
    {
      heading: '3. Conta e credenciais',
      paragraphs: [
        'Sua conta é pessoal e intransferível. Você responde por tudo o que acontece nela.',
        'A autenticação é feita por serviço de terceiros. Sua senha é definida e guardada por esse serviço: nós não a vemos, não a armazenamos e não conseguimos recuperá-la. Perda de acesso por senha esquecida se resolve pelo fluxo de redefinição, e não por nós.',
        'Compartilhar credenciais, revender acesso ou usar a conta de outra pessoa é motivo de bloqueio imediato.',
      ],
    },
    {
      heading: '4. Assinatura, pagamento e ausência de reembolso',
      paragraphs: [
        'O acesso a parte do conteúdo depende de assinatura ativa. Os valores e os planos vigentes são os exibidos na plataforma no momento da contratação.',
        'Não há reembolso. Nem parcial, nem proporcional, nem por período não utilizado. Isso vale para cancelamento por sua iniciativa, para desistência, para inatividade e para encerramento da conta por descumprimento destes Termos.',
        'Cancelar interrompe as cobranças seguintes; não devolve as anteriores. O acesso permanece até o fim do período já pago, salvo nos casos de bloqueio previstos na cláusula 6.',
        'O preço pode ser reajustado. O reajuste é comunicado por e-mail com antecedência e vale para os ciclos seguintes ao aviso.',
      ],
    },
    {
      heading: '5. Grupo de mensagens e conteúdo de terceiros',
      paragraphs: [
        'O grupo de WhatsApp da comunidade funciona em plataforma de terceiros, sob os termos dessa plataforma, e é espaço de conversa entre membros.',
        'Não somos responsáveis pelo que os membros dizem ou compartilham ali. Não há moderação contínua nem leitura de tudo o que é publicado. Mensagens, arquivos, links, ofertas, opiniões e combinações feitas no grupo são de responsabilidade de quem as publica, e qualquer negócio fechado entre membros é entre eles.',
        'O mesmo vale para links externos citados no mural, nos vídeos ou no grupo: eles levam a conteúdo que não é nosso e que não controlamos.',
        'Se algo no grupo violar estes Termos, avise em comunidade@lenoborges.com.br. Avisos são analisados, mas não há prazo de resposta garantido.',
      ],
    },
    {
      heading: '6. Conduta e sanções',
      paragraphs: [
        'É proibido publicar, no grupo, no mural ou em qualquer área da plataforma, conteúdo que seja ilegal ou que promova ilegalidade — o que inclui material que viole direito autoral, conteúdo sexual envolvendo menores, discurso de ódio, ameaça, assédio, discriminação, fraude, golpe, dado pessoal de terceiros sem autorização, malware, credencial vazada e pirataria de qualquer natureza.',
        'Também é proibido divulgar produto ou serviço próprio sem autorização, extrair conteúdo da plataforma em massa e redistribuir material de aula.',
        'Conteúdo ilegal no grupo ou no mural resulta em bloqueio da conta, remoção e banimento do grupo da comunidade e cancelamento da assinatura, sem reembolso de qualquer valor já pago. A medida é imediata e não depende de aviso prévio. Casos graves são comunicados às autoridades competentes.',
        'Infrações menos graves podem receber advertência ou suspensão temporária, a nosso critério. A ausência de sanção em um caso não impede sanção em outro.',
      ],
    },
    {
      heading: '7. Conteúdo que você publica',
      paragraphs: [
        'As perguntas que você publica no mural são visíveis para os demais membros e podem ser respondidas em vídeo na trilha, com o texto da pergunta e o seu nome de exibição.',
        'Ao publicar, você nos autoriza a exibir, reproduzir e adaptar esse conteúdo dentro da plataforma e nos materiais da comunidade, sem prazo e sem contrapartida financeira. Você continua sendo o autor do que escreveu.',
        'Se você apagar sua conta, suas perguntas permanecem publicadas de forma anônima, sem seu nome — elas carregam votos de outras pessoas e podem já ter sido respondidas em vídeo.',
        'Seu perfil de membro — nome, biografia, etapa na trilha e pontos de experiência — fica visível para as demais pessoas da comunidade, que o abrem clicando no seu nome no mural. Seus links de redes sociais só aparecem ali se você ligar o interruptor em Meu Perfil, que nasce desligado.',
        'Publique apenas conteúdo que seja seu ou que você tenha o direito de compartilhar.',
      ],
    },
    {
      heading: '8. Propriedade intelectual',
      paragraphs: [
        'Os vídeos, textos, exercícios, marca, layout e código da plataforma são de titularidade de Leno Borges ou de seus licenciadores.',
        'Sua assinatura dá direito de acesso pessoal ao conteúdo. Ela não dá direito de copiar, baixar em massa, gravar, republicar, revender, exibir publicamente, usar em treinamento de modelo de inteligência artificial ou criar obra derivada do material.',
      ],
    },
    {
      heading: '9. Disponibilidade',
      paragraphs: [
        'A plataforma é oferecida no estado em que se encontra. Não garantimos funcionamento ininterrupto, ausência de erros ou compatibilidade com todo dispositivo e navegador.',
        'Manutenções, atualizações e interrupções por falha de fornecedores podem ocorrer. Períodos de indisponibilidade não geram crédito nem prorrogação de assinatura.',
      ],
    },
    {
      heading: '10. Limitação de responsabilidade',
      paragraphs: [
        'Na máxima extensão permitida pela lei aplicável, não respondemos por lucros cessantes, perda de dados, perda de oportunidade, dano indireto ou dano decorrente do uso ou da impossibilidade de uso da plataforma, nem por atos de outros membros.',
        'Havendo responsabilidade que não possa ser afastada, ela fica limitada ao valor pago por você nos 3 meses anteriores ao evento.',
      ],
    },
    {
      heading: '11. Encerramento',
      paragraphs: [
        'Você pode encerrar sua conta a qualquer momento pela própria plataforma, em Meu Perfil. O encerramento é imediato e definitivo, e não gera reembolso.',
        'Podemos encerrar ou suspender contas em caso de descumprimento destes Termos, de inadimplência ou de encerramento do serviço. Se a plataforma for descontinuada por nossa iniciativa, avisaremos por e-mail com antecedência razoável.',
      ],
    },
    {
      heading: '12. Alterações destes Termos',
      paragraphs: [
        'Estes Termos podem mudar. Alterações relevantes são comunicadas na plataforma, e o uso passa a exigir um novo aceite: enquanto ele não for dado, o acesso ao painel fica bloqueado.',
        'Cada versão tem uma data. A data da versão que você aceitou fica registrada na sua conta e pode ser consultada em Meu Perfil, na seção Contratos.',
      ],
    },
    {
      heading: '13. Lei aplicável e foro',
      paragraphs: [
        'Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de Blumenau, Santa Catarina, para dirimir qualquer questão, com renúncia a qualquer outro.',
      ],
    },
  ],
};
