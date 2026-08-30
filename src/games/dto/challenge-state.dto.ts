import { ApiProperty } from '@nestjs/swagger';

/**
 * Os estados do card do GYM Challenge (spec 022, decisao 5).
 *
 * **Quatro, e nao tres.** A spec descreve tres condicoes de entrada -- sem
 * questoes, sem XP, pode jogar -- e a tela precisa de um quarto valor para quem
 * ja conquistou: um `disponivel` com `badgeUnlocked: true` obrigaria toda tela a
 * combinar dois campos para escolher a cor da borda, e a primeira que esquecesse
 * mostraria "Iniciar GYM Challenge" para quem ja terminou.
 */
export type ChallengeStatus =
  'em-breve' | 'xp-insuficiente' | 'disponivel' | 'conquistada';

export class RoundStateDto {
  @ApiProperty({ example: 1, enum: [1, 2, 3] })
  round: number;

  @ApiProperty({ example: 'easy', enum: ['easy', 'medium', 'hard'] })
  difficulty: string;

  @ApiProperty({
    example: true,
    description: 'Se esta rodada já foi aprovada. As três verdes é a insígnia',
  })
  passed: boolean;

  @ApiProperty({
    nullable: true,
    example: 8,
    description:
      'Acertos da última tentativa consolidada, ou `null` se nunca jogou',
  })
  score: number | null;
}

export class ChallengeStateDto {
  @ApiProperty({ example: 'logica' })
  badgeId: string;

  @ApiProperty({ example: 'Insígnia da Lógica' })
  badgeTitle: string;

  @ApiProperty({
    enum: ['em-breve', 'xp-insuficiente', 'disponivel', 'conquistada'],
    example: 'disponivel',
  })
  status: ChallengeStatus;

  @ApiProperty({ example: 1, enum: [1, 2, 3] })
  currentRound: number;

  @ApiProperty({ type: [RoundStateDto] })
  rounds: RoundStateDto[];

  @ApiProperty({
    example: 200,
    description: 'XP mínimo para participar. Zero é sem exigência',
  })
  requiredXp: number;

  @ApiProperty({
    example: 340,
    description:
      'O XP do membro **agora**, para a barra de progresso do card. Vem daqui ' +
      'e não do `AuthStore` para a barra não desenhar com um número velho',
  })
  currentXp: number;

  @ApiProperty({ example: false })
  badgeUnlocked: boolean;

  @ApiProperty({
    example: false,
    description:
      'Se há uma rodada aberta e não terminada. É o que troca o botão de ' +
      '"Iniciar" para "Continuar"',
  })
  hasActiveRound: boolean;

  @ApiProperty({
    example: false,
    description:
      'Se a próxima rodada é treino — a rodada corrente já foi aprovada ' +
      '(decisão 21). Vale `0` de XP em cada questão, e a tela mostra o selo ' +
      '"Modo Treino: Sem XP"',
  })
  replay: boolean;
}

export class ChallengeListDto {
  @ApiProperty({ type: [ChallengeStateDto] })
  challenges: ChallengeStateDto[];
}
