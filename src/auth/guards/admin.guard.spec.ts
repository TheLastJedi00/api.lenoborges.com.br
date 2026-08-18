import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { CurrentUserData } from '../decorators/current-user.decorator';

function contextWith(user?: CurrentUserData): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('deixa passar quem tem role admin', () => {
    const context = contextWith({
      id: 'uid-admin',
      email: 'admin@test.com',
      role: 'admin',
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  // 403 e nao 401: a pessoa esta autenticada, ela so nao e admin. Um 401 aqui
  // mandaria o front tentar renovar a sessao para resolver um problema que nao
  // e de sessao, e o loop resultante e silencioso.
  it('recusa com 403 quem esta autenticado sem ser admin', () => {
    const context = contextWith({
      id: 'uid-membro',
      email: 'membro@test.com',
      role: null,
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  // Este e o caso de alguem pendurar o AdminGuard sem o FirebaseAuthGuard antes.
  // Sem request.user, "nao e admin" e a unica resposta segura: tratar a ausencia
  // como permissao seria abrir a rota inteira por um erro de decorador.
  it('recusa quando request.user nao existe', () => {
    const context = contextWith(undefined);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
