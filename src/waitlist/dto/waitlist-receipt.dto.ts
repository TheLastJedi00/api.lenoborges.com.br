import { ApiProperty } from '@nestjs/swagger';

export class WaitlistReceiptDto {
  @ApiProperty({
    example: 'aluno@exemplo.com',
    description:
      'ID da inscrição, que é o e-mail normalizado. Deixou de ser UUID na ' +
      'spec 007: o Firestore não tem constraint UNIQUE, e o ID do documento é ' +
      'o único lugar onde ele garante unicidade de e-mail.',
  })
  id: string;

  @ApiProperty({
    example: '2026-08-13T18:20:31.412Z',
    description: 'Data de recebimento (UTC)',
  })
  receivedAt: Date;
}
