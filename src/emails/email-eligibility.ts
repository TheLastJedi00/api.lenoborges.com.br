import type { UserRecord } from 'firebase-admin/auth';
import type { Profile } from '../profile/entities/profile.entity';

/**
 * Por que este membro não pode receber e-mail do produto.
 *
 * É união literal, e nunca `string`: quem escolhe o texto é a tela, pelo código
 * (spec 015, decisão 12), e um `string` deixaria o `switch` de lá sem
 * exaustividade. **Texto de erro não é contrato.**
 */
export type CannotReceiveEmailReason =
  'desativado' | 'email-nao-verificado' | 'descadastrado';

/**
 * Os três cortes da spec 014 (decisão 7), numa função só.
 *
 * **Uma implementação, e não duas.** A audiência usa isto para cortar e o
 * detalhe do membro usa isto para dizer `canReceiveEmail` — duas
 * implementações da mesma pergunta é como a tela passa a oferecer um envio que a
 * API recusa com 422, e o admin escreve o recado inteiro para descobrir no fim.
 *
 * A **ordem dos motivos é definida**, e não arbitrária: da conta mais grave para
 * a preferência do membro. Sem ordem fixa, o texto da tela mudaria entre duas
 * requisições sem nada ter mudado no membro.
 *
 * Quem não tem documento de perfil não está descadastrado — ele nunca entrou na
 * lista. O corte dele é outro (não é audiência de campanha) e é do
 * `AudienceService`, porque para o admin ele continua sendo alguém a quem se
 * pode escrever.
 */
export function cannotReceiveEmailReason(
  user: Pick<UserRecord, 'disabled' | 'emailVerified' | 'email'>,
  profile: Pick<Profile, 'emailOptOut'> | null,
): CannotReceiveEmailReason | null {
  // Conta desativada não recebe e-mail do produto.
  if (user.disabled) {
    return 'desativado';
  }

  // Endereço não confirmado é candidato a erro de digitação, e cada um deles é
  // um bounce que corrói a reputação do domínio (spec 014, decisão 2).
  if (!user.emailVerified || !user.email) {
    return 'email-nao-verificado';
  }

  // O descadastro (spec 014, decisão 8). **Não existe e-mail que o ignore** —
  // nem o de vídeo, nem a campanha, nem o recado para uma pessoa só.
  if (profile?.emailOptOut) {
    return 'descadastrado';
  }

  return null;
}
