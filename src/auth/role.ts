import { UserRecord } from 'firebase-admin/auth';
import { UserRole } from './decorators/current-user.decorator';

/**
 * Le o papel de um usuario a partir das custom claims do Firebase Auth.
 *
 * Existe como funcao propria porque tres lugares precisam da mesma leitura --
 * login, refresh e GET /me -- e a regra "so 'admin' conta, o resto e membro
 * comum" nao pode ser reescrita em cada um deles. O guard faz a mesma leitura a
 * partir do payload do token verificado; a fonte muda, a regra nao.
 */
export function roleOf(user: UserRecord): UserRole | null {
  return user.customClaims?.role === 'admin' ? 'admin' : null;
}
