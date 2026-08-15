import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';

// O TypeORM carrega o driver com `require(name)`, onde `name` e uma variavel
// (PlatformTools.load). Um require assim e invisivel para o tracer de arquivos
// da Vercel, que entao nao empacota `pg` na function e o boot morre com
// DriverPackageNotInstalledError, mesmo com o pacote em dependencies. Este
// require literal existe so para o tracer enxergar `pg` e inclui-lo no bundle.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('pg');

dotenv.config();

// A conexao carrega PII (nome, telefone e e-mail da lista de espera), entao a
// verificacao do certificado do servidor fica LIGADA por padrao.
//
// O host direto do Supabase (db.<ref>.supabase.co) apresenta um certificado
// assinado pela CA propria da Supabase, que nao esta no bundle do sistema. Para
// verificar de verdade, baixe o CA em Settings > Database > SSL Configuration no
// painel e aponte DATABASE_SSL_CA_PATH para o arquivo.
//
// DATABASE_SSL_REJECT_UNAUTHORIZED=false desliga a verificacao. Sem ela, quem
// interceptar a conexao apresenta um certificado proprio e le todo o trafego,
// entao isso e aceitavel apenas em banco local ou descartavel, nunca em producao.
const caPath = process.env.DATABASE_SSL_CA_PATH;
const rejectUnauthorized =
  process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';

export const sslOptions = {
  rejectUnauthorized,
  ...(caPath ? { ca: readFileSync(caPath, 'utf8') } : {}),
};

// O schema NAO e gerenciado aqui: as migrations vivem em supabase/migrations e
// sao aplicadas por `supabase db push`. O TypeORM so mapeia e consulta, sempre
// com synchronize: false.
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: sslOptions,
  synchronize: false,
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
});
