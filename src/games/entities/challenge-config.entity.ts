import {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';
import { BadgeId } from '../../track/track.constants';

/**
 * A configuracao do desafio de uma insignia (spec 022, decisao 5).
 *
 * `challenge_configs/{badgeId}` -- o caminho e a insignia, e nao ha ID a
 * inventar: uma insignia tem uma configuracao, e o documento e ela.
 *
 * **O documento nao existe para nenhuma insignia no dia do deploy**, e e por
 * isso que "ausente" precisa significar `requiredXp: 0`. O default e o que
 * permite o admin nao configurar nada e o desafio funcionar: a primeira insignia
 * exige zero, e so as ultimas ganham exigencia. Um `undefined` chegando na
 * comparacao `xp >= requiredXp` responderia `false` para todo mundo, e o card
 * ficaria em "XP insuficiente" para a base inteira -- inclusive para quem tem
 * XP de sobra, e sem erro em log nenhum.
 */
export interface ChallengeConfig {
  badgeId: BadgeId;
  /** XP minimo para participar. Zero e sem exigencia, e e o padrao. */
  requiredXp: number;
  updatedAt: Date;
}

interface ChallengeConfigDocument {
  badgeId: BadgeId;
  requiredXp: number;
  updatedAt: Timestamp;
}

export const challengeConfigConverter: FirestoreDataConverter<ChallengeConfig> =
  {
    toFirestore(entry: ChallengeConfig): ChallengeConfigDocument {
      return {
        badgeId: entry.badgeId,
        requiredXp: entry.requiredXp,
        updatedAt: Timestamp.fromDate(entry.updatedAt),
      };
    },

    fromFirestore(snapshot: QueryDocumentSnapshot): ChallengeConfig {
      const data = snapshot.data() as Partial<ChallengeConfigDocument>;

      return {
        // O `badgeId` sai do caminho, e o campo no corpo e conveniencia de
        // leitura: o caminho e a fonte, e nao pode divergir de si mesmo.
        badgeId: snapshot.id as BadgeId,
        requiredXp: data.requiredXp ?? 0,
        updatedAt: data.updatedAt?.toDate() ?? new Date(0),
      };
    },
  };

/**
 * A configuracao que vale quando nao ha documento.
 *
 * Existe como funcao para que o repositorio nunca devolva `null` e nenhum
 * chamador precise saber que o documento pode faltar. **"Nao configurado" e um
 * estado valido do produto**, e nao um caso de erro.
 */
export function defaultChallengeConfig(badgeId: BadgeId): ChallengeConfig {
  return { badgeId, requiredXp: 0, updatedAt: new Date(0) };
}
