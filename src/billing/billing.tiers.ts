/**
 * O catalogo de tiers da Liga Dev.
 *
 * **E constante de codigo, e nao colecao do Firestore.** Uma colecao custaria
 * CRUD de admin, tela para edita-la, validacao de quem pode mexer e um historico
 * para responder "quanto custava em marco". Sao quatro linhas que mudam uma vez
 * por semestre e cuja mudanca ja e um deploy, porque a copia da landing muda
 * junto. Ver a decisao 3 da spec 009.
 *
 * > **Guardrail:** no dia em que existir cobranca de verdade, o preco deixa de
 * > ser copia e vira compromisso -- um assinante paga o valor que estava valendo
 * > quando assinou. Ai o catalogo vira colecao com historico, e nao antes.
 * > Enquanto for constante, **nada pode gravar o preco junto do perfil**, porque
 * > isso criaria um segundo dono da mesma verdade sem o historico que
 * > justificaria.
 *
 * O nome do tier e o que ele entrega tambem existem no conteudo do front, e essa
 * repeticao e aceita: ela e copy, muda num commit e nao precisa de rede para
 * renderizar. O que **nao** pode se repetir e o preco, e ele existe so aqui.
 */

export type TierId =
  'dev-tier' | 'great-dev-tier' | 'ultra-dev-tier' | 'master-dev-tier';

export interface Tier {
  readonly id: TierId;
  readonly name: string;
  /**
   * Em **centavos**, sempre. Valor monetario em decimal e a armadilha classica:
   * 199.99 nao existe exatamente em ponto flutuante, e a primeira soma revela
   * isso num lugar inconveniente. A string formatada vive ao lado, para a tela.
   */
  readonly price: number;
  readonly priceLabel: string;
  readonly period: 'mensal' | 'gratuito';
  readonly summary: string;
  readonly perks: readonly string[];
}

/**
 * Os tiers em ordem de degrau, e a ordem e dado: cada um entrega tudo do
 * anterior mais alguma coisa. Por isso todo `perks` de tier pago abre com "Tudo
 * do <anterior>" -- faixa que parece alternativa em vez de degrau faz o leitor
 * comparar o que nao e comparavel.
 */
export const TIERS: readonly Tier[] = [
  {
    id: 'dev-tier',
    name: 'Dev Tier',
    price: 0,
    priceLabel: 'Gratuito',
    period: 'gratuito',
    summary:
      'Qualquer pessoa entra, conquista a Insígnia da Lógica e a da POO, joga e ' +
      'disputa o ranking daquele trecho, sem pagar nada e sem prazo.',
    perks: [
      'Grupo aberto no WhatsApp para tirar dúvida e compartilhar conhecimento',
      'Trilha e jogos das duas primeiras insígnias',
      'Parte do conteúdo publicado de graça no canal do YouTube',
      'Voto no Mural de Perguntas',
    ],
  },
  {
    id: 'great-dev-tier',
    name: 'Great Dev Tier',
    price: 1999,
    priceLabel: 'R$ 19,99',
    period: 'mensal',
    summary:
      'Tudo do Dev Tier, mais a plataforma inteira: a trilha continua da terceira ' +
      'insígnia até a oitava, e segue na Elite Four.',
    perks: [
      'Tudo do Dev Tier',
      'Trilha completa: da Insígnia 3 até a 8, e as quatro Elite Battles',
      'Vídeos e jogos de todas as etapas',
      'Ranking completo, com as oito insígnias e a Elite Four em disputa',
    ],
  },
  {
    id: 'ultra-dev-tier',
    name: 'Ultra Dev Tier',
    price: 19999,
    priceLabel: 'R$ 199,99',
    period: 'mensal',
    summary:
      'Tudo do Great Dev Tier, mais a Grinding Arena: quatro Grindings por mês, ao ' +
      'vivo, em uma turma de no máximo quatro pessoas. São quatro cadeiras, e elas acabam.',
    perks: [
      'Tudo do Great Dev Tier',
      'Um Grinding por semana com o Leno Borges, ao vivo',
      'Turma de no máximo 4 alunos, sem plateia',
      'Correção e feedback pessoal em cada exercício entregue',
    ],
  },
  {
    id: 'master-dev-tier',
    name: 'Master Dev Tier',
    price: 26000,
    priceLabel: 'R$ 260,00',
    period: 'mensal',
    summary:
      'Tudo do Ultra Dev Tier, mais duas aulas de inglês por mês voltadas para ' +
      'entrevista técnica — para a vaga que trava no idioma, e não no código.',
    perks: [
      'Tudo do Ultra Dev Tier',
      'Duas aulas de inglês por mês, focadas em entrevista técnica',
      'Treino de apresentação, explicação de arquitetura e follow-up em inglês',
      'Preparação para vagas que exigem inglês em processo seletivo',
    ],
  },
];

/** Ids na ordem dos degraus, para validacao e para ordenar sem reimplementar. */
export const TIER_IDS: readonly TierId[] = TIERS.map((tier) => tier.id);
