import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { EmailCampaignService } from '../emails/email-campaign.service';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

const admin: CurrentUserData = {
  id: 'uid-admin',
  email: 'admin@empresa.com',
} as CurrentUserData;

describe('AdminUsersController — o e-mail direto', () => {
  let controller: AdminUsersController;
  let sendDirect: jest.Mock;

  beforeEach(() => {
    sendDirect = jest.fn().mockResolvedValue({
      id: 'camp-1',
      status: 'concluida',
      audienceCount: 1,
      sentCount: 1,
      failedCount: 0,
    });

    controller = new AdminUsersController(
      {} as unknown as AdminUsersService,
      { sendDirect } as unknown as EmailCampaignService,
    );
  });

  /**
   * **Nenhum caminho de envio novo** (decisão 10). O teste verifica que quem foi
   * chamado é o serviço de campanha — e não um `MailerService` direto, que seria
   * o desenho óbvio e o jeito garantido de o descadastro ser esquecido neste
   * caminho.
   */
  it('teste-trava: passa pelo MESMO EmailCampaignService, e não pelo mailer', async () => {
    await controller.sendEmail(admin, 'uid-membro', {
      subject: 'Sobre a sua dúvida',
      body: 'Oi. Vi sua pergunta no Mural.',
    });

    expect(sendDirect).toHaveBeenCalledWith({
      recipientUid: 'uid-membro',
      subject: 'Sobre a sua dúvida',
      body: 'Oi. Vi sua pergunta no Mural.',
      createdBy: 'uid-admin',
    });
  });

  it('devolve o resultado do disparo', async () => {
    await expect(
      controller.sendEmail(admin, 'uid-membro', {
        subject: 'Assunto',
        body: 'Corpo com mais de dez caracteres.',
      }),
    ).resolves.toMatchObject({ status: 'concluida', sentCount: 1 });
  });

  it('propaga o 422 do membro que não pode receber', async () => {
    sendDirect.mockRejectedValue(
      new UnprocessableEntityException({
        statusCode: 422,
        reason: 'descadastrado',
      }),
    );

    await expect(
      controller.sendEmail(admin, 'uid-membro', {
        subject: 'Assunto',
        body: 'Corpo com mais de dez caracteres.',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('propaga o 409 do trinco e o 404 do uid que não existe', async () => {
    sendDirect.mockRejectedValueOnce(new ConflictException());
    await expect(
      controller.sendEmail(admin, 'uid-membro', {
        subject: 'Assunto',
        body: 'Corpo com mais de dez caracteres.',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    sendDirect.mockRejectedValueOnce(new NotFoundException());
    await expect(
      controller.sendEmail(admin, 'uid-x', {
        subject: 'Assunto',
        body: 'Corpo com mais de dez caracteres.',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
