import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BadgeVideoRepository } from './badge-video.repository';
import { ALREADY_EXISTS } from '../waitlist/waitlist.repository';
import { BADGE_TITLES, BadgeId, isBadgeId } from './track.constants';
import { extractYoutubeId } from './youtube-id';
import { CreateBadgeVideoDto } from './dto/create-badge-video.dto';
import { UpdateBadgeVideoDto } from './dto/update-badge-video.dto';
import { ReorderVideosDto } from './dto/reorder-videos.dto';
import { BadgeVideoDto, BadgeVideoListDto } from './dto/badge-video.dto';
import {
  AnsweredQuestion,
  BadgeVideo,
  BadgeVideoKind,
} from './entities/badge-video.entity';
import { MuralRepository } from '../mural/mural.repository';
import { WatchedVideoRepository } from './watched-video.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailCampaignService } from '../emails/email-campaign.service';
import { videoCampaignId } from '../emails/entities/email-campaign.entity';

function toDto(video: BadgeVideo, watched: boolean): BadgeVideoDto {
  return {
    watched,
    id: video.id,
    badgeId: video.badgeId,
    title: video.title,
    description: video.description,
    youtubeId: video.youtubeId,
    kind: video.kind,
    questionId: video.questionId,
    question: video.question
      ? {
          id: video.question.id,
          title: video.question.title,
          authorName: video.question.authorName,
          askedAt: video.question.askedAt.toISOString(),
        }
      : null,
    orientation: orientationOf(video),
    devTierFree: video.devTierFree,
    order: video.order,
  };
}

/**
 * A proporcao do player, **derivada e nunca gravada** (decisao 2 da spec 017).
 *
 * Resposta e Short e Short e 9:16; aula e paisagem. Hoje isso e uma linha, e o
 * ponto de ela morar aqui e o dia em que deixar de ser: uma resposta longa
 * gravada em paisagem, um campo novo, uma escolha do admin -- **o que quer que
 * substitua esta regra, substitui aqui e nenhum front muda.**
 *
 * E a mesma forma da `phase` da spec 010: um valor que a API afirma e que o
 * cliente consome sem recalcular. Derivar de `kind` do lado da tela custaria uma
 * linha tambem, mas em tres arquivos -- template, folha de estilo e teste -- e
 * cada um deles envelheceria por conta propria.
 */
function orientationOf(video: BadgeVideo): 'paisagem' | 'retrato' {
  return video.kind === 'resposta' ? 'retrato' : 'paisagem';
}

@Injectable()
export class BadgeVideoService {
  private readonly logger = new Logger(BadgeVideoService.name);

  constructor(
    private readonly repository: BadgeVideoRepository,
    private readonly notifications: NotificationsService,
    private readonly campaigns: EmailCampaignService,
    private readonly configService: ConfigService,
    /** Lido na publicacao de uma resposta, e em nenhum outro lugar (spec 017). */
    private readonly mural: MuralRepository,
    /** O razao do que o membro assistiu, lido em toda listagem (spec 019). */
    private readonly watchedVideos: WatchedVideoRepository,
  ) {}

  /**
   * Insignia inexistente e 404; insignia sem video e 200 com lista vazia.
   *
   * A distincao importa para o front: a primeira e bug ou URL adulterada, a
   * segunda e terca-feira. Se as duas fossem 404, o front acabaria tratando
   * conteudo em preparo como falha de rede, com tela de erro no lugar do aviso
   * de que o material ainda esta sendo preparado. Ver a decisao 8 da spec 009.
   */
  async listByBadge(
    badgeId: string,
    /**
     * De quem e a resposta (spec 019).
     *
     * **A lista deixou de ser igual para todo mundo**: o `watched` de cada video
     * e do membro que perguntou. Um cache de lista colocado sem olhar isto serve
     * o check de uma pessoa para outra, sem falhar em nada.
     */
    uid: string,
    kind?: BadgeVideoKind,
  ): Promise<BadgeVideoListDto> {
    const badge = this.assertBadge(badgeId);
    const videos = await this.repository.listByBadge(badge, kind);

    // Um `getAll` nos caminhos exatos dos videos que esta resposta ja vai
    // listar. Ver `findWatchedIds` para por que nao e uma consulta.
    const watched = await this.watchedVideos.findWatchedIds(
      uid,
      videos.map((video) => video.id),
    );

    return {
      badgeId: badge,
      videos: videos.map((video) => toDto(video, watched.has(video.id))),
    };
  }

