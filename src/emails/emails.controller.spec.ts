import { createHmac } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { EmailsController } from './emails.controller';
import { ProfileRepository } from '../profile/profile.repository';
import { FirebaseService } from '../auth/firebase.service';
import { signUnsubscribeToken } from './unsubscribe-token';

const SEGREDO = 'segredo-de-teste';
const WEBHOOK_SECRET = `whsec_${Buffer.from('segredo-webhook').toString('base64')}`;

/** Assina como o provedor assina, para o teste passar pela mesma porta. */
function assinarCorpo(rawBody: string): Record<string, string> {
  const id = 'msg_1';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const assinatura = createHmac(
    'sha256',
    Buffer.from(WEBHOOK_SECRET.slice(6), 'base64'),
  )
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');

  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${assinatura}`,
  };
}

describe('EmailsController', () => {
  let controller: EmailsController;
  let repository: { setEmailOptOut: jest.Mock };
  let getUserByEmail: jest.Mock;

  beforeEach(async () => {
    repository = {
      setEmailOptOut: jest.fn().mockResolvedValue({ found: true }),
    };
    getUserByEmail = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailsController],
      providers: [
        { provide: ProfileRepository, useValue: repository },
        {
          provide: FirebaseService,
          useValue: { auth: { getUserByEmail } },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => SEGREDO,
            get: () => WEBHOOK_SECRET,
          },
        },
      ],
    }).compile();

    controller = module.get(EmailsController);
  });

  describe('POST /emails/descadastro', () => {
    it('token valido grava o opt-out com motivo membro', async () => {
      const token = signUnsubscribeToken('uid-123', SEGREDO);

      await expect(controller.unsubscribe(token)).resolves.toBeUndefined();

      expect(repository.setEmailOptOut).toHaveBeenCalledWith(
        'uid-123',
        true,
        'membro',
      );
    });

    /**
     * Um endpoint público que diferencia token válido de inválido é um oráculo
     * de `uid`, e o descadastro não ganha nada com a distinção.
     */
    it('teste-trava: token invalido responde 204 e NAO escreve nada', async () => {
      const token = signUnsubscribeToken('uid-123', 'outro-segredo');

      await expect(controller.unsubscribe(token)).resolves.toBeUndefined();

      expect(repository.setEmailOptOut).not.toHaveBeenCalled();
    });

    it('token ausente tambem responde 204 e nao escreve nada', async () => {
      await expect(controller.unsubscribe(undefined)).resolves.toBeUndefined();

      expect(repository.setEmailOptOut).not.toHaveBeenCalled();
    });

    it('uid sem perfil responde 204, sem lancar', async () => {
      repository.setEmailOptOut.mockResolvedValue({ found: false });
      const token = signUnsubscribeToken('uid-fantasma', SEGREDO);

      await expect(controller.unsubscribe(token)).resolves.toBeUndefined();
    });

    it('descadastrar duas vezes com o mesmo link nao e erro', async () => {
      // O link do rodapé não expira, o webhook repete evento, e o "cancelar
      // inscrição" do Gmail dispara um POST sem confirmação. Repetição é rotina.
      const token = signUnsubscribeToken('uid-123', SEGREDO);

      await controller.unsubscribe(token);
      await expect(controller.unsubscribe(token)).resolves.toBeUndefined();

      expect(repository.setEmailOptOut).toHaveBeenCalledTimes(2);
    });
  });

  describe('POST /emails/webhook/resend', () => {
    function requisicao(payload: unknown, assinado = true) {
      const rawBody = JSON.stringify(payload);
      const headers: Record<string, string> = assinado
        ? assinarCorpo(rawBody)
        : {};

      return {
        rawBody: Buffer.from(rawBody, 'utf8'),
        headers,
      } as unknown as RawBodyRequest<Request>;
    }

    /**
     * O webhook é público por natureza, e a assinatura é a única prova de quem
     * chamou. Aceitar sem ela deixaria qualquer um que descubra a URL
     * descadastrar quem quiser.
     */
    it('teste-trava: assinatura invalida responde 401 e NAO escreve nada', async () => {
      await expect(
        controller.resendWebhook(
          requisicao(
            { type: 'email.bounced', data: { to: ['x@y.com'] } },
            false,
          ),
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(repository.setEmailOptOut).not.toHaveBeenCalled();
    });

    it('bounce permanente descadastra, com motivo bounce', async () => {
      getUserByEmail.mockResolvedValue({ uid: 'uid-123' });

      await controller.resendWebhook(
        requisicao({
          type: 'email.bounced',
          data: { to: ['membro@exemplo.com'], bounce: { type: 'Permanent' } },
        }),
      );

      expect(getUserByEmail).toHaveBeenCalledWith('membro@exemplo.com');
      expect(repository.setEmailOptOut).toHaveBeenCalledWith(
        'uid-123',
        true,
        'bounce',
      );
    });

    it('reclamacao de spam descadastra, com motivo reclamacao', async () => {
      getUserByEmail.mockResolvedValue({ uid: 'uid-123' });

      await controller.resendWebhook(
        requisicao({
          type: 'email.complained',
          data: { to: ['membro@exemplo.com'] },
        }),
      );

      expect(repository.setEmailOptOut).toHaveBeenCalledWith(
        'uid-123',
        true,
        'reclamacao',
      );
    });

    /**
     * Caixa cheia volta a funcionar. Tratar soft bounce como descadastro remove
     * membro válido da lista por causa de uma semana de férias.
     */
    it('teste-trava: bounce temporario NAO descadastra ninguem', async () => {
      getUserByEmail.mockResolvedValue({ uid: 'uid-123' });

      await controller.resendWebhook(
        requisicao({
          type: 'email.bounced',
          data: { to: ['membro@exemplo.com'], bounce: { type: 'Transient' } },
        }),
      );

      expect(repository.setEmailOptOut).not.toHaveBeenCalled();
    });

    it('entrega, abertura e clique passam batido', async () => {
      for (const type of ['email.sent', 'email.delivered', 'email.opened']) {
        await controller.resendWebhook(
          requisicao({ type, data: { to: ['membro@exemplo.com'] } }),
        );
      }

      expect(repository.setEmailOptOut).not.toHaveBeenCalled();
    });

    it('teste-trava: e-mail desconhecido responde 204 e nao escreve nada', async () => {
      // Pode ser de alguem que ja excluiu a conta entre o envio e o bounce.
      getUserByEmail.mockRejectedValue(new Error('user not found'));

      await expect(
        controller.resendWebhook(
          requisicao({
            type: 'email.bounced',
            data: { to: ['fantasma@exemplo.com'] },
          }),
        ),
      ).resolves.toBeUndefined();

      expect(repository.setEmailOptOut).not.toHaveBeenCalled();
    });

    it('corpo que nao e JSON valido nao derruba o endpoint', async () => {
      const rawBody = 'nao sou json';
      const request = {
        rawBody: Buffer.from(rawBody, 'utf8'),
        headers: assinarCorpo(rawBody),
      } as unknown as RawBodyRequest<Request>;

      await expect(controller.resendWebhook(request)).resolves.toBeUndefined();
      expect(repository.setEmailOptOut).not.toHaveBeenCalled();
    });
  });
});
