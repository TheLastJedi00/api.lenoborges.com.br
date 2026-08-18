import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Papel do usuario, vindo da custom claim `role` do Firebase Auth.
 *
 * E claim, e nao campo do Firestore, de proposito: a claim viaja dentro do ID
 * token, entao o verifyIdToken que o guard ja faz devolve o papel de graca. Um
 * campo em `profiles` custaria uma leitura de banco em toda requisicao de admin
 * e criaria dois lugares capazes de discordar sobre quem manda.
 *
 * Ver a decisao 5 da spec 009.
 */
export type UserRole = 'admin';

export interface CurrentUserData {
  id: string;
  email: string;
  /** Nulo para o membro comum, que e a esmagadora maioria. */
  role: UserRole | null;
}

export interface AuthenticatedRequest extends Request {
  user?: CurrentUserData;
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    return data && user ? user[data] : user;
  },
);
