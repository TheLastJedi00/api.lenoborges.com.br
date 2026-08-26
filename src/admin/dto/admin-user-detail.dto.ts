import { ApiProperty } from '@nestjs/swagger';
import { AdminUserDto } from './admin-user.dto';
import type { EmailOptOutReason } from '../../profile/entities/profile.entity';
import type { CannotReceiveEmailReason } from '../../emails/email-eligibility';

/**
 * Um membro inteiro, para o admin (spec 015, decisão 8).
 *
 * **Este é o único lugar em que dado pessoal de terceiro sai desta API** —
 * telefone, bio e as redes sociais. É por isso que ele é rota própria, e não
 * campos a mais na listagem: uma listagem que carrega o telefone e a bio de 200
 * pessoas para desenhar 200 linhas trafega dado pessoal que ninguém pediu,
 * guarda-o no estado do navegador e o entrega ao primeiro `console.log` de
 * depuração. O detalhe é uma requisição a mais no clique, e o clique é raro.
 *
 * > **Isto não é o "perfil público de membro" que a spec 013 adiou.** Aquela
 * > decisão é sobre **membro vendo membro**, e continua adiada e intacta: não
 * > existe rota de perfil de terceiros para quem não é administrador, e nada
 * > aqui passa por fora do `AdminGuard`. A diferença não é formalidade — é a
 * > razão de não haver exportação, nem telefone na linha da lista, nem nada que
 * > transforme "ver uma pessoa" em "ter a base".
 */
export class AdminUserDetailDto extends AdminUserDto {
  @ApiProperty({ nullable: true, example: '47999990000' })
  phone: string | null;

  @ApiProperty({ nullable: true, example: 'Estudando back-end.' })
  bio: string | null;

  @ApiProperty({
    nullable: true,
    example: 'https://linkedin.com/in/lenoborges',
    description: 'URL completa (spec 013). Visível só para administradores',
  })
  linkedin: string | null;

  @ApiProperty({
    nullable: true,
    example: 'https://instagram.com/lenoborges',
    description: 'URL completa (spec 013). Visível só para administradores',
  })
  instagram: string | null;

  @ApiProperty({
    nullable: true,
    enum: ['membro', 'bounce', 'reclamacao'],
    example: 'bounce',
    description:
      'Por que saiu da lista. É o oposto do que Meu Perfil faz, e de propósito: ' +
      'para o membro, "seu provedor recusou nossos e-mails" é uma frase que não ' +
      'o ajuda a fazer nada; para o admin, é a única informação que explica o ' +
      '"não chegou para o fulano", e ele é quem pode agir',
  })
  emailOptOutReason: EmailOptOutReason | null;

  @ApiProperty({ nullable: true, example: '2026-08-20T12:00:00.000Z' })
  emailOptOutAt: string | null;

  @ApiProperty({ nullable: true, example: 'membro@email.com' })
  waitlistEntryId: string | null;

  @ApiProperty({ nullable: true, example: '2026-08-18T09:02:00.000Z' })
  profileCreatedAt: string | null;

  @ApiProperty({ nullable: true, example: '2026-08-24T11:00:00.000Z' })
  profileUpdatedAt: string | null;

  @ApiProperty({
    example: true,
    description:
      'Derivado dos MESMOS três cortes que a audiência de e-mail usa. Duas ' +
      'implementações da mesma pergunta é como a tela passa a dizer que dá para ' +
      'enviar enquanto o envio responde 422',
  })
  canReceiveEmail: boolean;

  @ApiProperty({
    nullable: true,
    enum: ['desativado', 'email-nao-verificado', 'descadastrado'],
    example: null,
    description:
      'A tela escolhe o texto por ESTE CÓDIGO, e nunca por leitura da mensagem: ' +
      'texto de erro não é contrato',
  })
  cannotReceiveReason: CannotReceiveEmailReason | null;
}
