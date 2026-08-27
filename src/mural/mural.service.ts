import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MuralRepository } from './mural.repository';
import { ProfileRepository } from '../profile/profile.repository';
import { ALREADY_EXISTS } from '../waitlist/waitlist.repository';
import { previousWeekId, weekEndsAt, weekIdOf } from './week-id';
import { MuralPhase, phaseOf } from './mural-phase';
import { isBadgeId } from '../track/track.constants';
import { MuralQuestion } from './entities/mural-question.entity';
import { MuralQuestionDto } from './dto/mural-question.dto';
import { MuralStateDto } from './dto/mural-state.dto';
import { WinnerDto } from './dto/winner.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * A escala das fases, para a promocao saber o que e "avancar".
 *
 * Ela vive aqui e nao no `mural-phase.ts` de proposito: la a comparacao e entre
 * relogio e piso, e aqui e entre a fase atual e a pedida. Sao a mesma ordem por
 * uma razao so -- e a mesma escala -- e emprestar uma constante entre os dois
 * juntaria duas perguntas diferentes numa linha so.
 */
const PHASE_ORDER: Readonly<Record<MuralPhase, number>> = {
  coleta: 0,
  votacao: 1,
  encerrada: 2,
};

@Injectable()
export class MuralService {
  constructor(
    private readonly repository: MuralRepository,
    private readonly profiles: ProfileRepository,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * O estado do ciclo para este usuário.
   *
   * `canAsk` sai daqui pronto, e não é recalculado no front: duas
   * implementações da mesma regra divergem na primeira exceção.
   */
  async getState(uid: string, now: Date = new Date()): Promise<MuralStateDto> {
    const currentWeekId = weekIdOf(now);
    const mine = await this.repository.findMine(currentWeekId, uid);
    const paid = await this.isPaid(uid);

    return {
      currentWeekId,
      votingWeekId: previousWeekId(currentWeekId),
      currentWeekEndsAt: weekEndsAt(currentWeekId).toISOString(),
      // Já perguntou nesta semana também zera o `canAsk`: o botão não deve
      // abrir um formulário que vai receber 409.
      canAsk: paid && !mine.found,
      myQuestionId: mine.entry?.id ?? null,
    };
  }

  async listQuestions(
    uid: string,
    fase: 'coleta' | 'votacao',
    now: Date = new Date(),
    /**
     * Inverte a coleta para a mais nova primeiro (spec 012).
     *
     * Só quem chega por uma notificação pede isto: a ordem padrão da aba —
     * a mais antiga primeiro — continua sendo a de quem entra pelo menu, e é
     * a certa para quem está lendo a semana inteira.
     */
    newestFirst = false,
  ): Promise<MuralQuestionDto[]> {
    const currentWeekId = weekIdOf(now);
    const votingWeekId = previousWeekId(currentWeekId);

    // As DUAS semanas vivas, e não a semana da aba (spec 016, decisão 6). Uma
    // pergunta da semana em coleta, adiantada para votação, pertence à aba de
    // votação e continua tendo o `weekId` da coleta — então traduzir a aba em
    // um `weekId` para de funcionar no primeiro adiantamento.
    //
    // As duas consultas são as mesmas de antes, com o mesmo `orderBy`: o que
    // passou para a memória foi a partição e a ordenação. **Nenhuma linha da
    // tabela de índices compostos do README muda.** Emendar cada aba com um
    // `where` extra por `promotedTo` seria o caminho oposto — dois índices
    // novos e a armadilha do `== null` de volta, em dois lugares.
    const [naColeta, emVotacao] = await Promise.all([
      this.repository.listByWeek(currentWeekId, false),
      this.repository.listByWeek(votingWeekId, true),
    ]);

    const questions = sortForPhase(
      [...naColeta, ...emVotacao].filter(
        (question) => phaseOf(question, now) === fase,
      ),
      fase,
      newestFirst,
    );

    // Um `getAll` por caminho para a página inteira, e nunca N leituras em laço
    // nem uma consulta por autor. Sem isto o front não sabe qual coração pintar.
    //
    // Ele vem **depois** da partição, sobre os ids da aba pedida: o custo é
    // linear nos ids passados, e ler antes dobraria a leitura de todo mundo
    // para atender uma aba só.
    const myVotes = await this.repository.findMyVotes(
      questions.map((question) => question.id),
      uid,
    );

    return questions.map((question) =>
      this.toDto(question, uid, myVotes.has(question.id), now),
    );
  }

  /**
   * A pauta: **o que está esperando vídeo**, com duas origens.
   *
   * As vencedoras das semanas encerradas — escolha da comunidade — e as
   * perguntas que o admin adiantou para `encerrada`. Cada linha diz de onde
   * veio, porque as duas pedem vídeos de peso diferente (spec 016, decisão 5).
   *
   * Semana em branco entra na lista com `question: null`. Ela é informação
   * honesta — nenhum vídeo é devido — e esconder a semana faria o histórico
   * parecer ter buracos.
   *
   * **Não custa nenhuma consulta por `promotedTo`, e nenhum índice novo.** As
   * adiantadas de cada semana encerrada saem do array que o `findWinner` já
   * carregou para escolher a vencedora em memória; as das duas semanas vivas
   * saem das mesmas duas leituras por semana que a listagem já faz. Um
   * `where('promotedTo', '==', 'encerrada')` seria o caminho óbvio, pediria um
   * índice composto novo — e ainda cairia na armadilha do `== null`.
   *
   * A ordem é da mais recente para a mais antiga, com as adiantadas de cada
   * semana antes da vencedora dela: separar em duas listas faria a tela
   * perguntar ao leitor uma coisa que ele não precisa decidir.
   */
  async listWinners(
    uid: string,
    semanas = 8,
    now: Date = new Date(),
  ): Promise<WinnerDto[]> {
    const currentWeekId = weekIdOf(now);
    const votingWeekId = previousWeekId(currentWeekId);

    const encerradas: string[] = [];
    let weekId = previousWeekId(votingWeekId);

    for (let i = 0; i < semanas; i += 1) {
      encerradas.push(weekId);
      weekId = previousWeekId(weekId);
    }

    const [vivas, fechadas] = await Promise.all([
      Promise.all(
        [currentWeekId, votingWeekId].map((semana) =>
          this.repository.listByWeek(semana, true),
        ),
      ),
      Promise.all(
        encerradas.map((semana) => this.repository.findWinner(semana)),
      ),
    ]);

    const pauta: WinnerDto[] = [];

    for (const perguntas of vivas) {
      pauta.push(...this.adiantadas(perguntas, uid, now));
    }

    fechadas.forEach((winner, indice) => {
      pauta.push(...this.adiantadas(winner.questions, uid, now));
      pauta.push({
        weekId: encerradas[indice],
        question: winner.entry
          ? this.toDto(winner.entry, uid, false, now)
          : null,
        origem: 'voto',
      });
    });

    return pauta;
  }

  /**
   * As adiantadas de um array de perguntas já carregado, da mais recente para a
   * mais antiga. Nenhuma leitura acontece aqui, e é esse o ponto.
   */
  private adiantadas(
    questions: MuralQuestion[],
    uid: string,
    now: Date,
  ): WinnerDto[] {
    return questions
      .filter((question) => question.promotedTo === 'encerrada')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((question) => ({
        weekId: question.weekId,
        question: this.toDto(question, uid, false, now),
        origem: 'adiantada' as const,
      }));
  }

  async createQuestion(
    uid: string,
    dto: CreateQuestionDto,
    now: Date = new Date(),
  ): Promise<MuralQuestionDto> {
    if (!isBadgeId(dto.badgeId)) {
      throw new BadRequestException(
        `Insígnia "${dto.badgeId}" não existe na trilha.`,
      );
    }

    const profile = await this.profiles.findById(uid);
    if (!profile.found || !profile.entry) {
      throw new NotFoundException('Perfil não encontrado.');
    }

    // O portão. A mensagem diz o que fazer, e não só que não pode: um 403 sem
    // caminho de saída é a forma mais cara de perder um upgrade.
    if (profile.entry.tier === 'dev-tier') {
      throw new ForbiddenException(
        'O Dev Tier vota no Mural, mas não escreve pergunta. Veja o Financeiro para assinar.',
      );
    }

    // O weekId vem SEMPRE do servidor, nunca do corpo da requisição: cliente que
    // escolhe a própria semana escolhe também votar na semana errada.
    const weekId = weekIdOf(now);

    let created: { entry: MuralQuestion };

    try {
      created = await this.repository.create({
        weekId,
        badgeId: dto.badgeId,
        authorUid: uid,
        authorName: firstName(profile.entry.name),
        title: dto.title,
        body: dto.body?.length ? dto.body : null,
      });
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === ALREADY_EXISTS
      ) {
        throw new ConflictException(
          'Você já perguntou esta semana. Dá para editar a sua pergunta enquanto a semana não virar.',
        );
      }
      throw error;
    }

    // O aviso vem DEPOIS da pergunta, fora do try que traduz o ALREADY_EXISTS, e
    // nunca pode derrubá-la: quando isto roda a pergunta já está gravada, e um
    // 500 aqui apagaria da tela um texto que a pessoa escreveu.
    //
    // O `catch` parece descuido e é decisão (spec 012, decisão 7). Quem não é
    // notificado da própria pergunta é o autor, e disso cuida a listagem, pelo
    // `actorUid` — não é este ponto que decide.
    try {
      await this.notifications.notifyQuestion({
        badgeId: dto.badgeId,
        title: created.entry.title,
        questionId: created.entry.id,
        actorUid: uid,
      });
    } catch {
      // Já logado lá dentro. A pergunta está no Mural, que é o que importa.
    }

    return this.toDto(created.entry, uid, false, now);
  }

