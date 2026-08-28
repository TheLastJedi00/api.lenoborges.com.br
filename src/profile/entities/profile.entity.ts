import type { TierId } from '../../billing/billing.tiers';

/**
 * Por que o endereco saiu da lista (spec 014, decisao 8).
 *
 * `membro` e o descadastro pedido pela pessoa; `bounce` e `reclamacao` chegam
 * pelo webhook do provedor e dizem que o endereco esta quebrado ou que a
 * mensagem foi denunciada. Confundir os tres apaga a informacao de que existe
 * um endereco morto na base.
 */
export type EmailOptOutReason = 'membro' | 'bounce' | 'reclamacao';

/**
 * O aceite vigente de um documento legal (spec 018, decisao 6).
 *
 * Guardado num mapa no proprio perfil, **e nao so na subcolecao de historico**,
 * porque a pergunta "esta pessoa esta em dia" e feita em toda requisicao
 * autenticada pelo `LegalAcceptanceGuard`: no mapa ela e respondida pela leitura
 * que a requisicao ja faz, sem consulta, sem indice e sem custo novo.
 *
 * O mapa sobrescreve na proxima versao -- e por isso a subcolecao existe. Ver
 * `LegalAcceptanceRepository`.
 */
export interface LegalAcceptance {
  version: string;
  acceptedAt: Date;
}
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
  /**
   * Se esta pessoa saiu da lista de e-mails (spec 014, decisao 8).
   *
   * **Nao existe "e-mail que ignora o descadastro" neste codigo.** Nem o
   * disparo manual, nem o automatico, nem um futuro "aviso importante". A
   * excecao legitima -- e-mail de conta, como redefinicao de senha e
   * verificacao de endereco -- nao passa por aqui: quem os dispara e o
   * Firebase, por outro caminho (spec 007, decisao 3). E essa separacao que
   * permite a regra ser absoluta sem prejudicar ninguem.
   */
  emailOptOut: boolean;
  /**
   * Por que saiu.
   *
   * "A pessoa pediu para sair" e "o provedor recusou o endereco" sao fatos
   * diferentes com a mesma consequencia, e confundi-los apaga a informacao de
   * que existe um endereco quebrado na base.
   */
  emailOptOutReason: EmailOptOutReason | null;
  emailOptOutAt: Date | null;
  /**
   * O aceite vigente de cada documento legal, por id (spec 018, decisao 6).
   *
   * **Documento antigo nao tem este campo -- e sao todos, no dia em que a spec
   * 018 sobe.** O `?? {}` no `fromFirestore` e o fallback mais caro de perder
   * desta spec: sem ele o valor chega `undefined`, o guard tenta indexa-lo e a
   * base inteira toma `500` em toda rota, no primeiro request depois do deploy.
   * E o mesmo cuidado do `emailOptOut ?? false`, com a diferenca de que este
   * falha ruidosamente em vez de em silencio -- o que, aqui, e sorte, nao
   * projeto.
   */
  legalAcceptances: Record<string, LegalAcceptance>;
  /**
   * Pontos de experiencia (spec 019, decisao 3).
   *
   * **Denormalizado, e sempre igual a `XP_PER_VIDEO` vezes o numero de
   * documentos em `watched_videos`** -- nao ao numero de documentos marcados
   * agora. Quem desmarca perde o check e nao perde o XP, e o documento do razao
   * fica: e isso que impede o farm por duplo clique.
   *
   * Quem escreve e o `WatchedVideoRepository`, com `FieldValue.increment`, no
   * mesmo lote do `create()` do razao. Nao ha outro caminho de escrita, e a
   * invariante acima e o que permite conferir este numero -- um contador que so
   * sabe somar nao tem com o que ser comparado.
   */
  xp: number;
  /**
   * Se as redes sociais aparecem no cartao que os outros membros abrem
   * (spec 019, decisao 9).
   *
   * **Nasce `false`, e o padrao e a decisao.** Quem preencheu o LinkedIn antes
   * desta spec o preencheu num formulario onde ninguem, alem da administracao,
   * podia ve-lo: publicar esses links para a comunidade inteira no dia do deploy
   * divulgaria um vinculo que nenhuma dessas pessoas foi chamada a autorizar.
   *
   * **Nao esconde nada do admin** (decisao 10). `GET /admin/users/:uid` continua
   * trazendo os dois links, porque a administracao ja le telefone e e-mail de
   * todo mundo -- um campo escondido dela seria teatro, e teatro de privacidade
   * e pior que ausencia dela, porque alguem confia nele.
   */
  socialLinksPublic: boolean;
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
  emailOptOut: boolean;
  emailOptOutReason: EmailOptOutReason | null;
  emailOptOutAt: Timestamp | null;
  legalAcceptances: Record<string, { version: string; acceptedAt: Timestamp }>;
  xp: number;
  socialLinksPublic: boolean;
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
      emailOptOut: profile.emailOptOut,
      emailOptOutReason: profile.emailOptOutReason,
      emailOptOutAt: profile.emailOptOutAt
        ? Timestamp.fromDate(profile.emailOptOutAt)
        : null,
      legalAcceptances: Object.fromEntries(
        Object.entries(profile.legalAcceptances ?? {}).map(
          ([documentId, acceptance]) => [
            documentId,
            {
              version: acceptance.version,
              acceptedAt: Timestamp.fromDate(acceptance.acceptedAt),
            },
          ],
        ),
      ),
      xp: profile.xp,
      socialLinksPublic: profile.socialLinksPublic,
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
      // **O `?? false` aqui e carga util, e o pior dos fallbacks de perder.**
      // Documento antigo nao tem o campo -- e sao todos, no dia em que a spec
      // 014 sobe --, e `undefined` numa comparacao booleana faz a base inteira
      // parecer descadastrada: o primeiro disparo sai para zero pessoa, sem
      // erro nenhum e sem nada na tela dizendo o que houve.
      emailOptOut: data.emailOptOut ?? false,
      emailOptOutReason: data.emailOptOutReason ?? null,
      emailOptOutAt: data.emailOptOutAt ? data.emailOptOutAt.toDate() : null,
      // **O `?? {}` e o fallback mais caro de perder desta spec** (018, decisao
      // 6). Documento antigo nao tem o campo -- e sao todos, no dia em que ela
      // sobe. Sem ele o valor chega `undefined`, o guard de aceite tenta
      // indexa-lo e a base inteira toma 500 em toda rota, no primeiro request
      // depois do deploy.
      legalAcceptances: Object.fromEntries(
        Object.entries(data.legalAcceptances ?? {}).map(
          ([documentId, acceptance]) => [
            documentId,
            {
              version: acceptance.version,
              acceptedAt: acceptance.acceptedAt.toDate(),
            },
          ],
        ),
      ),
      // **O `?? 0` e carga util** (spec 019, decisao 3). Documento antigo nao
      // tem o campo -- e sao todos, no dia em que ela sobe. Sem ele o valor
      // chega `undefined`, `undefined + 10` e `NaN`, e o painel passa a exibir
      // `NaN XP` para a base inteira.
      xp: data.xp ?? 0,
      // **O `?? false` aqui e o oposto do `emailOptOut` acima** (spec 019,
      // decisao 9). La o fallback errado esconderia a base inteira de um
      // disparo; aqui ele **publicaria** as redes sociais da base inteira. O
      // padrao e invisivel de proposito: quem preencheu o LinkedIn antes desta
      // spec o preencheu num formulario que so a administracao lia. Trocar isto
      // por `?? true` divulga o vinculo de todo mundo sem ninguem ter escolhido.
      socialLinksPublic: data.socialLinksPublic ?? false,
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
