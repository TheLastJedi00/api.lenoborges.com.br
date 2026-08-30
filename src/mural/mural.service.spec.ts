import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MuralService } from './mural.service';
import { MuralRepository } from './mural.repository';
import { ProfileRepository } from '../profile/profile.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { Profile } from '../profile/entities/profile.entity';
import {
  ANONYMOUS_AUTHOR_UID,
  MuralQuestion,
} from './entities/mural-question.entity';
import { TierId } from '../billing/billing.tiers';

// Terca-feira. Semana corrente: 2026-08-16. Em votacao: 2026-08-09.
const AGORA = new Date('2026-08-18T12:00:00.000Z');

/** Um instante de agosto de 2026, pelo dia. Encurta os semeios de ordenacao. */
const EM = (dia: string) => new Date(`2026-08-${dia}T00:00:00.000Z`);

function profile(tier: TierId, name: string | null = 'Leno Borges'): Profile {
  return {
    id: 'uid-1',
    name,
    phone: '47999990000',
    bio: 'bio',
    grade: 3,
    tier,
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
    promotedTo: null,
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
  let notifications: jest.Mocked<
    Pick<NotificationsService, 'notifyQuestion' | 'forgetQuestion'>
  >;

  beforeEach(() => {
    repository = {
      listByWeek: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue({ found: false, entry: null }),
      findMine: jest.fn().mockResolvedValue({ found: false, entry: null }),
      findMyVotes: jest.fn().mockResolvedValue(new Set<string>()),
      findWinner: jest
        .fn()
        .mockResolvedValue({ found: false, entry: null, questions: [] }),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    profiles = {
      findById: jest
        .fn()
        .mockResolvedValue({ found: true, entry: profile('great-dev-tier') }),
    };

    notifications = {
      notifyQuestion: jest.fn().mockResolvedValue(undefined),
      forgetQuestion: jest.fn().mockResolvedValue(undefined),
    };

    service = new MuralService(
      repository as unknown as MuralRepository,
      profiles as unknown as ProfileRepository,
      notifications as unknown as NotificationsService,
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

    /**
     * **O formulario de edicao abre preenchido a partir daqui** (spec 016,
     * decisao 9). `GET /mural` ja lia o documento da propria pergunta para
     * responder `myQuestionId` e jogava fora todo o resto.
     */
    it('devolve a pergunta inteira de quem ja perguntou', async () => {
      repository.findMine.mockResolvedValue({
        found: true,
        entry: question({ title: 'O texto que estava la', body: 'e o corpo' }),
      });

      const state = await service.getState('uid-1', AGORA);

      expect(state.myQuestion).toEqual(
        expect.objectContaining({
          id: '2026-08-16__uid-1',
          title: 'O texto que estava la',
          body: 'e o corpo',
          badgeId: 'poo',
          phase: 'coleta',
        }),
      );
    });

    it('devolve myQuestion null para quem ainda nao perguntou', async () => {
      const state = await service.getState('uid-1', AGORA);

      expect(state.myQuestion).toBeNull();
    });

    /**
     * **Nenhuma leitura a mais.** A pergunta e montada do `findMine` que ja
     * acontecia; um `GET /mural/perguntas/:id` novo, ou o front baixando a
     * semana inteira para achar uma linha, seria o preco de nao fazer isto.
     */
    it('nao le nada a mais do que ja lia', async () => {
      repository.findMine.mockResolvedValue({
        found: true,
        entry: question(),
      });

      await service.getState('uid-1', AGORA);

      expect(repository.findMine).toHaveBeenCalledTimes(1);
      expect(repository.findById).not.toHaveBeenCalled();
      expect(repository.listByWeek).not.toHaveBeenCalled();
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

  describe('authorUid no DTO (spec 019)', () => {
    it('pergunta de autor vivo traz o uid, para a tela abrir o cartao', async () => {
      repository.listByWeek.mockImplementation((weekId: string) =>
        Promise.resolve(
          weekId === '2026-08-09'
            ? [question({ weekId, authorUid: 'uid-7' })]
            : [],
        ),
      );

      const lista = await service.listQuestions('uid-1', 'votacao', AGORA);

      expect(lista[0].authorUid).toBe('uid-7');
    });

    /**
     * **A traducao do sentinela acontece no service, uma vez** (decisao 11).
     *
     * Mandar `__removido__` para o front obrigaria a tela a conhece-lo e
     * compara-lo, e a primeira comparacao errada abre um cartao que responde 404
     * em cima da pergunta de alguem que pediu para ser esquecido. `null` e o
     * front nao precisar saber que existe um sentinela.
     */
    it('teste-trava: pergunta anonimizada traz null, e nunca o sentinela', async () => {
      repository.listByWeek.mockImplementation((weekId: string) =>
        Promise.resolve(
          weekId === '2026-08-09'
            ? [
                question({
                  weekId,
                  authorUid: ANONYMOUS_AUTHOR_UID,
                  authorName: 'Membro removido',
                }),
              ]
            : [],
        ),
      );

      const lista = await service.listQuestions('uid-1', 'votacao', AGORA);

      expect(lista[0].authorUid).toBeNull();
      expect(lista[0].authorName).toBe('Membro removido');
    });
  });

  describe('listagem', () => {
    /**
     * **O eixo da listagem deixou de ser o `weekId` e passou a ser a fase**
     * (spec 016, decisao 6). Uma pergunta da semana em coleta, adiantada para
     * votacao, pertence a aba de votacao e continua tendo o `weekId` da coleta
     * -- entao consultar "a semana da aba" para de funcionar no primeiro
     * adiantamento.
     *
     * As duas consultas por semana continuam identicas, e e por isso que
     * nenhuma linha da tabela de indices do README muda: o que passou para a
     * memoria foi a particao e a ordenacao, e nao a consulta.
     */
    it('carrega as duas semanas vivas, e nao so a da aba pedida', async () => {
      await service.listQuestions('uid-1', 'votacao', AGORA);

      expect(repository.listByWeek).toHaveBeenCalledWith('2026-08-16', false);
      expect(repository.listByWeek).toHaveBeenCalledWith('2026-08-09', true);
    });

    it('ordena por votos na votação, e por data na coleta', async () => {
      repository.listByWeek.mockImplementation((weekId: string) =>
        Promise.resolve(
          weekId === '2026-08-09'
            ? [
                question({
                  id: 'poucos',
                  weekId,
                  voteCount: 1,
                  createdAt: EM('10'),
                }),
                question({
                  id: 'muitos',
                  weekId,
                  voteCount: 9,
                  createdAt: EM('12'),
                }),
              ]
            : [
                question({ id: 'nova', createdAt: EM('18') }),
                question({ id: 'antiga', createdAt: EM('17') }),
              ],
        ),
      );

      const votacao = await service.listQuestions('uid-1', 'votacao', AGORA);
      expect(votacao.map((item) => item.id)).toEqual(['muitos', 'poucos']);

      const coleta = await service.listQuestions('uid-1', 'coleta', AGORA);
      expect(coleta.map((item) => item.id)).toEqual(['antiga', 'nova']);
    });

    /**
     * Quem chega pela notificacao pede a mais nova primeiro; quem entra pelo
     * menu continua vendo a mais antiga em cima. Trocar o padrao silenciosamente
     * quebraria a leitura da semana inteira (spec 012, decisao 13).
     */
    it('inverte a coleta so quando pedem recentes', async () => {
      repository.listByWeek.mockImplementation((weekId: string) =>
        Promise.resolve(
          weekId === '2026-08-16'
            ? [
                question({ id: 'antiga', createdAt: EM('17') }),
                question({ id: 'nova', createdAt: EM('18') }),
              ]
            : [],
        ),
      );

      const lista = await service.listQuestions('uid-1', 'coleta', AGORA, true);

      expect(lista.map((item) => item.id)).toEqual(['nova', 'antiga']);
    });

    /**
     * Sem esta leitura o front não sabe qual coração pintar, e a tela pisca a
     * cada recarga. Ela é um `getAll` por caminho — nunca N leituras em laço.
     */
    it('marca quais perguntas o usuário já votou', async () => {
      repository.listByWeek.mockImplementation((weekId: string) =>
        Promise.resolve(
          weekId === '2026-08-09'
            ? [
                question({ id: 'a', weekId, createdAt: EM('10') }),
                question({ id: 'b', weekId, createdAt: EM('11') }),
              ]
            : [],
        ),
      );
      repository.findMyVotes.mockResolvedValue(new Set(['b']));

      const lista = await service.listQuestions('uid-2', 'votacao', AGORA);

      expect(lista.map((item) => item.hasVoted)).toEqual([false, true]);
    });

    it('marca a própria pergunta', async () => {
      repository.listByWeek.mockImplementation((weekId: string) =>
        Promise.resolve(weekId === '2026-08-16' ? [question()] : []),
      );

      const lista = await service.listQuestions('uid-1', 'coleta', AGORA);

      expect(lista[0].isMine).toBe(true);
    });

    it('carrega a fase derivada em cada pergunta', async () => {
      repository.listByWeek.mockImplementation((weekId: string) =>
        Promise.resolve(weekId === '2026-08-09' ? [question({ weekId })] : []),
      );

      const lista = await service.listQuestions('uid-1', 'votacao', AGORA);

      expect(lista[0].phase).toBe('votacao');
    });

    /**
     * O `findMyVotes` e um `getAll` por caminho e o custo e linear nos ids
     * passados. Particionar **antes** e o que impede a leitura dobrar de
     * tamanho: sem isso, abrir uma aba leria os votos das duas semanas.
     */
    describe('a particao pela fase (spec 016)', () => {
      it('pergunta da semana atual adiantada aparece na votacao e some da coleta', async () => {
        repository.listByWeek.mockImplementation((weekId: string) =>
          Promise.resolve(
            weekId === '2026-08-16'
              ? [question({ id: 'adiantada', promotedTo: 'votacao' })]
              : [],
          ),
        );

        const votacao = await service.listQuestions('uid-1', 'votacao', AGORA);
        expect(votacao.map((item) => item.id)).toEqual(['adiantada']);

        const coleta = await service.listQuestions('uid-1', 'coleta', AGORA);
        expect(coleta).toEqual([]);
      });

      /**
       * "Sair do mural" e exatamente isto: cair fora das duas abas. A pergunta
       * continua no banco e aparece na pauta, que e a decisao 5.
       */
      it('pergunta adiantada para encerrada nao aparece em nenhuma das duas abas', async () => {
        repository.listByWeek.mockImplementation((weekId: string) =>
          Promise.resolve(
            weekId === '2026-08-16'
              ? [question({ id: 'na-pauta', promotedTo: 'encerrada' })]
              : [],
          ),
        );

        await expect(
          service.listQuestions('uid-1', 'coleta', AGORA),
        ).resolves.toEqual([]);
        await expect(
          service.listQuestions('uid-1', 'votacao', AGORA),
        ).resolves.toEqual([]);
      });

      /**
       * **O teste que garante que a troca de eixo nao e uma mudanca de
       * comportamento.** Sem nenhuma promocao, as duas abas devolvem o que
       * devolviam antes, na mesma ordem.
       */
      it('sem promocao nenhuma, as duas abas sao as de antes', async () => {
        repository.listByWeek.mockImplementation((weekId: string) =>
          Promise.resolve([
            question({ id: `${weekId}-a`, weekId, createdAt: EM('10') }),
            question({
              id: `${weekId}-b`,
              weekId,
              voteCount: 5,
              createdAt: EM('11'),
            }),
          ]),
        );

        const coleta = await service.listQuestions('uid-1', 'coleta', AGORA);
        expect(coleta.map((item) => item.id)).toEqual([
          '2026-08-16-a',
          '2026-08-16-b',
        ]);

        const votacao = await service.listQuestions('uid-1', 'votacao', AGORA);
        expect(votacao.map((item) => item.id)).toEqual([
          '2026-08-09-b',
          '2026-08-09-a',
        ]);
      });

      /**
       * **A invariante do adiantamento**, do lado da listagem: adiantar uma
       * pergunta custa zero para quem nao foi adiantado.
       *
       * Sem esta trava, a primeira refatoracao que "simplificar" a particao
       * empurra a semana inteira junto -- e o sintoma e um mural que abre o
       * voto uma semana antes para todo mundo.
       */
      it('promover uma nao move as outras tres', async () => {
        repository.listByWeek.mockImplementation((weekId: string) =>
          Promise.resolve(
            weekId === '2026-08-16'
              ? [
                  question({
                    id: 'q1',
                    createdAt: EM('17'),
                    promotedTo: 'votacao',
                  }),
                  question({ id: 'q2', createdAt: EM('18') }),
                  question({ id: 'q3', createdAt: EM('19') }),
                  question({ id: 'q4', createdAt: EM('20') }),
                ]
              : [],
          ),
        );

        const coleta = await service.listQuestions('uid-1', 'coleta', AGORA);
        expect(coleta.map((item) => item.id)).toEqual(['q2', 'q3', 'q4']);
        expect(coleta.every((item) => item.phase === 'coleta')).toBe(true);

        const votacao = await service.listQuestions('uid-1', 'votacao', AGORA);
        expect(votacao.map((item) => item.id)).toEqual(['q1']);
      });

      /**
       * O inverso, na semana em votacao: tirar uma pergunta do mural nao fecha
       * o voto das demais, que continuam ate a virada normal.
       */
      it('promover uma da votacao para encerrada nao tira as outras da aba', async () => {
        repository.listByWeek.mockImplementation((weekId: string) =>
          Promise.resolve(
            weekId === '2026-08-09'
              ? [
                  question({
                    id: 'saiu',
                    weekId,
                    voteCount: 9,
                    promotedTo: 'encerrada',
                  }),
                  question({ id: 'ficou-a', weekId, voteCount: 4 }),
                  question({ id: 'ficou-b', weekId, voteCount: 2 }),
                ]
              : [],
          ),
        );

        const votacao = await service.listQuestions('uid-1', 'votacao', AGORA);

        expect(votacao.map((item) => item.id)).toEqual(['ficou-a', 'ficou-b']);
      });
    });

    it('le os votos so dos ids da aba pedida, e nao das duas semanas', async () => {
      repository.listByWeek.mockImplementation((weekId: string) =>
        Promise.resolve([question({ id: `${weekId}-x`, weekId })]),
      );

      await service.listQuestions('uid-1', 'coleta', AGORA);

      expect(repository.findMyVotes).toHaveBeenCalledWith(
        ['2026-08-16-x'],
        'uid-1',
      );
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

    /**
     * **A trava da edicao ja obedece ao piso, sem uma linha nova no service.**
     *
     * Ela le `phaseOf`, e a Fase 01 ensinou `phaseOf` a conhecer o
     * adiantamento. E o teste que prova que a decisao 1 desta spec e uma
     * decisao e nao um `if` a mais: uma coisa mudou de lugar e tres
     * comportamentos obedeceram. Se este teste exigir codigo novo, a Fase 01
     * foi feita errada.
     */
    it('recusa editar a pergunta da semana corrente que o admin adiantou', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: question({ promotedTo: 'votacao' }),
      });

      await expect(
        service.updateQuestion(
          'uid-1',
          '2026-08-16__uid-1',
          { title: 'Mudando depois de adiantada' },
          AGORA,
        ),
      ).rejects.toThrow(ConflictException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    /**
     * A mensagem antiga dizia "a semana virou", e ela mente no caso da
     * promocao. A nova fala do estado e nao da causa: os dois caminhos levam ao
     * mesmo lugar, e a pessoa nao precisa saber qual foi.
     */
    it('a mensagem do 409 fala do estado, e nao da virada da semana', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: question({ promotedTo: 'votacao' }),
      });

      await expect(
        service.updateQuestion(
          'uid-1',
          '2026-08-16__uid-1',
          { title: 'Mudando depois de adiantada' },
          AGORA,
        ),
      ).rejects.toThrow(/em votação/);

      await expect(
        service.updateQuestion(
          'uid-1',
          '2026-08-16__uid-1',
          { title: 'Mudando depois de adiantada' },
          AGORA,
        ),
      ).rejects.not.toThrow(/semana virou/);
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

    it('rotula a vencedora da semana como origem voto', async () => {
      repository.findWinner.mockResolvedValue({
        found: true,
        entry: question({ id: 'venceu', weekId: '2026-08-02' }),
        questions: [question({ id: 'venceu', weekId: '2026-08-02' })],
      });

      const winners = await service.listWinners('uid-1', 1, AGORA);

      expect(winners[0].origem).toBe('voto');
    });

    /**
     * **A pauta tem duas origens** (spec 016, decisao 5). A adiantada nao some
     * da vida do autor: sem esta linha ela sairia do mural e nao apareceria em
     * lugar nenhum, o que e indistinguivel de ter sido removida pela moderacao.
     */
    it('a adiantada da semana corrente entra na pauta como origem adiantada', async () => {
      repository.listByWeek.mockImplementation((weekId: string) =>
        Promise.resolve(
          weekId === '2026-08-16'
            ? [question({ id: 'adiantada', promotedTo: 'encerrada' })]
            : [],
        ),
      );

      const pauta = await service.listWinners('uid-1', 1, AGORA);

      const linha = pauta.find((item) => item.question?.id === 'adiantada');
      expect(linha).toBeDefined();
      expect(linha?.origem).toBe('adiantada');
      expect(linha?.weekId).toBe('2026-08-16');
    });

    /**
     * Ela nao pode aparecer duas vezes quando a semana dela encerrar: e por
     * isso que a promovida fica fora da conta da vencedora, e nao so por causa
     * da exposicao dobrada.
     */
    it('a adiantada nao aparece duas vezes quando a semana dela encerra', async () => {
      const adiantada = question({
        id: 'adiantada',
        weekId: '2026-08-02',
        voteCount: 20,
        promotedTo: 'encerrada',
      });
      const segunda = question({
        id: 'segunda',
        weekId: '2026-08-02',
        voteCount: 3,
      });
      repository.findWinner.mockResolvedValue({
        found: true,
        entry: segunda,
        questions: [adiantada, segunda],
      });

      const pauta = await service.listWinners('uid-1', 1, AGORA);

      const vezes = pauta.filter(
        (item) => item.question?.id === 'adiantada',
      ).length;
      expect(vezes).toBe(1);
      expect(
        pauta.filter((item) => item.origem === 'voto')[0].question?.id,
      ).toBe('segunda');
    });
  });

  /**
   * O adiantamento (spec 016). O admin empurra **uma** pergunta para a frente:
   * `votacao` abre o voto agora, `encerrada` tira do Mural e poe na pauta.
   */
  describe('adiantamento', () => {
    it('adianta a pergunta da semana em coleta para votacao', async () => {
      repository.findById.mockResolvedValue({ found: true, entry: question() });
      repository.update.mockResolvedValue({
        entry: question({ promotedTo: 'votacao' }),
      });

      const promovida = await service.promote(
        '2026-08-16__uid-1',
        'votacao',
        AGORA,
      );

      expect(repository.update).toHaveBeenCalledWith('2026-08-16__uid-1', {
        promotedTo: 'votacao',
      });
      expect(promovida.promotedTo).toBe('votacao');
      expect(promovida.phase).toBe('votacao');
    });

    it('responde 404 para pergunta que nao existe', async () => {
      await expect(
        service.promote('2026-08-16__ninguem', 'votacao', AGORA),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * **Nao pode ser um 200 que nao faz nada.** A tela precisa saber que o
     * botao nao tinha efeito -- um botao que responde sucesso sem mudar nada e
     * o que ensina a pessoa a nao confiar no que ela ve.
     */
    it('recusa com 409 adiantar para votacao o que ja esta em votacao pelo relogio', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: question({ weekId: '2026-08-09' }),
      });

      await expect(
        service.promote('2026-08-09__uid-1', 'votacao', AGORA),
      ).rejects.toThrow(ConflictException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('recusa com 409 adiantar de novo para a fase que a promocao ja deu', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: question({ promotedTo: 'votacao' }),
      });

      await expect(
        service.promote('2026-08-16__uid-1', 'votacao', AGORA),
      ).rejects.toThrow(ConflictException);
    });

    it('recusa com 409 voltar de encerrada para votacao', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: question({ promotedTo: 'encerrada' }),
      });

      await expect(
        service.promote('2026-08-16__uid-1', 'votacao', AGORA),
      ).rejects.toThrow(ConflictException);
    });

    /**
     * "Responder logo" e responder logo: a pergunta sai do Mural sem ter
     * recebido um voto. E o ponto em aberto 3 da spec 016, assumido como o
     * comportamento desejado e nao como buraco.
     */
    it('adianta de coleta direto para encerrada, pulando a votacao inteira', async () => {
      repository.findById.mockResolvedValue({ found: true, entry: question() });
      repository.update.mockResolvedValue({
        entry: question({ promotedTo: 'encerrada' }),
      });

      const promovida = await service.promote(
        '2026-08-16__uid-1',
        'encerrada',
        AGORA,
      );

      expect(promovida.phase).toBe('encerrada');
    });

    it('aceita votacao -> encerrada', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: question({ promotedTo: 'votacao' }),
      });
      repository.update.mockResolvedValue({
        entry: question({ promotedTo: 'encerrada' }),
      });

      await expect(
        service.promote('2026-08-16__uid-1', 'encerrada', AGORA),
      ).resolves.toEqual(expect.objectContaining({ promotedTo: 'encerrada' }));
    });

    /**
     * **Adiantar nao abre vaga para uma pergunta nova** (decisao 10). O ID do
     * documento continua sendo `{weekId}__{uid}` e a promocao nao o toca.
     *
     * Este teste existe para impedir a "otimizacao" de resolver a fase mexendo
     * no `weekId`: ela exigiria recriar o documento e migrar a subcolecao de
     * votos inteira, e liberaria o caminho da semana para uma segunda pergunta
     * da mesma pessoa.
     */
    it('quem teve a pergunta adiantada continua com a vaga da semana ocupada', async () => {
      repository.findMine.mockResolvedValue({
        found: true,
        entry: question({ promotedTo: 'votacao' }),
      });

      const state = await service.getState('uid-1', AGORA);

      expect(state.canAsk).toBe(false);
      expect(state.myQuestionId).toBe('2026-08-16__uid-1');
    });
  });

  describe('notificacao (spec 012)', () => {
    beforeEach(() => {
      repository.create.mockResolvedValue({ entry: question() });
    });

    it('anuncia a pergunta criada, com o uid de quem escreveu', async () => {
      await service.createQuestion(
        'uid-1',
        { badgeId: 'logica', title: 'Um titulo com dez ou mais' },
        AGORA,
      );

      expect(notifications.notifyQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ badgeId: 'logica', actorUid: 'uid-1' }),
      );
    });

    /**
     * Um 500 aqui apagaria da tela um texto que a pessoa escreveu, e a pergunta
     * ja esta gravada quando isto roda.
     */
    it('pergunta continua criada quando notificar falha', async () => {
      notifications.notifyQuestion.mockRejectedValue(new Error('offline'));

      await expect(
        service.createQuestion(
          'uid-1',
          { badgeId: 'logica', title: 'Um titulo com dez ou mais' },
          AGORA,
        ),
      ).resolves.toEqual(expect.objectContaining({ id: '2026-08-16__uid-1' }));
    });

    it('moderar a pergunta apaga a notificacao dela', async () => {
      repository.findById.mockResolvedValue({ found: true, entry: question() });

      await service.remove(question().id);

      expect(notifications.forgetQuestion).toHaveBeenCalledWith(question().id);
    });

    it('falha ao esquecer a notificacao nao desfaz a moderacao', async () => {
      repository.findById.mockResolvedValue({ found: true, entry: question() });
      notifications.forgetQuestion.mockRejectedValue(new Error('offline'));

      await expect(service.remove(question().id)).resolves.toBeUndefined();
      expect(repository.remove).toHaveBeenCalled();
    });
  });
});
