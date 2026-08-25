import { NotFoundException } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { FirebaseService } from '../auth/firebase.service';
import { ProfileRepository } from '../profile/profile.repository';
import { Profile } from '../profile/entities/profile.entity';

function authUser(uid: string, extra: Record<string, unknown> = {}) {
  return {
    uid,
    email: `${uid}@test.com`,
    emailVerified: true,
    disabled: false,
    customClaims: undefined,
    metadata: {
      creationTime: 'Mon, 18 Aug 2026 09:00:00 GMT',
      lastSignInTime: 'Mon, 18 Aug 2026 10:00:00 GMT',
    },
    ...extra,
  };
}

function profile(id: string, grade: number): Profile {
  return {
    id,
    name: 'Membro',
    phone: '47999990000',
    bio: 'bio',
    grade,
    tier: 'dev-tier',
    linkedin: null,
    instagram: null,
    emailOptOut: false,
    emailOptOutReason: null,
    emailOptOutAt: null,
    completedAt: new Date(),
    waitlistEntryId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let listUsers: jest.Mock;
  // A juncao por caminho mora no repositorio desde a spec 014: a audiencia do
  // disparo de e-mail precisa exatamente dela, e duas copias divergiriam no
  // primeiro campo novo do perfil.
  let findManyByIds: jest.Mock;
  let profileRepository: jest.Mocked<
    Pick<ProfileRepository, 'update' | 'findManyByIds'>
  >;

  beforeEach(() => {
    listUsers = jest.fn();
    findManyByIds = jest.fn().mockResolvedValue(new Map());
    profileRepository = {
      update: jest.fn(),
      findManyByIds,
    };

    const firebase = { auth: { listUsers } };

    service = new AdminUsersService(
      firebase as unknown as FirebaseService,
      profileRepository as unknown as ProfileRepository,
    );
  });

  it('junta identidade do Auth com o perfil do Firestore', async () => {
    listUsers.mockResolvedValue({
      users: [authUser('uid-1')],
      pageToken: undefined,
    });
    findManyByIds.mockResolvedValue(new Map([['uid-1', profile('uid-1', 5)]]));

    const page = await service.list(50);

    expect(page.users).toHaveLength(1);
    expect(page.users[0]).toMatchObject({
      id: 'uid-1',
      email: 'uid-1@test.com',
      grade: 5,
      profileCompleted: true,
    });
    expect(page.nextPageToken).toBeNull();
  });

  /**
   * **Este é o teste que sustenta a decisão 10.**
   *
   * Quem se cadastrou e não terminou o onboarding não tem documento de perfil, e
   * é exatamente a pessoa que o admin mais precisa ver. Se a listagem paginasse
   * pelo Firestore — que é a "simplificação" tentadora —, essa pessoa
   * desapareceria da tela sem nenhum sinal.
   */
  it('mantém na lista o usuário que ainda não tem perfil', async () => {
    listUsers.mockResolvedValue({
      users: [authUser('uid-sem-perfil')],
      pageToken: undefined,
    });
    // Sem documento, o uid simplesmente nao entra no mapa.
    findManyByIds.mockResolvedValue(new Map());

    const page = await service.list(50);

    expect(page.users).toHaveLength(1);
    expect(page.users[0]).toMatchObject({
      id: 'uid-sem-perfil',
      name: null,
      grade: null,
      profileCompleted: false,
    });
  });

  it('devolve o pageToken do Auth para a próxima página', async () => {
    listUsers.mockResolvedValue({
      users: [authUser('uid-1')],
      pageToken: 'proxima-pagina',
    });

    const page = await service.list(50);

    expect(page.nextPageToken).toBe('proxima-pagina');
  });

  it('lê a custom claim de admin na listagem', async () => {
    listUsers.mockResolvedValue({
      users: [authUser('uid-admin', { customClaims: { role: 'admin' } })],
      pageToken: undefined,
    });

    const page = await service.list(50);

    expect(page.users[0].role).toBe('admin');
  });

  it('não faz leitura de perfil quando a página vem vazia', async () => {
    listUsers.mockResolvedValue({ users: [], pageToken: undefined });

    const page = await service.list(50);

    // getAll() sem documentos estoura no Firestore, e uma página vazia é normal
    // na última página da listagem.
    expect(findManyByIds).not.toHaveBeenCalled();
    expect(page.users).toEqual([]);
  });

  describe('updateGrade', () => {
    /**
     * **O teste que importa desta fase.**
     *
     * Mexer em `tier` nao pode tocar `grade`, nem o contrario. Um patch montado
     * com os dois campos sempre presentes escreveria `grade: undefined` ao
     * conceder acesso -- e o Firestore aceitaria, zerando o progresso de quem
     * acabou de pagar.
     */
    it('altera tier sem tocar grade, e vice-versa', async () => {
      profileRepository.update.mockResolvedValue({
        entry: profile('uid-1', 5),
      });

      await service.updateUser('uid-1', { tier: 'great-dev-tier' });
      expect(profileRepository.update).toHaveBeenCalledWith('uid-1', {
        tier: 'great-dev-tier',
      });

      await service.updateUser('uid-1', { grade: 7 });
      expect(profileRepository.update).toHaveBeenLastCalledWith('uid-1', {
        grade: 7,
      });
    });

    it('altera o grade do perfil', async () => {
      profileRepository.update.mockResolvedValue({
        entry: profile('uid-1', 7),
      });

      await service.updateUser('uid-1', { grade: 7 });

      expect(profileRepository.update).toHaveBeenCalledWith('uid-1', {
        grade: 7,
      });
    });

    it('recusa alterar quem não tem perfil', async () => {
      profileRepository.update.mockRejectedValue(
        new Error('Perfil uid-x nao encontrado apos o update.'),
      );

      await expect(
        service.updateUser('uid-x', { grade: 7 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // Corpo vazio não é erro nem escrita: é um PATCH que não pediu nada.
    it('não escreve quando não há campo para alterar', async () => {
      await service.updateUser('uid-1', {});

      expect(profileRepository.update).not.toHaveBeenCalled();
    });
  });
});
