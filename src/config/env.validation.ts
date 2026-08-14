import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsNumber()
  @IsOptional()
  PORT?: number;

  @IsString()
  @IsOptional()
  NODE_ENV?: string;

  @IsString()
  @IsNotEmpty()
  FRONTEND_URL: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  // 'false' desliga a verificacao do certificado TLS do banco. Apenas para
  // banco local ou descartavel; ver src/config/typeorm.config.ts.
  @IsString()
  @IsOptional()
  DATABASE_SSL_REJECT_UNAUTHORIZED?: string;

  // Caminho para o CA do Supabase (Settings > Database > SSL Configuration).
  // Com ele preenchido a verificacao do certificado funciona de verdade.
  @IsString()
  @IsOptional()
  DATABASE_SSL_CA_PATH?: string;

  // Quantidade de proxies na frente da API. Precisa bater com a topologia real,
  // senao o rate limit por IP pode ser furado com X-Forwarded-For forjado.
  @IsNumber()
  @IsOptional()
  TRUST_PROXY_HOPS?: number;

  // 'true' liga o Swagger em /docs mesmo em producao. Fora de producao ele ja
  // vem ligado. Ver src/main.ts.
  @IsString()
  @IsOptional()
  SWAGGER_ENABLED?: string;

  // Supabase Auth (spec 005)
  @IsString()
  @IsNotEmpty()
  SUPABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  SUPABASE_ANON_KEY: string;

  @IsString()
  @IsNotEmpty()
  SUPABASE_SERVICE_ROLE_KEY: string;

  @IsString()
  @IsOptional()
  SUPABASE_JWT_SECRET?: string;

  // Emissor esperado no JWT. Default: SUPABASE_URL + /auth/v1. Ver
  // src/auth/guards/supabase-auth.guard.ts.
  @IsString()
  @IsOptional()
  SUPABASE_JWT_ISSUER?: string;

  // Cookie de refresh token
  @IsIn(['true', 'false'])
  @IsOptional()
  AUTH_COOKIE_SECURE?: string;

  // Enum fechado: o CookieService repassa este valor direto para o Express, e um
  // valor invalido viraria um atributo SameSite que o navegador ignora.
  @IsIn(['lax', 'strict', 'none'])
  @IsOptional()
  AUTH_COOKIE_SAMESITE?: string;

  @IsNumber()
  @IsOptional()
  AUTH_COOKIE_MAX_AGE_DAYS?: number;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  // SameSite=None so vale acompanhado de Secure: o navegador descarta o cookie em
  // silencio quando falta. Sem esta checagem, o login responde 200, o cookie de
  // refresh nunca chega ao navegador e todo F5 desloga, sem erro em log nenhum.
  // Falhar no boot e o unico jeito de isso aparecer antes de estar em producao.
  if (
    validatedConfig.AUTH_COOKIE_SAMESITE === 'none' &&
    validatedConfig.AUTH_COOKIE_SECURE !== 'true'
  ) {
    throw new Error(
      'AUTH_COOKIE_SAMESITE=none exige AUTH_COOKIE_SECURE=true. ' +
        'O navegador descarta cookie SameSite=None sem Secure, e a sessao nunca persiste.',
    );
  }

  return validatedConfig;
}
