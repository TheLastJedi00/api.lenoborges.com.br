import {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';
import { BadgeId } from '../../track/track.constants';
import { RoundNumber } from '../games.constants';

/** O resultado consolidado de uma rodada aprovada ou reprovada. */
export interface RoundResult {
  passed: boolean;
  /** Quantos acertos de `QUESTIONS_PER_ROUND`. */
  score: number;
  completedAt: Date;
}

/**
 * O estado do GYM Challenge de um membro numa insignia (spec 022, decisao 7).
 *
 * `gym_challenges/{badgeId__uid}` -- **um documento por (membro, insignia),
 * sempre.** Nao e um log de tentativas, e o estado atual: quem reprova e tenta
 * de novo sobrescreve a rodada corrente no mesmo documento. A razao e que o que
 * importa para o produto e "este membro desbloqueou esta insignia", e isso e uma
 * pergunta de sim ou nao.
 *
 * O caminho composto carrega a mesma garantia de `badge_videos/{badgeId__ytId}`:
 * o mesmo membro nao tem dois desafios abertos na mesma insignia, e tem um em
 * cada insignia diferente -- que e o caso real.
 */
export interface GymChallenge {
  id: string;
  badgeId: BadgeId;
  uid: string;
  /** A rodada que o membro precisa vencer agora. Avanca ao aprovar. */
  currentRound: RoundNumber;
  /** O que ja foi feito, por numero de rodada. Rodada nao jogada nao tem chave. */
  roundResults: Partial<Record<RoundNumber, RoundResult>>;
  badgeUnlocked: boolean;
  /**
   * Se a rodada aberta agora e treino (decisao 21).
   *
   * Vive no documento pai, e nao em cada questao da subcolecao, porque e uma
   * propriedade da **rodada** e nao da pergunta: gravar em dez lugares o que e
   * verdade uma vez so abre a chance de nove concordarem e um discordar.
   */
  replaying: boolean;
  startedAt: Date;
  updatedAt: Date;
}

interface GymChallengeDocument {
  badgeId: BadgeId;
  uid: string;
  currentRound: RoundNumber;
  roundResults: Partial<
    Record<string, { passed: boolean; score: number; completedAt: Timestamp }>
  >;
  badgeUnlocked: boolean;
  replaying: boolean;
  startedAt: Timestamp;
  updatedAt: Timestamp;
}

/** O ID do documento. A regra tem um dono so, como `badgeVideoDocId`. */
export function gymChallengeDocId(badgeId: string, uid: string): string {
  return `${badgeId}__${uid}`;
}

export const gymChallengeConverter: FirestoreDataConverter<GymChallenge> = {
  toFirestore(entry: GymChallenge): GymChallengeDocument {
    return {
      badgeId: entry.badgeId,
      uid: entry.uid,
      currentRound: entry.currentRound,
      roundResults: Object.fromEntries(
        Object.entries(entry.roundResults).map(([round, result]) => [
          round,
          {
            passed: result.passed,
            score: result.score,
            completedAt: Timestamp.fromDate(result.completedAt),
          },
        ]),
      ),
      badgeUnlocked: entry.badgeUnlocked,
      replaying: entry.replaying,
      startedAt: Timestamp.fromDate(entry.startedAt),
      updatedAt: Timestamp.fromDate(entry.updatedAt),
    };
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): GymChallenge {
    const data = snapshot.data() as Partial<GymChallengeDocument>;

    return {
      id: snapshot.id,
      badgeId: data.badgeId!,
      uid: data.uid!,
      // Um documento sem `currentRound` nao existe hoje, mas um `undefined` aqui
      // faria o `ROUND_DIFFICULTY[undefined]` devolver `undefined` e a rodada
      // sortear de uma dificuldade que nao existe -- lista vazia, dez questoes
      // que nao vem, e uma tela em branco sem erro.
      currentRound: data.currentRound ?? 1,
      roundResults: Object.fromEntries(
        Object.entries(data.roundResults ?? {}).map(([round, result]) => [
          Number(round),
          {
            passed: result!.passed,
            score: result!.score,
            completedAt: result!.completedAt.toDate(),
          },
        ]),
      ),
      badgeUnlocked: data.badgeUnlocked ?? false,
      replaying: data.replaying ?? false,
      startedAt: data.startedAt?.toDate() ?? new Date(0),
      updatedAt: data.updatedAt?.toDate() ?? new Date(0),
    };
  },
};

/** O estado de quem nunca abriu esta insignia. Nunca gravado sem jogar. */
export function initialChallenge(badgeId: BadgeId, uid: string): GymChallenge {
  return {
    id: gymChallengeDocId(badgeId, uid),
    badgeId,
    uid,
    currentRound: 1,
    roundResults: {},
    badgeUnlocked: false,
    replaying: false,
    startedAt: new Date(0),
    updatedAt: new Date(0),
  };
}
