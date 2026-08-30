import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  validateSync,
} from 'class-validator';
import { parseServiceAccount } from './service-account';

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

  // Firebase (spec 007)
  //
  // Chave de servico do projeto, o JSON inteiro em uma linha so. E credencial de
  // administrador: quem a tem emite token de qualquer usuario e le qualquer
  // documento do Firestore, ignorando as security rules. A validacao do formato
  // fica em validateServiceAccount, abaixo.
  @IsString()
  @IsNotEmpty()
  FIREBASE_SERVICE_ACCOUNT_JSON: string;

  // Chave publica do projeto, usada nas chamadas REST ao Identity Toolkit. NAO e
  // segredo: ela vai no bundle de qualquer app Firebase web por desenho, e
  // identifica o projeto sem autorizar nada sozinha. Esta aqui por conveniencia
  // de configuracao, nao por sigilo.
  @IsString()
  @IsNotEmpty()
  FIREBASE_WEB_API_KEY: string;

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

  // E-mail (spec 014)
  //
  // Chave do Resend. **Opcional aqui e obrigatoria em producao**, checada logo
  // abaixo em validate(): sem ela o MailerService escreve o e-mail no log e
  // devolve sucesso. O perigo do desenvolvimento nao e o e-mail que nao sai, e o
  // que sai -- uma maquina local apontada para o Firestore de producao rodando o
  // gatilho de video manda para a base inteira. O padrao precisa ser inofensivo,
  // e ligar precisa ser um ato deliberado. Ver a decisao 16 da spec 014.
  @IsString()
  @IsOptional()
  RESEND_API_KEY?: string;

  // Remetente, no formato `Nome <endereco@dominio>`. **Do dominio proprio,
  // nunca o dominio de teste do provedor** (decisao 2): e-mail de dominio nao
  // autenticado cai em spam, e reputacao de dominio se perde uma vez.
  @IsString()
  @IsNotEmpty()
  EMAIL_FROM: string;

  // Para onde vai a resposta de quem responder ao e-mail. Sem ele, responder ao
  // aviso de video novo cai numa caixa que ninguem le.
  @IsString()
  @IsNotEmpty()
  EMAIL_REPLY_TO: string;

  // Segredo do HMAC do token de descadastro (decisao 9). Trocar este valor
  // invalida todo link de descadastro ja enviado -- e link de descadastro morto
  // e pior que qualquer risco que ele carrega, porque o botao que a pessoa acha
  // depois e o "marcar como spam" do cliente de e-mail.
  @IsString()
  @IsNotEmpty()
  EMAIL_UNSUBSCRIBE_SECRET: string;

  // Onde esta API responde, em absoluto. **E-mail nao tem roteador**: o link
  // do rodape e o cabecalho List-Unsubscribe precisam de uma URL inteira, e
  // quem responde ao descadastro e este servidor, nao o front. Sem ela, o
  // fallback e localhost -- que funciona em desenvolvimento e produz um link
  // morto em producao.
  @IsString()
  @IsOptional()
  API_PUBLIC_URL?: string;

  // Segredo da assinatura do webhook de bounce e reclamacao (decisao 10).
  // Obrigatorio em producao, pela mesma checagem da RESEND_API_KEY.
  @IsString()
  @IsOptional()
  RESEND_WEBHOOK_SECRET?: string;

  // Geracao de questoes por IA (spec 022, decisao 9).
  //
  // **Opcional aqui e obrigatoria em producao**, pela mesma checagem imperativa
  // da RESEND_API_KEY logo abaixo -- e nao com `@IsNotEmpty()`, que e o padrao
  // da FIREBASE_WEB_API_KEY. A diferenca importa: exigi-la sempre derrubaria o
  // boot de toda maquina de desenvolvimento que nao tem a chave, por causa de
  // uma rota de admin que ninguem esta usando. Sem a chave, a rota de geracao
  // responde 503 dizendo que a IA nao esta configurada, e o resto da API serve
  // normalmente.
  //
  // **Nenhuma rota publica a alcanca.** O GeminiService so e injetado no
  // controller de admin.
  @IsString()
  @IsOptional()
  GEMINI_API_KEY?: string;
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

  // Em producao o modo log da decisao 16 e defeito, nao conveniencia: uma API
  // de producao que registra o e-mail e nao envia e um recurso quebrado em
  // silencio. Fora de producao a ausencia e o padrao seguro.
  if (validatedConfig.NODE_ENV === 'production') {
    if (!validatedConfig.RESEND_API_KEY) {
      throw new Error(
        'RESEND_API_KEY e obrigatoria em producao. Sem ela o mailer apenas ' +
          'registra o e-mail no log e nada e enviado.',
      );
    }

    if (!validatedConfig.RESEND_WEBHOOK_SECRET) {
      throw new Error(
        'RESEND_WEBHOOK_SECRET e obrigatoria em producao. Sem ela o webhook de ' +
          'bounce recusa tudo, e endereco morto nunca se desliga sozinho.',
      );
    }

    if (!validatedConfig.API_PUBLIC_URL) {
      throw new Error(
        'API_PUBLIC_URL e obrigatoria em producao. Sem ela o link de ' +
          'descadastro de todo e-mail aponta para localhost, e quem quiser sair ' +
          'da lista nao consegue -- o que vira denuncia de spam.',
      );
    }

    // Em producao, a ausencia da chave da Gemini e o admin descobrindo pelo 503
    // que o botao "Gerar com IA" nunca funcionou -- depois de escrever o prompt.
    // Falhar no boot troca isso por uma linha no deploy.
    if (!validatedConfig.GEMINI_API_KEY) {
      throw new Error(
        'GEMINI_API_KEY e obrigatoria em producao. Sem ela a geracao de ' +
          'questoes do GYM Challenge responde 503, e o admin so descobre ' +
          'depois de escrever o prompt.',
      );
    }
  }

  // Chave de servico malformada so apareceria como erro de PEM invalido dentro
  // do firebase-admin, na primeira operacao de auth, em producao. Parsear no
  // boot troca isso por uma mensagem que diz qual campo falta.
  parseServiceAccount(validatedConfig.FIREBASE_SERVICE_ACCOUNT_JSON);

  return validatedConfig;
}
