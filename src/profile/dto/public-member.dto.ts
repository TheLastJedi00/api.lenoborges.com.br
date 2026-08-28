import { ApiProperty } from '@nestjs/swagger';

/**
 * O cartao que um membro abre sobre outro (spec 019, decisao 8).
 *
 * **O que NAO esta aqui e a decisao.** Sem e-mail, sem telefone, sem `tier`, sem
 * `role`, sem `completedAt`, sem `emailOptOut`, sem data de entrada.
 *
 * A regra que fica, e vale para sempre:
 *
 * > **Campo novo no perfil nao entra neste DTO por padrao.** Ele entra se
 * > alguem decidir que e publico, e a decisao e escrita aqui.
 *
 * Por isso esta classe **nao estende `ProfileDto`, nao reusa mapeador e nao e
 * montada por espalhamento de objeto** -- os tres atalhos que fazem o campo
 * seguinte vazar sem ninguem ter escolhido. O mapeamento e campo a campo, no
 * `ProfileService.findPublicMember`, e o teste de vazamento compara o conjunto
 * de chaves da resposta por igualdade, e nao por `toMatchObject`.
 *
 * `GET /admin/users/:uid` (spec 015) continua devolvendo tudo, atras do
 * `AdminGuard`. **Sao duas rotas com propositos opostos**, e fundi-las com um
 * `if (role === 'admin')` seria transformar a diferenca entre "o que a
 * comunidade ve" e "o que a operacao ve" num ramo dentro de uma funcao -- o
 * lugar exato onde ela e apagada por engano.
 */
export class PublicMemberDto {
  @ApiProperty({ example: 'aBcD1234' })
  id: string;

  @ApiProperty({ example: 'Ana Prado', nullable: true })
  name: string | null;

  @ApiProperty({
    example: 'Desenvolvedora backend, migrando de suporte para dev.',
    nullable: true,
  })
  bio: string | null;

  @ApiProperty({
    example: 3,
    description:
      'Etapas concluídas da trilha, de 0 a 13. Quem traduz número em texto é a ' +
      'tela, em `core/progress`',
  })
  grade: number;

  @ApiProperty({
    example: 340,
    description: 'Pontos de experiência: 10 por vídeo assistido, uma vez cada',
  })
  xp: number;

  @ApiProperty({
    example: 'https://www.linkedin.com/in/ana-prado',
    nullable: true,
    description:
      '**`null` quando o membro não ligou o interruptor** em Meu Perfil, e ' +
      'também quando ele simplesmente não preencheu. Os dois casos são o mesmo ' +
      'para quem lê: não há link a mostrar. O corte acontece no servidor — um ' +
      'front que recebesse o link e decidisse não desenhá-lo já o teria ' +
      'entregado a quem abrisse a aba de rede',
  })
  linkedin: string | null;

  @ApiProperty({
    example: 'https://www.instagram.com/anaprado',
    nullable: true,
    description: 'Mesma regra do `linkedin`',
  })
  instagram: string | null;
}
