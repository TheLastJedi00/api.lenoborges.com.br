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
    { badgeId = 'logica', xpAmount = 30, position = 0 } = {},
  ) {
    return service.createTraining(badgeId, {
      title: titulo,
      description: 'Descrição do desafio',
      steps: ['Passo um', 'Passo dois'],
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
        steps: ['Passo um', 'Passo dois'],
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
        steps: ['Passo'],
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
});
