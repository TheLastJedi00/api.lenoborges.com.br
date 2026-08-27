import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { LegalService } from './legal.service';
import { ProfileRepository } from '../profile/profile.repository';
import { LegalAcceptanceRequiredException } from './legal-acceptance-required.exception';
import { AuthenticatedRequest } from '../auth/decorators/current-user.decorator';

/**
 * Rotas que continuam funcionando com o bloqueio de pe, e o motivo de cada uma.
 *
 * A lista e curta de proposito. Toda linha aqui e um pedaco do produto que
 * alguem pode usar sem ter concordado com nada, entao nenhuma entra por
 * conveniencia:
 *
 * - `/auth/*`      entrar e sair nao podem depender de aceitar nada;
 * - `GET /me`      e por onde o front descobre o que falta (decisao 9);
 * - `POST /me/legal-acceptances`  e a saida do bloqueio -- sem ela ninguem
 *                  entra no produto nunca mais;
 * - `/legal/*`     ja e publica;
 * - `PATCH /me/emails`  descadastrar-se nunca depende de concordar com nada.
 *
 * **`PATCH /me/profile` NAO esta na lista, e nao e esquecimento.** Aquele e o
 * endpoint que carimba `completedAt`: barrado aqui, quem nao aceitou nao conclui
 * o onboarding. O bloqueio do membro novo e o do membro antigo passam a ser a
 * mesma regra, num lugar so -- sem um `if` extra dentro do `ProfileService` que
 * envelheceria sozinho. Quem "consertar" isto achando que e engano abre o
 * cadastro sem aceite.
 */
const EXEMPT: readonly { method: string | null; path: RegExp }[] = [
  { method: null, path: /^\/auth(\/|$)/ },
  { method: null, path: /^\/legal(\/|$)/ },
  { method: 'GET', path: /^\/me\/?$/ },
  { method: 'POST', path: /^\/me\/legal-acceptances\/?$/ },
  { method: 'PATCH', path: /^\/me\/emails\/?$/ },
];

/**
 * Recusa toda rota autenticada enquanto houver documento vigente nao aceito
 * (spec 018, decisao 8).
 *
 * **Por que no backend, e nao so no modal do front:** e a decisao 10 da spec 013
 * de novo, com as mesmas palavras. Um modal que o navegador descarta e protecao
 * nenhuma, e o proposito inteiro desta spec e que ninguem use o produto sem ter
 * concordado. Se o bloqueio vivesse so na tela, a frase "todo membro aceitou os
 * termos" seria falsa e ninguem saberia.
 *
 * **Admin nao e excecao.** Um admin isento seria a unica conta do produto capaz
 * de operar sem concordar com o produto, e a isencao viraria a explicacao de por
 * que ninguem testou o fluxo. O preco esta no ponto em aberto 3 da spec: um bug
 * aqui tranca todo mundo do lado de fora, inclusive quem conserta, e a saida e a
 * de sempre neste projeto -- deploy. Nao ha flag de emergencia, e criar uma
 * seria criar uma forma de rodar o produto com o bloqueio desligado.
 *
 * Roda **depois** do `FirebaseAuthGuard`: antes dele nao ha `uid` para
 * consultar, e o sintoma seria 500 em rota publica.
 */
@Injectable()
export class LegalAcceptanceGuard implements CanActivate {
  constructor(
    private readonly legalService: LegalService,
    private readonly profileRepository: ProfileRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = (request.path ?? request.url ?? '').split('?')[0];
    const method = request.method ?? '';

    if (
      EXEMPT.some(
        (rule) =>
          (rule.method === null || rule.method === method) &&
          rule.path.test(path),
      )
    ) {
      return true;
    }

    // Sem usuario autenticado nao ha aceite a cobrar: a rota ou e publica, ou o
    // FirebaseAuthGuard ja recusou antes de chegar aqui.
    const user = request.user;
    if (!user?.id) {
      return true;
    }

    const profile = await this.profileRepository.findById(user.id);
    if (!profile.found || !profile.entry) {
      // Quem nao tem perfil ainda nao tem o que bloquear -- e o 404 do proprio
      // endpoint diz isso melhor do que um 428 diria.
      return true;
    }

    const pending = this.legalService.pendingFor(
      profile.entry.legalAcceptances,
    );

    if (pending.length > 0) {
      throw new LegalAcceptanceRequiredException(pending);
    }

    return true;
  }
}
