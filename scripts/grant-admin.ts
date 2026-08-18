/**
 * Promove (ou rebaixa) um usuario a administrador da Liga Dev.
 *
 *   npm run admin:grant -- lenoborges.dev@gmail.com
 *   npm run admin:grant -- lenoborges.dev@gmail.com --revoke
 *
 * **Isto e tarefa de terminal e nao de tela, de proposito.** Um endpoint que
 * cria admin nao teria quem criasse o primeiro, e seria a superficie mais cara
 * do projeto para o menor uso -- tres execucoes na vida do produto. Ver a
 * decisao 5 da spec 009.
 *
 * O script usa a mesma FIREBASE_SERVICE_ACCOUNT_JSON da API, entao ele age
 * sobre o projeto do .env carregado: rodar contra producao exige o .env de
 * producao.
 */
import 'dotenv/config';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { parseServiceAccount } from '../src/config/service-account';

function parseArgs(argv: string[]): { email: string; revoke: boolean } {
  const args = argv.slice(2);
  const revoke = args.includes('--revoke');
  const email = args.find((arg) => !arg.startsWith('--'));

  if (!email) {
    throw new Error(
      'Uso: npm run admin:grant -- <email> [--revoke]\n' +
        'Exemplo: npm run admin:grant -- lenoborges.dev@gmail.com',
    );
  }

  return { email, revoke };
}

async function main(): Promise<void> {
  const { email, revoke } = parseArgs(process.argv);

  const serviceAccount = parseServiceAccount(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '',
  );

  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        privateKey: serviceAccount.privateKey,
      }),
      projectId: serviceAccount.projectId,
    });
  }

  const auth = getAuth();
  const user = await auth.getUserByEmail(email);

  // Preservar as claims que ja existem importa: sobrescrever o objeto inteiro
  // apagaria qualquer claim futura em silencio, e o sintoma apareceria longe
  // daqui.
  const claims = { ...(user.customClaims ?? {}) };

  if (revoke) {
    delete claims.role;
  } else {
    claims.role = 'admin';
  }

  await auth.setCustomUserClaims(user.uid, claims);

  const acao = revoke ? 'rebaixado a membro comum' : 'promovido a admin';
  console.log(
    `\n  ${email} (${user.uid}) ${acao} no projeto ${serviceAccount.projectId}.`,
  );

  // Sem este aviso, o proximo passo de quem rodou o script e abrir a plataforma,
  // nao ver nada mudar e comecar uma investigacao inutil. A claim so entra no
  // proximo ID token, e o atual vale ate uma hora (CHECK_REVOKED = false, na
  // decisao 2 da spec 007).
  console.log(
    '\n  ATENCAO: a claim so vale no PROXIMO token.\n' +
      '  O ID token que a pessoa ja tem continua valendo por ate uma hora.\n' +
      '  Para valer agora, saia da conta e entre de novo.\n',
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n  Falhou: ${message}\n`);
  process.exit(1);
});
