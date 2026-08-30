import { Injectable } from '@nestjs/common';
import {
  CollectionReference,
  DocumentReference,
  FieldValue,
  Timestamp,
  WriteBatch,
} from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import { PROFILE_COLLECTION } from '../profile/profile.repository';
import { ALREADY_EXISTS } from '../waitlist/waitlist.repository';
import { XP_PER_VIDEO } from './track.constants';
import {
  WatchedVideo,
  watchedVideoConverter,
} from './entities/watched-video.entity';

export const WATCHED_VIDEO_SUBCOLLECTION = 'watched_videos';

/**
 * O razao do que cada membro assistiu (spec 019).
 *
 * Mora em `profiles/{uid}/watched_videos/{videoId}`, e e a **unica** escrita de
 * `xp` neste produto. Ver `WatchedVideo` para o porque de o documento nunca ser
 * apagado.
 *
 * **Apagar um perfil precisa apagar esta subcolecao explicitamente.**
 * Subcolecao nao some com o pai no Firestore -- quarta vez que este produto
 * esbarra nisso, depois dos votos do Mural, de `notification_reads` e de
 * `legal_acceptances`.
 */
@Injectable()
export class WatchedVideoRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private collectionOf(uid: string): CollectionReference<WatchedVideo> {
    return this.firebase.firestore
      .collection(PROFILE_COLLECTION)
      .doc(uid)
      .collection(WATCHED_VIDEO_SUBCOLLECTION)
      .withConverter(watchedVideoConverter);
  }

  private profileDoc(uid: string): DocumentReference {
    return this.firebase.firestore.collection(PROFILE_COLLECTION).doc(uid);
  }

  async findOne(
    uid: string,
    videoId: string,
  ): Promise<{ found: boolean; entry: WatchedVideo | null }> {
    const snapshot = await this.collectionOf(uid).doc(videoId).get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.data()! };
  }

  /**
   * O que ja foi assistido, **entre os videos que a resposta vai listar**.
   *
   * E um `getAll` nos caminhos exatos, e nao um
   * `where('badgeId', '==', badgeId)` (decisao 6). Sao as mesmas N leituras, e
   * tres diferencas:
   *
   * 1. **Nenhum indice, nem automatico.** E leitura por caminho, como tudo neste
   *    produto.
   * 2. **Nao devolve lixo.** A consulta traria registros de videos removidos da
   *    insignia; o `getAll` so pergunta pelo que esta na tela.
   * 3. **O custo e proporcional ao que se mostra**, e nao ao que a pessoa ja
   *    assistiu naquela insignia.
   *
   * Devolve o conjunto dos ids **marcados agora** -- video com documento mas com
   * `watched: false` fica de fora, porque o que a tela desenha e o check, e nao
   * o razao. Video sem documento e `false`: nao existe "nao sei".
   */
  async findWatchedIds(
    uid: string,
    videoIds: readonly string[],
  ): Promise<Set<string>> {
    if (videoIds.length === 0) {
      // getAll() sem documento nenhum estoura no Firestore, e insignia vazia e o
      // estado normal do produto -- onze das treze etapas, no lancamento.
      return new Set();
    }

    const collection = this.collectionOf(uid);
    // O getAll perde o converter no caminho de volta: ele devolve
    // DocumentSnapshot<DocumentData>. O cast e aqui, num lugar so, e nao
    // espalhado por quem chama.
    const snapshots = await this.firebase.firestore.getAll(
      ...videoIds.map((id) => collection.doc(id)),
    );

    const watched = new Set<string>();
    for (const snapshot of snapshots) {
      if (snapshot.exists && (snapshot.data() as WatchedVideo).watched) {
        watched.add(snapshot.id);
      }
    }

    return watched;
  }

  /**
   * Marca ou desmarca, e **paga o XP no maximo uma vez por video, para sempre**.
   *
   * Os dois caminhos:
   *
   * - **Nao existe documento:** um `WriteBatch` com `create()` do razao e
   *   `FieldValue.increment(XP_PER_VIDEO)` no perfil. `create()` recusa
   *   duplicata com ALREADY_EXISTS e **derruba o lote inteiro** -- e e essa
   *   derrubada que impede o incremento. Sem transacao, sem leitura previa e
   *   sem janela entre conferir e escrever: a atomicidade faz o trabalho da
   *   trava.
   * - **Existe documento:** um `update` de `watched` e `updatedAt`, e mais nada.
   *   **Sem tocar em `firstWatchedAt`** -- ele e a prova de quando o XP foi pago
   *   -- e **sem tocar em `xp`**: desmarcar nao decrementa, e remarcar nao
   *   incrementa. E ai que o farm por duplo clique morre.
   *
   * Devolve `granted` -- se esta chamada pagou XP -- e o **`xp` resultante**,
   * lido do perfil depois da escrita.
   *
   * O `xp` sai daqui, e nao de uma segunda leitura no service, por duas razoes.
   * A primeira e de desenho: **quem escreve o incremento e quem responde por
   * ele**, e reproduzir a conta noutro lugar seria a segunda implementacao da
   * mesma regra.
   *
   * A segunda e de acoplamento, e custou um boot quebrado para ficar clara: com
   * o `ProfileRepository` injetado no service, o `TrackModule` passaria a
   * importar o `ProfileModule`, fechando o ciclo de arquivos
   * `ProfileModule -> TrackModule -> EmailsModule -> ProfileModule`. Nenhum
   * teste unitario pega isso -- nenhum deles monta o `AppModule` --, e a
   * aplicacao morre no boot com `ProfileModule` chegando `undefined` no
   * `EmailsModule`.
   */
  async setWatched(
    uid: string,
    videoId: string,
    badgeId: string,
    watched: boolean,
    /**
     * Escritas que precisam cair **no mesmo lote** -- hoje, a linha do ranking
     * (spec 022, decisao 11).
     *
     * Um gancho, e nao o `RankingRepository` injetado aqui, pela mesma razao
     * pela qual o `ProfileRepository` nao esta: injeta-lo faria o `TrackModule`
     * importar o `GamesModule`, e o ciclo de arquivos que isso fecha derruba o
     * boot sem nenhum teste unitario notar. Quem compoe e o service.
     *
     * **O lote e o que garante que o placar nunca fique a frente do perfil.**
     * Um `commit` que falha nao paga nem um nem outro; duas escritas separadas
     * criariam um XP no ranking que o perfil nao tem, e nada depois compararia
     * os dois para descobrir.
     */
    extra?: (batch: WriteBatch) => void,
  ): Promise<{ granted: boolean; xp: number }> {
    const ref = this.collectionOf(uid).doc(videoId);
    const now = Timestamp.now();

    const batch = this.firebase.firestore.batch();
    batch.create(ref, {
      videoId,
      badgeId,
      watched,
      firstWatchedAt: now.toDate(),
      updatedAt: now.toDate(),
    });
    batch.update(this.profileDoc(uid), {
      xp: FieldValue.increment(XP_PER_VIDEO),
      updatedAt: now,
    });

    extra?.(batch);

    try {
      await batch.commit();

      return { granted: true, xp: await this.xpOf(uid) };
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }

      // O video ja tinha sido marcado alguma vez. So o interruptor muda -- e
      // `update` parcial, e nao `set`, porque `set` reescreveria
      // `firstWatchedAt` e apagaria quando o XP foi realmente pago.
      await ref.update({ watched, updatedAt: now.toDate() });

      return { granted: false, xp: await this.xpOf(uid) };
    }
  }

  /**
   * O `xp` gravado no perfil, depois da escrita.
   *
   * `?? 0` de novo, e nao e redundancia com o converter: esta leitura e crua,
   * pelo caminho, sem passar por ele -- e um perfil anterior a esta spec nao tem
   * o campo.
   */
  private async xpOf(uid: string): Promise<number> {
    const snapshot = await this.profileDoc(uid).get();
    const xp = (snapshot.data() as { xp?: number } | undefined)?.xp;

    return typeof xp === 'number' ? xp : 0;
  }

  /**
   * Apaga o razao inteiro de um perfil (decisao 13).
   *
   * Chamado pela exclusao de conta, junto de `legal_acceptances` e
   * `notification_reads`. E historico de comportamento ligado a um `uid`: a
   * pessoa pediu para ser esquecida, e o que ela assistiu vai junto.
   */
  async removeAll(uid: string): Promise<void> {
    const refs = await this.firebase.firestore
      .collection(PROFILE_COLLECTION)
      .doc(uid)
      .collection(WATCHED_VIDEO_SUBCOLLECTION)
      .listDocuments();

    if (refs.length === 0) {
      return;
    }

    const batch = this.firebase.firestore.batch();
    for (const ref of refs) {
      batch.delete(ref);
    }

    await batch.commit();
  }
}

/** O ALREADY_EXISTS do Firestore chega como `{ code: 6 }` no erro do commit. */
function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === ALREADY_EXISTS
  );
}
