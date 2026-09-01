import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import {
  PROFILE_COLLECTION,
  ProfileRepository,
} from '../profile/profile.repository';
import { RankingRepository } from '../games/ranking.repository';
import { BadgeId, isBadgeId } from '../track/track.constants';
import { isAlreadyExists } from '../waitlist/waitlist.repository';
import { Training } from './entities/training.entity';
import { TrainingComment } from './entities/training-comment.entity';
import { TrainingRepository } from './training.repository';
import { TrainingCommentRepository } from './training-comment.repository';
import { TrainingCompletionRepository } from './training-completion.repository';
import { CreateTrainingDto } from './dto/create-training.dto';
import { UpdateTrainingDto } from './dto/update-training.dto';
import { CreateTrainingCommentDto } from './dto/create-comment.dto';
import { ReorderTrainingsDto } from './dto/reorder-trainings.dto';
import {
  AdminTrainingCommentListDto,
  TrainingCommentDto,
  TrainingCommentListDto,
  TrainingCompletionDto,
  TrainingDto,
  TrainingListDto,
} from './dto/training.dto';
import {
  TRAINING_COMMENTS_MAX_PAGE_SIZE,
  TRAINING_COMMENTS_PAGE_SIZE,
  TRAINING_RECENT_COMMENTS_PAGE_SIZE,
} from './training.constants';

export interface ListCommentsQuery {
  limit?: number;
  after?: string;
}

/**
 * A Arena de Treinamento (spec 023).
 *
 * Três regras moram aqui e em nenhum outro lugar: **o XP é pago uma vez por
 * desafio**, **comentar exige tier pago**, e **excluir um treinamento leva
 * junto o que pendurou nele**.
 */
@Injectable()
export class TrainingService {
  constructor(
    private readonly trainings: TrainingRepository,
    private readonly comments: TrainingCommentRepository,
    private readonly completions: TrainingCompletionRepository,
    private readonly profiles: ProfileRepository,
    private readonly ranking: RankingRepository,
    private readonly firebase: FirebaseService,
  ) {}

  /**
   * Os desafios da insígnia, já na ordem, com o `completed` **de quem pediu**.
   */
  async listByBadge(uid: string, badgeId: string): Promise<TrainingListDto> {
    const badge = this.assertBadge(badgeId);

    const { entries } = await this.trainings.listByBadge(badge);
    const completed = await this.completions.findCompletedIds(
      uid,
      entries.map((training) => training.id),
    );

    return {
      badgeId: badge,
      trainings: entries.map((training) =>
        this.toDto(training, completed.has(training.id)),
      ),
    };
  }

  async getOne(uid: string, trainingId: string): Promise<TrainingDto> {
    const training = await this.assertTraining(trainingId);
    const { found } = await this.completions.findById(uid, trainingId);

    return this.toDto(training, found);
  }

