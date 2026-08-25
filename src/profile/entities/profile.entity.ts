import type { TierId } from '../../billing/billing.tiers';
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
  /**
   * Tier de acesso do membro (spec 010).
   *
   * **`tier` e acesso; `grade` e conquista. Os dois nao se derivam um do outro,
   * em nenhuma direcao** — e essa e a restricao mais facil de violar sem
   * perceber. Quem cancelou com seis insignias continua com seis: o que ele
   * perde e o avanco, nao o passado.
   *
   * E campo do documento, e nao custom claim como `role`, porque tier muda com
   * frequencia e precisa valer na hora. Uma claim levaria ate uma hora para
   * entrar em vigor, e o membro que acabou de pagar ficaria de fora vendo o
   * relogio.
   */
  tier: TierId;
  /**
   * Perfil no LinkedIn, **URL completa** ou nulo (spec 013, decisao 1).
   *
   * Guardar handle e montar a URL na exibicao espalharia a regra de montagem
   * por todo consumidor futuro, e o primeiro deles montaria errado. Quem
   * normaliza `@fulano` em URL e o front; a API valida o dominio e recusa o
   * resto.
   */
  linkedin: string | null;
  /** Perfil no Instagram, **URL completa** ou nulo. Mesma regra do `linkedin`. */
  instagram: string | null;
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
  tier: TierId;
  linkedin: string | null;
  instagram: string | null;
  completedAt: Timestamp | null;
  waitlistEntryId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Faixa que era `check` no Postgres e agora e responsabilidade da aplicacao. */
/**
 * Faixa de `grade`, redefinida pela spec 008 (Liga Dev), que vive no repositorio
 * do **front** -- este backend nao tem pasta 008, porque aquela spec era quase
 * toda de front e executou as duas mudancas daqui por dentro.
 *
 * O numero conta **etapas concluidas**, nao a etapa em curso:
 *
 *   0       entrou, nenhuma insignia
 *   1 a 8   insignias conquistadas
 *   9       venceu as Oitavas da Elite Four
 *   10      venceu as Quartas
 *   11      venceu as Semifinais
 *   12      CAMPEAO, venceu a Final
 *   13      Battle Frontier (pos-game)
 *
 * `grade: 12` e campeao, e nao "chegou na final". Quem traduz numero em texto
 * e o front, em `core/progress`.
 */
export const GRADE_MIN = 0;
export const GRADE_MAX = 13;

export const profileConverter: FirestoreDataConverter<Profile> = {
  toFirestore(profile: Profile): ProfileDocument {
    return {
      name: profile.name,
      phone: profile.phone,
      bio: profile.bio,
      grade: profile.grade,
      tier: profile.tier,
      linkedin: profile.linkedin,
      instagram: profile.instagram,
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
      // Documento antigo nao tem `tier` -- e sao todos, no dia em que a spec 010
      // sobe. Sem este fallback ele chega `undefined`, e toda comparacao de tier
      // vira falsa em silencio para a base inteira. E o mesmo cuidado do
      // `completedAt ?? null` logo abaixo, e pela mesma razao.
      tier: data.tier ?? 'dev-tier',
      // Documento antigo nao tem as redes -- e sao todos, no dia em que a spec
      // 013 sobe. E o mesmo cuidado do `tier` acima e do `completedAt` abaixo, e
      // pela mesma razao: sem o `?? null` o valor chega `undefined` e toda
      // comparacao vira falsa em silencio.
      linkedin: data.linkedin ?? null,
      instagram: data.instagram ?? null,
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
