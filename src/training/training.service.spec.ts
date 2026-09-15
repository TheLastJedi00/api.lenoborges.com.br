import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Timestamp } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import { FakeFirestore } from '../track/testing/fake-firestore';
import { ProfileRepository } from '../profile/profile.repository';
import { RankingRepository } from '../games/ranking.repository';
import { TrainingRepository } from './training.repository';
import { TrainingCommentRepository } from './training-comment.repository';
import { TrainingCompletionRepository } from './training-completion.repository';
import { TrainingService } from './training.service';
import { TierId } from '../billing/billing.tiers';
import { StorageService } from '../storage/storage.service';

/**
 * Duble do Storage. O bucket nao entra nesta spec -- quem cobre o
 * `StorageService` de verdade e `storage.service.spec.ts`, com o duble
 * de bucket dele. Aqui o que interessa e **quem chama o que, e em que ordem**: se
 * o tier foi conferido antes do upload, e se a URL foi validada antes de gravar a
 * conclusao.
 *
 * O `isOwnUrl` imita o de verdade em vez de devolver `true`: o teste
 * da URL de outro membro precisa que ele reprove de fato.
 */
function storageDouble() {
  return {
    upload: jest.fn((path: string) =>
      Promise.resolve(
        `https://storage.googleapis.com/b/${path}?v=1757000000000`,
      ),
    ),
    remove: jest.fn(() => Promise.resolve()),
    isOwnUrl: jest.fn(
      (url: string, path: string) =>
        url === `https://storage.googleapis.com/b/${path}?v=1757000000000`,
    ),
  } as unknown as StorageService;
}

/**
 * Contra o `fake-firestore`, e não contra mocks de repositório.
 *
 * A propriedade que esta spec inteira existe para garantir -- **concluir duas
 * vezes não paga XP duas vezes** -- não é verificável com `jest.fn()`. Um mock
 * prova que `batch.create` foi chamado; não prova que a segunda chamada falhou,
 * que o incremento não aconteceu **por causa dela**, e que o `xp` final bate.
 * É a mesma razão pela qual a spec 019 escreveu o fake.
 */
