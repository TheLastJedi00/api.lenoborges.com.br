import { plainToInstance } from 'class-transformer';
import {
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
  return validatedConfig;
}
