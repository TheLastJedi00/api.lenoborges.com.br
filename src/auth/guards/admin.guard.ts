import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedRequest } from '../decorators/current-user.decorator';

/**
 * Portao das rotas de administracao.
 *
 * Le `request.user.role` e nada mais: nenhuma ida ao Firestore, nenhuma ida ao
 * Firebase Auth. E o pagamento da decisao 5 da spec 009 -- a claim viaja dentro
 * do ID token justamente para esta verificacao ser de graca.
 *
 * **Roda sempre depois do FirebaseAuthGuard**, que e quem popula `request.user`.
 * Sozinho ele recusa tudo, e isso e proposital: sem usuario na requisicao, "nao
 * e admin" e a unica resposta segura.
 *
 * Vale repetir o que a spec diz, porque e a parte que se esquece: o botao
 * escondido no front nao e a seguranca. Quem impede e este guard.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.user?.role !== 'admin') {
      // 403, nunca 401: quem chega aqui passou pela autenticacao. Devolver 401
      // faria o front tentar renovar a sessao para resolver o que nao e
      // problema de sessao.
      throw new ForbiddenException(
        'Esta area e restrita a administradores da Liga Dev.',
      );
    }

    return true;
  }
}
