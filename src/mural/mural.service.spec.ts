import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { MuralService } from './mural.service';
import { MuralRepository } from './mural.repository';
import { ProfileRepository } from '../profile/profile.repository';
import { Profile } from '../profile/entities/profile.entity';
import { MuralQuestion } from './entities/mural-question.entity';
import { TierId } from '../billing/billing.tiers';

// Terca-feira. Semana corrente: 2026-08-16. Em votacao: 2026-08-09.
const AGORA = new Date('2026-08-18T12:00:00.000Z');

function profile(tier: TierId, name: string | null = 'Leno Borges'): Profile {
  return {
    id: 'uid-1',
    name,
    phone: '47999990000',
    bio: 'bio',
    grade: 3,
    tier,
    completedAt: new Date(),
    waitlistEntryId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function question(overrides: Partial<MuralQuestion> = {}): MuralQuestion {
  return {
    id: '2026-08-16__uid-1',
    weekId: '2026-08-16',
    badgeId: 'poo',
    authorUid: 'uid-1',
    authorName: 'Leno',
    title: 'Como saber quando usar herança?',
    body: null,
    voteCount: 0,
    answerVideoId: null,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...overrides,
  };
}

describe('MuralService', () => {
  let service: MuralService;
  let repository: jest.Mocked<
    Pick<
      MuralRepository,
      | 'listByWeek'
      | 'findById'
      | 'findMine'
      | 'findMyVotes'
      | 'findWinner'
      | 'create'
      | 'update'
      | 'remove'
    >
  >;
  let profiles: jest.Mocked<Pick<ProfileRepository, 'findById'>>;

  beforeEach(() => {
    repository = {
      listByWeek: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue({ found: false, entry: null }),
      findMine: jest.fn().mockResolvedValue({ found: false, entry: null }),
      findMyVotes: jest.fn().mockResolvedValue(new Set<string>()),
      findWinner: jest.fn().mockResolvedValue({ found: false, entry: null }),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    profiles = {
      findById: jest
        .fn()
        .mockResolvedValue({ found: true, entry: profile('great-dev-tier') }),
    };

    service = new MuralService(
      repository as unknown as MuralRepository,
      profiles as unknown as ProfileRepository,
    );
  });

  describe('estado do ciclo', () => {
    it('devolve a semana corrente e a anterior, e a virada em UTC', async () => {
      const state = await service.getState('uid-1', AGORA);

      expect(state.currentWeekId).toBe('2026-08-16');
      expect(state.votingWeekId).toBe('2026-08-09');
      expect(state.currentWeekEndsAt).toBe('2026-08-23T03:00:00.000Z');
    });

    it('permite perguntar para quem paga e ainda não perguntou', async () => {
      const state = await service.getState('uid-1', AGORA);

      expect(state.canAsk).toBe(true);
      expect(state.myQuestionId).toBeNull();
    });

    // O botão não pode abrir um formulário que vai receber 409.
    it('bloqueia quem já perguntou nesta semana', async () => {
      repository.findMine.mockResolvedValue({
        found: true,
        entry: question(),
      });

      const state = await service.getState('uid-1', AGORA);

      expect(state.canAsk).toBe(false);
      expect(state.myQuestionId).toBe('2026-08-16__uid-1');
    });

    it('bloqueia o Dev Tier', async () => {
      profiles.findById.mockResolvedValue({
        found: true,
        entry: profile('dev-tier'),
      });

      const state = await service.getState('uid-1', AGORA);

      expect(state.canAsk).toBe(false);
    });
  });

  describe('listagem', () => {
    it('ordena por votos na fase de votação, e por data na coleta', async () => {
      await service.listQuestions('uid-1', 'votacao', AGORA);
      expect(repository.listByWeek).toHaveBeenCalledWith('2026-08-09', true);

      await service.listQuestions('uid-1', 'coleta', AGORA);
      expect(repository.listByWeek).toHaveBeenCalledWith('2026-08-16', false);
    });

    /**
     * Sem esta leitura o front não sabe qual coração pintar, e a tela pisca a
     * cada recarga. Ela é um `getAll` por caminho — nunca N leituras em laço.
     */
    it('marca quais perguntas o usuário já votou', async () => {
      repository.listByWeek.mockResolvedValue([
        question({ id: 'a' }),
        question({ id: 'b' }),
      ]);
      repository.findMyVotes.mockResolvedValue(new Set(['b']));

      const lista = await service.listQuestions('uid-2', 'votacao', AGORA);

      expect(lista.map((item) => item.hasVoted)).toEqual([false, true]);
    });

    it('marca a própria pergunta', async () => {
      repository.listByWeek.mockResolvedValue([question()]);

      const lista = await service.listQuestions('uid-1', 'coleta', AGORA);

      expect(lista[0].isMine).toBe(true);
    });

    it('carrega a fase derivada em cada pergunta', async () => {
      repository.listByWeek.mockResolvedValue([
        question({ weekId: '2026-08-09' }),
      ]);

      const lista = await service.listQuestions('uid-1', 'votacao', AGORA);

      expect(lista[0].phase).toBe('votacao');
    });
  });

  describe('criação', () => {
    beforeEach(() => {
      repository.create.mockResolvedValue({ entry: question() });
    });

    /**
     * **O portão da spec 010.** O Dev Tier vota, mas não escreve — e a mensagem
     * precisa dizer o que fazer, não só que não pode: 403 sem caminho de saída é
     * a forma mais cara de perder um upgrade.
     */
    it('recusa o Dev Tier com 403 e um caminho de saída', async () => {
      profiles.findById.mockResolvedValue({
        found: true,
        entry: profile('dev-tier'),
      });

      await expect(
        service.createQuestion(
          'uid-1',
          { badgeId: 'poo', title: 'Uma pergunta bem formulada' },
          AGORA,
        ),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.createQuestion(
          'uid-1',
          { badgeId: 'poo', title: 'Uma pergunta bem formulada' },
          AGORA,
        ),
      ).rejects.toThrow(/Financeiro/);
    });

    it('aceita de quem paga', async () => {
      const criada = await service.createQuestion(
        'uid-1',
        { badgeId: 'poo', title: 'Uma pergunta bem formulada' },
        AGORA,
      );

      expect(criada.id).toBe('2026-08-16__uid-1');
    });

    // O weekId nunca vem do cliente.
    it('carimba a semana no servidor', async () => {
      await service.createQuestion(
        'uid-1',
        { badgeId: 'poo', title: 'Uma pergunta bem formulada' },
        AGORA,
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ weekId: '2026-08-16' }),
      );
    });

    it('denormaliza só o primeiro nome do autor', async () => {
      await service.createQuestion(
        'uid-1',
        { badgeId: 'poo', title: 'Uma pergunta bem formulada' },
        AGORA,
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ authorName: 'Leno' }),
      );
    });

    // Cartão sem autor pareceria defeito; a pergunta existe de qualquer jeito.
    it('usa "Membro" quando o perfil ainda não tem nome', async () => {
      profiles.findById.mockResolvedValue({
        found: true,
        entry: profile('great-dev-tier', null),
      });

      await service.createQuestion(
        'uid-1',
        { badgeId: 'poo', title: 'Uma pergunta bem formulada' },
        AGORA,
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ authorName: 'Membro' }),
      );
    });

    it('recusa insígnia que não existe na trilha', async () => {
      await expect(
        service.createQuestion(
          'uid-1',
          { badgeId: 'inventada', title: 'Uma pergunta bem formulada' },
          AGORA,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('traduz ALREADY_EXISTS em 409, com o caminho de editar', async () => {
      repository.create.mockRejectedValue(
        Object.assign(new Error('already exists'), { code: 6 }),
      );

      await expect(
        service.createQuestion(
          'uid-1',
          { badgeId: 'poo', title: 'Uma pergunta bem formulada' },
          AGORA,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('edição', () => {
    it('deixa o autor reescrever enquanto a semana está em coleta', async () => {
      repository.findById.mockResolvedValue({ found: true, entry: question() });
      repository.update.mockResolvedValue({
        entry: question({ title: 'Outro título, melhor pensado' }),
      });

      const atualizada = await service.updateQuestion(
        'uid-1',
        '2026-08-16__uid-1',
        { title: 'Outro título, melhor pensado' },
        AGORA,
      );

      expect(atualizada.title).toBe('Outro título, melhor pensado');
    });

    it('recusa editar pergunta de outra pessoa', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: question({ authorUid: 'uid-outro' }),
      });

      await expect(
        service.updateQuestion(
          'uid-1',
          '2026-08-16__uid-outro',
          { title: 'Mudando o que não é meu' },
          AGORA,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    /**
     * Depois da virada a pergunta já está em votação, e mexer no texto
     * invalidaria os votos que ela recebeu: quem votou votou naquilo.
     */
    it('recusa editar depois que a semana virou', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: question({ weekId: '2026-08-09' }),
      });

      await expect(
        service.updateQuestion(
          'uid-1',
          '2026-08-09__uid-1',
          { title: 'Mudando durante a votação' },
          AGORA,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('vencedoras', () => {
    /**
     * Semana em branco não some do histórico: nenhum vídeo é devido, e esconder
     * a semana faria a lista parecer ter buracos.
     */
    it('lista semana sem pergunta como semana em branco', async () => {
      const winners = await service.listWinners('uid-1', 2, AGORA);

      expect(winners.length).toBe(2);
      expect(winners[0].question).toBeNull();
    });

    // A primeira encerrada é a retrasada: a anterior ainda está em votação.
    it('começa pela semana retrasada, não pela que ainda vota', async () => {
      const winners = await service.listWinners('uid-1', 1, AGORA);

      expect(winners[0].weekId).toBe('2026-08-02');
    });
  });
});
