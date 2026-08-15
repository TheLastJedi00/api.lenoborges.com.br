import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JWTVerifyGetKey } from 'jose';
import { AuthenticatedRequest } from '../decorators/current-user.decorator';

/** Valor de `aud` e de `role` que o GoTrue emite para usuario autenticado. */
const AUTHENTICATED = 'authenticated';

// O jose 6 e ESM puro e este projeto compila para CommonJS. O Node local aceita
// `require()` de ESM, mas o runtime da Vercel nao, e o boot morre com
// ERR_REQUIRE_ESM. O `import()` dinamico sobrevive ao emit CJS (module:
// nodenext preserva a chamada) e continua funcionando nos dois lugares.
let josePromise: Promise<typeof import('jose')> | undefined;
function loadJose(): Promise<typeof import('jose')> {
  josePromise ??= import('jose');
  return josePromise;
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly jwtSecret: string | undefined;
  private readonly supabaseUrl: string | undefined;
  private readonly issuer: string | undefined;
  private keyPromise: Promise<JWTVerifyGetKey | Uint8Array> | undefined;

  constructor(private readonly configService: ConfigService) {
    this.jwtSecret = this.configService.get<string>('SUPABASE_JWT_SECRET');
    this.supabaseUrl = this.configService.get<string>('SUPABASE_URL');

    // O Supabase hospedado emite os tokens de usuario com iss
    // `${SUPABASE_URL}/auth/v1`. SUPABASE_JWT_ISSUER existe como escapatoria para
    // projeto com GOTRUE_JWT_ISSUER customizado, sem precisar mexer em codigo.
    this.issuer =
      this.configService.get<string>('SUPABASE_JWT_ISSUER') ??
      (this.supabaseUrl
        ? `${this.supabaseUrl.replace(/\/$/, '')}/auth/v1`
        : undefined);

    // A chave so pode ser montada depois do import() do jose, mas configuracao
    // faltando continua derrubando o boot em vez de virar 401 em cada request.
    if (!this.jwtSecret && !this.supabaseUrl) {
      throw new Error(
        'Neither SUPABASE_JWT_SECRET nor SUPABASE_URL configured for SupabaseAuthGuard',
      );
    }
  }

  private getKey(): Promise<JWTVerifyGetKey | Uint8Array> {
    this.keyPromise ??= (async () => {
      if (this.jwtSecret) {
        return new TextEncoder().encode(this.jwtSecret);
      }
      const { createRemoteJWKSet } = await loadJose();
      const jwksUrl = new URL(
        `${this.supabaseUrl!.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`,
      );
      return createRemoteJWKSet(jwksUrl);
    })();
    return this.keyPromise;
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

    // Fora do try: falha ao carregar o jose ou ao montar a chave e problema de
    // infraestrutura, e virar 401 aqui esconderia isso atras de "token invalido".
    const { jwtVerify } = await loadJose();
    const key = await this.getKey();

    try {
      // Verificar so a assinatura deixaria passar qualquer JWT emitido com a
      // mesma chave, inclusive a anon key do projeto, que e publica e circula no
      // bundle do front. Por isso audience, issuer e role tambem sao exigidos.
      const { payload } = await jwtVerify(token, key, {
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
