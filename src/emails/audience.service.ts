import { Injectable } from '@nestjs/common';
import { MemberDirectoryService } from '../admin/member-directory.service';
import { cannotReceiveEmailReason } from './email-eligibility';
import type { CannotReceiveEmailReason } from './email-eligibility';
import type { TierId } from '../billing/billing.tiers';

/** Um destinatário. Só o que o envio precisa: para quem, e com que token. */
export interface AudienceMember {
  uid: string;
  email: string;
}

export interface AudienceFilters {
  /**
   * O destinatário único de uma campanha `direto` (spec 015, decisão 11).
   *
   * **Não é filtro: é curto-circuito.** Quando ele existe, os outros campos não
   * são nem lidos. Ver o comentário de `build`.
   */
  recipientUid?: string | null;
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
    // =========================================================================
    // O CURTO-CIRCUITO (spec 015, decisão 11). **A ordem é a proteção, e não o
    // conteúdo.**
    //
    // Uma campanha `direto` grava `filters` com os três campos nulos, e filtro
    // nulo significa TODOS OS MEMBROS. Se este `if` estivesse depois da
    // varredura, ou se alguém "simplificasse" a função juntando as condições, um
    // recado escrito para uma pessoa — retomado, reprocessado, ou refatorado por
    // engano — montaria a base inteira e sairia para todo mundo.
    //
    // É por isso que ele é a primeira coisa da função, antes de qualquer leitura
    // de filtro. O teste-trava se chama "campanha direto com os tres filtros
    // nulos monta audiencia de UM": se ele quebrar, não conserte o teste.
    // =========================================================================
    if (filters.recipientUid) {
      const { member } = await this.buildOne(filters.recipientUid);
      return member ? [member] : [];
    }

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

  /**
   * O destinatário de um e-mail direto, e **por que não**, quando for o caso.
   *
   * Passa pelos **mesmos três cortes** da campanha (spec 015, decisão 12): não
   * há exceção para "é só uma pessoa". O que muda é a resposta — quem chama
   * traduz o motivo num `422` nomeado, em vez do `400` de audiência zero, porque
   * a tela precisa dizer *por que* não dá e uma mensagem em prosa a obrigaria a
   * fazer análise de texto para escolher o que escrever.
   *
   * `member` e `reason` nulos ao mesmo tempo significam que o `uid` não existe
   * no Auth — que quem chama traduz em `404`.
   */
  async buildOne(uid: string): Promise<{
    member: AudienceMember | null;
    reason: CannotReceiveEmailReason | null;
    label: string | null;
  }> {
    const membro = await this.directory.loadOne(uid);
    if (!membro) {
      return { member: null, reason: null, label: null };
    }

    const { user, profile } = membro;
    const reason = cannotReceiveEmailReason(user, profile);

    // O rotulo e capturado aqui, no instante do envio, e nao lido depois: a
    // conta pode mudar de nome ou deixar de existir, e a linha do historico
    // precisa continuar legivel (decisao 15).
    const label = profile?.name ?? user.email ?? null;

    if (reason !== null || !user.email) {
      return { member: null, reason, label };
    }

    return {
      member: { uid: user.uid, email: user.email },
      reason: null,
      label,
    };
  }

  /** Só a contagem, que é o que a prévia da tela do admin mostra (decisão 14). */
  async count(filters: AudienceFilters = {}): Promise<number> {
    const membros = await this.build(filters);
    return membros.length;
  }
}
