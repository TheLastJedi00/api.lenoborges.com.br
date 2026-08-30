import { AudienceService } from './audience.service';
import { MemberDirectoryService } from '../admin/member-directory.service';
import { FirebaseService } from '../auth/firebase.service';
import { ProfileRepository } from '../profile/profile.repository';
import { Profile } from '../profile/entities/profile.entity';
import type { TierId } from '../billing/billing.tiers';

interface UsuarioFake {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  disabled?: boolean;
}

function perfil(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'uid',
    name: 'Membro',
    phone: '47999990000',
    bio: 'bio',
    grade: 3,
    tier: 'dev-tier',
    linkedin: null,
    instagram: null,
    emailOptOut: false,
    emailOptOutReason: null,
    emailOptOutAt: null,
    legalAcceptances: {},
    xp: 0,
    socialLinksPublic: false,
    nickname: null,
    completedAt: new Date('2026-01-01T00:00:00.000Z'),
    waitlistEntryId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function build(
  usuarios: UsuarioFake[],
  perfis: Record<string, Profile>,
  paginas?: UsuarioFake[][],
): { service: AudienceService; listUsers: jest.Mock } {
  const listUsers = jest.fn();

  if (paginas) {
    paginas.forEach((pagina, indice) => {
      listUsers.mockResolvedValueOnce({
        users: pagina.map(completar),
        pageToken: indice < paginas.length - 1 ? `token-${indice}` : undefined,
      });
    });
  } else {
    listUsers.mockResolvedValue({
      users: usuarios.map(completar),
      pageToken: undefined,
    });
  }

  // A varredura tem um dono só desde a spec 015: o AudienceService não junta
  // mais Auth com perfis, ele só recorta o que o diretório devolve.
  const directory = new MemberDirectoryService(
    { auth: { listUsers } } as unknown as FirebaseService,
    {
      findManyByIds: (uids: string[]) =>
        Promise.resolve(
          new Map(
            uids
              .filter((uid) => perfis[uid])
              .map((uid) => [uid, { ...perfis[uid], id: uid }]),
          ),
        ),
    } as unknown as ProfileRepository,
  );

  const service = new AudienceService(directory);

  return { service, listUsers };
}

function completar(user: UsuarioFake) {
  return {
    uid: user.uid,
    email: user.email ?? `${user.uid}@exemplo.com`,
    emailVerified: user.emailVerified ?? true,
    disabled: user.disabled ?? false,
  };
}

describe('AudienceService', () => {
  it('junta Auth e perfis e devolve uid e e-mail', async () => {
    const { service } = build([{ uid: 'a' }], { a: perfil() });

    await expect(service.build()).resolves.toEqual([
      { uid: 'a', email: 'a@exemplo.com' },
    ]);
  });

  /**
   * A ordem é o que sustenta o cursor da campanha: estável, a mesma entre uma
   * tentativa e outra. Sem ela, "retomar do cursor" retoma de um lugar
   * arbitrário — e o sintoma é gente recebendo duas vezes e gente não recebendo.
   */
  it('devolve ordenado por uid', async () => {
    const { service } = build([{ uid: 'c' }, { uid: 'a' }, { uid: 'b' }], {
      a: perfil(),
      b: perfil(),
      c: perfil(),
    });

    const membros = await service.build();
    expect(membros.map((m) => m.uid)).toEqual(['a', 'b', 'c']);
  });

  describe('os tres cortes', () => {
    // Os três são invisíveis quando quebram: a campanha "funciona" e a pessoa
    // simplesmente não recebe.
    it('teste-trava: conta desativada fica de fora', async () => {
      const { service } = build([{ uid: 'a' }, { uid: 'b', disabled: true }], {
        a: perfil(),
        b: perfil(),
      });

      const membros = await service.build();
      expect(membros.map((m) => m.uid)).toEqual(['a']);
    });

    it('teste-trava: e-mail nao verificado fica de fora', async () => {
      // Endereço não confirmado é candidato a erro de digitação, e cada um é um
      // bounce que corrói a reputação do domínio.
      const { service } = build(
        [{ uid: 'a' }, { uid: 'b', emailVerified: false }],
        { a: perfil(), b: perfil() },
      );

      const membros = await service.build();
      expect(membros.map((m) => m.uid)).toEqual(['a']);
    });

    it('teste-trava: quem descadastrou fica de fora', async () => {
      const { service } = build([{ uid: 'a' }, { uid: 'b' }], {
        a: perfil(),
        b: perfil({ emailOptOut: true }),
      });

      const membros = await service.build();
      expect(membros.map((m) => m.uid)).toEqual(['a']);
    });

    it('quem nao tem perfil fica de fora: sem perfil nao ha tier nem grade', async () => {
      const { service } = build([{ uid: 'a' }, { uid: 'sem-perfil' }], {
        a: perfil(),
      });

      const membros = await service.build();
      expect(membros.map((m) => m.uid)).toEqual(['a']);
    });
  });

  describe('filtros', () => {
    it('teste-trava: filtro ausente significa TODOS, e nunca ninguem', async () => {
      // Inverter isto manda a campanha para zero pessoa, sem erro nenhum.
      const { service } = build([{ uid: 'a' }, { uid: 'b' }], {
        a: perfil({ tier: 'dev-tier', grade: 0 }),
        b: perfil({ tier: 'master-dev-tier', grade: 13 }),
      });

      await expect(
        service.build({ tiers: null, gradeMin: null, gradeMax: null }),
      ).resolves.toHaveLength(2);
      await expect(service.build({})).resolves.toHaveLength(2);
    });

    it('tiers corta por lista', async () => {
      const tiers: TierId[] = ['ultra-dev-tier'];
      const { service } = build([{ uid: 'a' }, { uid: 'b' }], {
        a: perfil({ tier: 'dev-tier' }),
        b: perfil({ tier: 'ultra-dev-tier' }),
      });

      const membros = await service.build({ tiers });
      expect(membros.map((m) => m.uid)).toEqual(['b']);
    });

    it('gradeMin e gradeMax cortam a faixa, com as pontas incluidas', async () => {
      const { service } = build([{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }], {
        a: perfil({ grade: 2 }),
        b: perfil({ grade: 5 }),
        c: perfil({ grade: 9 }),
      });

      const membros = await service.build({ gradeMin: 5, gradeMax: 9 });
      expect(membros.map((m) => m.uid)).toEqual(['b', 'c']);
    });

    it('teste-trava: quem publicou nao esta na audiencia do proprio anuncio', async () => {
      const { service } = build([{ uid: 'admin' }, { uid: 'membro' }], {
        admin: perfil(),
        membro: perfil(),
      });

      const membros = await service.build({ excludeUid: 'admin' });
      expect(membros.map((m) => m.uid)).toEqual(['membro']);
    });
  });

  it('percorre todas as paginas do listUsers', async () => {
    const { service, listUsers } = build([], { a: perfil(), b: perfil() }, [
      [{ uid: 'a' }],
      [{ uid: 'b' }],
    ]);

    const membros = await service.build();

    expect(listUsers).toHaveBeenCalledTimes(2);
    expect(membros.map((m) => m.uid)).toEqual(['a', 'b']);
  });

  describe('o curto-circuito do e-mail direto', () => {
    function comGetUser(
      usuarios: UsuarioFake[],
      perfis: Record<string, Profile>,
    ) {
      const listUsers = jest.fn().mockResolvedValue({
        users: usuarios.map(completar),
        pageToken: undefined,
      });
      const getUser = jest.fn((uid: string) => {
        const encontrado = usuarios.find((u) => u.uid === uid);
        return encontrado
          ? Promise.resolve(completar(encontrado))
          : Promise.reject(new Error('auth/user-not-found'));
      });

      const repositorio = {
        findManyByIds: (uids: string[]) =>
          Promise.resolve(
            new Map(
              uids
                .filter((uid) => perfis[uid])
                .map((uid) => [uid, { ...perfis[uid], id: uid }]),
            ),
          ),
        findById: (uid: string) =>
          Promise.resolve({
            found: !!perfis[uid],
            entry: perfis[uid] ? { ...perfis[uid], id: uid } : null,
          }),
      };

      const directory = new MemberDirectoryService(
        { auth: { listUsers, getUser } } as unknown as FirebaseService,
        repositorio as unknown as ProfileRepository,
      );

      return { service: new AudienceService(directory), listUsers };
    }

    /**
     * **O TESTE MAIS IMPORTANTE DESTA SPEC.**
     *
     * Uma campanha `direto` grava `filters` com os três campos nulos, e filtro
     * nulo significa TODOS OS MEMBROS. Se o `recipientUid` deixar de ser lido
     * antes dos filtros — uma retomada, um reprocessamento, uma refatoração que
     * "simplifica" a ordem das condições —, o recado escrito para uma pessoa sai
     * para a base inteira.
     *
     * Se este teste quebrar, **não conserte o teste**.
     */
    it('teste-trava: campanha direto com os tres filtros nulos monta audiencia de UM', async () => {
      const { service, listUsers } = comGetUser(
        [{ uid: 'alvo' }, { uid: 'outro-1' }, { uid: 'outro-2' }],
        { alvo: perfil(), 'outro-1': perfil(), 'outro-2': perfil() },
      );

      const membros = await service.build({
        recipientUid: 'alvo',
        tiers: null,
        gradeMin: null,
        gradeMax: null,
      });

      expect(membros).toEqual([{ uid: 'alvo', email: 'alvo@exemplo.com' }]);
      // E a varredura nem chega a acontecer: o curto-circuito e antes dela.
      expect(listUsers).not.toHaveBeenCalled();
    });

    it('os tres cortes valem para o destinatario unico, com o motivo nomeado', async () => {
      const { service } = comGetUser(
        [
          { uid: 'desativado', disabled: true },
          { uid: 'nao-verificado', emailVerified: false },
          { uid: 'descadastrado' },
        ],
        {
          desativado: perfil(),
          'nao-verificado': perfil(),
          descadastrado: perfil({ emailOptOut: true }),
        },
      );

      await expect(service.buildOne('desativado')).resolves.toMatchObject({
        member: null,
        reason: 'desativado',
      });
      await expect(service.buildOne('nao-verificado')).resolves.toMatchObject({
        member: null,
        reason: 'email-nao-verificado',
      });
      await expect(service.buildOne('descadastrado')).resolves.toMatchObject({
        member: null,
        reason: 'descadastrado',
      });
    });

    it('uid que o Auth nao conhece volta sem membro e sem motivo', async () => {
      const { service } = comGetUser([{ uid: 'a' }], { a: perfil() });

      await expect(service.buildOne('ninguem')).resolves.toEqual({
        member: null,
        reason: null,
        label: null,
      });
    });

    it('o rotulo e o nome, e o e-mail quando nao ha nome', async () => {
      const { service } = comGetUser([{ uid: 'a' }, { uid: 'b' }], {
        a: perfil({ name: 'Leno Borges' }),
        b: perfil({ name: null }),
      });

      await expect(service.buildOne('a')).resolves.toMatchObject({
        label: 'Leno Borges',
      });
      await expect(service.buildOne('b')).resolves.toMatchObject({
        label: 'b@exemplo.com',
      });
    });

    /**
     * Quem nunca terminou o onboarding não tem documento de perfil, e não é
     * audiência de campanha — mas continua sendo alguém a quem o admin pode
     * escrever. É a diferença entre "não está na lista" e "pediu para sair".
     */
    it('membro sem perfil recebe e-mail direto, mesmo fora da audiencia de campanha', async () => {
      const { service } = comGetUser([{ uid: 'sem-perfil' }], {});

      await expect(service.buildOne('sem-perfil')).resolves.toMatchObject({
        member: { uid: 'sem-perfil', email: 'sem-perfil@exemplo.com' },
        reason: null,
      });
      await expect(service.build()).resolves.toEqual([]);
    });
  });

  it('count devolve so o numero', async () => {
    const { service } = build([{ uid: 'a' }, { uid: 'b' }], {
      a: perfil(),
      b: perfil(),
    });

    await expect(service.count()).resolves.toBe(2);
  });
});
