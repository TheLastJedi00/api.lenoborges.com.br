import {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';

/**
 * Perfil do membro (spec 005, remodelado pela spec 007).
 *
 * O ID do documento e o UID do Firebase. A tabela antiga tinha
 * `id uuid references auth.users(id) on delete cascade`; nada disso e preciso
 * aqui, porque "existe perfil para este usuario" vira uma leitura por caminho,
 * `profiles/{uid}`, sem consulta e sem indice. O Firebase Auth e a fonte de
 * verdade de quem existe, e o documento e endereçado por essa verdade.
 *
 * O `check (grade between 1 and 33)` do Postgres nao tem equivalente no
 * Firestore. A faixa passa a ser garantida pela aplicacao e pelas security
 * rules; ver a decisao 7 da spec 007.
 */
export interface Profile {
  id: string;
  name: string | null;
  phone: string | null;
  bio: string | null;
  grade: number;
  completedAt: Date | null;
  waitlistEntryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** O que vai para o Firestore: sem `id`, que e o caminho, e com Timestamp. */
interface ProfileDocument extends DocumentData {
  name: string | null;
  phone: string | null;
  bio: string | null;
  grade: number;
  completedAt: Timestamp | null;
  waitlistEntryId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Faixa que era `check` no Postgres e agora e responsabilidade da aplicacao. */
export const GRADE_MIN = 1;
export const GRADE_MAX = 33;

export const profileConverter: FirestoreDataConverter<Profile> = {
  toFirestore(profile: Profile): ProfileDocument {
    return {
      name: profile.name,
      phone: profile.phone,
      bio: profile.bio,
      grade: profile.grade,
      completedAt: profile.completedAt
        ? Timestamp.fromDate(profile.completedAt)
        : null,
      waitlistEntryId: profile.waitlistEntryId,
      createdAt: Timestamp.fromDate(profile.createdAt),
      updatedAt: Timestamp.fromDate(profile.updatedAt),
    };
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): Profile {
    const data = snapshot.data() as ProfileDocument;

    return {
      id: snapshot.id,
      name: data.name ?? null,
      phone: data.phone ?? null,
      bio: data.bio ?? null,
      grade: data.grade,
      // completedAt nulo e o estado normal de quem ainda nao fez o onboarding, e
      // e por ele que profileCompleted e decidido. Um undefined vindo de
      // documento antigo viraria "completou", entao o ?? null e carga util.
      completedAt: data.completedAt ? data.completedAt.toDate() : null,
      waitlistEntryId: data.waitlistEntryId ?? null,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    };
  },
};
