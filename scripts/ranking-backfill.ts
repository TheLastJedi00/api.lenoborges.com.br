/**
 * Preenche a colecao `ranking` a partir dos perfis existentes (spec 022,
 * decisao 11).
 *
 *   npm run ranking:backfill -- --dry-run
 *   npm run ranking:backfill
 *
 * **Sem ele, `GET /ranking` responde `200` com lista vazia** -- e nao aparece
 * nada em log nenhum. E a mesma armadilha do `tab` da spec 021, vista do outro
 * lado: la o documento existia sem o campo que a consulta filtra; aqui o
 * documento nao existe. O sintoma e identico e igualmente silencioso, e por isso
 * este script roda **antes** de o codigo novo receber trafego, nos dois
 * projetos.
 *
 * **So entra quem tem `completedAt` e `nickname`.** O primeiro exclui a conta
 * pela metade, que nao tem nome nem bio; o segundo e a decisao 20: quem nao
 * escolheu gamertag nao aparece no placar, e uma linha sem `nickname` seria um
 * nome em branco ao lado dos outros.
 *
 * **Idempotente**, e ele **preserva as posicoes ja calculadas**: rodar de novo
 * atualiza XP e insignias sem apagar o `previousPosition`, que e o que sustenta
 * o selo de "subiu 3 hoje".
 *
 * Como o `grant-admin` e o `backfill-tab`, usa a `FIREBASE_SERVICE_ACCOUNT_JSON`
 * do `.env` carregado, entao **age sobre o projeto daquele `.env`**. Sao dois
 * projetos, e os dois precisam dele.
 */
import 'dotenv/config';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { parseServiceAccount } from '../src/config/service-account';

/** O limite de escritas de um WriteBatch do Firestore. */
const BATCH_LIMIT = 500;

/** O teto de insignias do GYM Battle. Duplicado aqui de proposito: um script
 * nao deve arrastar o grafo de modulos do Nest para rodar. */
const MAX_BADGES = 8;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(
        parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? ''),
      ),
    });
  }

  const firestore = getFirestore();
  const perfis = await firestore.collection('profiles').get();

  const candidatos = perfis.docs.filter((doc) => {
    const data = doc.data();

    return Boolean(data.completedAt) && Boolean(data.nickname);
  });

  console.log(
    `${perfis.size} perfis, ${candidatos.length} com onboarding e gamertag.`,
  );

  if (dryRun) {
    for (const doc of candidatos) {
      const data = doc.data();
      console.log(
        `  ${doc.id}  ${String(data.nickname)}  xp=${Number(data.xp ?? 0)}  insignias=${Math.min(Number(data.grade ?? 0), MAX_BADGES)}`,
      );
    }
    console.log('\n--dry-run: nada foi gravado.');

    return;
  }

  // As linhas que ja existem, para nao apagar as posicoes calculadas. Uma
  // leitura da colecao inteira, e nao uma por perfil: sao os mesmos documentos.
  const existentes = new Map<string, FirebaseFirestore.DocumentData>();
  const atuais = await firestore.collection('ranking').get();
  for (const doc of atuais.docs) {
    existentes.set(doc.id, doc.data());
  }

  let gravados = 0;

  for (let i = 0; i < candidatos.length; i += BATCH_LIMIT) {
    const batch = firestore.batch();

    for (const doc of candidatos.slice(i, i + BATCH_LIMIT)) {
      const data = doc.data();
      const anterior = existentes.get(doc.id);

      batch.set(firestore.collection('ranking').doc(doc.id), {
        uid: doc.id,
        nickname: String(data.nickname),
        xp: Number(data.xp ?? 0),
        badgeCount: Math.max(
          0,
          Math.min(Number(data.grade ?? 0), MAX_BADGES),
        ),
        // Preservadas: elas sao do snapshot diario, e nao deste script.
        previousPosition: anterior?.previousPosition ?? null,
        currentPosition: anterior?.currentPosition ?? null,
        positionUpdatedAt: anterior?.positionUpdatedAt ?? null,
        updatedAt: Timestamp.now(),
      });

      gravados += 1;
    }

    await batch.commit();
  }

  console.log(`${gravados} linhas gravadas no ranking.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
