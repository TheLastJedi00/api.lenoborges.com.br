import {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';

/**
 * Inscricao na lista de espera (spec 004, remodelada pela spec 007).
 *
 * O ID do documento e o e-mail normalizado. Nao e arrumacao: o Firestore nao tem
 * constraint UNIQUE, e o ID do documento e o unico lugar onde ele garante
 * unicidade. A coluna `email unique` do Postgres virou isto.
 *
 * `email` continua tambem como campo do documento, redundante com o ID de
 * proposito: ler o caminho para descobrir o e-mail obrigaria todo consumidor a
 * saber que o ID *e* o e-mail, e essa e uma decisao de armazenamento que nao
 * deveria vazar para quem so quer o dado.
 */
export interface WaitlistEntry {
  id: string;
  name: string;
  phone: string;
  email: string;
  consent: boolean;
  createdAt: Date;
}

/** O que vai para o Firestore: sem `id`, que e o caminho, e com Timestamp. */
interface WaitlistEntryDocument extends DocumentData {
  name: string;
  phone: string;
  email: string;
  consent: boolean;
  createdAt: Timestamp;
}

/**
 * Conversao em um lugar so.
 *
 * O `createdAt` e o motivo de o converter existir. A migration da spec 004
 * documentava por que a coluna era `timestamptz`: como timestamp sem fuso, o
 * valor seria gravado no fuso da sessao do banco e lido no fuso do processo
 * Node, deslocando o `receivedAt` que a API anuncia como UTC. O Timestamp do
 * Firestore e UTC por construcao e resolve isso, mas a conversao para Date
 * precisa acontecer em algum lugar -- e um lugar so, nao espalhada por service.
 */
export const waitlistEntryConverter: FirestoreDataConverter<WaitlistEntry> = {
  toFirestore(entry: WaitlistEntry): WaitlistEntryDocument {
    return {
      name: entry.name,
      phone: entry.phone,
      email: entry.email,
      consent: entry.consent,
      createdAt: Timestamp.fromDate(entry.createdAt),
    };
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): WaitlistEntry {
    const data = snapshot.data() as WaitlistEntryDocument;

    return {
      id: snapshot.id,
      name: data.name,
      phone: data.phone,
      email: data.email,
      consent: data.consent,
      createdAt: data.createdAt.toDate(),
    };
  },
};
