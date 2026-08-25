import { Injectable } from '@nestjs/common';
import { UserRecord } from 'firebase-admin/auth';
import { FirebaseService } from '../auth/firebase.service';
import { ProfileRepository } from '../profile/profile.repository';
import { Profile } from '../profile/entities/profile.entity';

/**
 * Um membro visto pelas duas fontes.
 *
 * `profile` nulo **é informação**, e não ausência de dado: é o retrato de quem
 * criou conta e parou antes do onboarding.
 */
export interface DirectoryMember {
  user: UserRecord;
  profile: Profile | null;
}

/** Página do `listUsers` do Auth. 1000 é o teto do Admin SDK. */
const AUTH_PAGE_SIZE = 1000;

/**
 * A base inteira, montada uma vez (spec 015, decisão 1).
 *
 * **O Firebase Auth é a fonte de quem existe; `profiles` é quem sabe tier, grade
 * e o resto.** A junção tem um dono só, e é este: a Administração e a audiência
 * de e-mail chamavam a mesma coisa cada uma do seu jeito, e duas implementações
 * da mesma junção divergem no primeiro campo novo do perfil.
 *
 * Por que a base inteira, e não uma página: **filtrar uma página é filtrar
 * errado**. Com 213 membros e um filtro de "onboarding pendente", uma página de
 * 50 devolveria os pendentes que por acaso caíram nos primeiros 50 `uid`s, a
 * tela diria "3 membros" com toda a confiança do mundo, e nada denunciaria. Ou o
 * filtro acontece antes da paginação, ou ele não acontece.
 *
 * ## O teto, e ele está escrito de propósito (decisão 4)
 *
 * Cada chamada custa `N/1000` chamadas ao Auth mais `N` leituras de documento no
 * Firestore. Com 200 membros: uma chamada e 200 leituras. Com 5.000: cinco
 * chamadas e 5.000 leituras, **por busca digitada**. Está dimensionado para a
 * comunidade de hoje — dezenas de membros — e o sinal de que passou do ponto é a
 * lista demorar a responder com o admin digitando. Quando incomodar, a saída é
 * um índice de busca ou uma projeção mantida por escrita, e **é outra spec**.
 *
 * ## Não existe cache aqui, e a recusa é deliberada
 *
 * A tentação é óbvia: um `Map` estático e a varredura vira uma por instância. O
 * motivo de não fazer é que **a API roda em função serverless** — o cache seria
 * por instância, sem invalidação confiável, e o primeiro sintoma seria o admin
 * trocar um tier, recarregar a lista e ver o valor antigo. Em algumas
 * requisições, e não em outras, que é a forma mais cara de um bug existir.
 *
 * A única contenção é o `debounceTime(400)` do front, e ela basta no tamanho de
 * hoje.
 */
@Injectable()
export class MemberDirectoryService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly profileRepository: ProfileRepository,
  ) {}

  /** Todo mundo que existe no Auth, com o perfil ao lado quando houver. */
  async loadAll(): Promise<DirectoryMember[]> {
    const membros: DirectoryMember[] = [];
    let pageToken: string | undefined;

    do {
      const page = await this.firebase.auth.listUsers(
        AUTH_PAGE_SIZE,
        pageToken,
      );
      // O laço é o ponto inteiro deste método: sem ele a base para em mil, e o
      // membro 1001 deixa de existir para a busca e para a contagem.
      pageToken = page.pageToken;

      if (page.users.length === 0) {
        continue;
      }

      const perfis = await this.profileRepository.findManyByIds(
        page.users.map((user) => user.uid),
      );

      for (const user of page.users) {
        membros.push({ user, profile: perfis.get(user.uid) ?? null });
      }
    } while (pageToken);

    return membros;
  }
}
