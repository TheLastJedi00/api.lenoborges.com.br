import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FakeFirestore } from '../track/testing/fake-firestore';
import { FirebaseService } from '../auth/firebase.service';
import { GymQuestionRepository } from './gym-question.repository';
import { GymQuestionService } from './gym-question.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { MAX_QUESTIONS_PER_DIFFICULTY } from './games.constants';

function makeService(): {
  service: GymQuestionService;
  repository: GymQuestionRepository;
  firestore: FakeFirestore;
} {
  const firestore = new FakeFirestore();
  const repository = new GymQuestionRepository({
    firestore,
  } as unknown as FirebaseService);

  return { service: new GymQuestionService(repository), repository, firestore };
}

function dto(extra: Partial<CreateQuestionDto> = {}): CreateQuestionDto {
  return {
    difficulty: 'easy',
    question: 'O que um laço `for` controla?',
    alternatives: ['A repetição', 'A memória', 'A ordem', 'O tipo'],
    correctIndex: 0,
    ...extra,
  };
}

describe('GymQuestionService', () => {
  describe('a insignia precisa ter desafio', () => {
    it('recusa insignia que nao existe na trilha', async () => {
      const { service } = makeService();

      await expect(service.create('inventada', dto())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('recusa a Elite Four e a Battle Frontier', async () => {
      // A insignia existe na trilha e **nao tem GYM Challenge** (ponto Q.2).
      // Sem esta recusa, o admin cadastraria 90 questoes para uma insignia que
      // nenhuma tela de desafio lista, e ninguem descobriria ate ele perguntar
      // por que o card nao aparece.
      const { service } = makeService();

      await expect(service.create('final-gcp', dto())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('aceita as oito insignias do GYM Battle', async () => {
      const { service } = makeService();

      await expect(service.create('nestjs', dto())).resolves.toMatchObject({
        badgeId: 'nestjs',
      });
    });
  });

  describe('o teto por dificuldade', () => {
    it('recusa a questao alem do teto do nivel', async () => {
      const { service, repository } = makeService();
      await repository.createMany(
        Array.from({ length: MAX_QUESTIONS_PER_DIFFICULTY }, () => ({
          badgeId: 'logica' as const,
          difficulty: 'easy' as const,
          question: 'Enunciado qualquer, com mais de dez caracteres',
          alternatives: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
        })),
      );

      await expect(service.create('logica', dto())).rejects.toThrow(
        ConflictException,
      );
    });

    it('o teto e por nivel, e nao por insignia', async () => {
      // 33 faceis nao impedem a primeira dificil. O teto de 99 por insignia e
      // consequencia de tres tetos de 33, e nao um limite proprio.
      const { service, repository } = makeService();
      await repository.createMany(
        Array.from({ length: MAX_QUESTIONS_PER_DIFFICULTY }, () => ({
          badgeId: 'logica' as const,
          difficulty: 'easy' as const,
          question: 'Enunciado qualquer, com mais de dez caracteres',
          alternatives: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
        })),
      );

      await expect(
        service.create('logica', dto({ difficulty: 'hard' })),
      ).resolves.toMatchObject({ difficulty: 'hard' });
    });

    it('o teto de uma insignia nao afeta a outra', async () => {
      const { service, repository } = makeService();
      await repository.createMany(
        Array.from({ length: MAX_QUESTIONS_PER_DIFFICULTY }, () => ({
          badgeId: 'logica' as const,
          difficulty: 'easy' as const,
          question: 'Enunciado qualquer, com mais de dez caracteres',
          alternatives: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
        })),
      );

      await expect(service.create('poo', dto())).resolves.toMatchObject({
        badgeId: 'poo',
      });
    });
  });

  describe('createMany', () => {
    it('recusa o lote inteiro quando ele estoura o teto', async () => {
      // **Tudo ou nada.** Gravar as que cabem e descartar o resto deixaria o
      // admin com um rascunho parcialmente salvo e nenhuma forma de saber
      // quais entraram.
      const { service, repository } = makeService();
      await repository.createMany(
        Array.from({ length: MAX_QUESTIONS_PER_DIFFICULTY - 1 }, () => ({
          badgeId: 'logica' as const,
          difficulty: 'medium' as const,
          question: 'Enunciado qualquer, com mais de dez caracteres',
          alternatives: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
        })),
      );

      await expect(
        service.createMany('logica', [
          dto({ difficulty: 'medium' }),
          dto({ difficulty: 'medium' }),
        ]),
      ).rejects.toThrow(ConflictException);
    });

    it('conta os niveis do lote separadamente', async () => {
      const { service } = makeService();

      const entries = await service.createMany('logica', [
        dto({ difficulty: 'easy' }),
        dto({ difficulty: 'medium' }),
        dto({ difficulty: 'hard' }),
      ]);

      expect(entries).toHaveLength(3);
    });

    it('recusa lote vazio', async () => {
      const { service } = makeService();

      await expect(service.createMany('logica', [])).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('countByDifficulty', () => {
    it('devolve os tres niveis e o total, com ready falso abaixo do minimo', async () => {
      const { service, repository } = makeService();
      await repository.createMany([
        { ...dtoData('easy'), badgeId: 'logica' },
        { ...dtoData('easy'), badgeId: 'logica' },
      ]);

      await expect(service.counts('logica')).resolves.toEqual({
        easy: 2,
        medium: 0,
        hard: 0,
        total: 2,
        ready: false,
      });
    });

    it('ready so vira true com os tres niveis no minimo', async () => {
      // Noventa no total nao basta: 90 faceis e zero dificeis nao montam uma
      // rodada 3. O `ready` olha os tres, e nao a soma.
      const { service, repository } = makeService();
      await repository.createMany([
        ...Array.from({ length: 30 }, () => ({
          ...dtoData('easy'),
          badgeId: 'logica' as const,
        })),
        ...Array.from({ length: 30 }, () => ({
          ...dtoData('medium'),
          badgeId: 'logica' as const,
        })),
        ...Array.from({ length: 29 }, () => ({
          ...dtoData('hard'),
          badgeId: 'logica' as const,
        })),
      ]);

      await expect(service.counts('logica')).resolves.toMatchObject({
        total: 89,
        ready: false,
      });

      await service.create('logica', dto({ difficulty: 'hard' }));

      await expect(service.counts('logica')).resolves.toMatchObject({
        total: 90,
        ready: true,
      });
    });
  });

  describe('update e delete', () => {
    it('recusa editar questao de outra insignia', async () => {
      // O `badgeId` esta no caminho da rota. Sem esta conferencia, um id colado
      // na URL errada editaria a questao de outra insignia com 200.
      const { service } = makeService();
      const criada = await service.create('poo', dto());

      await expect(
        service.update('logica', criada.id, { correctIndex: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('recusa correctIndex que aponta para fora das alternativas', async () => {
      // O DTO ja limita a 0-3. Esta e a validacao cruzada que ele **nao** pode
      // fazer: ela precisa do valor atual do campo que nao foi enviado.
      const { service } = makeService();
      const criada = await service.create('logica', dto());

      await expect(
        service.update('logica', criada.id, {
          alternatives: ['a', 'b', 'c', 'd'],
          correctIndex: 3,
        }),
      ).resolves.toMatchObject({ correctIndex: 3 });
    });

    it('apaga a questao da insignia certa', async () => {
      const { service } = makeService();
      const criada = await service.create('logica', dto());

      await expect(
        service.remove('logica', criada.id),
      ).resolves.toBeUndefined();
      await expect(service.remove('logica', criada.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

function dtoData(difficulty: 'easy' | 'medium' | 'hard') {
  return {
    difficulty,
    question: 'Enunciado qualquer, com mais de dez caracteres',
    alternatives: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
  };
}
