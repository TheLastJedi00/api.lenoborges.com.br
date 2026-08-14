import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from 'jose';
import { AuthenticatedRequest } from '../decorators/current-user.decorator';

/** Valor de `aud` e de `role` que o GoTrue emite para usuario autenticado. */
const AUTHENTICATED = 'authenticated';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly getKey: JWTVerifyGetKey | Uint8Array;
  private readonly issuer: string | undefined;

  constructor(private readonly configService: ConfigService) {
    const jwtSecret = this.configService.get<string>('SUPABASE_JWT_SECRET');
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');

    // O Supabase hospedado emite os tokens de usuario com iss
    // `${SUPABASE_URL}/auth/v1`. SUPABASE_JWT_ISSUER existe como escapatoria para
    // projeto com GOTRUE_JWT_ISSUER customizado, sem precisar mexer em codigo.
    this.issuer =
      this.configService.get<string>('SUPABASE_JWT_ISSUER') ??
      (supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/auth/v1` : undefined);

    if (jwtSecret) {
      this.getKey = new TextEncoder().encode(jwtSecret);
    } else if (supabaseUrl) {
      const jwksUrl = new URL(
        `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`,
      );
      this.getKey = createRemoteJWKSet(jwksUrl);
    } else {
      throw new Error(
        'Neither SUPABASE_JWT_SECRET nor SUPABASE_URL configured for SupabaseAuthGuard',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers?.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Token de autenticação ausente ou inválido.',
      );
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedException(
        'Token de autenticação ausente ou inválido.',
      );
    }

    try {
      // Verificar so a assinatura deixaria passar qualquer JWT emitido com a
      // mesma chave, inclusive a anon key do projeto, que e publica e circula no
      // bundle do front. Por isso audience, issuer e role tambem sao exigidos.
      const { payload } = await jwtVerify(token, this.getKey, {
        audience: AUTHENTICATED,
        issuer: this.issuer,
      });

      if (!payload.sub || payload.role !== AUTHENTICATED) {
        throw new UnauthorizedException(
          'Token de autenticação ausente ou inválido.',
        );
      }

      request.user = {
        id: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : '',
      };

      return true;
    } catch {
      throw new UnauthorizedException(
        'Token de autenticação ausente ou inválido.',
      );
    }
  }
}
