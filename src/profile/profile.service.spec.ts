import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileRepository } from './profile.repository';
import { AuthService } from '../auth/auth.service';
import { MuralRepository } from '../mural/mural.repository';
import { WaitlistRepository } from '../waitlist/waitlist.repository';
import { FirebaseService } from '../auth/firebase.service';
import { Profile } from './entities/profile.entity';
import { LegalService } from '../legal/legal.service';
import { LegalAcceptanceRepository } from '../legal/legal-acceptance.repository';
import { WatchedVideoRepository } from '../track/watched-video.repository';
import { NicknameRepository } from './nickname.repository';
import { RankingRepository } from '../games/ranking.repository';
import { GymChallengeRepository } from '../games/gym-challenge.repository';
import { TrainingCompletionRepository } from '../training/training-completion.repository';
import { TrainingCommentRepository } from '../training/training-comment.repository';

describe('ProfileService', () => {
  let service: ProfileService;
  let repository: {
    findById: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    setEmailOptOut: jest.Mock;
    setSocialLinksPublic: jest.Mock;
  };
  let firebase: {
    identityToolkit: jest.Mock;
    auth: { revokeRefreshTokens: jest.Mock; deleteUser: jest.Mock };
  };
  let muralRepository: {
    anonymizeAuthor: jest.Mock;
    removeVotesBy: jest.Mock;
  };
  let waitlistRepository: { remove: jest.Mock };
  /** Ordem real das chamadas, para o teste-trava da decisao 9. */
  let ordem: string[];
  let authService: { reauthenticate: jest.Mock; continueUrl: string };
  let legalService: { pendingFor: jest.Mock };
  let legalAcceptanceRepository: { removeAll: jest.Mock };
  let watchedVideoRepository: { removeAll: jest.Mock };
  let nicknameRepository: { claim: jest.Mock; release: jest.Mock };
  let rankingRepository: { upsert: jest.Mock; remove: jest.Mock };
  let gymChallengeRepository: { removeAll: jest.Mock };
  let trainingCompletionRepository: { removeAll: jest.Mock };
  let trainingCommentRepository: { removeAllByUid: jest.Mock };

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      setEmailOptOut: jest.fn().mockResolvedValue({ found: true }),
      setSocialLinksPublic: jest.fn().mockResolvedValue({ found: true }),
    };

    ordem = [];
    const registra = (nome: string) =>
      jest.fn().mockImplementation(() => {
        ordem.push(nome);
        return Promise.resolve(undefined);
      });

    firebase = {
      identityToolkit: jest.fn(),
      auth: {
        revokeRefreshTokens: jest.fn().mockResolvedValue(undefined),
        deleteUser: registra('deleteUser'),
      },
    };

    muralRepository = {
      anonymizeAuthor: registra('anonymizeAuthor'),
      removeVotesBy: registra('removeVotesBy'),
    };
    waitlistRepository = { remove: registra('waitlist.remove') };
    legalService = { pendingFor: jest.fn().mockReturnValue([]) };
    legalAcceptanceRepository = { removeAll: registra('legal.removeAll') };
    watchedVideoRepository = { removeAll: registra('watched.removeAll') };
    watchedVideoRepository = { removeAll: registra('watched.removeAll') };
    repository.remove = registra('profile.remove');
    nicknameRepository = {
      claim: jest.fn().mockResolvedValue({ taken: false, entry: null }),
      release: registra('nickname.release'),
    };
    rankingRepository = {
      upsert: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
      remove: registra('ranking.remove'),
    } as unknown as { upsert: jest.Mock; remove: jest.Mock };
    gymChallengeRepository = { removeAll: registra('gym.removeAll') };
    trainingCompletionRepository = {
      removeAll: registra('trainingCompletion.removeAll'),
    };
    trainingCommentRepository = {
      removeAllByUid: registra('trainingComment.removeAllByUid'),
    };
    authService = {
      reauthenticate: jest.fn().mockResolvedValue('id-token-fresco'),
      continueUrl: 'http://localhost:4200/?entrar=1',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        {
          provide: ProfileRepository,
          useValue: repository,
        },
        { provide: FirebaseService, useValue: firebase },
        { provide: AuthService, useValue: authService },
        { provide: MuralRepository, useValue: muralRepository },
        { provide: WaitlistRepository, useValue: waitlistRepository },
        { provide: LegalService, useValue: legalService },
        {
          provide: LegalAcceptanceRepository,
          useValue: legalAcceptanceRepository,
        },
        {
          provide: WatchedVideoRepository,
          useValue: watchedVideoRepository,
        },
        { provide: NicknameRepository, useValue: nicknameRepository },
        { provide: RankingRepository, useValue: rankingRepository },
        {
          provide: GymChallengeRepository,
          useValue: gymChallengeRepository,
        },
        {
          provide: TrainingCompletionRepository,
          useValue: trainingCompletionRepository,
        },
        {
          provide: TrainingCommentRepository,
          useValue: trainingCommentRepository,
        },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
  });

  describe('setNickname (spec 022)', () => {
    /** Um perfil qualquer, com a gamertag ainda por escolher. */
    function perfilSemNickname(extra: Partial<Profile> = {}): Profile {
      return {
        id: 'uid-1',
        name: 'Leno',
        phone: '47999990000',
        bio: 'bio',
        grade: 0,
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
        completedAt: new Date(),
        waitlistEntryId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...extra,
      };
    }

    it('grava a gamertag quando o perfil ainda nao tem uma', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: perfilSemNickname(),
      });

      await expect(
        service.setNickname('uid-1', { nickname: 'LenoDev' }),
      ).resolves.toBeUndefined();

      expect(nicknameRepository.claim).toHaveBeenCalledWith('uid-1', 'LenoDev');
    });

    it('teste-trava: 409 quando o perfil ja tem gamertag', async () => {
      // **Imutavel depois de gravado** (decisao 20), e a razao e o placar: um
      // nome que muda faz o historico de posicoes deixar de se referir a alguem.
      // Sem esta recusa, o membro trocaria a gamertag e deixaria o documento de
      // unicidade antigo orfao, ocupando um nome que ninguem mais usa.
      repository.findById.mockResolvedValue({
        found: true,
        entry: perfilSemNickname({ nickname: 'LenoDev' }),
      });

      await expect(
        service.setNickname('uid-1', { nickname: 'OutroNome' }),
      ).rejects.toThrow(ConflictException);

      expect(nicknameRepository.claim).not.toHaveBeenCalled();
    });

    it('409 quando o nome ja pertence a outra pessoa', async () => {
      // Mesmo status, outro motivo. Quem decide isso e o ALREADY_EXISTS do
      // create() no lote, e nao uma consulta previa: entre consultar e gravar
      // cabe o clique de outra pessoa.
      repository.findById.mockResolvedValue({
        found: true,
        entry: perfilSemNickname(),
      });
      nicknameRepository.claim.mockResolvedValue({ taken: true, entry: null });

      await expect(
        service.setNickname('uid-1', { nickname: 'LenoDev' }),
      ).rejects.toThrow(ConflictException);
    });

    it('404 quando nao ha perfil', async () => {
      repository.findById.mockResolvedValue({ found: false, entry: null });

      await expect(
        service.setNickname('uid-1', { nickname: 'LenoDev' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setEmailPreference', () => {
    it('receber: false vira opt-out com motivo membro', async () => {
      await service.setEmailPreference('uid-1', { receber: false });

      expect(repository.setEmailOptOut).toHaveBeenCalledWith(
        'uid-1',
        true,
        'membro',
      );
    });

    it('receber: true religa', async () => {
      await service.setEmailPreference('uid-1', { receber: true });

      expect(repository.setEmailOptOut).toHaveBeenCalledWith(
        'uid-1',
        false,
        'membro',
      );
    });

    it('perfil inexistente lanca NotFoundException', async () => {
      repository.setEmailOptOut.mockResolvedValue({ found: false });

      await expect(
        service.setEmailPreference('uid-fantasma', { receber: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteAccount', () => {
    const dto = { password: 'senha-certa' };
    const comWaitlist = {
      found: true,
      entry: {
        id: 'uid-1',
        name: 'Fulano',
        phone: '47999990000',
        bio: 'bio',
        grade: 3,
        linkedin: null,
        instagram: null,
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
        nickname: 'Fulano_Dev',
        waitlistEntryId: 'fulano@email.com',
      },
    };

    it('teste-trava: o deleteUser do Auth e a ULTIMA chamada', async () => {
      // Com o Auth primeiro, uma falha no meio deixa dado pessoal orfao no
      // Firestore, sem conta, sem sessao e sem ninguem com direito de pedir a
      // remocao -- o pior resultado possivel da operacao cujo proposito inteiro
      // e remover dado pessoal.
      repository.findById.mockResolvedValue(comWaitlist);

      await service.deleteAccount('uid-1', 'fulano@email.com', null, dto);

      expect(ordem).toEqual([
        'anonymizeAuthor',
        'removeVotesBy',
        // A subcolecao de aceites sai antes do perfil, pelo mesmo motivo que
        // 'notification_reads': subcolecao nao some com o pai (spec 018).
        'legal.removeAll',
        // E o razao do que a pessoa assistiu, pela quarta vez que este produto
        // esbarra na mesma regra (spec 019, decisao 13). E historico de
        // comportamento ligado a um `uid`: quem pediu para ser esquecido leva
        // junto o que assistiu.
        'watched.removeAll',
        // E os do GYM Challenge, com a subcolecao `active_round` dentro deles
        // (spec 022, decisao 14). Quinta e sexta vez que a mesma regra vale.
        'gym.removeAll',
        // E a Arena de Treinamento (spec 023): as conclusoes, que sao historico
        // de comportamento ligado ao uid, e os comentarios, que sao texto
        // escrito pela pessoa. Setima e oitava vez que a regra vale.
        //
        // **Comentario de treinamento e APAGADO, e pergunta do Mural e
        // ANONIMIZADA**, e a diferenca nao e descuido: a pergunta carrega votos
        // de terceiros e pode ja ter virado video na trilha, enquanto o
        // comentario nao carrega nada de ninguem alem de quem o escreveu.
        'trainingCompletion.removeAll',
        'trainingComment.removeAllByUid',
        // A linha do placar: gamertag, XP e insignias ligados ao uid.
        'ranking.remove',
        // **E a gamertag volta a ficar livre.** Sem isto, o membro que voltasse
        // encontraria o proprio nome ocupado por um fantasma -- um documento de
        // unicidade cujo uid aponta para um perfil que nao existe mais, e que
        // ninguem consegue liberar sem mexer no banco a mao.
        'nickname.release',
        'profile.remove',
        'waitlist.remove',
        'deleteUser',
      ]);
    });

    it('teste-trava: falha no Firestore IMPEDE a exclusao do usuario do Auth', async () => {
      repository.findById.mockResolvedValue(comWaitlist);
      muralRepository.removeVotesBy.mockRejectedValue(new Error('offline'));

      await expect(
        service.deleteAccount('uid-1', 'fulano@email.com', null, dto),
      ).rejects.toThrow('offline');

      expect(firebase.auth.deleteUser).not.toHaveBeenCalled();
    });

    it('nao ha waitlist para apagar quando o perfil nao tem inscricao', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: { ...comWaitlist.entry, waitlistEntryId: null },
      });

      await service.deleteAccount('uid-1', 'fulano@email.com', null, dto);

      expect(waitlistRepository.remove).not.toHaveBeenCalled();
      expect(firebase.auth.deleteUser).toHaveBeenCalledWith('uid-1');
    });

    it('senha errada da 401 e nada e apagado', async () => {
      repository.findById.mockResolvedValue(comWaitlist);
      authService.reauthenticate.mockRejectedValue(
        new UnauthorizedException('Senha incorreta.'),
      );

      await expect(
        service.deleteAccount('uid-1', 'fulano@email.com', null, dto),
      ).rejects.toThrow(UnauthorizedException);

      expect(ordem).toEqual([]);
    });

    it('teste-trava: admin da 403 ANTES da reautenticacao', async () => {
      // Para o admin nao gastar a senha descobrindo que nao podia.
      await expect(
        service.deleteAccount('uid-admin', 'admin@email.com', 'admin', dto),
      ).rejects.toThrow(ForbiddenException);

      expect(authService.reauthenticate).not.toHaveBeenCalled();
      expect(repository.findById).not.toHaveBeenCalled();
      expect(ordem).toEqual([]);
    });

    it('perfil inexistente da 404', async () => {
      repository.findById.mockResolvedValue({ found: false, entry: null });

      await expect(
        service.deleteAccount('uid-1', 'fulano@email.com', null, dto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('changePassword', () => {
    const dto = {
      currentPassword: 'senha-atual',
      newPassword: 'senha-nova-forte',
    };

    it('reautentica, troca com o token fresco e revoga a sessao', async () => {
      firebase.identityToolkit.mockResolvedValue({});

      await service.changePassword('uid-1', 'fulano@email.com', dto);

      expect(authService.reauthenticate).toHaveBeenCalledWith(
        'fulano@email.com',
        'senha-atual',
      );
      const [endpoint, body] = firebase.identityToolkit.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(endpoint).toBe('update');
      expect(body.idToken).toBe('id-token-fresco');
      expect(body.password).toBe('senha-nova-forte');
      expect(firebase.auth.revokeRefreshTokens).toHaveBeenCalledWith('uid-1');
    });

    it('teste-trava: senha atual errada da 401 e NADA e revogado', async () => {
      // Revogar antes de conferir desloga em todo aparelho quem so errou de
      // digitacao.
      authService.reauthenticate.mockRejectedValue(
        new UnauthorizedException('Senha incorreta.'),
      );

      await expect(
        service.changePassword('uid-1', 'fulano@email.com', dto),
      ).rejects.toThrow(UnauthorizedException);

      expect(firebase.identityToolkit).not.toHaveBeenCalled();
      expect(firebase.auth.revokeRefreshTokens).not.toHaveBeenCalled();
    });

    it('senha nova recusada pela politica vira 400, e nada e revogado', async () => {
      firebase.identityToolkit.mockRejectedValue(
        new Error('WEAK_PASSWORD : Password should be at least 6 characters'),
      );

      await expect(
        service.changePassword('uid-1', 'fulano@email.com', dto),
      ).rejects.toThrow(BadRequestException);

      expect(firebase.auth.revokeRefreshTokens).not.toHaveBeenCalled();
    });
  });

  describe('changeEmail', () => {
    const dto = { newEmail: 'novo@email.com', password: 'senha-certa' };

    it('reautentica e pede a confirmacao PARA O ENDERECO NOVO', async () => {
      firebase.identityToolkit.mockResolvedValue({});

      await expect(
        service.changeEmail('uid-1', 'atual@email.com', dto),
      ).resolves.toEqual({ status: 'confirmation_sent' });

      expect(authService.reauthenticate).toHaveBeenCalledWith(
        'atual@email.com',
        'senha-certa',
      );
      const [endpoint, body] = firebase.identityToolkit.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(endpoint).toBe('sendOobCode');
      expect(body.requestType).toBe('VERIFY_AND_CHANGE_EMAIL');
      expect(body.newEmail).toBe('novo@email.com');
      expect(body.idToken).toBe('id-token-fresco');
    });

    it('teste-trava: senha errada da 401 e NAO dispara e-mail nenhum', async () => {
      // A ordem e reautenticar primeiro, sempre. Invertida, o endpoint vira um
      // jeito de mandar e-mail para terceiros sem saber senha nenhuma.
      authService.reauthenticate.mockRejectedValue(
        new UnauthorizedException('Senha incorreta.'),
      );

      await expect(
        service.changeEmail('uid-1', 'atual@email.com', dto),
      ).rejects.toThrow(UnauthorizedException);

      expect(firebase.identityToolkit).not.toHaveBeenCalled();
    });

    it('e-mail novo igual ao atual da 400 antes de qualquer ida ao Firebase', async () => {
      await expect(
        service.changeEmail('uid-1', '  Novo@Email.com ', dto),
      ).rejects.toThrow(BadRequestException);

      expect(authService.reauthenticate).not.toHaveBeenCalled();
      expect(firebase.identityToolkit).not.toHaveBeenCalled();
    });

    it('teste-trava: EMAIL_EXISTS responde byte a byte igual a e-mail invalido', async () => {
      // E a decisao mais facil de "melhorar" depois em nome da UX, e melhora-la
      // reabre o oraculo de enumeracao que a spec 005 fechou.
      firebase.identityToolkit.mockRejectedValue(new Error('EMAIL_EXISTS'));
      const jaExiste = await service
        .changeEmail('uid-1', 'atual@email.com', dto)
        .catch((error: Error) => error.message);

      firebase.identityToolkit.mockRejectedValue(
        new Error('INVALID_NEW_EMAIL'),
      );
      const invalido = await service
        .changeEmail('uid-1', 'atual@email.com', dto)
        .catch((error: Error) => error.message);

      expect(jaExiste).toBe('Não foi possível usar este e-mail.');
      expect(invalido).toBe(jaExiste);
    });
  });

  describe('getProfile', () => {
    it('deve retornar dados do perfil existente', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: 'Leno Borges',
          phone: '47999990000',
          bio: 'Engenheiro de Software',
          grade: 1,
          completedAt: new Date('2026-08-14T10:00:00.000Z'),
        },
      });

      const profile = await service.getProfile(
        'user-1',
        'leno@borges.com.br',
        null,
      );

      expect(profile).toEqual({
        id: 'user-1',
        email: 'leno@borges.com.br',
        name: 'Leno Borges',
        phone: '47999990000',
        bio: 'Engenheiro de Software',
        grade: 1,
        profileCompleted: true,
        role: null,
        pendingLegal: [],
        legalAcceptances: {},
        // Explicito porque o `toDto` usa `?? null` (spec 022): o `toEqual`
        // ignora chave com `undefined` -- que e como os outros campos deste
        // fixture parcial chegam -- e nao ignora `null`. O fallback existe para
        // o perfil montado a mao num teste ou num script nao virar
        // `nickname: undefined` no ranking.
        nickname: null,
      });
    });

    it('deve lancar NotFoundException se perfil nao for encontrado', async () => {
      repository.findById.mockResolvedValue({ found: false, entry: null });

      await expect(
        service.getProfile('user-unknown', 'u@test.com', null),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findPublicMember (spec 019)', () => {
    const membro = {
      id: 'uid-2',
      name: 'Ana Prado',
      phone: '47988887777',
      bio: 'Migrando de suporte para dev.',
      grade: 3,
      xp: 340,
      tier: 'ultra-tier',
      emailOptOut: true,
      linkedin: 'https://www.linkedin.com/in/ana-prado',
      instagram: 'https://www.instagram.com/anaprado',
      socialLinksPublic: false,
      completedAt: new Date('2026-05-02T10:00:00.000Z'),
      legalAcceptances: {},
    };

    /**
     * **O teste de vazamento, e o mais importante deste bloco.**
     *
     * A comparacao e por igualdade do conjunto de chaves, e **nao por
     * `toMatchObject`** -- aquele passa feliz quando um campo a mais aparece. O
     * dia em que alguem acrescentar `phone` ao perfil e a um mapeador
     * compartilhado, e este teste que fica vermelho.
     */
    it('teste-trava: a resposta tem exatamente sete campos', async () => {
      repository.findById.mockResolvedValue({ found: true, entry: membro });

      const cartao = await service.findPublicMember('uid-2');

      expect(Object.keys(cartao).sort()).toEqual([
        'bio',
        'grade',
        'id',
        'instagram',
        'linkedin',
        'name',
        'xp',
      ]);
    });

    it('teste-trava: o nickname nao entra no cartao publico', async () => {
      // **O `PublicMemberDto` e definido pelo que ele deixa de fora** (spec 019,
      // decisao 8), e campo novo entra por decisao escrita, nao por
      // conveniencia. A gamertag ja e publica por outro caminho -- o ranking --
      // e coloca-la aqui tambem seria uma segunda fonte para o mesmo fato, que
      // divergiria no dia em que uma das duas passasse a esconder alguem.
      repository.findById.mockResolvedValue({
        found: true,
        entry: { ...membro, nickname: 'AnaDev' },
      });

      const cartao = (await service.findPublicMember(
        'uid-2',
      )) as unknown as Record<string, unknown>;

      expect(cartao.nickname).toBeUndefined();
      expect(Object.keys(cartao)).toHaveLength(7);
    });

    it('teste-trava: nao vaza telefone, tier nem preferencia de e-mail', async () => {
      repository.findById.mockResolvedValue({ found: true, entry: membro });

      const cartao = (await service.findPublicMember(
        'uid-2',
      )) as unknown as Record<string, unknown>;

      expect(cartao.phone).toBeUndefined();
      expect(cartao.email).toBeUndefined();
      expect(cartao.tier).toBeUndefined();
      expect(cartao.emailOptOut).toBeUndefined();
    });

    /**
     * O padrao e invisivel (decisao 9), e o corte acontece **no servidor**: um
     * front que recebesse o link e decidisse nao desenha-lo ja o teria entregado
     * a quem abrisse a aba de rede.
     */
    it('teste-trava: com o interruptor desligado, as redes vem nulas', async () => {
      repository.findById.mockResolvedValue({ found: true, entry: membro });

      const cartao = await service.findPublicMember('uid-2');

      expect(cartao.linkedin).toBeNull();
      expect(cartao.instagram).toBeNull();
      // E o resto continua vindo: esconder a rede nao esconde a pessoa.
      expect(cartao.name).toBe('Ana Prado');
      expect(cartao.xp).toBe(340);
    });

    it('com o interruptor ligado, as redes vem', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: { ...membro, socialLinksPublic: true },
      });

      const cartao = await service.findPublicMember('uid-2');

      expect(cartao.linkedin).toBe('https://www.linkedin.com/in/ana-prado');
      expect(cartao.instagram).toBe('https://www.instagram.com/anaprado');
    });

    /**
     * Conta pela metade nao tem nome nem bio, e um cartao vazio com 200 e pior
     * do que um 404. De quebra, fecha a enumeracao de contas em criacao.
     */
    it('teste-trava: onboarding incompleto e 404', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: { ...membro, completedAt: null },
      });

      await expect(service.findPublicMember('uid-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('perfil inexistente e 404', async () => {
      repository.findById.mockResolvedValue({ found: false, entry: null });

      await expect(service.findPublicMember('uid-3')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setPrivacyPreference (spec 019)', () => {
    it('liga o interruptor pelo caminho de escrita proprio', async () => {
      repository.setSocialLinksPublic.mockResolvedValue({ found: true });

      await service.setPrivacyPreference('uid-1', { socialLinksPublic: true });

      expect(repository.setSocialLinksPublic).toHaveBeenCalledWith(
        'uid-1',
        true,
      );
    });

    it('desliga tambem', async () => {
      repository.setSocialLinksPublic.mockResolvedValue({ found: true });

      await service.setPrivacyPreference('uid-1', { socialLinksPublic: false });

      expect(repository.setSocialLinksPublic).toHaveBeenCalledWith(
        'uid-1',
        false,
      );
    });

    it('perfil inexistente e 404', async () => {
      repository.setSocialLinksPublic.mockResolvedValue({ found: false });

      await expect(
        service.setPrivacyPreference('uid-x', { socialLinksPublic: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('caso 1: PATCH normaliza nome, telefone e bio antes de gravar', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: null,
          phone: null,
          bio: null,
          grade: 1,
          completedAt: null,
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Fulano de Tal',
          phone: '11999998888',
          bio: 'Bio com espaços ajustados.',
          grade: 1,
          completedAt: new Date('2026-08-14T10:00:00.000Z'),
        },
      });

      await service.updateProfile('user-1', 'fulano@email.com', null, {
        name: '  Fulano    de    Tal  ',
        phone: '(11) 99999-8888',
        bio: '  Bio com espaços ajustados.  ',
      });

      const updateCalls = repository.update.mock.calls as [
        string,
        Partial<Profile>,
      ][];
      expect(updateCalls[0][0]).toBe('user-1');
      expect(updateCalls[0][1].name).toBe('Fulano de Tal');
      expect(updateCalls[0][1].phone).toBe('11999998888');
      expect(updateCalls[0][1].bio).toBe('Bio com espaços ajustados.');
      expect(updateCalls[0][1].completedAt).toBeInstanceOf(Date);
    });

    it('caso 2: primeira atualizacao preenche completed_at', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: null,
          phone: null,
          bio: null,
          grade: 1,
          completedAt: null,
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio valida para onboarding.',
          grade: 1,
          completedAt: new Date(),
        },
      });

      await service.updateProfile('user-1', 'email@test.com', null, {
        name: 'Nome',
        phone: '11999998888',
        bio: 'Bio valida para onboarding.',
      });

      const updateCalls = repository.update.mock.calls as [
        string,
        Partial<Profile>,
      ][];
      expect(updateCalls[0][0]).toBe('user-1');
      expect(updateCalls[0][1].completedAt).toBeInstanceOf(Date);
    });

    it('caso 3: atualizacao seguinte NAO sobrescreve completed_at original', async () => {
      const originalCompletedAt = new Date('2026-01-01T00:00:00.000Z');

      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: 'Nome Antigo',
          phone: '11999998888',
          bio: 'Bio antiga de cadastro inicial.',
          grade: 1,
          completedAt: originalCompletedAt,
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Nome Novo',
          phone: '11999998888',
          bio: 'Nova bio atualizada com sucesso.',
          grade: 1,
          completedAt: originalCompletedAt,
        },
      });

      await service.updateProfile('user-1', 'email@test.com', null, {
        name: 'Nome Novo',
        phone: '11999998888',
        bio: 'Nova bio atualizada com sucesso.',
      });

      expect(repository.update).toHaveBeenCalledWith('user-1', {
        name: 'Nome Novo',
        phone: '11999998888',
        bio: 'Nova bio atualizada com sucesso.',
      });
    });

    it('caso 4: bio curta demais ou longa demais lanca BadRequestException', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: { id: 'user-1', completedAt: null },
      });

      await expect(
        service.updateProfile('user-1', 'email@test.com', null, {
          name: 'Nome',
          phone: '11999998888',
          bio: 'Curta',
        }),
      ).rejects.toThrow(BadRequestException);

      const longBio = 'a'.repeat(501);
      await expect(
        service.updateProfile('user-1', 'email@test.com', null, {
          name: 'Nome',
          phone: '11999998888',
          bio: longBio,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('caso 5: perfil inexistente lanca NotFoundException', async () => {
      repository.findById.mockResolvedValue({ found: false, entry: null });

      await expect(
        service.updateProfile('user-inexistente', 'email@test.com', null, {
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio valida para teste.',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('caso 6a: as redes entram no patch e saem no ProfileDto', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio antiga de cadastro inicial.',
          grade: 1,
          linkedin: null,
          instagram: null,
          completedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio antiga de cadastro inicial.',
          grade: 1,
          linkedin: 'https://www.linkedin.com/in/fulano',
          instagram: null,
          completedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });

      const dto = await service.updateProfile(
        'user-1',
        'email@test.com',
        null,
        {
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio antiga de cadastro inicial.',
          linkedin: 'https://www.linkedin.com/in/fulano',
          instagram: null,
        },
      );

      expect(repository.update).toHaveBeenCalledWith('user-1', {
        name: 'Nome',
        phone: '11999998888',
        bio: 'Bio antiga de cadastro inicial.',
        linkedin: 'https://www.linkedin.com/in/fulano',
        instagram: null,
      });
      expect(dto.linkedin).toBe('https://www.linkedin.com/in/fulano');
      expect(dto.instagram).toBeNull();
    });

    it('caso 6b: teste-trava — campo ausente no corpo NAO apaga a rede guardada', async () => {
      // "Nao mencionei" e "quero apagar" sao coisas diferentes, e a segunda
      // chega como `null` depois do DTO. Um patch que manda `undefined` para o
      // Firestore apaga em silencio o LinkedIn de quem so editou a bio.
      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio antiga de cadastro inicial.',
          grade: 1,
          linkedin: 'https://www.linkedin.com/in/fulano',
          instagram: 'https://www.instagram.com/fulano',
          completedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio nova, sem tocar nas redes.',
          grade: 1,
          linkedin: 'https://www.linkedin.com/in/fulano',
          instagram: 'https://www.instagram.com/fulano',
          completedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });

      await service.updateProfile('user-1', 'email@test.com', null, {
        name: 'Nome',
        phone: '11999998888',
        bio: 'Bio nova, sem tocar nas redes.',
      });

      const [, patchData] = repository.update.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect('linkedin' in patchData).toBe(false);
      expect('instagram' in patchData).toBe(false);
    });

    it('caso 6c: teste-trava — editar o perfil de quem ja concluiu nao recarimba completedAt', async () => {
      // Esta spec e a primeira a chamar o endpoint duas vezes na vida de um
      // usuario, entao e a primeira em que quebrar isso apareceria.
      const original = new Date('2026-01-01T00:00:00.000Z');

      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio antiga de cadastro inicial.',
          grade: 1,
          linkedin: null,
          instagram: null,
          completedAt: original,
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio nova depois do onboarding.',
          grade: 1,
          linkedin: null,
          instagram: null,
          completedAt: original,
        },
      });

      await service.updateProfile('user-1', 'email@test.com', null, {
        name: 'Nome',
        phone: '11999998888',
        bio: 'Bio nova depois do onboarding.',
        linkedin: 'https://www.linkedin.com/in/fulano',
      });

      const [, patchData] = repository.update.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect('completedAt' in patchData).toBe(false);
    });

    it('caso 6: grade nunca e alterado por este endpoint', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: null,
          phone: null,
          bio: null,
          grade: 1,
          completedAt: null,
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio valida para teste.',
          grade: 1,
          completedAt: new Date(),
        },
      });

      const bodyWithExtraField = {
        name: 'Nome',
        phone: '11999998888',
        bio: 'Bio valida para teste.',
      };

      await service.updateProfile(
        'user-1',
        'email@test.com',
        null,
        bodyWithExtraField,
      );

      expect(repository.update).not.toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ grade: 33 }),
      );
    });
  });
});
