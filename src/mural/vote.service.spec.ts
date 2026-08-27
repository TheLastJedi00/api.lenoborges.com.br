import { ConflictException, NotFoundException } from '@nestjs/common';
import { VoteService } from './vote.service';
import { MuralRepository } from './mural.repository';
import { MuralQuestion } from './entities/mural-question.entity';

// Terca-feira. Semana corrente: 2026-08-16. Em votacao: 2026-08-09.
const AGORA = new Date('2026-08-18T12:00:00.000Z');

function question(
  weekId: string,
  promotedTo: 'votacao' | 'encerrada' | null = null,
): MuralQuestion {
  return {
    id: `${weekId}__uid-1`,
    weekId,
    badgeId: 'poo',
    authorUid: 'uid-1',
    authorName: 'Leno',
    title: 'Como saber quando usar herança?',
    body: null,
    voteCount: 3,
    answerVideoId: null,
    promotedTo,
    createdAt: AGORA,
    updatedAt: AGORA,
  };
}

describe('VoteService', () => {
  let service: VoteService;
  let repository: jest.Mocked<
    Pick<MuralRepository, 'findById' | 'vote' | 'unvote' | 'hasVoted'>
  >;

  beforeEach(() => {
    repository = {
      findById: jest
        .fn()
        .mockResolvedValue({ found: true, entry: question('2026-08-09') }),
      vote: jest.fn().mockResolvedValue(undefined),
      unvote: jest.fn().mockResolvedValue(undefined),
      hasVoted: jest.fn().mockResolvedValue(true),
    };

    service = new VoteService(repository as unknown as MuralRepository);
  });

  it('vota numa pergunta da semana em votação', async () => {
    await service.vote('2026-08-09__uid-1', 'uid-2', AGORA);

    expect(repository.vote).toHaveBeenCalledWith('2026-08-09__uid-1', 'uid-2');
  });

  /**
   * O segundo voto não estoura para quem clica — do ponto de vista da pessoa o
   * coração já está pintado —, mas o contador **não pode subir de novo**. Quem
   * garante isso é o lote atômico do repository: o `create()` falha e o
   * `increment` falha junto.
   */
  it('não incrementa duas vezes quando o voto já existe', async () => {
    repository.vote.mockRejectedValue(
      Object.assign(new Error('already exists'), { code: 6 }),
    );

    await expect(
      service.vote('2026-08-09__uid-1', 'uid-2', AGORA),
    ).resolves.toBeUndefined();
  });

  /**
   * Não se vota na semana em coleta: quem publicasse domingo de manhã teria
   * sete dias de vantagem sobre quem publicasse sábado à noite.
   */
  it('recusa voto na semana em coleta', async () => {
    repository.findById.mockResolvedValue({
      found: true,
      entry: question('2026-08-16'),
    });

    await expect(
      service.vote('2026-08-16__uid-1', 'uid-2', AGORA),
    ).rejects.toThrow(ConflictException);
    expect(repository.vote).not.toHaveBeenCalled();
  });

  it('recusa voto em semana encerrada', async () => {
    repository.findById.mockResolvedValue({
      found: true,
      entry: question('2026-08-02'),
    });

    await expect(
      service.vote('2026-08-02__uid-1', 'uid-2', AGORA),
    ).rejects.toThrow(ConflictException);
  });

  it('recusa voto em pergunta que não existe', async () => {
    repository.findById.mockResolvedValue({ found: false, entry: null });

    await expect(
      service.vote('2026-08-09__ninguem', 'uid-2', AGORA),
    ).rejects.toThrow(NotFoundException);
  });

  it('desfaz o voto de quem votou', async () => {
    await service.unvote('2026-08-09__uid-1', 'uid-2', AGORA);

    expect(repository.unvote).toHaveBeenCalledWith(
      '2026-08-09__uid-1',
      'uid-2',
    );
  });

  /**
   * **O caso que ninguém lembra de testar.**
   *
   * Sem a conferência antes do decremento, dois `DELETE` seguidos tirariam dois
   * de um voto que existia uma vez só — e o `voteCount` ficaria negativo, o que
   * não quebra nada visivelmente e faz a ordenação do mural mentir para sempre.
   */
  it('desvotar sem ter votado é idempotente, e não deixa o contador negativo', async () => {
    repository.hasVoted.mockResolvedValue(false);

    await expect(
      service.unvote('2026-08-09__uid-1', 'uid-2', AGORA),
    ).resolves.toBeUndefined();
    expect(repository.unvote).not.toHaveBeenCalled();
  });

  it('recusa desvotar fora da fase de votação', async () => {
    repository.findById.mockResolvedValue({
      found: true,
      entry: question('2026-08-16'),
    });

    await expect(
      service.unvote('2026-08-16__uid-1', 'uid-2', AGORA),
    ).rejects.toThrow(ConflictException);
  });

  /**
   * **A primeira prova de que o piso da spec 016 e uma decisao, e nao um `if` a
   * mais em cada tela.**
   *
   * O VoteService nao ganhou uma linha: ele le `phaseOf`, e `phaseOf` aprendeu
   * o adiantamento. Uma pergunta da semana em coleta adiantada pelo admin
   * aceita voto agora; a pergunta ao lado, sem adiantamento, continua
   * respondendo 409 -- que e a invariante do adiantamento vista do voto.
   */
  describe('o piso do adiantamento (spec 016)', () => {
    it('aceita voto na pergunta em coleta que foi adiantada para votacao', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: question('2026-08-16', 'votacao'),
      });

      await service.vote('2026-08-16__uid-1', 'uid-2', AGORA);

      expect(repository.vote).toHaveBeenCalledWith(
        '2026-08-16__uid-1',
        'uid-2',
      );
    });

    it('a mesma pergunta sem adiantamento continua recusando com 409', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: question('2026-08-16'),
      });

      await expect(
        service.vote('2026-08-16__uid-1', 'uid-2', AGORA),
      ).rejects.toThrow(ConflictException);
      expect(repository.vote).not.toHaveBeenCalled();
    });

    /**
     * Adiantar para "responder logo" tira a pergunta do mural, e tirar do mural
     * quer dizer que o voto fecha. Sem isto, a pauta continuaria recebendo voto
     * depois de a pergunta ja ter virado pauta.
     */
    it('recusa voto na pergunta adiantada para encerrada', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: question('2026-08-09', 'encerrada'),
      });

      await expect(
        service.vote('2026-08-09__uid-1', 'uid-2', AGORA),
      ).rejects.toThrow(ConflictException);
    });
  });
});
