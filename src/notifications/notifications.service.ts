import { Injectable, Logger } from '@nestjs/common';
import { NotificationRepository } from './notification.repository';
import { NotificationReadRepository } from './notification-read.repository';
import { ProfileRepository } from '../profile/profile.repository';
import { Notification } from './entities/notification.entity';
import { NotificationDto } from './dto/notification.dto';
import { BadgeId } from '../track/track.constants';

/** Janela de leitura, em dias. Ver `listUnread`. */
export const NOTIFICATION_WINDOW_DAYS = 30;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repository: NotificationRepository,
    private readonly reads: NotificationReadRepository,
    private readonly profiles: ProfileRepository,
  ) {}

  /**
   * O que esta pessoa ainda nao viu.
   *
   * **Os tres cortes acontecem em memoria, depois da leitura**, e nao em `where`:
   * cada filtro combinado com o `orderBy` do repositorio exigiria um indice
   * composto em producao. Com teto de 50 documentos, filtrar depois de ler nao
   * custa nada mensuravel -- e a lista de indices que producao exige ja cresceu
   * duas vezes sem ninguem perceber.
   *
   * A ordem dos cortes importa por economia: o `findMyReads` so e chamado com o
   * que sobrou, e assim o `getAll` nao carrega caminho que ja foi descartado.
   */
  async listUnread(
    uid: string,
    now: Date = new Date(),
  ): Promise<NotificationDto[]> {
    const window = await this.repository.listWindow();

    if (window.length === 0) {
      return [];
    }

    const since = new Date(
      now.getTime() - NOTIFICATION_WINDOW_DAYS * DAY_IN_MS,
    );
    const profile = await this.profiles.findById(uid);
    // Perfil ausente nao derruba a listagem: o painel funciona inteiro sem o
    // sino, e um erro aqui viraria erro de tela por causa de um acessorio.
    const memberSince = profile.entry?.createdAt ?? null;

    const candidates = window.filter(
      (item) =>
        item.actorUid !== uid &&
        item.createdAt >= since &&
        (memberSince === null || item.createdAt >= memberSince),
    );

    if (candidates.length === 0) {
      return [];
    }

    const alreadyRead = await this.reads.findMyReads(
      candidates.map((item) => item.id),
      uid,
    );

    return candidates
      .filter((item) => !alreadyRead.has(item.id))
      .map((item) => this.toDto(item));
  }

  async markRead(uid: string, notificationId: string): Promise<void> {
    await this.reads.markRead(uid, notificationId);
  }

  /**
   * Marca tudo o que **aquela pessoa** teria visto.
   *
   * Nao e "tudo o que existe": marcar o que ela nunca veria -- evento dela
   * mesma, evento anterior a entrada dela -- encheria a subcolecao com registros
   * de leitura que nao significam nada.
   */
  async markAllRead(uid: string, now: Date = new Date()): Promise<void> {
    const unread = await this.listUnread(uid, now);

    await this.reads.markAllRead(
      uid,
      unread.map((item) => item.id),
    );
  }

  /**
   * Anuncia um video novo.
   *
   * **Nunca lanca.** O video ja esta publicado quando isto roda, e um erro aqui
   * viraria 500 numa requisicao que deu certo -- a API perderia o trabalho do
   * admin por causa de um aviso. A falha vira log, porque notificacao que nao e
   * escrita em silencio e notificacao que ninguem sabe que faltou.
   */
  async notifyVideo(event: {
    badgeId: BadgeId;
    title: string;
    youtubeId: string;
    actorUid: string;
  }): Promise<void> {
    await this.safely(`video ${event.badgeId}/${event.youtubeId}`, () =>
      this.repository.create({
        kind: 'video',
        title: event.title,
        badgeId: event.badgeId,
        actorUid: event.actorUid,
        targetId: event.youtubeId,
      }),
    );
  }

  /** Anuncia uma pergunta nova. Mesma regra do `notifyVideo`: nunca lanca. */
  async notifyQuestion(event: {
    badgeId: BadgeId;
    title: string;
    questionId: string;
    actorUid: string;
  }): Promise<void> {
    await this.safely(`pergunta ${event.questionId}`, () =>
      this.repository.create({
        kind: 'pergunta',
        title: event.title,
        badgeId: event.badgeId,
        actorUid: event.actorUid,
        targetId: event.questionId,
      }),
    );
  }

  /**
   * Esquece a pergunta moderada.
   *
   * Uma notificacao que leva a uma pergunta removida e um aviso que aponta para
   * o vazio. Nunca lanca, pela mesma razao dos outros dois.
   */
  async forgetQuestion(questionId: string): Promise<void> {
    await this.safely(`remocao da pergunta ${questionId}`, () =>
      this.repository.deleteForQuestion(questionId),
    );
  }

  private async safely(what: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error(
        `Falha ao notificar (${what}): ${(error as Error)?.message ?? error}`,
      );
    }
  }

  private toDto(notification: Notification): NotificationDto {
    return {
      id: notification.id,
      kind: notification.kind,
      title: notification.title,
      badgeId: notification.badgeId,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}
