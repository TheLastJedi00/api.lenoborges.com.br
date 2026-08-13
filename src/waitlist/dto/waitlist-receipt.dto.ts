import { ApiProperty } from '@nestjs/swagger';

export class WaitlistReceiptDto {
  @ApiProperty({ example: 'f87e5b22-55e1-4c6e-8b9a-4c9f8a3c8e5d', description: 'ID da inscrição' })
  id: string;

  @ApiProperty({ example: '2026-08-13T18:20:31.412Z', description: 'Data de recebimento (UTC)' })
  receivedAt: Date;
}