describe('TrainingService', () => {
  let firestore: FakeFirestore;
  let service: TrainingService;
  let ranking: RankingRepository;

  const firebase = () => ({ firestore }) as unknown as FirebaseService;

  beforeEach(() => {
    firestore = new FakeFirestore();
    ranking = new RankingRepository(firebase());

    service = new TrainingService(
      new TrainingRepository(firebase()),
      new TrainingCommentRepository(firebase()),
      new TrainingCompletionRepository(firebase()),
      new ProfileRepository(firebase()),
      ranking,
      firebase(),
      storageDouble(),
    );
  });

  /** Um perfil com tier, nome e XP — o que as três regras deste service leem. */
  function semearPerfil(
    uid: string,
    {
      tier = 'great-dev-tier',
      name = 'Ana Prado',
      xp = 0,
    }: { tier?: TierId; name?: string; xp?: number } = {},
  ) {
    firestore.docs.set(`profiles/${uid}`, {
      name,
      tier,
      xp,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  async function criarTreinamento(
    titulo = 'Refatore o laço',
    {
      badgeId = 'logica',
      xpAmount = 30,
      position = 0,
      hints = ['Dica uma', 'Dica duas'],
    } = {},
  ) {
    return service.createTraining(badgeId, {
      title: titulo,
      description: 'Descrição do desafio',
      objective: 'Objetivo do desafio',
      hints,
      xpAmount,
      ...(position ? {} : {}),
    });
  }

  describe('listByBadge', () => {
    it('recusa uma insígnia que não existe na trilha', async () => {
      await expect(service.listByBadge('u1', 'nao-existe')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('devolve lista vazia com sucesso: insígnia sem desafio é normal', async () => {
      await expect(service.listByBadge('u1', 'logica')).resolves.toEqual({
        badgeId: 'logica',
        trainings: [],
      });
    });

    it('devolve os desafios na ordem, com `completed` de quem pediu', async () => {
      semearPerfil('ana');
      const primeiro = await criarTreinamento('Primeiro');
      await criarTreinamento('Segundo');

      await service.complete('ana', primeiro.id);

      const { trainings } = await service.listByBadge('ana', 'logica');

      expect(trainings.map((item) => item.title)).toEqual([
        'Primeiro',
        'Segundo',
      ]);
      expect(trainings.map((item) => item.completed)).toEqual([true, false]);
    });

    /**
     * O `completed` é de **quem pediu**, e não do desafio.
     *
     * É o único campo da resposta que muda de membro para membro. Um cache
     * colocado sem olhar isto serve o check de uma pessoa para outra sem falhar
     * em nada -- e é por isso que existe um teste com dois membros.
     */
    it('não serve o check de um membro para outro', async () => {
      semearPerfil('ana');
      semearPerfil('beto');
      const treinamento = await criarTreinamento('Primeiro');

      await service.complete('ana', treinamento.id);

      const daAna = await service.listByBadge('ana', 'logica');
      const doBeto = await service.listByBadge('beto', 'logica');

      expect(daAna.trainings[0].completed).toBe(true);
      expect(doBeto.trainings[0].completed).toBe(false);
    });
  });

  describe('complete', () => {
    it('recusa um treinamento que não existe', async () => {
      semearPerfil('ana');

      await expect(service.complete('ana', 'fantasma')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('paga o XP do desafio e devolve o total do servidor', async () => {
      semearPerfil('ana', { xp: 100 });
      const treinamento = await criarTreinamento('Primeiro', { xpAmount: 30 });

      const resultado = await service.complete('ana', treinamento.id);

      expect(resultado).toEqual({
        trainingId: treinamento.id,
        completed: true,
        xpAwarded: 30,
        xp: 130,
      });
    });

    it('paga o valor do desafio, e não a constante padrão', async () => {
      semearPerfil('ana');
      const treinamento = await criarTreinamento('Longo', { xpAmount: 80 });

      expect((await service.complete('ana', treinamento.id)).xp).toBe(80);
    });

    /**
     * **O teste que a decisão 3 existe para garantir.**
     *
     * A segunda conclusão é idempotente: responde sucesso, paga zero, e o `xp`
     * do perfil **não se move**. Quem impede o segundo pagamento não é um `if`
     * antes da escrita -- é o `ALREADY_EXISTS` do `create()` derrubando o lote
     * inteiro, e com ele o incremento que ia junto. Sem transação, sem leitura
     * prévia e sem janela entre conferir e escrever.
     */
    it('concluir de novo não duplica XP, e responde sucesso', async () => {
      semearPerfil('ana');
      const treinamento = await criarTreinamento('Primeiro', { xpAmount: 30 });

      await service.complete('ana', treinamento.id);
      const segunda = await service.complete('ana', treinamento.id);

      expect(segunda.completed).toBe(true);
      expect(segunda.xpAwarded).toBe(0);
      expect(segunda.xp).toBe(30);
    });

    it('o dobro clique não move o perfil além do primeiro pagamento', async () => {
      semearPerfil('ana');
      const treinamento = await criarTreinamento('Primeiro', { xpAmount: 30 });

      await service.complete('ana', treinamento.id);
      await service.complete('ana', treinamento.id);
      await service.complete('ana', treinamento.id);

      expect(firestore.raw('profiles/ana')?.xp).toBe(30);
    });

    /**
     * **O custo das dicas** (spec 025, decisão 2).
     *
     * Cada dica revelada desconta 1 do prêmio do desafio, e não do saldo do
     * membro: debitar do saldo global deixaria o XP andar para trás -- e, num
     * membro novo, negativo -- por ter pedido ajuda.
     */
    describe('o desconto das dicas reveladas', () => {
      it('sem dica revelada, paga o prêmio cheio', async () => {
        semearPerfil('ana');
        const treinamento = await criarTreinamento('Primeiro', {
          xpAmount: 30,
        });

        const resultado = await service.complete('ana', treinamento.id, {
          hintsUsed: 0,
        });

        expect(resultado.xpAwarded).toBe(30);
        expect(resultado.xp).toBe(30);
      });

      it('desconta 1 XP por dica revelada', async () => {
        semearPerfil('ana');
        const treinamento = await criarTreinamento('Primeiro', {
          xpAmount: 30,
          hints: ['Uma', 'Duas', 'Três'],
        });

        const resultado = await service.complete('ana', treinamento.id, {
          hintsUsed: 2,
        });

        expect(resultado.xpAwarded).toBe(28);
        expect(resultado.xp).toBe(28);
      });

      /**
       * **O teto é o número de dicas, e é a única desonestidade que dá para
       * barrar.** O servidor não sabe quantas dicas foram realmente abertas --
       * quem quiser trapacear manda zero e leva o prêmio cheio, e isso é
       * aceito. O que o `Math.min` impede é o contrário: um número absurdo
       * levando o cálculo para longe do desafio real.
       */
      it('corta o `hintsUsed` no número de dicas do desafio', async () => {
        semearPerfil('ana');
        const treinamento = await criarTreinamento('Primeiro', {
          xpAmount: 30,
          hints: ['Uma', 'Duas'],
        });

        const resultado = await service.complete('ana', treinamento.id, {
          hintsUsed: 999,
        });

        expect(resultado.xpAwarded).toBe(28);
      });

      /** O `Math.max(0, ...)` impede o XP negativo. */
      it('nunca paga menos que zero, nem quando as dicas valem mais que o prêmio', async () => {
        semearPerfil('ana');
        const treinamento = await criarTreinamento('Barato', {
          xpAmount: 2,
          hints: ['Uma', 'Duas', 'Três', 'Quatro', 'Cinco'],
        });

        const resultado = await service.complete('ana', treinamento.id, {
          hintsUsed: 5,
        });

        expect(resultado.xpAwarded).toBe(0);
        expect(resultado.xp).toBe(0);
      });

      it('grava na conclusão quantas dicas foram cobradas', async () => {
        semearPerfil('ana');
        const treinamento = await criarTreinamento('Primeiro', {
          xpAmount: 30,
          hints: ['Uma', 'Duas'],
        });

        await service.complete('ana', treinamento.id, { hintsUsed: 999 });

        expect(
          firestore.raw(`training_completions/ana__${treinamento.id}`)
            ?.hintsUsed,
        ).toBe(2);
      });

      /**
       * **A segunda chamada não escreve nada, nem com outro `hintsUsed`.**
       *
       * Quem impede o segundo pagamento continua sendo o `ALREADY_EXISTS` do
       * caminho, e não o campo novo: mandar `0` na segunda tentativa não
       * reabre o pagamento nem reescreve o que ficou registrado na primeira.
       */
      it('a segunda conclusão paga zero e não reescreve as dicas da primeira', async () => {
        semearPerfil('ana');
        const treinamento = await criarTreinamento('Primeiro', {
          xpAmount: 30,
          hints: ['Uma', 'Duas'],
        });

        await service.complete('ana', treinamento.id, { hintsUsed: 2 });
        const segunda = await service.complete('ana', treinamento.id, {
          hintsUsed: 0,
        });

        expect(segunda.xpAwarded).toBe(0);
        expect(segunda.xp).toBe(28);
        expect(
          firestore.raw(`training_completions/ana__${treinamento.id}`)
            ?.hintsUsed,
        ).toBe(2);
      });

      /** O `hintsUsed` ausente é zero: é o que a tela anterior à spec fazia. */
      it('sem o argumento, paga o prêmio cheio', async () => {
        semearPerfil('ana');
        const treinamento = await criarTreinamento('Primeiro', {
          xpAmount: 30,
        });

        expect((await service.complete('ana', treinamento.id)).xpAwarded).toBe(
          30,
        );
      });
    });

    /**
     * **A mesma idempotência, no transporte que produção usa.**
     *
     * Os dois casos acima rodam em gRPC, onde a recusa do `create()` chega como
     * `code: 6`. Produção roda com `preferRest: true` e recebe `code: 409` --
     * e foi o segundo clique em "Concluir Desafio" que expôs isso, em
     * 2026-09-01: a requisição **pendurava**, sem log e sem exceção, com esta
     * suíte verde. Depois de subir o `firebase-admin`, um `catch` que só
     * conhecesse o `6` trocaria o travamento por um `500`.
     *
     * O teste é o mesmo de sempre; o que muda é só o transporte. É essa
     * repetição que trava a regra.
     */
    it('teste-trava: concluir de novo é idempotente também no transporte REST', async () => {
      const rest = new FakeFirestore('rest');
      const firebaseRest = () =>
        ({ firestore: rest }) as unknown as FirebaseService;
      const servicoRest = new TrainingService(
        new TrainingRepository(firebaseRest()),
        new TrainingCommentRepository(firebaseRest()),
        new TrainingCompletionRepository(firebaseRest()),
        new ProfileRepository(firebaseRest()),
        new RankingRepository(firebaseRest()),
        firebaseRest(),
        storageDouble(),
      );
      rest.docs.set('profiles/ana', {
        name: 'Ana Prado',
        tier: 'great-dev-tier',
        xp: 0,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      const treinamento = await servicoRest.createTraining('logica', {
        title: 'Primeiro',
        description: 'Descrição do desafio',
        objective: 'Objetivo do desafio',
        hints: ['Dica uma', 'Dica duas'],
        xpAmount: 30,
      });

      await servicoRest.complete('ana', treinamento.id);
      const segunda = await servicoRest.complete('ana', treinamento.id);

      expect(segunda.completed).toBe(true);
      expect(segunda.xpAwarded).toBe(0);
      expect(segunda.xp).toBe(30);
      expect(rest.raw('profiles/ana')?.xp).toBe(30);
    });

    /**
     * O placar anda **no mesmo lote** que o perfil (spec 022, decisão 11).
     *
     * Duas escritas separadas criariam um XP no ranking que o perfil não tem, e
     * nada depois compararia os dois para descobrir.
     */
    it('soma no ranking de quem já escolheu gamertag', async () => {
      semearPerfil('ana');
      await ranking.upsert({
        uid: 'ana',
        nickname: 'anadev',
        xp: 100,
        badgeCount: 1,
      });
      const treinamento = await criarTreinamento('Primeiro', { xpAmount: 30 });

      await service.complete('ana', treinamento.id);

      expect((await ranking.findByUid('ana')).entry?.xp).toBe(130);
    });

    /**
     * **Quem não tem linha de placar não ganha uma em branco.**
     *
     * Um `increment` sobre documento inexistente o criaria sem `nickname` -- uma
     * linha vazia no ranking de quem a spec 022 mantém fora de propósito.
     */
    it('não cria linha de placar para quem nunca escolheu gamertag', async () => {
      semearPerfil('ana');
      const treinamento = await criarTreinamento('Primeiro');

      await service.complete('ana', treinamento.id);

      expect((await ranking.findByUid('ana')).found).toBe(false);
      expect(firestore.raw('profiles/ana')?.xp).toBe(30);
    });
  });

  describe('addComment', () => {
    it('recusa quem é Dev Tier, com o caminho para assinar', async () => {
      semearPerfil('ana', { tier: 'dev-tier' });
      const treinamento = await criarTreinamento();

      await expect(
        service.addComment('ana', treinamento.id, { content: 'Oi' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a mensagem do 403 diz o que fazer, e não só que não pode', async () => {
      semearPerfil('ana', { tier: 'dev-tier' });
      const treinamento = await criarTreinamento();

      await expect(
        service.addComment('ana', treinamento.id, { content: 'Oi' }),
      ).rejects.toThrow(/Financeiro/i);
    });

    it('aceita Great Tier', async () => {
      semearPerfil('ana', { tier: 'great-dev-tier' });
      const treinamento = await criarTreinamento();

      const comentario = await service.addComment('ana', treinamento.id, {
        content: 'Travei no passo 3',
      });

      expect(comentario.content).toBe('Travei no passo 3');
    });

    it('aceita os tiers acima do Great', async () => {
      semearPerfil('ultra', { tier: 'ultra-dev-tier' });
      semearPerfil('master', { tier: 'master-dev-tier' });
      const treinamento = await criarTreinamento();

      await expect(
        service.addComment('ultra', treinamento.id, { content: 'Oi' }),
      ).resolves.toBeDefined();
      await expect(
        service.addComment('master', treinamento.id, { content: 'Oi' }),
      ).resolves.toBeDefined();
    });

    it('recusa um treinamento que não existe, antes de olhar o tier', async () => {
      semearPerfil('ana');

      await expect(
        service.addComment('ana', 'fantasma', { content: 'Oi' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('recusa quem não tem perfil', async () => {
      const treinamento = await criarTreinamento();

      await expect(
        service.addComment('sem-perfil', treinamento.id, { content: 'Oi' }),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * O nome é **fotografado**, e é o primeiro nome.
     *
     * O nome completo numa lista de comentários vira ruído, e a foto é o que
     * sobrevive a uma troca de nome no perfil: o comentário fica com o nome de
     * quem escreveu naquele dia.
     */
    it('fotografa o primeiro nome de quem escreveu', async () => {
      semearPerfil('ana', { name: 'Ana Prado' });
      const treinamento = await criarTreinamento();

      const comentario = await service.addComment('ana', treinamento.id, {
        content: 'Oi',
      });

      expect(comentario.authorName).toBe('Ana');
    });

    it('não devolve o uid de quem escreveu', async () => {
      semearPerfil('ana');
      const treinamento = await criarTreinamento();

      const comentario = await service.addComment('ana', treinamento.id, {
        content: 'Oi',
      });

      expect(Object.keys(comentario).sort()).toEqual([
        'adminReply',
        'authorName',
        'content',
        'createdAt',
        'id',
        'trainingId',
      ]);
    });

    it('nasce sem resposta do admin', async () => {
      semearPerfil('ana');
      const treinamento = await criarTreinamento();

      const comentario = await service.addComment('ana', treinamento.id, {
        content: 'Oi',
      });

      expect(comentario.adminReply).toBeNull();
    });
  });

  describe('listComments', () => {
    async function comentar(trainingId: string, content: string) {
      const comentario = await service.addComment('ana', trainingId, {
        content,
      });

      // Envelhece um minuto por comentário: três `new Date()` seguidos caem no
      // mesmo milissegundo e o teste passaria a depender da ordem de inserção
      // do fake, que é o que ele deveria estar provando.
      const cru = firestore.raw(`training_comments/${comentario.id}`)!;
      cru.createdAt = Timestamp.fromMillis(
        Date.parse('2026-09-01T12:00:00.000Z') + envelhecimento++ * 60_000,
      );

      return comentario;
    }
    let envelhecimento = 1;

    beforeEach(() => {
      envelhecimento = 1;
      semearPerfil('ana');
    });

    it('recusa um treinamento que não existe', async () => {
      await expect(service.listComments('fantasma', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('devolve os mais recentes primeiro', async () => {
      const treinamento = await criarTreinamento();
      await comentar(treinamento.id, 'Primeiro');
      await comentar(treinamento.id, 'Segundo');

      const { comments } = await service.listComments(treinamento.id, {});

      expect(comments.map((item) => item.content)).toEqual([
        'Segundo',
        'Primeiro',
      ]);
    });

    it('devolve dez por padrão, e o cursor da próxima página', async () => {
      const treinamento = await criarTreinamento();
      for (let i = 1; i <= 12; i += 1) {
        await comentar(treinamento.id, `Comentário ${i}`);
      }

      const primeira = await service.listComments(treinamento.id, {});

      expect(primeira.comments).toHaveLength(10);
      expect(primeira.nextCursor).toBe(primeira.comments[9].id);
    });

    it('não oferece cursor quando a página é a última', async () => {
      const treinamento = await criarTreinamento();
      await comentar(treinamento.id, 'Único');

      expect((await service.listComments(treinamento.id, {})).nextCursor).toBe(
        null,
      );
    });

    it('continua depois do cursor', async () => {
      const treinamento = await criarTreinamento();
      await comentar(treinamento.id, 'Primeiro');
      await comentar(treinamento.id, 'Segundo');

      const primeira = await service.listComments(treinamento.id, { limit: 1 });
      const segunda = await service.listComments(treinamento.id, {
        limit: 1,
        after: primeira.nextCursor!,
      });

      expect(segunda.comments.map((item) => item.content)).toEqual([
        'Primeiro',
      ]);
    });

    /**
     * `?limit=` chega do cliente, e uma listagem sem teto é a coleção inteira à
     * distância de uma query string. Acima do teto o valor é fixado no teto,
     * **sem erro**: é paginação, não pedido de dados.
     */
    it('fixa um limite absurdo no teto, em vez de recusar', async () => {
      const treinamento = await criarTreinamento();
      await comentar(treinamento.id, 'Único');

      await expect(
        service.listComments(treinamento.id, { limit: 5000 }),
      ).resolves.toBeDefined();
    });

    it('recusa um limite que não é número positivo', async () => {
      const treinamento = await criarTreinamento();

      await expect(
        service.listComments(treinamento.id, { limit: 0 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  /**
   * **O teste-trava da exclusão em cascata.**
   *
   * No Firestore nada some junto com o pai. Sem esta limpeza, os comentários e
   * as conclusões do desafio apagado ficam invisíveis, cobrados e impossíveis de
   * encontrar depois -- é o mesmo descuido que já custou quatro coleções órfãs
   * neste projeto, e a única diferença é que desta vez existe um teste que
   * reprova.
   */
  describe('removeTraining', () => {
    beforeEach(() => {
      semearPerfil('ana');
    });

    it('recusa um treinamento que não existe', async () => {
      await expect(service.removeTraining('fantasma')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('apaga os comentários daquele desafio, e só os dele', async () => {
      const alvo = await criarTreinamento('Alvo');
      const vizinho = await criarTreinamento('Vizinho');
      await service.addComment('ana', alvo.id, { content: 'Do alvo' });
      await service.addComment('ana', vizinho.id, { content: 'Do vizinho' });

      await service.removeTraining(alvo.id);

      expect(
        (await service.listComments(vizinho.id, {})).comments,
      ).toHaveLength(1);
      expect(
        [...firestore.docs.keys()].filter((key) =>
          key.startsWith('training_comments/'),
        ),
      ).toHaveLength(1);
    });

    it('apaga as conclusões daquele desafio, e só as dele', async () => {
      const alvo = await criarTreinamento('Alvo');
      const vizinho = await criarTreinamento('Vizinho');
      await service.complete('ana', alvo.id);
      await service.complete('ana', vizinho.id);

      await service.removeTraining(alvo.id);

      expect(
        [...firestore.docs.keys()].filter((key) =>
          key.startsWith('training_completions/'),
        ),
      ).toEqual([`training_completions/ana__${vizinho.id}`]);
    });

    /**
     * **O XP já pago não volta.** A conclusão some com o desafio, mas o
     * incremento não é desfeito: o membro fez o exercício, e uma exclusão
     * administrativa não é motivo para tirar XP de quem trabalhou por ele.
     */
    it('não devolve o XP que o desafio já pagou', async () => {
      const alvo = await criarTreinamento('Alvo', { xpAmount: 30 });
      await service.complete('ana', alvo.id);

      await service.removeTraining(alvo.id);

      expect(firestore.raw('profiles/ana')?.xp).toBe(30);
    });

    it('renormaliza as posições dos que sobraram para 0..n-1', async () => {
      const primeiro = await criarTreinamento('Primeiro');
      await criarTreinamento('Segundo');
      await criarTreinamento('Terceiro');

      await service.removeTraining(primeiro.id);

      const { trainings } = await service.listByBadge('ana', 'logica');

      expect(trainings.map((item) => item.title)).toEqual([
        'Segundo',
        'Terceiro',
      ]);
      expect(trainings.map((item) => item.position)).toEqual([0, 1]);
    });
  });

  describe('reorder', () => {
    beforeEach(() => {
      semearPerfil('ana');
    });

    it('recusa uma lista com id repetido', async () => {
      const primeiro = await criarTreinamento('Primeiro');
      await criarTreinamento('Segundo');

      await expect(
        service.reorder('logica', {
          orderedIds: [primeiro.id, primeiro.id],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa uma lista que não cobre a insígnia inteira', async () => {
      const primeiro = await criarTreinamento('Primeiro');
      await criarTreinamento('Segundo');

      await expect(
        service.reorder('logica', { orderedIds: [primeiro.id] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa um id que não é daquela insígnia', async () => {
      const daLogica = await criarTreinamento('Da lógica');
      const daPoo = await service.createTraining('poo', {
        title: 'Da POO',
        description: 'Descrição',
        objective: 'Objetivo',
        hints: ['Dica'],
      });

      await expect(
        service.reorder('logica', { orderedIds: [daLogica.id, daPoo.id] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('grava a ordem nova quando a lista bate', async () => {
      const primeiro = await criarTreinamento('Primeiro');
      const segundo = await criarTreinamento('Segundo');

      await service.reorder('logica', {
        orderedIds: [segundo.id, primeiro.id],
      });

      const { trainings } = await service.listByBadge('ana', 'logica');

      expect(trainings.map((item) => item.title)).toEqual([
        'Segundo',
        'Primeiro',
      ]);
    });
  });

  describe('submissao na Arena (spec 027)', () => {
    const PNG = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    const TEXTO = Buffer.from('nao sou imagem nenhuma, nem de longe');

    function arquivo(buffer: Buffer, mimetype = 'image/png') {
      return { buffer, mimetype, size: buffer.length } as Express.Multer.File;
    }

    /** A URL que o duble cunha para aquele caminho. */
    function urlDe(uid: string, trainingId: string) {
      return `https://storage.googleapis.com/b/trainings/${uid}/${trainingId}?v=1757000000000`;
    }

    describe('uploadResultImage', () => {
      it('sobe a foto do Great Dev e devolve a URL', async () => {
        semearPerfil('ana', { tier: 'great-dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');

        const url = await service.uploadResultImage(
          'ana',
          treinamento.id,
          arquivo(PNG),
        );

        expect(url).toBe(urlDe('ana', treinamento.id));
      });

      it('teste-trava: o Dev Tier leva 403 antes de o arquivo entrar no bucket', async () => {
        // A ordem e a decisao (spec 027, decisao 2). Validar depois deixaria no
        // Storage a foto de quem nao tinha direito de manda-la -- cobrada, publica
        // e sem nada apontando para ela -- para responder 403 em seguida.
        semearPerfil('ana', { tier: 'dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');

        await expect(
          service.uploadResultImage('ana', treinamento.id, arquivo(PNG)),
        ).rejects.toThrow(ForbiddenException);
      });

      it('a recusa por tier diz o que fazer', async () => {
        semearPerfil('ana', { tier: 'dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');

        await expect(
          service.uploadResultImage('ana', treinamento.id, arquivo(PNG)),
        ).rejects.toThrow(/Great Dev Tier para cima.*Financeiro/s);
      });

      it('confere o treinamento antes de aceitar o arquivo', async () => {
        // Mesma razao da spec 019: o trainingId vem da URL e e escolhido pelo
        // cliente, e uma rota que grava a partir de string do cliente grava a
        // partir de qualquer string.
        semearPerfil('ana', { tier: 'great-dev-tier' });

        await expect(
          service.uploadResultImage('ana', 'fantasma', arquivo(PNG)),
        ).rejects.toThrow(NotFoundException);
      });

      it('recusa o que nao e imagem, mesmo se o mimetype disser que e', async () => {
        semearPerfil('ana', { tier: 'great-dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');

        await expect(
          service.uploadResultImage(
            'ana',
            treinamento.id,
            arquivo(TEXTO, 'image/png'),
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('recusa arquivo acima do teto', async () => {
        semearPerfil('ana', { tier: 'great-dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');

        await expect(
          service.uploadResultImage('ana', treinamento.id, {
            buffer: PNG,
            mimetype: 'image/png',
            size: 6 * 1024 * 1024,
          } as Express.Multer.File),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('complete com submissao', () => {
      it('o Dev Tier manda o codigo e recebe o XP', async () => {
        semearPerfil('ana', { tier: 'dev-tier' });
        const treinamento = await criarTreinamento('Primeiro', {
          xpAmount: 30,
        });

        const resultado = await service.complete('ana', treinamento.id, {
          mainCode: 'public static void main(String[] a) {}',
        });

        expect(resultado.xpAwarded).toBe(30);
        expect(
          firestore.raw(`training_completions/ana__${treinamento.id}`)
            ?.mainCode,
        ).toBe('public static void main(String[] a) {}');
      });

      it('teste-trava: o Dev Tier com resultImageUrl e 403, e nada e escrito', async () => {
        // A rota de upload ja barrou o tier, mas ela e o complete sao duas
        // chamadas: sem esta conferencia, o Dev Tier leva 403 no upload e manda uma
        // URL qualquer aqui. E o XP nao pode ser pago numa chamada que falhou.
        semearPerfil('ana', { tier: 'dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');

        await expect(
          service.complete('ana', treinamento.id, {
            resultImageUrl: urlDe('ana', treinamento.id),
          }),
        ).rejects.toThrow(ForbiddenException);

        expect(
          firestore.raw(`training_completions/ana__${treinamento.id}`),
        ).toBeUndefined();
        expect(firestore.raw('profiles/ana')?.xp).toBe(0);
      });

      it('o Great Dev grava os dois campos', async () => {
        semearPerfil('ana', { tier: 'great-dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');

        await service.complete('ana', treinamento.id, {
          mainCode: 'codigo',
          resultImageUrl: urlDe('ana', treinamento.id),
        });

        const gravado = firestore.raw(
          `training_completions/ana__${treinamento.id}`,
        );
        expect(gravado?.mainCode).toBe('codigo');
        expect(gravado?.resultImageUrl).toBe(urlDe('ana', treinamento.id));
      });

      it('teste-trava: URL de host de fora e 400', async () => {
        semearPerfil('ana', { tier: 'great-dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');

        await expect(
          service.complete('ana', treinamento.id, {
            resultImageUrl: 'https://evil.com/foto.png',
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('teste-trava: a foto de outro membro e 400', async () => {
        // O caminho leva o uid justamente para esta comparacao ser possivel sem
        // consultar nada. Sem ela, a prova de um membro entra como prova de outro.
        semearPerfil('ana', { tier: 'great-dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');

        await expect(
          service.complete('ana', treinamento.id, {
            resultImageUrl: urlDe('bruno', treinamento.id),
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('teste-trava: a foto de outro desafio do mesmo membro e 400', async () => {
        semearPerfil('ana', { tier: 'great-dev-tier' });
        const alvo = await criarTreinamento('Alvo');
        const outro = await criarTreinamento('Outro');

        await expect(
          service.complete('ana', alvo.id, {
            resultImageUrl: urlDe('ana', outro.id),
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('corpo vazio continua concluindo e pagando o premio cheio', async () => {
        // A janela entre os dois deploys: a tela anterior a esta spec manda {}.
        semearPerfil('ana', { tier: 'dev-tier' });
        const treinamento = await criarTreinamento('Primeiro', {
          xpAmount: 30,
        });

        const resultado = await service.complete('ana', treinamento.id, {});

        expect(resultado.xpAwarded).toBe(30);
        const gravado = firestore.raw(
          `training_completions/ana__${treinamento.id}`,
        );
        expect(gravado?.mainCode).toBeNull();
        expect(gravado?.resultImageUrl).toBeNull();
      });

      it('codigo so de espacos e gravado como null, e nao como espacos', async () => {
        semearPerfil('ana', { tier: 'dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');

        await service.complete('ana', treinamento.id, { mainCode: '   ' });

        expect(
          firestore.raw(`training_completions/ana__${treinamento.id}`)
            ?.mainCode,
        ).toBeNull();
      });

      it('getOne devolve a submissao de quem pediu', async () => {
        semearPerfil('ana', { tier: 'great-dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');
        await service.complete('ana', treinamento.id, {
          mainCode: 'o que a ana entregou',
          resultImageUrl: urlDe('ana', treinamento.id),
        });

        const lido = await service.getOne('ana', treinamento.id);

        expect(lido.submission).toEqual({
          mainCode: 'o que a ana entregou',
          resultImageUrl: urlDe('ana', treinamento.id),
        });
      });

      it('getOne devolve submission nula para quem nao concluiu', async () => {
        semearPerfil('ana');
        const treinamento = await criarTreinamento('Primeiro');

        const lido = await service.getOne('ana', treinamento.id);

        expect(lido.completed).toBe(false);
        expect(lido.submission).toBeNull();
      });

      it('teste-trava: a listagem nao carrega o codigo', async () => {
        // Um mainCode de 20000 caracteres por desafio numa lista de vinte seria o
        // corpo de uma tela inteira para desenhar cartoes que nao mostram codigo.
        semearPerfil('ana', { tier: 'dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');
        await service.complete('ana', treinamento.id, {
          mainCode: 'x'.repeat(20000),
        });

        const lista = await service.listByBadge('ana', treinamento.badgeId);

        expect(lista.trainings[0].completed).toBe(true);
        expect(lista.trainings[0].submission).toBeUndefined();
      });

      it('teste-trava: a submissao de um membro nao vaza para outro', async () => {
        semearPerfil('ana', { tier: 'dev-tier' });
        semearPerfil('bruno', { tier: 'dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');
        await service.complete('ana', treinamento.id, {
          mainCode: 'segredo da ana',
        });

        const comoBruno = await service.getOne('bruno', treinamento.id);

        expect(comoBruno.completed).toBe(false);
        expect(comoBruno.submission).toBeNull();
      });

      it('teste-trava: a segunda conclusao nao reescreve a submissao', async () => {
        // Concluir de novo nao escreve nada -- o ALREADY_EXISTS derruba o lote --,
        // entao a submissao gravada e a da primeira chamada. Nao existe reenviar a
        // resposta, e e isso que a tela nao deve oferecer.
        semearPerfil('ana', { tier: 'great-dev-tier' });
        const treinamento = await criarTreinamento('Primeiro');

        await service.complete('ana', treinamento.id, {
          mainCode: 'primeira versao',
        });
        const segunda = await service.complete('ana', treinamento.id, {
          mainCode: 'segunda versao',
        });

        expect(segunda.xpAwarded).toBe(0);
        expect(
          firestore.raw(`training_completions/ana__${treinamento.id}`)
            ?.mainCode,
        ).toBe('primeira versao');
      });
    });
  });
});