  async create(
    badgeId: string,
    dto: CreateBadgeVideoDto,
    /** Quem publicou. Vai na notificacao, e quem publica nao e notificado. */
    actorUid: string,
  ): Promise<BadgeVideoDto> {
    const badge = this.assertBadge(badgeId);

    // A extracao acontece uma vez, aqui na entrada. O admin cola a URL inteira;
    // saber que existem cinco formas dela e problema nosso.
    const youtube = extractYoutubeId(dto.youtubeUrl);
    if (!youtube.found || !youtube.id) {
      throw new BadRequestException(
        'Não reconheci esse link do YouTube. Cole a URL do vídeo (youtube.com/watch?v=… ou youtu.be/…).',
      );
    }

    const kind = dto.kind ?? 'aula';

    // `questionId` so faz sentido em resposta. Aula com pergunta e resposta sem
    // pergunta sao os dois estados incoerentes, e o 400 e mais barato que um
    // dado torto que ninguem sabe interpretar depois.
    //
    // A segunda metade so passou a ser cobrada na spec 017, quando ela ganhou
    // consequencia visivel: resposta sem pergunta e um video que a trilha
    // desenha com um balao vazio em cima.
    if (kind === 'aula' && dto.questionId) {
      throw new BadRequestException(
        'Só vídeo de resposta se vincula a uma pergunta do Mural.',
      );
    }

    if (kind === 'resposta' && !dto.questionId) {
      throw new BadRequestException(
        'Todo vídeo de resposta responde a uma pergunta do Mural. Informe qual.',
      );
    }

    const question = await this.snapshotQuestion(dto.questionId);

    // A ordem e por (badgeId, kind): o novo video entra no fim da ABA dele, e
    // nao no fim da insignia. Contar a insignia inteira faria a primeira
    // resposta nascer na posicao 3 de uma lista que tem um item so.
    const existing = await this.repository.listByBadge(badge, kind);

    let created: { entry: BadgeVideo };

    try {
      created = await this.repository.create({
        badgeId: badge,
        title: dto.title,
        description: dto.description?.length ? dto.description : null,
        youtubeId: youtube.id,
        kind,
        questionId: dto.questionId ?? null,
        question,
        devTierFree: dto.devTierFree ?? false,
        // Entra no fim: quem cadastra esta acrescentando, e reordenar depois e
        // uma operacao propria.
        order: existing.length,
      });
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === ALREADY_EXISTS
      ) {
        // O caminho do documento e `{badgeId}__{youtubeId}`, entao o Firestore
        // recusa o mesmo video duas vezes na mesma insignia. Em outra insignia
        // ele entra, e isso e proposital.
        throw new ConflictException(
          'Esse vídeo já está nesta insígnia. Ele pode entrar em outra, mas não duas vezes na mesma.',
        );
      }
      throw error;
    }

    // O aviso vem DEPOIS do video, fora do try que traduz o ALREADY_EXISTS, e
    // nunca pode derrubar o que ja deu certo: quando isto roda o video ja esta
    // gravado, e um 500 aqui perderia o trabalho do admin por causa de um aviso.
    //
    // O `catch` parece descuido e e decisao (spec 012, decisao 7). O
    // `NotificationsService` ja captura tudo por dentro; este segundo cinto
    // existe para a garantia ser estrutural e nao depender de o outro service
    // continuar se comportando.
    try {
      await this.notifications.notifyVideo({
        badgeId: badge,
        // O titulo anunciado e o que ficou gravado, e nao o que veio no corpo.
        title: created.entry.title,
        youtubeId: created.entry.youtubeId,
        actorUid,
      });
    } catch {
      // Ja logado la dentro. Aqui nao ha nada a fazer e nada a contar a quem
      // publicou: o video esta no ar.
    }

    await this.emailVideo(created.entry, actorUid);

    await this.linkAnswer(created.entry);

