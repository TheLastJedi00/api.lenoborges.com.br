/**
 * Fecha o dia do ranking: copia a posicao atual para "ontem" e recalcula a de
 * hoje (spec 022, decisao 22).
 *
 *   npm run ranking:snapshot -- --dry-run
 *   npm run ranking:snapshot
 *
 * **A ordem das duas escritas e a decisao inteira, e ela e num sentido so:**
 * primeiro o `currentPosition` de ontem vira `previousPosition`, depois a
 * posicao de hoje e calculada e gravada como `currentPosition`. Inverter faz o
 * selo dizer "0 posicoes" para todo mundo, porque as duas passariam a ser o
 * mesmo numero.
 *
 * **A posicao aqui e cache, e nao verdade.** A ordem de agora sai da consulta
 * ordenada, a cada leitura do `GET /ranking`; estes dois campos existem **so**
 * para a variacao diaria. Ler o `currentPosition` para desenhar a lista faria a
 * linha do topo dizer "#47" enquanto a lista abaixo mostra a pessoa em 43 --
 * duas verdades na mesma tela.
 *
 * **Idempotente dentro do mesmo dia? Nao, e nem deveria ser.** Rodar duas vezes
 * no mesmo dia zera a variacao, porque a segunda execucao copia a posicao de
 * hoje para ontem. E o comportamento correto de um snapshot; quem o agenda roda
 * uma vez por dia. O `--dry-run` existe justamente para conferir antes.
 *
 * Como os outros scripts, usa a `FIREBASE_SERVICE_ACCOUNT_JSON` do `.env`
 * carregado e **age sobre o projeto daquele `.env`**.
 */
import 'dotenv/config';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { parseServiceAccount } from '../src/config/service-account';

const BATCH_LIMIT = 400;

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

  // A mesma ordenacao do `GET /ranking`: `xp` desc com desempate por `uid`. Uma
  // ordenacao diferente aqui produziria posicoes que nao batem com a lista que
  // o membro ve, e o selo de evolucao mentiria de forma consistente.
  const snapshot = await firestore
    .collection('ranking')
    .orderBy('xp', 'desc')
    .orderBy('uid', 'asc')
    .get();

  console.log(`${snapshot.size} membros no ranking.`);

  const linhas = snapshot.docs.map((doc, index) => {
    const data = doc.data();
    const currentPosition = index + 1;
    // O `currentPosition` de ontem vira o `previousPosition` de hoje. Quem nunca
    // teve posicao entra com `null`, e a tela nao desenha selo nenhum -- "ainda
    // nao sei" e diferente de "nao mudou".
    const previousPosition = (data.currentPosition as number | null) ?? null;

    return {
      uid: doc.id,
      nickname: String(data.nickname ?? ''),
      currentPosition,
      previousPosition,
      variacao:
        previousPosition === null ? null : previousPosition - currentPosition,
    };
  });

  if (dryRun) {
    for (const linha of linhas.slice(0, 50)) {
      const seta =
        linha.variacao === null
          ? 'novo'
          : linha.variacao > 0
            ? `subiu ${linha.variacao}`
            : linha.variacao < 0
              ? `desceu ${-linha.variacao}`
              : 'manteve';

      console.log(
        `  #${linha.currentPosition}  ${linha.nickname}  (${seta})`,
      );
    }
    if (linhas.length > 50) {
      console.log(`  ... e mais ${linhas.length - 50}.`);
    }
    console.log('\n--dry-run: nada foi gravado.');

    return;
  }

  for (let i = 0; i < linhas.length; i += BATCH_LIMIT) {
    const batch = firestore.batch();

    for (const linha of linhas.slice(i, i + BATCH_LIMIT)) {
      batch.update(firestore.collection('ranking').doc(linha.uid), {
        currentPosition: linha.currentPosition,
        previousPosition: linha.previousPosition,
        positionUpdatedAt: Timestamp.now(),
      });
    }

    await batch.commit();
  }

  console.log(`${linhas.length} posicoes atualizadas.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
