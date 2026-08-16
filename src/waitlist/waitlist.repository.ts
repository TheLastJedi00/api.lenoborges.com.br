import { Injectable } from '@nestjs/common';
import { CollectionReference } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import {
  WaitlistEntry,
  waitlistEntryConverter,
} from './entities/waitlist-entry.entity';

export const WAITLIST_COLLECTION = 'waitlist_entries';

/**
 * Codigo de erro do Firestore para documento que ja existe (gRPC ALREADY_EXISTS).
 *
 * Ocupa o lugar que o `23505` do Postgres ocupava: e o que o `create()` devolve
 * quando duas requisicoes tentam gravar o mesmo e-mail ao mesmo tempo. Exportado
 * porque quem traduz a corrida em resposta HTTP e o service, nao este arquivo.
 */
export const ALREADY_EXISTS = 6;

@Injectable()
export class WaitlistRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<WaitlistEntry> {
    return this.firebase.firestore
      .collection(WAITLIST_COLLECTION)
      .withConverter(waitlistEntryConverter);
  }

  async findByEmail(
    email: string,
  ): Promise<{ found: boolean; entry?: WaitlistEntry }> {
    // Leitura por caminho, nao consulta: o e-mail normalizado E o ID do
    // documento. Trocar isto por um where() custaria um indice e, pior,
    // devolveria a unicidade ao acaso -- e ela hoje so existe por ser o caminho.
    const snapshot = await this.collection.doc(email).get();

    if (!snapshot.exists) {
      return { found: false };
    }

    return { found: true, entry: snapshot.data()! };
  }

  async create(
    data: Pick<WaitlistEntry, 'name' | 'phone' | 'email' | 'consent'>,
  ): Promise<{ entry: WaitlistEntry }> {
    const createdAt = new Date();
    const ref = this.collection.doc(data.email);

    // create(), nunca set(): set sobrescreveria a inscricao anterior em
    // silencio. E o create que recusa duplicata com ALREADY_EXISTS, e essa
    // recusa e a unica coisa segurando a unicidade do e-mail.
    await ref.create({ ...data, id: data.email, createdAt });

    return { entry: { ...data, id: ref.id, createdAt } };
  }
}
