import { ApiProperty } from '@nestjs/swagger';
import { MuralQuestionDto } from './mural-question.dto';

export class WinnerDto {
  @ApiProperty({ example: '2026-08-02' })
  weekId: string;

  @ApiProperty({
    type: () => MuralQuestionDto,
    nullable: true,
    description:
      'A mais votada da semana, ou null quando a semana passou em branco. ' +
      'Semana sem pergunta é informação honesta, não erro a esconder',
  })
  question: MuralQuestionDto | null;
}
