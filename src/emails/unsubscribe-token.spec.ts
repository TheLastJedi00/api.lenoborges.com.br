import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './unsubscribe-token';

const SEGREDO = 'segredo-de-teste-bem-longo';

describe('unsubscribe-token', () => {
  it('assina e verifica, devolvendo o uid', () => {
    const token = signUnsubscribeToken('uid-123', SEGREDO);

    expect(verifyUnsubscribeToken(token, SEGREDO)).toBe('uid-123');
  });

  it('o token cabe numa URL sem escapar nada', () => {
    const token = signUnsubscribeToken('uid-123', SEGREDO);

    expect(token).toBe(encodeURIComponent(token));
  });

  it('teste-trava: token adulterado nao verifica', () => {
    const token = signUnsubscribeToken('uid-123', SEGREDO);
    const [uid, assinatura] = token.split('.');

    // Assinatura mexida, mantendo o comprimento.
    const trocada =
      assinatura.slice(0, -1) + (assinatura.endsWith('a') ? 'b' : 'a');
    expect(verifyUnsubscribeToken(`${uid}.${trocada}`, SEGREDO)).toBeNull();

    // E o uid trocado, com a assinatura do outro: e o caso que descadastraria a
    // pessoa errada se a verificacao fosse so "tem duas partes".
    const outroUid = Buffer.from('uid-999').toString('base64url');
    expect(
      verifyUnsubscribeToken(`${outroUid}.${assinatura}`, SEGREDO),
    ).toBeNull();
  });

  it('teste-trava: token assinado com outro segredo nao verifica', () => {
    const token = signUnsubscribeToken('uid-123', 'outro-segredo');

    expect(verifyUnsubscribeToken(token, SEGREDO)).toBeNull();
  });

  it('token malformado devolve null em vez de estourar', () => {
    expect(verifyUnsubscribeToken('', SEGREDO)).toBeNull();
    expect(verifyUnsubscribeToken('semponto', SEGREDO)).toBeNull();
    expect(verifyUnsubscribeToken('a.b.c', SEGREDO)).toBeNull();
    expect(verifyUnsubscribeToken('.assinatura', SEGREDO)).toBeNull();
  });

  it('assinatura de tamanho diferente nao estoura o timingSafeEqual', () => {
    const [uid] = signUnsubscribeToken('uid-123', SEGREDO).split('.');

    expect(verifyUnsubscribeToken(`${uid}.curta`, SEGREDO)).toBeNull();
  });

  it('o mesmo uid com o mesmo segredo gera sempre o mesmo token', () => {
    // O link do rodape precisa continuar valendo depois de reenviar a campanha.
    expect(signUnsubscribeToken('uid-123', SEGREDO)).toBe(
      signUnsubscribeToken('uid-123', SEGREDO),
    );
  });
});