  /**
   * Reescreve a própria pergunta, **só enquanto a semana está em coleta**.
   *
   * Depois da virada ela já está em votação, e mexer no texto invalidaria os
   * votos que ela recebeu — quem votou votou naquilo.
   */
  async updateQuestion(
    uid: string,
    questionId: string,
    dto: UpdateQuestionDto,
    now: Date = new Date(),
  ): Promise<MuralQuestionDto> {
    const found = await this.repository.findById(questionId);
    if (!found.found || !found.entry) {
      throw new NotFoundException('Pergunta não encontrada.');
    }

    if (found.entry.authorUid !== uid) {
      throw new ForbiddenException('Essa pergunta não é sua.');
    }

    if (phaseOf(found.entry, now) !== 'coleta') {
      throw new ConflictException(
        'A semana virou e a sua pergunta já está em votação — o texto não muda mais.',
      );
    }

    const updated = await this.repository.update(questionId, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.body !== undefined
        ? { body: dto.body.length ? dto.body : null }
        : {}),
    });

    return this.toDto(updated.entry, uid, false, now);
  }

  /**
   * Adianta uma pergunta (spec 016).
   *
   * **A promocao e um piso, e nunca um estado gravado.** O que se grava aqui
   * levanta o chao da fase; o relogio continua sendo a autoridade quando esta a
   * frente, e e por isso que nenhum valor gravado pode ficar velho.
   *
   * **E de mao unica**: `coleta -> votacao -> encerrada`. Promover para uma
   * fase igual ou anterior a atual responde 409, e nao um 200 que nao faz nada
   * -- a tela precisa saber que o botao nao tinha efeito. O caminho de
   * arrependimento e o `DELETE`, que apaga os votos junto: despromover deixaria
   * a pergunta editavel de novo **com votos em cima dela**, e quem votou votou
   * naquele texto.
   *
   * **O `weekId` nao e tocado** (decisao 10). Mover a pergunta para outra
   * semana "resolveria" a fase sem campo novo, e custaria recriar o documento,
   * migrar a subcolecao de votos inteira e liberar o caminho da semana para uma
   * segunda pergunta da mesma pessoa.
   */
  async promote(
    questionId: string,
    fase: 'votacao' | 'encerrada',
    now: Date = new Date(),
  ): Promise<MuralQuestionDto> {
    const found = await this.repository.findById(questionId);
    if (!found.found || !found.entry) {
      throw new NotFoundException('Pergunta não encontrada.');
    }

    const atual = phaseOf(found.entry, now);
    if (PHASE_ORDER[fase] <= PHASE_ORDER[atual]) {
      throw new ConflictException(
        atual === fase
          ? `Essa pergunta já está em ${fase === 'votacao' ? 'votação' : 'pauta'}.`
          : 'A promoção é de mão única, e essa pergunta já passou dessa fase. Para desfazer, remova a pergunta.',
      );
    }

    const updated = await this.repository.update(questionId, {
      promotedTo: fase,
    });

    return this.toDto(updated.entry, found.entry.authorUid, false, now);
  }

  async remove(questionId: string): Promise<void> {
    const found = await this.repository.findById(questionId);
    if (!found.found) {
      throw new NotFoundException('Pergunta não encontrada.');
    }

    await this.repository.remove(questionId);

    // A notificação da pergunta vai junto com os votos dela: um aviso que leva a
    // uma pergunta moderada aponta para o vazio. Falhar aqui não desfaz a
    // moderação, que é a operação que o admin de fato pediu (spec 012).
    try {
      await this.notifications.forgetQuestion(questionId);
    } catch {
      // Já logado lá dentro.
    }
  }

  private async isPaid(uid: string): Promise<boolean> {
    const profile = await this.profiles.findById(uid);
    return !!profile.entry && profile.entry.tier !== 'dev-tier';
  }

  private toDto(
    question: MuralQuestion,
    uid: string,
    hasVoted: boolean,
    now: Date,
  ): MuralQuestionDto {
    return {
      id: question.id,
      weekId: question.weekId,
      phase: phaseOf(question, now),
      promotedTo: question.promotedTo,
      badgeId: question.badgeId,
      authorName: question.authorName,
      title: question.title,
      body: question.body,
      voteCount: question.voteCount,
      hasVoted,
      isMine: question.authorUid === uid,
      answerVideoId: question.answerVideoId,
    };
  }
}

