import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../auth/firebase.service';
import { ProfileRepository } from '../profile/profile.repository';
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

/** Página do `listUsers` do Auth. 1000 é o teto do Admin SDK. */
const AUTH_PAGE_SIZE = 1000;

/**
 * Para quem um e-mail iria (spec 014, decisão 7).
 *
 * **O Firebase Auth é quem sabe quem existe e qual é o e-mail; `profiles` é quem
 * sabe tier e grade.** É a mesma junção que a Administração já faz, e ela é
 * reusada pelo `ProfileRepository.findManyByIds` — não reescrita.
 *
 * **Os filtros acontecem em memória, depois da junção** (decisão 13). Não é
 * preguiça: cada `where` combinado com ordenação é um índice composto novo em
 * produção, e a lista de índices que produção exige já cresceu duas vezes sem
 * ninguém perceber. Além disso, o corte por `disabled` e `emailVerified` nem
 * teria como ser consulta — esses campos vivem no Auth, não no Firestore.
 */
@Injectable()
export class AudienceService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly profileRepository: ProfileRepository,
  ) {}

  /**
   * A audiência inteira, **ordenada por `uid`**.
   *
   * A ordem é o que sustenta o cursor da campanha (decisão 4): ela é estável,
   * é a mesma que o `listUsers` devolve, e não muda entre uma tentativa e
   * outra. Sem ela, "retomar do cursor" retomaria de um lugar arbitrário.
   */
  async build(filters: AudienceFilters = {}): Promise<AudienceMember[]> {
    const membros: AudienceMember[] = [];
    let pageToken: string | undefined;

    do {
      const page = await this.firebase.auth.listUsers(
        AUTH_PAGE_SIZE,
        pageToken,
      );
      pageToken = page.pageToken;

      // Os dois primeiros cortes vivem no Auth e acontecem antes de ler perfil
      // nenhum: não adianta buscar o documento de quem já está fora.
      const candidatos = page.users.filter((user) => {
        if (!user.email) {
          return false;
        }
        // Conta desativada não recebe e-mail do produto.
        if (user.disabled) {
          return false;
        }
        // Endereço não confirmado é candidato a erro de digitação, e cada um
        // deles é um bounce que corrói a reputação do domínio (decisão 2).
        if (!user.emailVerified) {
          return false;
        }
        return user.uid !== filters.excludeUid;
      });

      if (candidatos.length === 0) {
        continue;
      }

      const perfis = await this.profileRepository.findManyByIds(
        candidatos.map((user) => user.uid),
      );

      for (const user of candidatos) {
        const perfil = perfis.get(user.uid);

        // Sem perfil não há tier nem grade, e quem se cadastrou e parou antes do
        // onboarding não é audiência de campanha da comunidade.
        if (!perfil) {
          continue;
        }

        // O descadastro (decisão 8). **Não existe e-mail que o ignore.**
        if (perfil.emailOptOut) {
          continue;
        }

        if (filters.tiers && filters.tiers.length > 0) {
          if (!filters.tiers.includes(perfil.tier)) {
            continue;
          }
        }

        if (filters.gradeMin != null && perfil.grade < filters.gradeMin) {
          continue;
        }

        if (filters.gradeMax != null && perfil.grade > filters.gradeMax) {
          continue;
        }

        membros.push({ uid: user.uid, email: user.email! });
      }
    } while (pageToken);

    return membros.sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  }

  /** Só a contagem, que é o que a prévia da tela do admin mostra (decisão 14). */
  async count(filters: AudienceFilters = {}): Promise<number> {
    const membros = await this.build(filters);
    return membros.length;
  }
}
