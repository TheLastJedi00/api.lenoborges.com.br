import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { FirebaseService } from '../firebase.service';
import { AuthenticatedRequest } from '../decorators/current-user.decorator';

/**
 * Se o guard confere, a cada requisicao, se os tokens do usuario foram revogados.
 *
 * Fica `false` de proposito, e a escolha tem preco dos dois lados:
 *
 * - Com `false`, um ID token emitido antes do logout continua valido ate
 *   expirar, o que da uma janela de ate uma hora entre "sair" e o token parar de
 *   funcionar. Quem esta com o token e o proprio usuario que acabou de sair, e o
 *   refresh ja foi revogado, entao a sessao nao se renova.
 * - Com `true`, o Admin SDK vai ao servidor do Google em TODA requisicao
 *   autenticada para conferir o timestamp de revogacao. Cada GET /me passa a
 *   custar uma ida a rede.
 *
 * Para este projeto a janela de uma hora e aceitavel. Se um dia houver dado
 * sensivel atras do guard, ou requisito de logout imediato, e este o botao: virar
 * `true` e aceitar a latencia. Ver a decisao 2 da spec 007.
 */
const CHECK_REVOKED = false;

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(private readonly firebase: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers?.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Token de autenticação ausente ou inválido.',
      );
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedException(
        'Token de autenticação ausente ou inválido.',
      );
    }

    try {
      // verifyIdToken confere assinatura, expiracao, audience e issuer por
      // dentro, contra o projeto da credencial. A verificacao manual de aud, iss
      // e role que a fix/005-guard-aud-iss precisou escrever a mao nao tem
      // equivalente aqui: refazer duplicaria a regra em dois lugares, e o lugar
      // errado seria o nosso.
      const payload = await this.firebase.auth.verifyIdToken(
        token,
        CHECK_REVOKED,
      );

      // A custom claim `role` chega dentro do proprio payload verificado, entao
      // copia-la aqui e o que torna o AdminGuard barato: ele le request.user e
      // nao volta ao Firebase nem ao Firestore. Ver a decisao 5 da spec 009.
      request.user = {
        id: payload.uid,
        email: typeof payload.email === 'string' ? payload.email : '',
        role: payload.role === 'admin' ? 'admin' : null,
      };

      return true;
    } catch {
      throw new UnauthorizedException(
        'Token de autenticação ausente ou inválido.',
      );
    }
  }
}
