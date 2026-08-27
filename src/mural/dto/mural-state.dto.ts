import { ApiProperty } from '@nestjs/swagger';
import { MuralQuestionDto } from './mural-question.dto';

/**
 * O estado do ciclo, para o front desenhar a tela inteira sem adivinhar nada.
 *
 * O `weekId` e o `endsAt` vêm daqui de propósito: o contador da tela não pode
 * sair do relógio do navegador sozinho. Quem está com o fuso errado no celular —
 * ou viajando — veria uma virada que não existe, votaria e receberia 409.
 */
export class MuralStateDto {
  @ApiProperty({
    example: '2026-08-16',
    description: 'Semana que recebe perguntas',
  })
  currentWeekId: string;

  @ApiProperty({
    example: '2026-08-09',
    description: 'Semana que recebe votos',
  })
  votingWeekId: string;

  @ApiProperty({
    example: '2026-08-23T03:00:00.000Z',
    description:
      'Instante da virada, em UTC. É meia-noite em São Paulo, e não meia-noite UTC',
  })
  currentWeekEndsAt: string;

  @ApiProperty({
    example: false,
    description:
      'Se o usuário pode escrever pergunta nesta semana. Vem pronto: o front ' +
      'NÃO recalcula a regra a partir do tier, ou existiriam duas implementações ' +
      'da mesma coisa, divergindo na primeira exceção',
  })
  canAsk: boolean;

  @ApiProperty({
    nullable: true,
    example: null,
    description:
      'Id da pergunta que o usuário já fez nesta semana, se houver. **Fica**, e não ' +
      'vai a Deprecated: é um campo e não uma estrutura, e a tela ainda o usa ' +
      'para decidir qual botão mostrar',
  })
  myQuestionId: string | null;

  @ApiProperty({
    type: () => MuralQuestionDto,
    nullable: true,
    description:
      'A pergunta da semana deste usuário, inteira. É dela que o formulário de ' +
      'edição se preenche — sem ela, quem clica em "Editar minha pergunta" ' +
      'reescreve tudo do zero. **Não custa leitura nenhuma**: o documento já ' +
      'era lido para responder `myQuestionId`, e o resto era jogado fora',
  })
  myQuestion: MuralQuestionDto | null;
}
