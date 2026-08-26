import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { MemberDirectoryService } from './member-directory.service';
import { FirebaseService } from '../auth/firebase.service';
import { ProfileRepository } from '../profile/profile.repository';
import { Profile } from '../profile/entities/profile.entity';
import type { TierId } from '../billing/billing.tiers';

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

function profile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
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
    completedAt: new Date('2026-08-18T09:02:00.000Z'),
    waitlistEntryId: null,
    createdAt: new Date('2026-08-18T09:02:00.000Z'),
    updatedAt: new Date('2026-08-18T09:02:00.000Z'),
    ...overrides,
  };
}

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let listUsers: jest.Mock;
  let getUser: jest.Mock;
  let findManyByIds: jest.Mock;
  let findById: jest.Mock;
  let profileRepository: jest.Mocked<
    Pick<ProfileRepository, 'update' | 'findManyByIds' | 'findById'>
  >;

  beforeEach(() => {
    listUsers = jest
      .fn()
      .mockResolvedValue({ users: [], pageToken: undefined });
    getUser = jest.fn();
    findManyByIds = jest.fn().mockResolvedValue(new Map());
    findById = jest.fn().mockResolvedValue({ found: false, entry: null });
    profileRepository = {
      update: jest.fn(),
      findManyByIds,
      findById,
    };

    const firebase = { auth: { listUsers, getUser } };

    service = new AdminUsersService(
      profileRepository as unknown as ProfileRepository,
      new MemberDirectoryService(
        firebase as unknown as FirebaseService,
        profileRepository as unknown as ProfileRepository,
      ),
    );
  });

  /** Semeia a base: usuários do Auth e os perfis de quem tem. */
  function base(
    usuarios: ReturnType<typeof authUser>[],
    perfis: Record<string, Profile> = {},
  ) {
    listUsers.mockResolvedValue({ users: usuarios, pageToken: undefined });
    findManyByIds.mockImplementation((uids: string[]) =>
      Promise.resolve(
        new Map(
          uids.filter((uid) => perfis[uid]).map((uid) => [uid, perfis[uid]]),
        ),
      ),
    );
  }

  describe('a linha', () => {
    it('junta identidade do Auth com o perfil do Firestore', async () => {
      base([authUser('uid-1')], { 'uid-1': profile('uid-1', { grade: 5 }) });

      const page = await service.list({});

      expect(page.users).toHaveLength(1);
      expect(page.users[0]).toMatchObject({
        id: 'uid-1',
        email: 'uid-1@test.com',
        grade: 5,
        profileCompleted: true,
      });
    });

    /**
     * **O teste que sustenta a decisão 10 da spec 009, e a decisão 1 desta.**
     *
     * Quem se cadastrou e não terminou o onboarding não tem documento de perfil,
     * e é exatamente a pessoa que o admin mais precisa ver. Trocar a fonte para
     * o Firestore para ganhar `where` esconderia justamente quem o filtro de
     * "onboarding pendente" existe para encontrar.
     */
    it('mantém na lista o usuário que ainda não tem perfil', async () => {
      base([authUser('uid-sem-perfil')]);

      const page = await service.list({});

      expect(page.users[0]).toMatchObject({
        id: 'uid-sem-perfil',
        name: null,
        grade: null,
        tier: null,
        profileCompleted: false,
      });
    });

    /**
     * A spec 010 fez o PATCH aceitar `tier` e esqueceu de o GET devolvê-lo. O
     * seletor de tier do editor abre vazio desde então, e o admin escolhe às
     * cegas — agora que dá para filtrar por tier, uma linha sem o campo seria
     * uma tela que mente.
     */
    it('teste-trava: tier sai na linha (decisão 9, conserto da spec 010)', async () => {
      base([authUser('uid-1')], {
        'uid-1': profile('uid-1', { tier: 'ultra-dev-tier' }),
      });

      const page = await service.list({});

      expect(page.users[0].tier).toBe('ultra-dev-tier');
    });

    /**
     * **A regra é da API, e não do CSS** (decisão 8). Uma listagem que carrega o
     * telefone de 200 pessoas para desenhar 200 linhas trafega dado pessoal que
     * ninguém pediu, guarda-o no estado do navegador e o entrega ao primeiro
     * `console.log` de depuração.
     */
    it('teste-trava: nenhum telefone na resposta da listagem', async () => {
      base([authUser('uid-1')], { 'uid-1': profile('uid-1') });

      const page = await service.list({});

      expect(page.users[0]).not.toHaveProperty('phone');
      expect(JSON.stringify(page)).not.toContain('47999990000');
    });

    it('lê a custom claim de admin na listagem', async () => {
      base([authUser('uid-admin', { customClaims: { role: 'admin' } })]);

      const page = await service.list({});

      expect(page.users[0].role).toBe('admin');
    });
  });

  describe('a busca', () => {
    beforeEach(() => {
      base(
        [
          authUser('uid-leno', { email: 'leno@empresa.com' }),
          authUser('uid-maria', { email: 'maria@outra.com' }),
          authUser('uid-jose', { email: 'jose@outra.com' }),
        ],
        {
          'uid-leno': profile('uid-leno', { name: 'Leno Borges' }),
          'uid-maria': profile('uid-maria', { name: 'Maria Silva' }),
          'uid-jose': profile('uid-jose', { name: 'José da Silva' }),
        },
      );
    });

    it('acha pelo sobrenome', async () => {
      const page = await service.list({ q: 'borges' });

      expect(page.users.map((u) => u.id)).toEqual(['uid-leno']);
    });

    /**
     * **O teste que impede alguém de trocar `includes` por `startsWith`.**
     *
     * Quem procura um membro pelo sobrenome, ou pelo domínio do e-mail, digita o
     * meio da string. Prefixo é o que o Firestore conseguiria fazer, e é
     * justamente o que não serve — a busca em memória foi comprada com o custo
     * da varredura, e não usá-la seria pagar a conta sem levar a compra.
     */
    it('teste-trava: acha pelo meio da string, e não só pelo prefixo', async () => {
      const page = await service.list({ q: 'eno' });

      expect(page.users.map((u) => u.id)).toEqual(['uid-leno']);
    });

    it('teste-trava: acento não separa quem procura de quem é procurado', async () => {
      const page = await service.list({ q: 'jose' });

      expect(page.users.map((u) => u.id)).toEqual(['uid-jose']);
    });

    it('acha pelo domínio do e-mail', async () => {
      const page = await service.list({ q: 'outra.com' });

      expect(page.users.map((u) => u.id).sort()).toEqual([
        'uid-jose',
        'uid-maria',
      ]);
    });

    /**
     * **Telefone não é buscável** (decisão 5). Não é a chave pela qual alguém
     * procura uma pessoa, e transformar o telefone de todo mundo em índice de
     * busca é ampliar o uso de um dado pessoal para ganhar um caso que não
     * acontece.
     */
    it('teste-trava: telefone não entra na busca', async () => {
      const page = await service.list({ q: '47999990000' });

      expect(page.users).toEqual([]);
    });

    it('acha quem não tem nome, pelo e-mail', async () => {
      base([authUser('uid-novo', { email: 'recem@chegado.com' })]);

      const page = await service.list({ q: 'recem' });

      expect(page.users.map((u) => u.id)).toEqual(['uid-novo']);
    });
  });

  describe('onboarding pendente', () => {
    /**
     * **Dois estados, um filtro** (decisão 6). "Não existe documento de perfil"
     * e "existe documento com `completedAt` nulo" são fatos diferentes com a
     * mesma consequência, e para o admin a pergunta é uma só: quem criou conta e
     * não terminou. Separá-los seria expor detalhe de implementação numa tela de
     * gestão.
     */
    it('teste-trava: quem não tem documento nenhum entra no pendente', async () => {
      base(
        [
          authUser('uid-sem-doc'),
          authUser('uid-parou'),
          authUser('uid-terminou'),
        ],
        {
          'uid-parou': profile('uid-parou', { completedAt: null }),
          'uid-terminou': profile('uid-terminou'),
        },
      );

      const page = await service.list({ onboarding: 'pendente' });

      expect(page.users.map((u) => u.id).sort()).toEqual([
        'uid-parou',
        'uid-sem-doc',
      ]);
    });

    it('concluido traz só quem terminou', async () => {
      base([authUser('uid-sem-doc'), authUser('uid-terminou')], {
        'uid-terminou': profile('uid-terminou'),
      });

      const page = await service.list({ onboarding: 'concluido' });

      expect(page.users.map((u) => u.id)).toEqual(['uid-terminou']);
    });
  });

  describe('tier e faixa de insígnia', () => {
    beforeEach(() => {
      base([authUser('a'), authUser('b'), authUser('c')], {
        a: profile('a', { tier: 'dev-tier', grade: 0 }),
        b: profile('b', { tier: 'ultra-dev-tier', grade: 5 }),
        c: profile('c', { tier: 'master-dev-tier', grade: 13 }),
      });
    });

    /**
     * **A inversão que uma lista não pode errar.** Filtro vazio lido como
     * "ninguém" mostraria uma tela vazia e faria o admin achar que a base sumiu.
     */
    it('teste-trava: filtro ausente significa TODOS, e nunca ninguém', async () => {
      await expect(service.list({})).resolves.toMatchObject({ total: 3 });
      await expect(
        service.list({ tiers: undefined, gradeMin: undefined }),
      ).resolves.toMatchObject({ total: 3 });
    });

    it('tiers corta por lista', async () => {
      const tiers: TierId[] = ['ultra-dev-tier', 'master-dev-tier'];

      const page = await service.list({ tiers });

      expect(page.users.map((u) => u.id).sort()).toEqual(['b', 'c']);
    });

    it('a faixa de insígnia inclui as duas pontas', async () => {
      const page = await service.list({ gradeMin: 5, gradeMax: 13 });

      expect(page.users.map((u) => u.id).sort()).toEqual(['b', 'c']);
    });

    it('quem não tem perfil sai quando há filtro de tier ou de faixa', async () => {
      base([authUser('sem-perfil'), authUser('b')], {
        b: profile('b', { tier: 'ultra-dev-tier', grade: 5 }),
      });

      const page = await service.list({ gradeMin: 0 });

      // Sem documento nao ha tier nem grade: ele nao tem como satisfazer um
      // filtro sobre campos que nao existem. Sem filtro nenhum ele continua na
      // lista, que e o caso que importa.
      expect(page.users.map((u) => u.id)).toEqual(['b']);
    });

    /**
     * Faixa invertida é engano de digitação, e um recorte vazio em silêncio
     * esconderia isso: o admin leria "nenhum membro com esse recorte" e
     * procuraria o defeito na base.
     */
    it('teste-trava: gradeMin maior que gradeMax responde 400', async () => {
      await expect(
        service.list({ gradeMin: 8, gradeMax: 3 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('ordem e página', () => {
    function comData(uid: string, criadoEm: string) {
      return authUser(uid, {
        metadata: { creationTime: criadoEm, lastSignInTime: '' },
      });
    }

    function tresDatas() {
      base([
        comData('antigo', 'Mon, 03 Aug 2026 09:00:00 GMT'),
        comData('novo', 'Mon, 24 Aug 2026 09:00:00 GMT'),
        comData('meio', 'Mon, 10 Aug 2026 09:00:00 GMT'),
      ]);
    }

    it('os mais recentes primeiro', async () => {
      tresDatas();

      const page = await service.list({});

      expect(page.users.map((u) => u.id)).toEqual(['novo', 'meio', 'antigo']);
    });

    /**
     * **A ordem vem antes do fatiamento.** Invertidos, os dois devolvem a página
     * certa de uma lista errada — e a tela não teria como saber, porque ela
     * recebe exatamente o que pediu: `limit` linhas a partir de `offset`.
     */
    it('teste-trava: ordena a base inteira antes de cortar a página', async () => {
      tresDatas();

      const page = await service.list({ limit: 1 });

      expect(page.users.map((u) => u.id)).toEqual(['novo']);
    });

    it('offset desloca dentro do recorte', async () => {
      tresDatas();

      const page = await service.list({ limit: 2, offset: 2 });

      expect(page.users.map((u) => u.id)).toEqual(['antigo']);
      expect(page.offset).toBe(2);
    });

    it('limit acima do teto é fixado em 200, sem erro', async () => {
      base([authUser('a')]);

      const page = await service.list({ limit: 5000 });

      // E paginacao, e nao pedido de dados: recusar seria transformar um
      // parametro de tela num erro que o admin nao pode consertar.
      expect(page.limit).toBe(200);
    });

    it('limit padrão é 50', async () => {
      base([authUser('a')]);

      await expect(service.list({})).resolves.toMatchObject({ limit: 50 });
    });
  });

  describe('a contagem', () => {
    /**
     * **`total` é o tamanho do RECORTE, e não da base** (decisão 2). É a frase
     * que impede a tela de escrever "213 membros" com um filtro ligado — o
     * número grande sozinho é lido como o tamanho da comunidade.
     */
    it('teste-trava: total é do recorte, e não da base', async () => {
      base([authUser('a'), authUser('b'), authUser('c')], {
        a: profile('a', { name: 'Leno Borges' }),
        b: profile('b', { name: 'Maria Silva' }),
        c: profile('c', { name: 'Ana Souza' }),
      });

      const semFiltro = await service.list({});
      const comFiltro = await service.list({ q: 'silva' });

      expect(semFiltro.total).toBe(3);
      expect(comFiltro.total).toBe(1);
    });

    it('total conta o recorte inteiro, e não a página', async () => {
      base([authUser('a'), authUser('b'), authUser('c')]);

      const page = await service.list({ limit: 1 });

      expect(page.users).toHaveLength(1);
      expect(page.total).toBe(3);
    });

    it('não devolve mais o pageToken do Auth', async () => {
      base([authUser('a')]);

      const page = await service.list({});

      // O cursor era do Auth, e a paginacao nao e mais do Auth: nao existe
      // token para devolver sobre uma lista que ele nunca viu.
      expect(page).not.toHaveProperty('nextPageToken');
    });
  });

  describe('getUser', () => {
    it('devolve o membro inteiro, com o que só existe no detalhe', async () => {
      getUser.mockResolvedValue(authUser('uid-1'));
      findById.mockResolvedValue({
        found: true,
        entry: profile('uid-1', {
          phone: '47999990000',
          bio: 'Estudando back-end.',
          linkedin: 'https://linkedin.com/in/leno',
          instagram: null,
          waitlistEntryId: 'leno@email.com',
        }),
      });

      const detalhe = await service.getUser('uid-1');

      expect(detalhe).toMatchObject({
        id: 'uid-1',
        phone: '47999990000',
        bio: 'Estudando back-end.',
        linkedin: 'https://linkedin.com/in/leno',
        instagram: null,
        waitlistEntryId: 'leno@email.com',
        canReceiveEmail: true,
        cannotReceiveReason: null,
      });
      expect(detalhe.profileCreatedAt).toBe('2026-08-18T09:02:00.000Z');
    });

    /**
     * **Um 404 aqui diria "não existe" sobre alguém que a lista acabou de
     * mostrar.** Quem criou conta e parou não tem documento de perfil, e é
     * justamente quem o filtro de onboarding pendente encontra: abrir o detalhe
     * dessa pessoa tem que funcionar.
     */
    it('teste-trava: usuário sem perfil responde 200 com os campos nulos', async () => {
      getUser.mockResolvedValue(authUser('uid-sem-perfil'));
      findById.mockResolvedValue({ found: false, entry: null });

      const detalhe = await service.getUser('uid-sem-perfil');

      expect(detalhe).toMatchObject({
        id: 'uid-sem-perfil',
        name: null,
        phone: null,
        bio: null,
        tier: null,
        profileCompleted: false,
        profileCreatedAt: null,
        // Sem perfil nao ha descadastro: essa pessoa nunca entrou na lista.
        canReceiveEmail: true,
      });
    });

    it('uid que o Auth não conhece responde 404', async () => {
      getUser.mockRejectedValue(new Error('auth/user-not-found'));

      await expect(service.getUser('uid-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    /**
     * **O oposto do que Meu Perfil faz, e de propósito** (decisão 11). Lá quem
     * lê não pode agir sobre um bounce; aqui pode — conferir o endereço, falar
     * com a pessoa por outro caminho, corrigir.
     */
    it('diz por que o membro não recebe e-mail, com o motivo e a data', async () => {
      getUser.mockResolvedValue(authUser('uid-1'));
      findById.mockResolvedValue({
        found: true,
        entry: profile('uid-1', {
          emailOptOut: true,
          emailOptOutReason: 'bounce',
          emailOptOutAt: new Date('2026-08-20T12:00:00.000Z'),
        }),
      });

      const detalhe = await service.getUser('uid-1');

      expect(detalhe).toMatchObject({
        canReceiveEmail: false,
        cannotReceiveReason: 'descadastrado',
        emailOptOutReason: 'bounce',
        emailOptOutAt: '2026-08-20T12:00:00.000Z',
      });
    });

    it('conta desativada não pode receber, e o motivo é o da conta', async () => {
      getUser.mockResolvedValue(authUser('uid-1', { disabled: true }));
      findById.mockResolvedValue({ found: true, entry: profile('uid-1') });

      const detalhe = await service.getUser('uid-1');

      expect(detalhe.cannotReceiveReason).toBe('desativado');
    });
  });

  describe('updateUser', () => {
    /**
     * **O teste que importa desta fase.**
     *
     * Mexer em `tier` nao pode tocar `grade`, nem o contrario. Um patch montado
     * com os dois campos sempre presentes escreveria `grade: undefined` ao
     * conceder acesso -- e o Firestore aceitaria, zerando o progresso de quem
     * acabou de pagar.
     */
    it('altera tier sem tocar grade, e vice-versa', async () => {
      profileRepository.update.mockResolvedValue({ entry: profile('uid-1') });

      await service.updateUser('uid-1', { tier: 'great-dev-tier' });
      expect(profileRepository.update).toHaveBeenCalledWith('uid-1', {
        tier: 'great-dev-tier',
      });

      await service.updateUser('uid-1', { grade: 7 });
      expect(profileRepository.update).toHaveBeenLastCalledWith('uid-1', {
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
