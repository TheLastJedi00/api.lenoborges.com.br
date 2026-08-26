import { cannotReceiveEmailReason } from './email-eligibility';

function user(overrides: Record<string, unknown> = {}) {
  return {
    disabled: false,
    emailVerified: true,
    email: 'membro@email.com',
    ...overrides,
  } as { disabled: boolean; emailVerified: boolean; email: string | undefined };
}

describe('cannotReceiveEmailReason', () => {
  it('quem está inteiro pode receber', () => {
    expect(cannotReceiveEmailReason(user(), { emailOptOut: false })).toBeNull();
  });

  describe('os três cortes, um teste por corte', () => {
    // Os três são invisíveis quando quebram: o envio "funciona" e a pessoa
    // simplesmente não recebe.
    it('conta desativada não recebe', () => {
      expect(
        cannotReceiveEmailReason(user({ disabled: true }), {
          emailOptOut: false,
        }),
      ).toBe('desativado');
    });

    it('e-mail não verificado não recebe', () => {
      expect(
        cannotReceiveEmailReason(user({ emailVerified: false }), {
          emailOptOut: false,
        }),
      ).toBe('email-nao-verificado');
    });

    it('quem descadastrou não recebe', () => {
      expect(cannotReceiveEmailReason(user(), { emailOptOut: true })).toBe(
        'descadastrado',
      );
    });
  });

  /**
   * **A ordem não é arbitrária** (Fase 03, Task 04): da conta mais grave para a
   * preferência do membro. Sem ordem definida, o motivo devolvido dependeria da
   * ordem em que os `if` foram escritos, e o texto da tela mudaria entre duas
   * requisições sem nada ter mudado no membro.
   */
  it('teste-trava: com mais de um corte, vale o primeiro da ordem', () => {
    const tudoErrado = user({ disabled: true, emailVerified: false });

    expect(cannotReceiveEmailReason(tudoErrado, { emailOptOut: true })).toBe(
      'desativado',
    );

    expect(
      cannotReceiveEmailReason(user({ emailVerified: false }), {
        emailOptOut: true,
      }),
    ).toBe('email-nao-verificado');
  });

  /**
   * Quem não tem documento de perfil **não está descadastrado**: ele nunca
   * entrou na lista. Para o admin ele continua sendo alguém a quem se pode
   * escrever, e o corte de audiência de campanha é outro, do `AudienceService`.
   */
  it('sem perfil não é descadastro', () => {
    expect(cannotReceiveEmailReason(user(), null)).toBeNull();
  });

  it('sem endereço nenhum é o mesmo caso de endereço não confirmado', () => {
    expect(
      cannotReceiveEmailReason(user({ email: undefined }), {
        emailOptOut: false,
      }),
    ).toBe('email-nao-verificado');
  });
});
