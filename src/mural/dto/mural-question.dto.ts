import { ApiProperty } from '@nestjs/swagger';
import type { MuralPhase } from '../mural-phase';

export class MuralQuestionDto {
  @ApiProperty({ example: '2026-08-16__9b1deb4d3b7d' })
  id: string;

  @ApiProperty({
    example: '2026-08-16',
    description: 'Domingo que abre a semana',
  })
  weekId: string;

  @ApiProperty({ example: 'coleta', enum: ['coleta', 'votacao', 'encerrada'] })
  phase: MuralPhase;

  @ApiProperty({ example: 'poo' })
  badgeId: string;

  @ApiProperty({
    example: 'Leno',
    description: 'Nome de quando a pergunta foi feita — é denormalizado',
  })
  authorName: string;

  @ApiProperty({
    example: 'Como saber quando usar herança em vez de composição?',
  })
  title: string;

  @ApiProperty({ nullable: true, example: null })
  body: string | null;

  @ApiProperty({ example: 12 })
  voteCount: number;

  @ApiProperty({
    example: false,
    description: 'Se o usuário autenticado já votou nesta pergunta',
  })
  hasVoted: boolean;

  @ApiProperty({
    example: false,
    description: 'Se a pergunta é do próprio usuário',
  })
  isMine: boolean;

  @ApiProperty({
    nullable: true,
    example: null,
    description: 'Vídeo de resposta, quando a pergunta venceu e foi respondida',
  })
  answerVideoId: string | null;
}
