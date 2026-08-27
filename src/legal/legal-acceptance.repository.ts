import { Injectable } from '@nestjs/common';
import { DocumentReference, Timestamp } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import { PROFILE_COLLECTION } from '../profile/profile.repository';

export const LEGAL_ACCEPTANCE_SUBCOLLECTION = 'legal_acceptances';

/**
 * O historico de aceites de uma pessoa (spec 018, decisao 6).
 *
 * Mora em `profiles/{uid}/legal_acceptances/{documentId}__{version}`, e existe
 * ao lado do mapa `legalAcceptances` do perfil porque as duas coisas respondem
 * perguntas diferentes:
 *
 * - o **mapa** responde "esta pessoa esta em dia", na leitura que a requisicao
 *   ja faz -- sem consulta, sem indice, sem custo novo;
 * - a **subcolecao** responde "quando ela aceitou a versao de agosto", que e a
 *   pergunta que aparece quando alguem contesta uma cobranca. O mapa perde essa
 *   informacao na proxima versao, porque sobrescreve.
 *
 * **O caminho carrega a versao, e e ele que garante a unicidade**: duplo clique
 * nao grava duas vezes, e o retry de uma requisicao que ja tinha vencido
 * tampouco.
 *
 * **Nao ha IP nem user-agent aqui** (decisao 7). A pessoa esta autenticada: uid,
 * data e versao ja dizem quem aceitou o que e quando, e e o provedor de
 * identidade que responde por "era mesmo ela". IP e user-agent seriam dado
 * pessoal novo com finalidade unica de uma disputa que nao existe -- e a spec
 * 013 escreveu a condicao de que a exclusao de conta depende: nenhuma colecao
 * nova pode guardar `uid` ao lado de dado pessoal.
 *
 * **Apagar um perfil precisa apagar esta subcolecao explicitamente.**
 * Subcolecao nao some com o pai no Firestore -- terceira vez que este produto
 * esbarra nisso, depois dos votos do Mural e de `notification_reads`.
 */
@Injectable()
export class LegalAcceptanceRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private acceptanceDoc(
    uid: string,
    documentId: string,
    version: string,
  ): DocumentReference {
    return this.firebase.firestore
      .collection(PROFILE_COLLECTION)
      .doc(uid)
      .collection(LEGAL_ACCEPTANCE_SUBCOLLECTION)
      .doc(`${documentId}__${version}`);
  }

  /**
   * Grava o aceite e atualiza o mapa do perfil, **no mesmo lote**.
   *
   * Um `WriteBatch` e nao duas escritas: mapa e historico discordando e o unico
   * estado que ninguem consegue explicar depois -- o guard liberaria alguem sem
   * prova de aceite, ou barraria alguem que tem.
   *
   * **`create()`, nunca `set()`.** O `ALREADY_EXISTS` aqui significa "ja tinha
   * aceitado", que e sucesso, e vira `created: false` em vez de excecao.
   * Reescrever seria apagar quando a pessoa realmente aceitou -- e essa data e a
   * unica prova que vai existir.
   */
  async record(
    uid: string,
    documentId: string,
    version: string,
    acceptedAt: Date,
  ): Promise<{ created: boolean }> {
    const ref = this.acceptanceDoc(uid, documentId, version);
    const existing = await ref.get();

    if (existing.exists) {
      return { created: false };
    }

    const profileRef = this.firebase.firestore
      .collection(PROFILE_COLLECTION)
      .doc(uid);
    const timestamp = Timestamp.fromDate(acceptedAt);

    const batch = this.firebase.firestore.batch();
    batch.create(ref, { documentId, version, acceptedAt: timestamp });
    // Caminho pontilhado, e nao um objeto inteiro: `legalAcceptances` com um
    // objeto novo apagaria o aceite do outro documento, que e exatamente o
    // estado em que a pessoa aceita os termos e volta a dever a politica.
    batch.update(profileRef, {
      [`legalAcceptances.${documentId}`]: { version, acceptedAt: timestamp },
      updatedAt: Timestamp.now(),
    });

    await batch.commit();

    return { created: true };
  }

  /**
   * Apaga o historico de aceites de um perfil (spec 018, decisao 11).
   *
   * Chamado pela exclusao de conta, junto de `notification_reads`. O aceite e
   * dado pessoal, a pessoa pediu para ser esquecida, e o contrato que ele
   * comprova terminou junto com a conta.
   */
  async removeAll(uid: string): Promise<void> {
    const refs = await this.firebase.firestore
      .collection(PROFILE_COLLECTION)
      .doc(uid)
      .collection(LEGAL_ACCEPTANCE_SUBCOLLECTION)
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