  /**
   * Conclui o desafio e paga o XP -- **no máximo uma vez, para sempre**.
   *
   * O lote leva três escritas: a prova da conclusão, o incremento no perfil e a
   * linha do placar. **Ou entram as três ou nenhuma**, e é a atomicidade que faz
   * o trabalho da trava: o `create()` da conclusão recusa caminho ocupado com
   * `ALREADY_EXISTS` e derruba o lote inteiro, levando o incremento junto. Sem
   * transação, sem leitura prévia e sem janela entre conferir e escrever.
   *
   * A segunda chamada é **idempotente e responde sucesso**: o desafio está
   * concluído, que é o que quem clicou queria. `xpAwarded: 0` diz que esta
   * chamada não pagou nada, e o `xp` devolvido continua sendo o do servidor --
   * a tela pinta este número em vez de somar localmente.
   */
  async complete(
    uid: string,
    trainingId: string,
  ): Promise<TrainingCompletionDto> {
    const training = await this.assertTraining(trainingId);

    // A linha do placar é lida **antes** do lote. O `addXpToBatch` não usa
    // `FieldValue.increment` de propósito: um increment sobre documento
    // inexistente criaria uma linha de ranking sem `nickname`, de quem nunca
    // escolheu gamertag -- exatamente quem a spec 022 mantém fora.
    const rankingRow = await this.ranking.findByUid(uid);

    const batch = this.firebase.firestore.batch();
    const now = new Date();

    this.completions.create(batch, {
      uid,
      trainingId,
      xpAwarded: training.xpAmount,
      now,
    });
    batch.update(this.profileDoc(uid), {
      xp: FieldValue.increment(training.xpAmount),
      updatedAt: Timestamp.fromDate(now),
    });
    this.ranking.addXpToBatch(
      batch,
      uid,
      rankingRow.found,
      training.xpAmount,
      rankingRow.entry?.xp ?? 0,
    );

    try {
      await batch.commit();

      return {
        trainingId,
        completed: true,
        xpAwarded: training.xpAmount,
        xp: await this.xpOf(uid),
      };
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }

      return {
        trainingId,
        completed: true,
        xpAwarded: 0,
        xp: await this.xpOf(uid),
      };
    }
  }

  async listComments(
    trainingId: string,
    query: ListCommentsQuery,
  ): Promise<TrainingCommentListDto> {
    await this.assertTraining(trainingId);

    const limit = this.resolveLimit(query.limit);
    const { entries } = await this.comments.listByTraining(trainingId, {
      limit,
      after: query.after,
    });

    return {
      comments: entries.map((comment) => toCommentDto(comment)),
      // Só oferece cursor quando a página encheu. Página incompleta é a última,
      // e um "Mostrar mais" que devolve vazio é um botão que mente.
      nextCursor:
        entries.length === limit ? entries[entries.length - 1].id : null,
    };
  }

  /**
   * Comenta num desafio. **Só Great Tier ou superior** (decisão 2).
   *
   * A ordem das conferências importa: o treinamento primeiro, o perfil depois.
   * Um `404` de desafio inexistente não pode depender do tier de quem pediu --
   * senão a mesma URL errada responde `403` para uns e `404` para outros, e quem
   * for depurar isso persegue um problema de permissão que não existe.
   */
  async addComment(
    uid: string,
    trainingId: string,
    dto: CreateTrainingCommentDto,
  ): Promise<TrainingCommentDto> {
    await this.assertTraining(trainingId);

    const profile = await this.profiles.findById(uid);
    if (!profile.found || !profile.entry) {
      throw new NotFoundException('Perfil não encontrado.');
    }

    // O portão. A mensagem diz o que fazer, e não só que não pode: um 403 sem
    // caminho de saída é a forma mais cara de perder um upgrade. Mesma decisão
    // do Mural, mesma frase final.
    if (profile.entry.tier === 'dev-tier') {
      throw new ForbiddenException(
        'Comentar na Arena de Treinamento é do Great Tier para cima. Veja o Financeiro para assinar.',
      );
    }

    const { entry } = await this.comments.create({
      trainingId,
      uid,
      authorName: firstName(profile.entry.name),
      content: dto.content,
    });

    return toCommentDto(entry);
  }

  async listByBadgeForAdmin(badgeId: string): Promise<TrainingListDto> {
    const badge = this.assertBadge(badgeId);
    const { entries } = await this.trainings.listByBadge(badge);

    // O `completed` do próprio admin não tem uso nesta tela, e `false` é a
    // verdade dela: o painel não desenha check. Um ramo separado só para isso
    // seria um caminho a mais para envelhecer sozinho.
    return {
      badgeId: badge,
      trainings: entries.map((training) => this.toDto(training, false)),
    };
  }

  /**
   * Cria o desafio **no fim da lista** da insígnia.
   *
   * A posição é calculada aqui, e não recebida: uma posição vinda do cliente
   * colide com a de outro item, e a lista passa a ter dois `position: 3` -- o
   * estado exato que a renormalização existe para nunca deixar acontecer.
   */
  async createTraining(
    badgeId: string,
    dto: CreateTrainingDto,
  ): Promise<TrainingDto> {
    const badge = this.assertBadge(badgeId);
    const { entries } = await this.trainings.listByBadge(badge);

    const { entry } = await this.trainings.create({
      badgeId: badge,
      title: dto.title,
      description: dto.description,
      steps: dto.steps,
      videoUrl: dto.videoUrl ?? null,
      xpAmount: dto.xpAmount,
      position: entries.length,
    });

    return this.toDto(entry, false);
  }

  /**
   * Edita o desafio.
   *
   * Os campos entram um a um, e não por spread: `undefined` num `update` do
   * Firestore é erro, e um DTO parcial tem `undefined` em tudo o que o admin
   * não mexeu.
   */
  async updateTraining(
    trainingId: string,
    dto: UpdateTrainingDto,
  ): Promise<TrainingDto> {
    await this.assertTraining(trainingId);

    const { entry } = await this.trainings.update(trainingId, {
      ...(dto.title === undefined ? {} : { title: dto.title }),
      ...(dto.description === undefined
        ? {}
        : { description: dto.description }),
      ...(dto.steps === undefined ? {} : { steps: dto.steps }),
      ...(dto.videoUrl === undefined ? {} : { videoUrl: dto.videoUrl }),
      ...(dto.xpAmount === undefined ? {} : { xpAmount: dto.xpAmount }),
      ...(dto.position === undefined ? {} : { position: dto.position }),
    });

    return this.toDto(entry!, false);
  }

  /**
   * Exclui o desafio **e o que pendurou nele**: comentários e conclusões.
   *
   * No Firestore nada some junto com o pai. Sem esta limpeza, os comentários e
   * as conclusões do desafio apagado ficam invisíveis, cobrados e impossíveis de
   * encontrar depois -- a mesma armadilha dos votos do Mural, de
   * `notification_reads`, de `legal_acceptances` e de `watched_videos`, agora
   * pela sexta e sétima vez.
   *
   * **Filhos primeiro, pai depois**, pelo mesmo motivo da exclusão de conta: com
   * o pai morto antes, uma falha no meio deixaria órfão que ninguém mais
   * consegue encontrar para apagar.
   */
  async removeTraining(trainingId: string): Promise<void> {
    const training = await this.assertTraining(trainingId);

    await this.comments.removeAllByTraining(trainingId);
    await this.completions.removeAllByTraining(trainingId);
    await this.trainings.delete(trainingId);

    // A lista que sobrou volta a ser 0..n-1. Sem isto, a insígnia fica com um
    // buraco na numeração e a próxima criação nasce em cima de uma posição
    // ocupada.
    const { entries } = await this.trainings.listByBadge(training.badgeId);
    await this.trainings.reorder(entries.map((item) => item.id));
  }

  /**
   * Reordena a insígnia inteira, em lote atômico.
   *
   * A lista recebida precisa bater **exatamente** com o conjunto que existe:
   * reordenar não pode criar nem apagar, e as três formas de errar -- faltando,
   * sobrando e repetido -- viram 400 aqui, antes de qualquer escrita.
   */
  async reorder(badgeId: string, dto: ReorderTrainingsDto): Promise<void> {
    const badge = this.assertBadge(badgeId);
    const { entries } = await this.trainings.listByBadge(badge);

    const existingIds = new Set(entries.map((item) => item.id));
    const receivedIds = new Set(dto.orderedIds);

    if (receivedIds.size !== dto.orderedIds.length) {
      throw new BadRequestException(
        'A ordem enviada tem treinamento repetido. Reordenar não pode duplicar.',
      );
    }

    if (
      receivedIds.size !== existingIds.size ||
      dto.orderedIds.some((id) => !existingIds.has(id))
    ) {
      throw new BadRequestException(
        'A ordem enviada não bate com os treinamentos desta insígnia. Recarregue a lista e tente de novo.',
      );
    }

    await this.trainings.reorder(dto.orderedIds);
  }

  /**
   * Os comentários mais recentes de toda a Arena, para o painel centralizado.
   *
   * Cada linha carrega o título do desafio comentado: sem ele o admin lê "travei
   * no passo 3" sem saber de onde, e tem que abrir a trilha para descobrir. Os
   * treinamentos são lidos **uma vez por id distinto**, e não um por comentário
   * -- cinquenta comentários de três desafios custam três leituras.
   */
  async listRecentComments(): Promise<AdminTrainingCommentListDto> {
    const { entries } = await this.comments.listRecent({
      limit: TRAINING_RECENT_COMMENTS_PAGE_SIZE,
    });

    const ids = [...new Set(entries.map((comment) => comment.trainingId))];
    const encontrados = await Promise.all(
      ids.map((id) => this.trainings.findById(id)),
    );
    const porId = new Map(
      encontrados
        .filter((result) => result.entry !== null)
        .map((result) => [result.entry!.id, result.entry!]),
    );

    return {
      comments: entries.map((comment) => {
        const training = porId.get(comment.trainingId);

        return {
          ...toCommentDto(comment),
          trainingTitle: training?.title ?? null,
          badgeId: training?.badgeId ?? null,
        };
      }),
    };
  }

  /**
   * Grava a resposta do admin **no próprio comentário**.
   *
   * Uma por comentário, e responder de novo sobrescreve: é a consequência aceita
   * de a resposta ser campo, e é a certa para o que a tela faz -- o admin corrige
   * o que escreveu, não conversa em fio.
   */
  async replyComment(
    adminUid: string,
    commentId: string,
    content: string,
  ): Promise<TrainingCommentDto> {
    const profile = await this.profiles.findById(adminUid);

    const { found, entry } = await this.comments.setAdminReply(commentId, {
      content,
      authorName: firstName(profile.entry?.name ?? null),
      repliedAt: new Date(),
    });

    if (!found || !entry) {
      throw new NotFoundException('Comentário não encontrado.');
    }

    return toCommentDto(entry);
  }

  private assertBadge(badgeId: string): BadgeId {
    if (!isBadgeId(badgeId)) {
      throw new NotFoundException(
        `Insígnia "${badgeId}" não existe na trilha.`,
      );
    }

    return badgeId;
  }

  private async assertTraining(trainingId: string): Promise<Training> {
    const { found, entry } = await this.trainings.findById(trainingId);

    if (!found || !entry) {
      throw new NotFoundException('Treinamento não encontrado.');
    }

    return entry;
  }

  /**
   * O `limit` da query string, conferido.
   *
   * Acima do teto é **fixado no teto, sem erro**: é paginação, não pedido de
   * dados, e recusar aqui transformaria uma tela lenta numa tela quebrada. Zero
   * e negativo são 400, porque não são pedido de página -- são um engano que
   * devolveria lista vazia e pareceria "não há comentários".
   */
  private resolveLimit(limit?: number): number {
    if (limit === undefined) {
      return TRAINING_COMMENTS_PAGE_SIZE;
    }

    if (!Number.isInteger(limit) || limit < 1) {
      throw new BadRequestException(
        'O limite precisa ser um inteiro positivo.',
      );
    }

    return Math.min(limit, TRAINING_COMMENTS_MAX_PAGE_SIZE);
  }

  private profileDoc(uid: string) {
    return this.firebase.firestore.collection(PROFILE_COLLECTION).doc(uid);
  }

  /**
   * O `xp` gravado no perfil, depois da escrita.
   *
   * `?? 0` porque esta leitura é crua, pelo caminho, sem passar pelo converter
   * -- e um perfil anterior à spec 019 não tem o campo.
   */
  private async xpOf(uid: string): Promise<number> {
    const snapshot = await this.profileDoc(uid).get();
    const xp = (snapshot.data() as { xp?: number } | undefined)?.xp;

    return typeof xp === 'number' ? xp : 0;
  }

  private toDto(training: Training, completed: boolean): TrainingDto {
    return {
      id: training.id,
      badgeId: training.badgeId,
      title: training.title,
      description: training.description,
      steps: training.steps,
      videoUrl: training.videoUrl,
      xpAmount: training.xpAmount,
      position: training.position,
      completed,
    };
  }
}

