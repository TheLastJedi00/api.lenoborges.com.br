/**
 * Escreve `tab` nos documentos de `badge_videos` que nao o tem (spec 021).
 *
 *   npm run tab:backfill -- --dry-run
 *   npm run tab:backfill
 *
 * **Por que ele existe, contra o que a decisao 2 da spec dizia.** A spec afirmou
 * que o fallback do converter (`data.tab ?? data.kind ?? 'aula'`) dispensava
 * migracao. **Isso esta errado, e foi verificado contra o Firestore real em
 * 2026-08-28:** o fallback roda na LEITURA de um documento que a consulta ja
 * devolveu, e `where('tab', '==', 'aula')` **nao enxerga documento que nao tem o
 * campo `tab`**. Ele nunca chega a ser lido, e portanto nunca ganha o valor
 * padrao.
 *
 * O sintoma e o pior possivel, e e o mesmo que a spec dizia estar evitando: a
 * trilha responde **200 com lista vazia**. Nada quebra, nada aparece em log, e
 * o aluno ve uma insignia vazia onde havia aulas.
 *
 * E a mesma armadilha que o README ja descrevia para o `promotedTo` da spec 016
 * -- `where('campo', '==', null)` nao enxerga documento sem o campo -- - e ela
 * pegou a spec 021 pelo outro lado: nao pelo `null`, mas pela ausencia.
 *
 * **O fallback do converter continua no lugar, e continua valendo.** Ele deixou
 * de ser a migracao e passou a ser o cinto de seguranca: um documento escrito
 * por caminho que ninguem previu ainda le a lista certa. Quem faz a base ficar
 * consultavel e este script.
 *
 * Ele e **idempotente**: roda quantas vezes for preciso, e so toca em documento
 * sem `tab`. Grava `tab = kind ?? 'aula'`, que e a lista em que o video ja
 * estava -- nenhum video muda de lugar.
 *
 * Como o `grant-admin`, ele usa a `FIREBASE_SERVICE_ACCOUNT_JSON` do `.env`
 * carregado, entao **age sobre o projeto daquele `.env`**: rodar contra
 * producao exige o `.env` de producao. Sao dois projetos, e os dois precisam
 * dele antes de o codigo novo receber trafego.
 */
import 'dotenv/config';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { parseServiceAccount } from '../src/config/service-account';

/** O limite de escritas de um WriteBatch do Firestore. */
const BATCH_LIMIT = 500;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

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

  const firestore = getFirestore();

  console.log(`\n  Projeto: ${serviceAccount.projectId}`);
  console.log(
    `  Modo: ${dryRun ? 'simulacao (nada e gravado)' : 'gravando'}\n`,
  );

  // A colecao inteira, sem `where`: procurar "documento sem o campo `tab`" com
  // uma consulta e exatamente o que o Firestore nao faz, e e a razao de este
  // script existir. Sao dezenas de videos -- ler tudo custa menos que a
  // engenharia de qualquer alternativa.
  const snapshot = await firestore.collection('badge_videos').get();

  const pendentes = snapshot.docs.filter(
    (doc) => (doc.data() as { tab?: string }).tab === undefined,
  );

  console.log(`  Videos na colecao: ${snapshot.size}`);
  console.log(`  Sem \`tab\`: ${pendentes.length}\n`);

  if (pendentes.length === 0) {
    console.log('  Nada a fazer.\n');
    return;
  }

  for (const doc of pendentes) {
    const dados = doc.data() as { kind?: string };
    const tab = dados.kind ?? 'aula';
    console.log(
      `    ${doc.id} | kind=${dados.kind ?? '(ausente)'} -> tab=${tab}`,
    );
  }

  if (dryRun) {
    console.log('\n  Simulacao: nada foi gravado. Rode sem --dry-run.\n');
    return;
  }

  // Em lotes, e nao um `update` por documento: o lote e atomico, e uma escrita
  // solta que falhasse no meio deixaria metade da colecao consultavel e metade
  // nao -- que e o estado mais dificil de diagnosticar depois.
  let gravados = 0;

  for (let inicio = 0; inicio < pendentes.length; inicio += BATCH_LIMIT) {
    const fatia = pendentes.slice(inicio, inicio + BATCH_LIMIT);
    const batch = firestore.batch();

    for (const doc of fatia) {
      const dados = doc.data() as { kind?: string };
      batch.update(doc.ref, {
        tab: dados.kind ?? 'aula',
        // `updatedAt` acompanha porque a colecao inteira o mantem, e um
        // documento com data velha depois de uma escrita e a linha que faz a
        // proxima pessoa duvidar do campo.
        updatedAt: Timestamp.now(),
      });
    }

    await batch.commit();
    gravados += fatia.length;
  }

  console.log(
    `\n  ${gravados} video(s) atualizados em ${serviceAccount.projectId}.\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n  Falhou: ${message}\n`);
  process.exit(1);
});
