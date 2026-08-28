import { MemberDirectoryService } from './member-directory.service';
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

function profile(id: string, grade = 3): Profile {
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
    legalAcceptances: {},
    xp: 0,
    socialLinksPublic: false,
    completedAt: new Date(),
    waitlistEntryId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('MemberDirectoryService', () => {
  let service: MemberDirectoryService;
  let listUsers: jest.Mock;
  let findManyByIds: jest.Mock;

  beforeEach(() => {
    listUsers = jest.fn();
    findManyByIds = jest.fn().mockResolvedValue(new Map());

    service = new MemberDirectoryService(
      { auth: { listUsers } } as unknown as FirebaseService,
      { findManyByIds } as unknown as ProfileRepository,
    );
  });

  /**
   * **O teste-trava da fase.**
   *
   * `listUsers` sem laço devolve mil e para, e ninguém percebe: a lista fica
   * certa por mais tempo do que se imagina, e no dia em que o membro 1001 entra
   * ele simplesmente não existe para a busca, para o filtro e para a contagem.
   */
  it('percorre o Auth até o fim, e não só a primeira página', async () => {
    const primeira = Array.from({ length: 1000 }, (_, i) =>
      authUser(`uid-${String(i).padStart(4, '0')}`),
    );
    const segunda = Array.from({ length: 200 }, (_, i) =>
      authUser(`uid-1${String(i).padStart(3, '0')}`),
    );

    listUsers
      .mockResolvedValueOnce({ users: primeira, pageToken: 'pagina-2' })
      .mockResolvedValueOnce({ users: segunda, pageToken: undefined });

    const membros = await service.loadAll();

    expect(listUsers).toHaveBeenCalledTimes(2);
    expect(listUsers).toHaveBeenNthCalledWith(1, 1000, undefined);
    expect(listUsers).toHaveBeenNthCalledWith(2, 1000, 'pagina-2');
    expect(membros).toHaveLength(1200);
  });

  /**
   * **A pessoa que a spec inteira existe para achar.**
   *
   * Quem criou conta e parou não tem documento em `profiles`. Se a varredura a
   * descartasse, o filtro de "onboarding pendente" procuraria a pessoa
   * exatamente onde ela não está.
   */
  it('mantém no resultado quem não tem documento de perfil', async () => {
    listUsers.mockResolvedValue({
      users: [authUser('uid-sem-perfil')],
      pageToken: undefined,
    });
    findManyByIds.mockResolvedValue(new Map());

    const membros = await service.loadAll();

    expect(membros).toHaveLength(1);
    expect(membros[0].profile).toBeNull();
    expect(membros[0].user.uid).toBe('uid-sem-perfil');
  });

  it('junta o perfil de quem tem', async () => {
    listUsers.mockResolvedValue({
      users: [authUser('uid-1')],
      pageToken: undefined,
    });
    findManyByIds.mockResolvedValue(new Map([['uid-1', profile('uid-1', 7)]]));

    const membros = await service.loadAll();

    expect(membros[0].profile?.grade).toBe(7);
  });

  it('não lê perfil nenhum quando o Auth devolve página vazia', async () => {
    listUsers.mockResolvedValue({ users: [], pageToken: undefined });

    const membros = await service.loadAll();

    // getAll() sem documento nenhum estoura no Firestore.
    expect(findManyByIds).not.toHaveBeenCalled();
    expect(membros).toEqual([]);
  });
});