/**
 * Ordena a aba **em memória**, depois da partição (spec 016, decisão 6).
 *
 * O comportamento visível é o de sempre: votos decrescentes na votação, com
 * desempate pela mais antiga; data crescente na coleta; e o `newestFirst` da
 * spec 012 invertendo a coleta para quem chegou por uma notificação.
 *
 * A ordenação saiu da consulta porque a aba deixou de ser uma semana: uma
 * pergunta adiantada vem do array da outra semana, e nenhuma consulta ordena
 * duas semanas juntas sem trazê-las juntas.
 */
function sortForPhase(
  questions: MuralQuestion[],
  fase: 'coleta' | 'votacao',
  newestFirst: boolean,
): MuralQuestion[] {
  const ordenadas = [...questions].sort((a, b) =>
    fase === 'votacao' && b.voteCount !== a.voteCount
      ? b.voteCount - a.voteCount
      : a.createdAt.getTime() - b.createdAt.getTime(),
  );

  return fase === 'coleta' && newestFirst ? ordenadas.reverse() : ordenadas;
}

/**
 * Primeiro nome, para o mural.
 *
 * O nome completo numa lista de trinta cartões vira ruído, e o primeiro nome já
 * dá o rosto que a pergunta precisa ter. Perfil sem nome cai em "Membro" — a
 * pergunta existe, e um cartão sem autor pareceria defeito.
 */
function firstName(name: string | null): string {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed.split(/\s+/)[0] : 'Membro';
}