/**
 * O comentário como a tela o vê -- **sem o `uid`**.
 *
 * O identificador serve para apagar o que é da pessoa quando ela pede para ser
 * esquecida, e para nada mais. Ele não fica de fora por spread: um campo novo na
 * entidade não deve vazar para o DTO por descuido, e o teste compara o conjunto
 * de chaves por igualdade justamente para isso.
 */
function toCommentDto(comment: TrainingComment): TrainingCommentDto {
  return {
    id: comment.id,
    trainingId: comment.trainingId,
    authorName: comment.authorName,
    content: comment.content,
    adminReply: comment.adminReply
      ? {
          content: comment.adminReply.content,
          authorName: comment.adminReply.authorName,
          repliedAt: comment.adminReply.repliedAt.toISOString(),
        }
      : null,
    createdAt: comment.createdAt.toISOString(),
  };
}

/**
 * Primeiro nome, como no Mural.
 *
 * O nome completo numa lista de comentários vira ruído, e o primeiro nome já dá
 * o rosto que o texto precisa ter. Perfil sem nome cai em "Membro" -- o
 * comentário existe, e um autor vazio pareceria defeito.
 */
function firstName(name: string | null): string {
  const trimmed = (name ?? '').trim();

  return trimmed ? trimmed.split(/\s+/)[0] : 'Membro';
}
