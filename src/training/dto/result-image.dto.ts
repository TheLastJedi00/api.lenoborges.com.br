import { ApiProperty } from '@nestjs/swagger';

/**
 * A resposta de `POST /trainings/:trainingId/result-image` (spec 027).
 *
 * **Só a URL, e nada de gravar a conclusão aqui.** A foto pode subir antes de a
 * pessoa decidir concluir -- ela ainda vai olhar o enunciado, trocar a imagem,
 * fechar o modal -- e uma rota que já concluísse pagaria o XP de um desafio que
 * ninguém disse que terminou.
 */
export class ResultImageDto {
  @ApiProperty({
    example:
      'https://storage.googleapis.com/dev-liga-dev.firebasestorage.app/trainings/uid-1/trn-1?v=1757000000000',
    description: 'Mande este valor em `resultImageUrl` ao concluir o desafio',
  })
  resultImageUrl: string;
}
