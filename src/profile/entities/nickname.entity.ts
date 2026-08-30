import {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';

/**
 * O documento que garante a unicidade do nickname (spec 022, decisao 20).
 *
 * `nicknames/{nickname}` -- **o nickname e o ID, e e so isso que impede dois
 * membros de terem a mesma gamertag.** Nao ha consulta, nao ha indice e nao ha
 * janela entre conferir e gravar: `create()` sobre um caminho ocupado falha com
 * ALREADY_EXISTS, e falha para quem chegou em segundo lugar, mesmo que os dois
 * tenham clicado no mesmo milissegundo. E a mesma estrategia de
 * `waitlist_entries/{email}` e de `badge_videos/{badgeId__youtubeId}`.
 *
 * O caminho alternativo -- `where('nickname','==',x)` e depois gravar -- tem uma
 * corrida no meio, e ela nao aparece em teste nenhum: dois cadastros
 * simultaneos do mesmo nome sao raros o suficiente para so acontecer em
 * producao, e o resultado sao dois membros com a mesma gamertag e um ranking que
 * nao sabe qual e qual.
 */
export interface NicknameEntry {
  /** O ID do documento: o nickname **em minusculas**. */
  id: string;
  uid: string;
  /** O nickname como a pessoa digitou, para exibir. */
  display: string;
  createdAt: Date;
}

interface NicknameDocument {
  uid: string;
  display: string;
  createdAt: Timestamp;
}

/**
 * O ID do documento a partir do nickname digitado.
 *
 * **`LenoDev` e `lenodev` colidem, e isso e a decisao.** Duas gamertags que se
 * leem igual num placar sao a mesma gamertag para quem esta olhando: permitir as
 * duas seria autorizar a copia do nome de outra pessoa trocando uma letra de
 * caixa. O que se exibe guarda a capitalizacao escolhida, e mora no
 * `profiles/{uid}.nickname`; o que colide e este ID.
 */
export function nicknameDocId(nickname: string): string {
  return nickname.toLowerCase();
}

export const nicknameConverter: FirestoreDataConverter<NicknameEntry> = {
  toFirestore(entry: NicknameEntry): NicknameDocument {
    return {
      uid: entry.uid,
      display: entry.display,
      createdAt: Timestamp.fromDate(entry.createdAt),
    };
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): NicknameEntry {
    const data = snapshot.data() as NicknameDocument;

    return {
      id: snapshot.id,
      uid: data.uid,
      // Documento gravado antes de `display` existir le o proprio id: ele e o
      // nickname, so que em minusculas. Melhor uma capitalizacao perdida do que
      // um `undefined` no lugar do nome de alguem no ranking.
      display: data.display ?? snapshot.id,
      createdAt: data.createdAt.toDate(),
    };
  },
};
