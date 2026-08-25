import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailsController } from './emails.controller';
import { ProfileRepository } from '../profile/profile.repository';
import { signUnsubscribeToken } from './unsubscribe-token';

const SEGREDO = 'segredo-de-teste';

describe('EmailsController', () => {
  let controller: EmailsController;
  let repository: { setEmailOptOut: jest.Mock };

  beforeEach(async () => {
    repository = {
      setEmailOptOut: jest.fn().mockResolvedValue({ found: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailsController],
      providers: [
        { provide: ProfileRepository, useValue: repository },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => SEGREDO },
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
});
