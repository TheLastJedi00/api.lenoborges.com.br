import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: jest.Mocked<Partial<NotificationsService>>;

  const user: CurrentUserData = {
    id: 'uid-1',
    email: 'membro@exemplo.com',
    role: null,
  };

  beforeEach(() => {
    service = {
      listUnread: jest.fn().mockResolvedValue([]),
      markRead: jest.fn().mockResolvedValue(undefined),
      markAllRead: jest.fn().mockResolvedValue(undefined),
    };

    controller = new NotificationsController(service as NotificationsService);
  });

  it('lista as nao lidas de quem pediu', async () => {
    await controller.list(user);

    expect(service.listUnread).toHaveBeenCalledWith('uid-1');
  });

  it('marca uma como lida', async () => {
    await controller.markRead(user, 'video__git-github__abc');

    expect(service.markRead).toHaveBeenCalledWith(
      'uid-1',
      'video__git-github__abc',
    );
  });

  /**
   * Sao dois caminhos ate a mesma marcacao no front -- o modal e o check da
   * linha --, entao marcar duas vezes e rotina. Um 409 em "ja li isso" seria um
   * erro sem nada a consertar.
   */
  it('marcar duas vezes a mesma notificacao responde sem erro nas duas', async () => {
    await controller.markRead(user, 'video__git-github__abc');

    await expect(
      controller.markRead(user, 'video__git-github__abc'),
    ).resolves.toBeUndefined();
    expect(service.markRead).toHaveBeenCalledTimes(2);
  });

  it('marca todas como lidas', async () => {
    await controller.markAllRead(user);

    expect(service.markAllRead).toHaveBeenCalledWith('uid-1');
  });
});
