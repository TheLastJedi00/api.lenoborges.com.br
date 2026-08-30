import { Injectable } from '@nestjs/common';
import { CollectionReference } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import { BadgeId } from '../track/track.constants';
import {
  ChallengeConfig,
  challengeConfigConverter,
  defaultChallengeConfig,
} from './entities/challenge-config.entity';

export const CHALLENGE_CONFIG_COLLECTION = 'challenge_configs';

@Injectable()
export class ChallengeConfigRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<ChallengeConfig> {
    return this.firebase.firestore
      .collection(CHALLENGE_CONFIG_COLLECTION)
      .withConverter(challengeConfigConverter);
  }

  /**
   * A configuracao da insignia, **sempre com um valor**.
   *
   * O `found` diz se o admin ja configurou -- a tela usa isso para nao mostrar
   * "salvo em 01/01/1970" --, e o `entry` nunca e nulo: quem pergunta "qual o XP
   * minimo" precisa de um numero, e "nao configurado" e zero.
   */
  async get(
    badgeId: BadgeId,
  ): Promise<{ found: boolean; entry: ChallengeConfig }> {
    const snapshot = await this.collection.doc(badgeId).get();

    if (!snapshot.exists) {
      return { found: false, entry: defaultChallengeConfig(badgeId) };
    }

    return { found: true, entry: snapshot.data()! };
  }

  /**
   * Le a configuracao de varias insignias de uma vez.
   *
   * A listagem de desafios precisa das oito, e oito leituras sequenciais seriam
   * oito viagens. O `getAll` e uma. Insignia sem documento entra com o default,
   * e nao fica de fora do mapa -- um mapa incompleto faria a tela pintar sete
   * cards e sumir com o oitavo.
   */
  async getMany(
    badgeIds: readonly BadgeId[],
  ): Promise<Map<BadgeId, ChallengeConfig>> {
    if (badgeIds.length === 0) {
      return new Map();
    }

    const snapshots = (await this.firebase.firestore.getAll(
      ...badgeIds.map((badgeId) => this.collection.doc(badgeId)),
    )) as unknown as {
      exists: boolean;
      id: string;
      data: () => ChallengeConfig;
    }[];

    const result = new Map<BadgeId, ChallengeConfig>();

    badgeIds.forEach((badgeId, index) => {
      const snapshot = snapshots[index];

      result.set(
        badgeId,
        snapshot?.exists ? snapshot.data() : defaultChallengeConfig(badgeId),
      );
    });

    return result;
  }

  /**
   * Grava a configuracao.
   *
   * **`set()` e nao `create()` aqui, e e a excecao que confirma a regra.** O
   * `create()` do repositorio existe onde o caminho carrega uma garantia de
   * unicidade -- e onde reescrever apagaria um fato. Aqui o documento e uma
   * preferencia do admin, salvar duas vezes e a operacao normal da tela, e um
   * `ALREADY_EXISTS` na segunda vez seria o botao "Salvar" funcionando uma vez
   * so por insignia.
   */
  async save(badgeId: BadgeId, requiredXp: number): Promise<ChallengeConfig> {
    const entry: ChallengeConfig = {
      badgeId,
      requiredXp,
      updatedAt: new Date(),
    };

    await this.collection.doc(badgeId).set(entry);

    return entry;
  }
}
