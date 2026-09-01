/**
 * Quanto vale concluir um desafio da Arena de Treinamento (spec 023, decisão 3).
 *
 * **O número 30 nasce e morre aqui.** É o padrão de um treinamento novo: o
 * admin pode escrever outro valor no formulário, e é por isso que o campo
 * `xpAmount` existe no documento em vez de a conta ser feita com esta constante
 * na hora de pagar. Quem paga o XP lê o valor **do treinamento**, e não daqui --
 * senão editar o desafio para valer 50 não mudaria nada, e ninguém entenderia
 * por quê.
 *
 * O mesmo desenho de `XP_PER_VIDEO` em `track.constants.ts`, com uma diferença
 * que vale registrar: lá o valor é do produto e é igual para todo vídeo; aqui o
 * valor é do desafio, porque um exercício de trinta minutos e um de três horas
 * não valem a mesma coisa, e a única pessoa que sabe qual é qual é quem escreveu
 * o enunciado.
 */
export const DEFAULT_TRAINING_XP = 30;

/**
 * Quantos comentários a listagem devolve por página (spec 023, decisão 2).
 *
 * Dez é o que cabe no modal sem transformá-lo numa segunda tela, e o "Mostrar
 * mais" carrega os anteriores por cursor. O número está aqui, e não no
 * controller, porque ele aparece em dois lugares -- o padrão da rota do membro e
 * o do painel do admin -- e dois literais iguais em arquivos diferentes divergem
 * no dia em que alguém muda um só.
 */
export const TRAINING_COMMENTS_PAGE_SIZE = 10;

/**
 * O teto de comentários que uma página pode pedir.
 *
 * Existe porque `?limit=` chega do cliente e uma listagem sem teto é uma leitura
 * da coleção inteira à distância de uma query string -- o mesmo cuidado que o
 * `/admin/users` já toma com o `limit` dele. Acima do teto o valor é fixado no
 * teto, sem erro: é paginação, não pedido de dados.
 */
export const TRAINING_COMMENTS_MAX_PAGE_SIZE = 50;

/**
 * Quantos comentários recentes o painel centralizado do admin carrega.
 *
 * É uma tela de trabalho, não um relatório: o que interessa é o que chegou
 * agora, e o que ficou para trás já foi respondido ou já não será.
 */
export const TRAINING_RECENT_COMMENTS_PAGE_SIZE = 50;
