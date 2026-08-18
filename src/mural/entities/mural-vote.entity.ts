import {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';

/**
 * Um voto, na subcolecao `mural_questions/{questionId}/votes/{uid}`.
 *
 * **O dado e o caminho.** O documento em si so carrega o carimbo de quando: quem
 * votou em que ja esta dito pelo endereco, e e ele que garante um voto por
 * pessoa por pergunta -- sem consulta, sem indice, do mesmo jeito que
 * `waitlist_entries/{email}` garante e-mail unico.
 */
export interface MuralVote {
  id: string;
  votedAt: Date;
}

interface MuralVoteDocument extends DocumentData {
  votedAt: Timestamp;
}

export const muralVoteConverter: FirestoreDataConverter<MuralVote> = {
  toFirestore(vote: MuralVote): MuralVoteDocument {
    return { votedAt: Timestamp.fromDate(vote.votedAt) };
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): MuralVote {
    const data = snapshot.data() as MuralVoteDocument;
    return { id: snapshot.id, votedAt: data.votedAt.toDate() };
  },
};