    // Video recem-publicado nao foi assistido por ninguem. O campo existe no
    // DTO por ser um so; aqui ele e sempre falso.
    return toDto(created.entry, false);
  }

  /**
   * Le a pergunta **uma vez, na publicacao**, e devolve a foto dela.
   *
   * Esta leitura e o preco inteiro da decisao 3 da spec 017. A alternativa era
   * um `getAll` sobre os `questionId` dentro do `listByBadge` -- e listagem
   * acontece toda vez que alguem abre a aba, enquanto isto acontece uma vez por
   * video. **Nao mover esta leitura para a listagem**: e a "simplificacao" que
   * troca uma leitura por video por N leituras por visita, e de quebra faz o
   * balao sumir quando o admin apagar a pergunta do mural.
   *
   * A leitura e por caminho direto (`mural_questions/{id}`): sem consulta, sem
   * indice. E ela e o que torna o 404 possivel -- sem ela, um `questionId`
   * digitado errado viraria um video de resposta com balao vazio, e o defeito so
   * apareceria na tela do aluno.
   */
  private async snapshotQuestion(
    questionId: string | undefined,
  ): Promise<AnsweredQuestion | null> {
    if (!questionId) {
      return null;
    }

    const found = await this.mural.findById(questionId);
    if (!found.found || !found.entry) {
      throw new NotFoundException(
        `A pergunta "${questionId}" não existe no Mural.`,
      );
    }

    return {
      id: found.entry.id,
      title: found.entry.title,
      authorName: found.entry.authorName,
      // A data da PERGUNTA. O balao diz "isto foi perguntado em tal dia", e a
      // data em que o video foi gravado nao e informacao de ninguem.
      askedAt: found.entry.createdAt,
    };
  }

  /**
   * Fecha o vinculo do lado do mural: a pergunta passa a apontar para o video.
   *
   * O campo `answerVideoId` existe na `MuralQuestion` desde a spec 010, sai no
   * DTO, o repositorio aceita grava-lo -- e ate a 017 nada nunca o escreveu.
   *
   * **Vem por ultimo, e falha em silencio**, pela mesma razao da decisao 7 da
   * spec 012: quando isto roda, o video ja esta gravado, ja foi notificado e ja
   * foi anunciado por e-mail, e um 500 aqui perderia o trabalho do admin por
   * causa de um vinculo.
   *
   * O que se perde quando falha: a pauta continua mostrando uma pergunta ja
   * respondida. Nada do lado do aluno quebra, porque **o balao vem da foto do
   * video, e nao deste vinculo** -- e e exatamente por isso que este e o lado
   * barato de falhar, e o ultimo a ser escrito.
   */
  private async linkAnswer(video: BadgeVideo): Promise<void> {
    if (video.kind !== 'resposta' || !video.questionId) {
      return;
    }

    try {
      await this.mural.update(video.questionId, { answerVideoId: video.id });
    } catch (error: unknown) {
      this.logger.error(
        `Falha ao vincular o video ${video.id} a pergunta ${video.questionId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * O anuncio por e-mail do video novo (spec 014, decisao 6).
   *
   * **E acessorio, e nenhuma falha dele pode virar status de erro.** Vale a
   * decisao 7 da spec 012 sem mudanca: o video ja esta gravado e a notificacao
   * ja saiu quando isto roda, e um 500 aqui perderia o trabalho do admin por
   * causa de um aviso. O `catch` parece descuido e e decisao.
   *
   * **O que muda em relacao a notificacao interna e o custo.** Escrever uma
   * notificacao e uma escrita e leva milissegundos; disparar e-mail para a base
   * inteira sao N/100 requisicoes HTTP para fora, e o admin espera por elas.
   * Isso e conhecido e aceito no tamanho de hoje -- dezenas de membros --, e e
   * **sincrono por ora**: ver a decisao 15 e o ponto em aberto 1 da spec 014. O
   * sinal de que passou do ponto e campanha terminando `interrompida` com
   * frequencia, e a saida entao e fila, nao `timeout` maior.
   *
   * Quem publicou nao recebe o proprio anuncio, que e a decisao 5 da spec 012
   * aplicada ao e-mail.
   */
  private async emailVideo(video: BadgeVideo, actorUid: string): Promise<void> {
    // **A primeira vez que este repositorio monta uma rota do front**, e a spec
    // 012 proibia isso para a API de notificacao -- la o front recebia
    // `badgeId` e resolvia o destino com o proprio roteador. Aqui nao ha
    // roteador: e-mail e um documento que chega numa caixa de entrada, e o link
    // precisa ser absoluto. Alguem tem que monta-lo, e este e o unico lugar que
    // sabe qual video acabou de entrar.
    const frontendUrl = this.configService
      .getOrThrow<string>('FRONTEND_URL')
      .split(',')[0]
      .trim()
      .replace(/\/+$/, '');

    const insignia = BADGE_TITLES[video.badgeId];

    try {
      await this.campaigns.createAndSend({
        // O caminho e a unicidade: um POST repetido por retry de rede nao
        // consegue anunciar o mesmo video duas vezes para a base inteira.
        id: videoCampaignId(video.badgeId, video.youtubeId),
        kind: 'video',
        subject: `Vídeo novo: ${video.title}`,
        body:
          `Saiu um vídeo novo na ${insignia}.\n\n` +
          `${video.title}\n\n` +
          'Ele já está na trilha, no lugar dele.',
        ctaLabel: 'Ver na trilha',
        ctaUrl: `${frontendUrl}/dashboard/trilha/${video.badgeId}`,
        filters: { tiers: null, gradeMin: null, gradeMax: null },
        createdBy: actorUid,
        excludeUid: actorUid,
      });
    } catch (error: unknown) {
      // O id da campanha e o do video vao juntos no log: sem eles, "as vezes nao
      // avisa" vira investigacao sem pista.
      this.logger.error(
        `Falha ao enviar o e-mail do video ${video.id} ` +
          `(campanha ${videoCampaignId(video.badgeId, video.youtubeId)}): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async update(
    badgeId: string,
    videoId: string,
    dto: UpdateBadgeVideoDto,
  ): Promise<BadgeVideoDto> {
    this.assertBadge(badgeId);
    await this.assertVideo(videoId);

    const updated = await this.repository.update(videoId, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description.length ? dto.description : null }
        : {}),
      // Marcar como "Livre para todos" é a válvula da decisão 8: sem ela, a
      // melhor resposta da semana nasce trancada para 90% de quem votou nela.
      ...(dto.devTierFree !== undefined
        ? { devTierFree: dto.devTierFree }
        : {}),
    });

    // Resposta de edicao do admin: o check e do membro, e nao faz parte do que
    // esta operacao mexeu.
    return toDto(updated.entry, false);
  }

  /**
   * Apaga e **renormaliza a ordem da aba**.
   *
   * Sem a renormalizacao, apagar o video do meio deixa a lista com as posicoes 0
   * e 2 -- um buraco que nao quebra nada visivelmente e vai envelhecendo ate
   * alguem tentar entender por que os numeros pulam.
   *
   * A renormalizacao e **dentro do `kind`** (spec 010): renormalizar a insignia
   * inteira embaralharia as duas abas de uma vez, e uma delas nao foi tocada.
   */
  async remove(badgeId: string, videoId: string): Promise<void> {
    const badge = this.assertBadge(badgeId);
    const video = await this.assertVideo(videoId);

    await this.repository.delete(videoId);

    const remaining = await this.repository.listByBadge(badge, video.kind);
    if (remaining.length > 0) {
      await this.repository.reorder(remaining.map((item) => item.id));
    }
  }

  /**
   * Reordena **uma aba** da insignia, em lote atomico.
   *
   * A lista recebida precisa bater **exatamente** com o conjunto daquela aba.
   * Reordenar nao pode criar nem apagar, e as tres formas de errar -- faltando,
   * sobrando e repetido -- viram 400 aqui, antes de qualquer escrita. Misturar
   * ids de abas diferentes tambem cai no 400, pelo mesmo teste de conjunto.
   */
  async reorder(
    badgeId: string,
    dto: ReorderVideosDto,
    kind: BadgeVideoKind = 'aula',
  ): Promise<void> {
    const badge = this.assertBadge(badgeId);
    const existing = await this.repository.listByBadge(badge, kind);

    const existingIds = new Set(existing.map((video) => video.id));
    const receivedIds = new Set(dto.videoIds);

    if (receivedIds.size !== dto.videoIds.length) {
      throw new BadRequestException(
        'A ordem enviada tem vídeo repetido. Reordenar não pode duplicar.',
      );
    }

    if (
      receivedIds.size !== existingIds.size ||
      dto.videoIds.some((id) => !existingIds.has(id))
    ) {
      throw new BadRequestException(
        'A ordem enviada não bate com os vídeos desta insígnia. Recarregue a lista e tente de novo.',
      );
    }

    await this.repository.reorder(dto.videoIds);
  }

  private assertBadge(badgeId: string): BadgeId {
    if (!isBadgeId(badgeId)) {
      throw new NotFoundException(
        `Insígnia "${badgeId}" não existe na trilha.`,
      );
    }
    return badgeId;
  }

  /** Devolve o vídeo, porque quem chama precisa do `kind` para renormalizar. */
  private async assertVideo(videoId: string): Promise<BadgeVideo> {
    const found = await this.repository.findById(videoId);
    if (!found.found || !found.entry) {
      throw new NotFoundException('Vídeo não encontrado.');
    }
    return found.entry;
  }
}
