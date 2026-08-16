import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { FirebaseService } from '../firebase.service';

function contextWith(authorization?: string): {
  context: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = {
    headers: authorization ? { authorization } : {},
  };

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('FirebaseAuthGuard', () => {
  let guard: FirebaseAuthGuard;
  let verifyIdToken: jest.Mock;

  beforeEach(() => {
    verifyIdToken = jest.fn();
    guard = new FirebaseAuthGuard({
      auth: { verifyIdToken },
    } as unknown as FirebaseService);
  });

  it('aceita um ID token valido e popula request.user', async () => {
    verifyIdToken.mockResolvedValue({
      uid: 'uid-123',
      email: 'membro@test.com',
    });
    const { context, request } = contextWith('Bearer token-valido');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'uid-123', email: 'membro@test.com' });
  });

  it('recusa quando nao ha header Authorization', async () => {
    const { context } = contextWith();

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('recusa esquema que nao seja Bearer', async () => {
    const { context } = contextWith('Basic dXNlcjpwYXNz');

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('recusa Bearer sem token', async () => {
    const { context } = contextWith('Bearer   ');

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('recusa token expirado', async () => {
    verifyIdToken.mockRejectedValue(
      Object.assign(new Error('expired'), { code: 'auth/id-token-expired' }),
    );
    const { context } = contextWith('Bearer expirado');

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('recusa token de outro projeto', async () => {
    // O verifyIdToken confere audience e issuer contra o projeto da credencial.
    // Este teste existe para que trocar o SDK por uma verificacao manual, um dia,
    // nao apague essa checagem sem ninguem perceber.
    verifyIdToken.mockRejectedValue(
      Object.assign(new Error('wrong audience'), {
        code: 'auth/argument-error',
      }),
    );
    const { context } = contextWith('Bearer de-outro-projeto');

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('nao vaza o motivo real da recusa', async () => {
    // "Token de outro projeto" e "token expirado" contam coisas diferentes para
    // quem esta tentando adivinhar. A resposta e a mesma nos dois casos.
    verifyIdToken.mockRejectedValue(new Error('Firebase ID token has no kid'));
    const { context } = contextWith('Bearer qualquer');

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Token de autenticação ausente ou inválido.',
    );
  });

  it('trata email ausente no payload como string vazia', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'uid-123' });
    const { context, request } = contextWith('Bearer sem-email');

    await guard.canActivate(context);

    expect(request.user).toEqual({ id: 'uid-123', email: '' });
  });
});
