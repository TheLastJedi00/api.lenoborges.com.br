import { ApiProperty } from '@nestjs/swagger';
import { NotificationKind } from '../entities/notification.entity';

/**
 * Uma notificacao nao lida, como o painel a recebe (spec 012).
 *
 * **O que este DTO nao tem e tao decidido quanto o que ele tem:**
 *
 * - **Sem `read`.** A listagem ja devolve so as nao lidas. Mandar as lidas pela
 *   rede para o cliente peneirar seria duas implementacoes da mesma regra, e a
 *   do cliente divergiria na primeira excecao. Mesmo principio do `canAsk`.
 * - **Sem nome e sem icone da insignia.** Os treze `badgeId` ja vivem nos dois
 *   lados de proposito (ver `track.constants.ts`), e o front resolve o nome pela
 *   tabela que ele ja usa na trilha e no Mural.
 * - **Sem rota de destino.** Rota e assunto de quem tem roteador. Uma API que
 *   devolvesse `/dashboard/trilha/git-github` amarraria o endereco das telas ao
 *   servidor, e quebraria o painel na primeira reorganizacao de rotas.
 * - **Sem titulo abreviado.** O titulo vai inteiro; quantos caracteres cabem no
 *   cartao muda com a largura da tela, e por isso e decisao de layout.
 */
export class NotificationDto {
  @ApiProperty({ example: 'video__git-github__dQw4w9WgXcQ' })
  id: string;

  @ApiProperty({ enum: ['video', 'pergunta'], example: 'video' })
  kind: NotificationKind;

  @ApiProperty({
    example: 'Rebase sem medo',
    description: 'Título do vídeo ou da pergunta, cru, sem abreviar.',
  })
  title: string;

  @ApiProperty({ example: 'git-github' })
  badgeId: string;

  @ApiProperty({ example: '2026-08-25T18:03:11.204Z' })
  createdAt: string;
}
