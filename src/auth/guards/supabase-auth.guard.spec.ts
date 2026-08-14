import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, generateSecret } from 'jose';
import { SupabaseAuthGuard } from './supabase-auth.guard';

describe('SupabaseAuthGuard', () => {
  let guard: SupabaseAuthGuard;
  let configService: ConfigService;
  const secretKey = 'super-secret-jwt-key-for-testing-123456';
  let secretUint8: Uint8Array;

  beforeAll(async () => {
    secretUint8 = new TextEncoder().encode(secretKey);
  });

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'SUPABASE_JWT_SECRET') return secretKey;
        if (key === 'SUPABASE_URL') return 'https://test.supabase.co';
        return undefined;
      }),
    } as unknown as ConfigService;

    guard = new SupabaseAuthGuard(configService);
  });

  function createMockContext(authHeader?: string) {
    const request = {
      headers: {
        authorization: authHeader,
      },
      user: undefined as any,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  it('deve autorizar e popular request.user quando o token JWT for valido', async () => {
    const validToken = await new SignJWT({
      sub: 'user-uuid-123',
      email: 'test@lenoborges.com.br',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(secretUint8);

    const context = createMockContext(`Bearer ${validToken}`);
    const canActivate = await guard.canActivate(context);

    expect(canActivate).toBe(true);
    const req = context.switchToHttp().getRequest();
    expect(req.user).toEqual({
      id: 'user-uuid-123',
      email: 'test@lenoborges.com.br',
    });
  });

  it('deve lancar UnauthorizedException quando o header Authorization estiver ausente', async () => {
    const context = createMockContext(undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('deve lancar UnauthorizedException quando o token JWT estiver expirado', async () => {
    const expiredToken = await new SignJWT({
      sub: 'user-uuid-123',
      email: 'test@lenoborges.com.br',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('-10s')
      .sign(secretUint8);

    const context = createMockContext(`Bearer ${expiredToken}`);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('deve lancar UnauthorizedException quando a assinatura for de outra chave', async () => {
    const otherSecret = new TextEncoder().encode('other-different-secret-key-987654');
    const invalidSignatureToken = await new SignJWT({
      sub: 'user-uuid-123',
      email: 'test@lenoborges.com.br',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(otherSecret);

    const context = createMockContext(`Bearer ${invalidSignatureToken}`);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
