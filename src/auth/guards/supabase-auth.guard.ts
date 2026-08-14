import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from 'jose';
import { AuthenticatedRequest } from '../decorators/current-user.decorator';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly getKey: JWTVerifyGetKey | Uint8Array;

  constructor(private readonly configService: ConfigService) {
    const jwtSecret = this.configService.get<string>('SUPABASE_JWT_SECRET');
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');

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
      const verifyResult =
        typeof this.getKey === 'function'
          ? await jwtVerify(token, this.getKey)
          : await jwtVerify(token, this.getKey);

      const payload = verifyResult.payload;

      if (!payload.sub) {
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
