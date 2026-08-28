import { LegalDocument } from '../entities/legal-document.entity';

/**
 * Politica de Privacidade da Liga Dev (spec 018, Anexo B).
 *
 * **A clausula 3 descreve o envio programado e o descadastro, e nada no codigo
 * muda por causa dela** -- e isso que a torna verdadeira. O opt-out da spec 014
 * continua absoluto: este texto diz que enviamos e diz como parar, e **nao abre
 * excecao para "comunicado importante"**, porque o codigo nao tem essa excecao e
 * nao vai ganhar uma por causa de um paragrafo.
 *
 * A tabela de direitos da clausula 10 aponta telas que existem (Meu Perfil, spec
 * 013). Toda linha nova ali precisa apontar para algo que ja esta implementado --
 * ver a decisao 10 da spec 018.
 */
export const POLITICA_DE_PRIVACIDADE: LegalDocument = {
  id: 'politica-de-privacidade',
  title: 'Política de Privacidade',
  version: '2026-08-28',
  updatedAt: '2026-08-28',
  contentHash:
    '217d5b7b3f051843f65dbcbc88d000e9f07bb00b0658e01362626c4f7b49f3e3',
  sections: [
    {
      heading: '1. Quem trata seus dados',
      paragraphs: [
        'O responsável pelo tratamento dos dados desta plataforma é Leno Borges, com atuação em Blumenau, Santa Catarina. Contato para qualquer assunto de privacidade: comunidade@lenoborges.com.br.',
        'Esta política explica o que coletamos, por que, com quem compartilhamos e o que você pode fazer a respeito.',
      ],
    },
    {
      heading: '2. Dados que coletamos',
      paragraphs: [
        'Você nos fornece: e-mail, nome, telefone, biografia e, se quiser, links de LinkedIn e Instagram; perguntas e votos publicados no mural.',
        'Coletamos automaticamente: dados de uso da plataforma — páginas acessadas, vídeos abertos, progresso na trilha, data e hora de acesso, tipo de dispositivo e navegador; e dados de entrega dos e-mails que enviamos, como envio, falha e descadastro.',
        'Registramos também os vídeos que você marca como assistidos e os pontos de experiência que eles somam. A marcação é sempre sua: nós não medimos o que você assiste dentro do player, não sabemos quanto de cada vídeo você viu e não usamos nenhum recurso de rastreamento do site de vídeos para isso.',
        'Não coletamos sua senha, dados de cartão, documento de identidade nem localização precisa.',
      ],
    },
    {
      heading: '3. Para que usamos',
      paragraphs: [
        'Criar e manter sua conta e dar acesso ao conteúdo contratado.',
        'Exibir seu nome e sua pergunta no mural para os demais membros.',
        'Exibir seu cartão de membro para as demais pessoas da comunidade: ao clicar no seu nome no mural, quem já é membro vê seu nome, sua biografia, sua etapa na trilha e seus pontos de experiência. Seus links de LinkedIn e Instagram só aparecem ali se você ligar o interruptor "Mostrar minhas redes para os outros membros", em Meu Perfil — ele nasce desligado. Seu telefone e seu e-mail nunca aparecem nesse cartão.',
        'Enviar ao e-mail cadastrado comunicações programadas da comunidade: novidades, novos vídeos, avisos e informações sobre a Liga Dev. É uma consequência do cadastro, e você pode sair da lista a qualquer momento — o link de descadastro vai no rodapé de todo e-mail, e o interruptor está em Meu Perfil.',
        'Analytics: usamos os dados de uso, de forma agregada, para entender como a plataforma é usada, quais conteúdos funcionam e onde as pessoas travam, e para decidir o que construir. Esse uso orienta o produto; ele não produz decisão automatizada sobre você.',
        'Cumprir obrigações legais e apurar violações dos Termos de Uso.',
        'E-mails obrigatórios de conta — redefinição de senha e confirmação de endereço — são enviados pelo provedor de autenticação e não dependem da lista de comunicações.',
      ],
    },
    {
      heading: '4. Base legal',
      paragraphs: [
        'Tratamos seus dados para executar o contrato entre nós, para atender obrigação legal e com base no legítimo interesse em melhorar e proteger a plataforma. Quando a base for o consentimento, ele pode ser retirado a qualquer momento, sem afetar o que já foi feito.',
      ],
    },
    {
      heading: '5. Autenticação por terceiros',
      paragraphs: [
        'O login é operado por serviço de autenticação de terceiros. Sua senha é criada e guardada por esse serviço; nós não temos acesso a ela, não a armazenamos e não conseguimos lê-la ou recuperá-la.',
        'O tratamento feito por esse serviço segue a política dele. A segurança da sua senha e do dispositivo em que você a usa é sua responsabilidade.',
      ],
    },
    {
      heading: '6. Com quem compartilhamos',
      paragraphs: [
        'Compartilhamos o mínimo necessário com fornecedores que operam partes do produto: provedor de autenticação e banco de dados, que hospeda sua conta e seus dados de perfil; provedor de envio de e-mail, que recebe seu endereço e seu nome para entregar as mensagens; provedor de hospedagem, que processa os acessos à aplicação; e a plataforma de mensagens usada pelo grupo da comunidade, sob os termos dela.',
        'Parte do seu perfil também fica visível para as demais pessoas da comunidade, e não só para fornecedores: é o cartão de membro descrito na cláusula 3. O que aparece ali está listado lá, e as redes sociais dependem de você ligar o interruptor.',
        'Não vendemos seus dados. Não os cedemos para publicidade de terceiros. Podemos divulgá-los por ordem judicial ou requisição de autoridade competente.',
        'Parte desses fornecedores opera fora do Brasil, o que implica transferência internacional dos dados, feita com as salvaguardas contratuais oferecidas por eles.',
      ],
    },
    {
      heading: '7. Grupo de mensagens',
      paragraphs: [
        'O que você publica no grupo da comunidade fica visível para os demais participantes e é tratado pela plataforma de mensagens, não por nós. Seu telefone fica visível para quem participa do grupo, conforme as regras dessa plataforma. Não temos como apagar mensagens já lidas ou encaminhadas por terceiros.',
      ],
    },
    {
      heading: '8. Cookies e armazenamento no navegador',
      paragraphs: [
        'Usamos um cookie de sessão, estritamente necessário para manter você conectado, e guardamos no seu navegador algumas preferências de interface, como o estado do menu lateral.',
        'Não usamos cookie de publicidade, pixel de rede social nem rastreio entre sites.',
      ],
    },
    {
      heading: '9. Por quanto tempo guardamos',
      paragraphs: [
        'Seus dados de conta ficam guardados enquanto ela existir. Depois da exclusão, os dados pessoais são apagados e o que permanece — o texto das perguntas publicadas — deixa de estar ligado a você.',
        'Registros necessários para cumprir obrigação legal ou para defesa em processo podem ser mantidos pelo prazo exigido pela lei.',
      ],
    },
    {
      heading: '10. Seus direitos',
      paragraphs: [
        'A Lei Geral de Proteção de Dados garante a você confirmar a existência de tratamento, acessar seus dados, corrigir dados incompletos ou desatualizados, pedir anonimização ou eliminação, saber com quem compartilhamos, e revogar consentimento.',
        'Você exerce boa parte deles sozinho, na hora: ver e corrigir seus dados, trocar e-mail ou senha, mostrar ou esconder suas redes sociais dos outros membros e apagar sua conta ficam em Meu Perfil; sair da lista de e-mails fica em Meu Perfil ou no link do rodapé de qualquer e-mail que enviamos.',
        'Para qualquer pedido que não esteja nessa lista, escreva para comunidade@lenoborges.com.br. Respondemos no prazo legal.',
      ],
    },
    {
      heading: '11. Segurança',
      paragraphs: [
        'Adotamos medidas técnicas e administrativas razoáveis para proteger seus dados: acesso restrito, comunicação criptografada e serviços de infraestrutura com práticas reconhecidas de segurança.',
        'Nenhum sistema é totalmente seguro. Em caso de incidente com risco relevante a você, comunicaremos você e a Autoridade Nacional de Proteção de Dados, nos termos da lei.',
      ],
    },
    {
      heading: '12. Crianças e adolescentes',
      paragraphs: [
        'O uso por menores de 18 anos depende de autorização e acompanhamento do responsável legal, que responde pelo cadastro e pelo conteúdo publicado.',
      ],
    },
    {
      heading: '13. Alterações desta política',
      paragraphs: [
        'Esta política pode mudar. Cada versão tem data, alterações relevantes são comunicadas na plataforma e passam a exigir novo aceite. A versão que você aceitou e a data do aceite ficam registradas em Meu Perfil, na seção Contratos.',
      ],
    },
  ],
};
