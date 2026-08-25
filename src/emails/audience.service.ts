import { Injectable } from '@nestjs/common';
import { MemberDirectoryService } from '../admin/member-directory.service';
import { cannotReceiveEmailReason } from './email-eligibility';
import type { TierId } from '../billing/billing.tiers';

/** Um destinatário. Só o que o envio precisa: para quem, e com que token. */
export interface AudienceMember {
  uid: string;
  email: string;
}

export interface AudienceFilters {
  /** `null` ou ausente significa **todos os tiers**, e nunca nenhum. */
  tiers?: TierId[] | null;
  gradeMin?: number | null;
  gradeMax?: number | null;
  /**
   * Quem não recebe este disparo específico.
   *
   * Usado pelo gatilho de vídeo: o admin não recebe o aviso do vídeo que ele
   * mesmo acabou de publicar. É a decisão 5 da spec 012 aplicada ao e-mail.
   */
  excludeUid?: string | null;
}

/**
 * Para quem um e-mail iria (spec 014, decisão 7).
 *
 * **A junção de Auth com `profiles` não mora mais aqui**: ela é do
 * `MemberDirectoryService` desde a spec 015, e ele é o dono único (decisão 1 de
 * lá). A Administração e este serviço varriam a mesma base cada um do seu jeito,
 * e duas implementações da mesma junção divergem no primeiro campo novo do
 * perfil — o que este serviço faz é só o recorte.
 *
 * **Os filtros acontecem em memória, depois da junção** (spec 014, decisão 13).
 * Não é preguiça: cada `where` combinado com ordenação é um índice composto novo
 * em produção, e a lista de índices que produção exige já cresceu duas vezes sem
 * ninguém perceber. Além disso, o corte por `disabled` e `emailVerified` nem
 * teria como ser consulta — esses campos vivem no Auth, não no Firestore.
 */
@Injectable()
export class AudienceService {
  constructor(private readonly directory: MemberDirectoryService) {}

  /**
   * A audiência inteira, **ordenada por `uid`**.
   *
   * A ordem é o que sustenta o cursor da campanha (decisão 4): ela é estável,
   * é a mesma que o `listUsers` devolve, e não muda entre uma tentativa e
   * outra. Sem ela, "retomar do cursor" retomaria de um lugar arbitrário.
   *
   * > **Esta ordem não é a da lista do admin**, que é `createdAt` decrescente
   * > (spec 015, decisão 3). São duas ordens com dois donos e duas razões:
   * > unificá-las quebraria a retomada em silêncio, porque um membro novo
   * > entrando no meio de uma campanha reposicionaria a fila.
   */
  async build(filters: AudienceFilters = {}): Promise<AudienceMember[]> {
    const membros: AudienceMember[] = [];

    for (const { user, profile } of await this.directory.loadAll()) {
      if (!user.email) {
        continue;
      }

      if (user.uid === filters.excludeUid) {
        continue;
      }

      // Os três cortes, e a pergunta tem uma implementação só: duas seriam como
      // a tela passa a oferecer um envio que a API recusa (spec 015, decisão 12).
      if (cannotReceiveEmailReason(user, profile) !== null) {
        continue;
      }

      // Sem perfil não há tier nem grade, e quem se cadastrou e parou antes do
      // onboarding não é audiência de campanha da comunidade.
      if (!profile) {
        continue;
      }

      if (filters.tiers && filters.tiers.length > 0) {
        if (!filters.tiers.includes(profile.tier)) {
          continue;
        }
      }

      if (filters.gradeMin != null && profile.grade < filters.gradeMin) {
        continue;
      }

      if (filters.gradeMax != null && profile.grade > filters.gradeMax) {
        continue;
      }

      membros.push({ uid: user.uid, email: user.email });
    }

    return membros.sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  }

  /** Só a contagem, que é o que a prévia da tela do admin mostra (decisão 14). */
  async count(filters: AudienceFilters = {}): Promise<number> {
    const membros = await this.build(filters);
    return membros.length;
  }
}
