import { Injectable } from '@nestjs/common';
import { CollectionReference, Timestamp } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import { ALREADY_EXISTS } from '../waitlist/waitlist.repository';
import { PROFILE_COLLECTION } from './profile.repository';
import {
  NicknameEntry,
  nicknameConverter,
  nicknameDocId,
} from './entities/nickname.entity';

export const NICKNAME_COLLECTION = 'nicknames';

/**
 * A unicidade da gamertag (spec 022, decisao 20).
 *
 * **Le-se so por caminho, e por isso nao gera indice nenhum** -- e o mesmo
 * motivo pelo qual `waitlist_entries/{email}` nunca gerou.
 */
@Injectable()
export class NicknameRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<NicknameEntry> {
    return this.firebase.firestore
      .collection(NICKNAME_COLLECTION)
      .withConverter(nicknameConverter);
  }

  /**
   * Reserva o nickname e grava no perfil, **no mesmo lote**.
   *
   * Os dois sao um fato so: o documento de unicidade sem o campo no perfil e um
   * nome ocupado por ninguem, e o campo no perfil sem o documento e uma gamertag
   * que outra pessoa ainda pode pegar. Um lote, ou nenhum dos dois.
   *
   * **`create()`, nunca `set()`** -- e aqui a regra e o recurso inteiro: e o
   * `ALREADY_EXISTS` do lote que devolve o 409 para quem chegou em segundo
   * lugar, mesmo que os dois tenham clicado no mesmo milissegundo. Um `set()`
   * roubaria o nome de outra pessoa em silencio.
   */
  async claim(
    uid: string,
    nickname: string,
  ): Promise<{ taken: boolean; entry: NicknameEntry | null }> {
    const entry: NicknameEntry = {
      id: nicknameDocId(nickname),
      uid,
      display: nickname,
      createdAt: new Date(),
    };

    const batch = this.firebase.firestore.batch();

    batch.create(this.collection.doc(entry.id), entry);
    batch.update(
      this.firebase.firestore.collection(PROFILE_COLLECTION).doc(uid),
      {
        nickname,
        updatedAt: Timestamp.now(),
      },
    );

    try {
      await batch.commit();
    } catch (error) {
      if ((error as { code?: number }).code === ALREADY_EXISTS) {
        return { taken: true, entry: null };
      }

      throw error;
    }

    return { taken: false, entry };
  }

  async findByNickname(
    nickname: string,
  ): Promise<{ found: boolean; entry: NicknameEntry | null }> {
    const snapshot = await this.collection.doc(nicknameDocId(nickname)).get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.data()! };
  }

  /**
   * Libera o nickname.
   *
   * Chamado so pela exclusao de conta (decisao 14). **E o unico jeito de o
   * membro que volta nao encontrar o proprio nome ocupado por um fantasma** --
   * um documento cujo `uid` aponta para um perfil que nao existe mais.
   */
  async release(nickname: string): Promise<void> {
    await this.collection.doc(nicknameDocId(nickname)).delete();
  }
}
