import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { AuthenticatedRequest } from '../decorators/current-user.decorator';

describe('SupabaseAuthGuard', () => {
  let guard: SupabaseAuthGuard;
  let configService: ConfigService;
  const secretKey = 'super-secret-jwt-key-for-testing-123456';
  const supabaseUrl = 'https://test.supabase.co';
  const issuer = `${supabaseUrl}/auth/v1`;
  let secretUint8: Uint8Array;

  beforeAll(() => {
    secretUint8 = new TextEncoder().encode(secretKey);
  });

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'SUPABASE_JWT_SECRET') return secretKey;
        if (key === 'SUPABASE_URL') return supabaseUrl;
        return undefined;
      }),
    } as unknown as ConfigService;

    guard = new SupabaseAuthGuard(configService);
  });

  /**
   * Token no formato que o GoTrue emite para usuario autenticado: `aud` e `role`
   * iguais a `authenticated` e `iss` apontando para o /auth/v1 do projeto.
   */
  function signToken(
    overrides: Record<string, unknown> = {},
    key: Uint8Array = secretUint8,
    expiration = '1h',
  ): Promise<string> {
    return new SignJWT({
      sub: 'user-uuid-123',
      email: 'test@lenoborges.com.br',
      role: 'authenticated',
      ...overrides,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(typeof overrides.iss === 'string' ? overrides.iss : issuer)
      .setAudience(
        typeof overrides.aud === 'string' ? overrides.aud : 'authenticated',
      )
      .setExpirationTime(expiration)
      .sign(key);
  }

  function createMockContext(authHeader?: string) {
    const request = {
      headers: {
        authorization: authHeader,
      },
      user: undefined,
    } as unknown as AuthenticatedRequest;

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  it('deve autorizar e popular request.user quando o token JWT for valido', async () => {
    const context = createMockContext(`Bearer ${await signToken()}`);
    const canActivate = await guard.canActivate(context);

    expect(canActivate).toBe(true);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    expect(req.user).toEqual({
      id: 'user-uuid-123',
      email: 'test@lenoborges.com.br',
    });
  });

  it('deve lancar UnauthorizedException quando o header Authorization estiver ausente', async () => {
    const context = createMockContext(undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('deve lancar UnauthorizedException quando o token JWT estiver expirado', async () => {
    const context = createMockContext(
      `Bearer ${await signToken({}, secretUint8, '-10s')}`,
    );
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('deve lancar UnauthorizedException quando a assinatura for de outra chave', async () => {
    const otherSecret = new TextEncoder().encode(
      'other-different-secret-key-987654',
    );
    const context = createMockContext(
      `Bearer ${await signToken({}, otherSecret)}`,
    );
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('deve recusar token com audience diferente de authenticated', async () => {
    const context = createMockContext(
      `Bearer ${await signToken({ aud: 'outro-servico' })}`,
    );
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('deve recusar token emitido por outro projeto do Supabase', async () => {
    const context = createMockContext(
      `Bearer ${await signToken({ iss: 'https://outro.supabase.co/auth/v1' })}`,
    );
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('deve recusar token com role diferente de authenticated', async () => {
    // A chave anon do projeto e um JWT assinado com o mesmo segredo legado, e ela
    // e publica por natureza: circula no bundle do front. Ver achado A3 do review.
    const context = createMockContext(
      `Bearer ${await signToken({ role: 'anon' })}`,
    );
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('deve aceitar issuer customizado por SUPABASE_JWT_ISSUER', async () => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'SUPABASE_JWT_SECRET') return secretKey;
        if (key === 'SUPABASE_URL') return supabaseUrl;
        if (key === 'SUPABASE_JWT_ISSUER') return 'https://legado/auth/v1';
        return undefined;
      }),
    } as unknown as ConfigService;
    guard = new SupabaseAuthGuard(configService);

    const context = createMockContext(
      `Bearer ${await signToken({ iss: 'https://legado/auth/v1' })}`,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
