import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AudienceMember, AudienceService } from './audience.service';
import { EmailCampaignRepository } from './email-campaign.repository';
import { MailerService, OutgoingEmail } from './mailer.service';
import { renderEmail } from './email-template';
import { signUnsubscribeToken } from './unsubscribe-token';
import type { CannotReceiveEmailReason } from './email-eligibility';
import { ALREADY_EXISTS } from '../waitlist/waitlist.repository';
import type { CreateCampaignData } from './email-campaign.repository';
import {
  CampaignStatus,
  EmailCampaign,
} from './entities/email-campaign.entity';

/**
 * Quantas mensagens vão numa requisição ao provedor.
 *
 * É o teto da API de lote, e é o mesmo número que fatia a audiência: o cursor é
 * gravado a cada 100 pessoas.
 */
export const BATCH_SIZE = 100;

/**
 * O texto que acompanha o `422`, por motivo.
 *
 * **A tela não lê isto.** Ela escolhe a frase pelo `reason` que vem no corpo
 * (spec 015, decisão 12), e esta prosa existe para quem chama a API por fora —
 * `curl`, log, Swagger. Um `includes('descadastr')` do outro lado quebraria na
 * primeira revisão de copy daqui, e é exatamente por isso que o código vai junto.
 */
const MOTIVO_EM_PROSA: Record<CannotReceiveEmailReason, string> = {
  desativado: 'A conta desse membro está desativada.',
  'email-nao-verificado': 'O e-mail desse membro ainda não foi confirmado.',
  descadastrado: 'Esse membro pediu para não receber e-mails.',
};

export interface CampaignResult {
  id: string;
  status: CampaignStatus;
  audienceCount: number;
  sentCount: number;
  failedCount: number;
}

/**
 * O único caminho de envio do produto (spec 014, decisão 3).
 *
 * **Disparo manual e disparo automático são o mesmo caminho.** Os dois produzem
 * um `email_campaigns/{id}` e passam por aqui; o que muda é quem escreve o
 * documento e o que vai dentro dele. O envio, o lote, o descadastro, o cabeçalho
 * e o registro são um código só.
 *
 * Dois caminhos de envio seria o desenho óbvio — "e-mail transacional é uma
 * coisa, campanha é outra" — e seria a origem garantida da primeira falha grave:
 * o caminho automático esqueceria o descadastro, porque quem escreve gatilho não
 * está pensando em lista. Aqui não dá para esquecer: **não existe função que
 * envie sem passar por onde o descadastro é aplicado.**
 */
@Injectable()
export class EmailCampaignService {
  private readonly logger = new Logger(EmailCampaignService.name);
  private readonly unsubscribeSecret: string;
  private readonly apiUrl: string;
  /**
   * Se os cabeçalhos `List-Unsubscribe` acompanham o envio.
   *
   * **Existe para a pergunta ser medida, e não discutida.** A suspeita é que
   * eles sejam o que joga o e-mail na aba Promoções do Gmail — e ela é
   * plausível, porque `List-Unsubscribe` é literalmente o que declara a
   * mensagem como correspondência de lista. Não dá para saber sem enviar dos
   * dois jeitos para a mesma caixa e olhar, e um `git revert` entre um envio e
   * outro não é medição: é uma variável a mais.
   *
   * **Ligado é o padrão, e o padrão é o certo.** Desligar tem preço conhecido:
   * some o botão "Cancelar inscrição" que o Gmail desenha no topo da mensagem, e
   * quem quer sair da lista aperta "marcar como spam" — que é muito pior do que
   * a aba Promoções, e é irreversível para a reputação do domínio. Google e
   * Yahoo exigem estes cabeçalhos de quem manda mais de 5.000 mensagens por dia;
   * abaixo disso desligar não infringe regra nenhuma, mas continua sendo uma
   * troca ruim fora de um teste.
   *
   * O link no rodapé **não depende disto** e nunca desaparece (decisão 8).
   */
  private readonly listUnsubscribeHeaders: boolean;

  constructor(
    private readonly repository: EmailCampaignRepository,
    private readonly audience: AudienceService,
    private readonly mailer: MailerService,
    private readonly configService: ConfigService,
  ) {
    this.unsubscribeSecret = this.configService.getOrThrow<string>(
      'EMAIL_UNSUBSCRIBE_SECRET',
    );

    // O link do rodapé precisa ser absoluto: e-mail não tem roteador. A base é a
    // própria API, porque quem responde ao descadastro é este servidor.
    this.apiUrl = (
      this.configService.get<string>('API_PUBLIC_URL') ??
      `http://localhost:${this.configService.get<string>('PORT') ?? '3000'}`
    ).replace(/\/+$/, '');

    // Ausente significa LIGADO. Só o `off` explícito desliga: um erro de
    // digitação na variável não pode virar um envio sem cabeçalho, porque o
    // sintoma disso aparece semanas depois, na reputação.
    this.listUnsubscribeHeaders =
      this.configService
        .get<string>('EMAIL_LIST_UNSUBSCRIBE')
        ?.toLowerCase() !== 'off';

    if (!this.listUnsubscribeHeaders) {
      this.logger.warn(
        'EMAIL_LIST_UNSUBSCRIBE=off: os e-mails vao SEM os cabecalhos de ' +
          'descadastro. Isto e para medir a aba do Gmail, e nao para ficar ' +
          'assim: sem eles o Gmail nao desenha o botao de cancelar inscricao, e ' +
          'quem quer sair aperta "marcar como spam".',
      );
    }
  }

  /**
   * Cria a campanha e dispara, **dentro da requisição**.
   *
   * O trinco de um disparo por vez vem antes de tudo (decisão 15): se já existe
   * campanha `enviando`, responde `409` e a segunda não começa.
   *
   * Audiência zero é `400`, e não uma campanha vazia: **campanha para zero
   * pessoa é sempre engano** — filtro trocado, faixa invertida, tier que não
   * existe mais.
   */
  async createAndSend(
    data: Omit<CreateCampaignData, 'audienceCount'> & {
      excludeUid?: string | null;
    },
  ): Promise<CampaignResult> {
    const emAndamento = await this.repository.findSending();
    if (emAndamento.found) {
      throw new ConflictException(
        'Já existe um disparo em andamento. Espere ele terminar antes de começar outro.',
      );
    }

    const membros = await this.audience.build({
      ...data.filters,
      excludeUid: data.excludeUid ?? null,
    });

    if (membros.length === 0) {
      throw new BadRequestException(
        'Esses filtros não pegam ninguém (0 pessoas). Campanha para zero pessoa é sempre engano.',
      );
    }

    let entry: EmailCampaign;
    try {
      ({ entry } = await this.repository.create({
        ...data,
        audienceCount: membros.length,
      }));
    } catch (error) {
      // **Campanha de vídeo que já existe não lança e não envia de novo.** O id
      // é `video__{badgeId}__{youtubeId}`, e é o `ALREADY_EXISTS` do `create()`
      // que impede um retry de rede de anunciar o mesmo vídeo duas vezes para a
      // base inteira. Engolido em silêncio, como na spec 012.
      if (data.id && isAlreadyExists(error)) {
        this.logger.log(
          `Campanha ${data.id} ja existia: nada foi enviado de novo.`,
        );
        return {
          id: data.id,
          status: 'concluida',
          audienceCount: 0,
          sentCount: 0,
          failedCount: 0,
        };
      }

      throw error;
    }

    return this.dispatch(entry, membros);
  }

  /**
   * Um recado para uma pessoa (spec 015, decisão 10).
   *
   * **Não é um caminho de envio novo.** Ele monta um `email_campaigns` com
   * `kind: 'direto'` e cai no mesmo `dispatch` da campanha — é a decisão 3 da
   * spec 014 aplicada pela terceira vez: *o envio, o lote, o descadastro, o
   * cabeçalho e o registro são um código só*. O que muda entre a campanha de
   * vídeo, a manual e este é quem escreve o documento, nunca o caminho.
   *
   * **O rodapé de descadastro vai neste e-mail também** (decisão 13), e não há
   * caminho no template que gere e-mail sem ele. Parece severo — "é uma mensagem
   * pessoal" — e é a leitura errada do que esta rota é: ela manda um e-mail com
   * o remetente, o template e o rodapé do produto. A conversa pessoal de
   * verdade existe e tem outro caminho, que é o cliente de e-mail do Leno.
   *
   * Os três cortes valem, e o motivo volta nomeado num `422` — e não no `400`
   * de audiência zero, que não diria à tela o que escrever.
   */
  async sendDirect(data: {
    recipientUid: string;
    subject: string;
    body: string;
    createdBy: string;
  }): Promise<CampaignResult> {
    // O trinco vem antes de tudo, como na campanha (decisao 14). E um incomodo
    // real e aceito: quem dispara para a base e lembra de escrever para uma
    // pessoa espera os poucos segundos do envio. Abrir excecao significaria uma
    // segunda porta para o provedor no mesmo instante.
    const emAndamento = await this.repository.findSending();
    if (emAndamento.found) {
      throw new ConflictException(
        'Tem um disparo acontecendo agora. Espere ele terminar para escrever para este membro.',
      );
    }

    const { member, reason, label } = await this.audience.buildOne(
      data.recipientUid,
    );

    if (!member) {
      if (reason === null) {
        throw new NotFoundException('Esse membro não existe.');
      }

      // 422 com o motivo NOMEADO: a tela escolhe o texto pelo codigo, e nunca
      // por leitura da mensagem — texto de erro nao e contrato.
      throw new UnprocessableEntityException({
        statusCode: 422,
        reason,
        message: MOTIVO_EM_PROSA[reason],
      });
    }

    const { entry } = await this.repository.create({
      kind: 'direto',
      subject: data.subject,
      body: data.body,
      // Sem botao de acao (decisao 12): um recado para uma pessoa nao tem para
      // onde apontar, e o unico botao que existiria seria "clique aqui".
      ctaLabel: null,
      ctaUrl: null,
      // Os filtros ficam nulos, e e por isso que `recipientUid` e lido ANTES
      // deles em `buildAudience`: filtro nulo significa todos os membros.
      filters: { tiers: null, gradeMin: null, gradeMax: null },
      recipientUid: member.uid,
      // O rotulo e o nome no instante do envio (decisao 15): a conta pode mudar
      // de nome ou deixar de existir, e a linha do historico precisa continuar
      // legivel. E a mesma denormalizacao do `authorName` do Mural.
      recipientLabel: label,
      audienceCount: 1,
      createdBy: data.createdBy,
    });

    return this.dispatch(entry, [member]);
  }

  /**
   * Retoma uma campanha `interrompida`, **a partir do cursor**.
   *
   * Não do começo: o cursor é exatamente o que existe para isso. Campanha
   * `concluida` responde `409` — retomar algo que terminou seria reenviar.
   */
  async resume(id: string): Promise<CampaignResult> {
    const { found, entry } = await this.repository.findById(id);
    if (!found || !entry) {
      throw new NotFoundException('Campanha não encontrada.');
    }

    if (entry.status !== 'interrompida') {
      throw new ConflictException(
        'Só campanha interrompida pode ser retomada.',
      );
    }

    const emAndamento = await this.repository.findSending();
    if (emAndamento.found) {
      throw new ConflictException(
        'Já existe um disparo em andamento. Espere ele terminar antes de retomar este.',
      );
    }

    const membros = await this.audience.build(entry.filters);

    return this.dispatch(entry, membros);
  }

  /** As mais recentes, para o histórico da tela. */
  async listRecent(): Promise<EmailCampaign[]> {
    return this.repository.listRecent();
  }

  /**
   * Monta o e-mail e manda **para um endereço só**, sem criar campanha.
   *
   * Existe pela mesma razão da prévia de audiência: disparo de e-mail é a
   * operação mais irreversível do produto. E-mail que saiu, saiu — não há
   * edição, não há apagar, e o erro fica na caixa de entrada de todo mundo com o
   * nome do produto em cima.
   */
  async sendTest(
    to: string,
    uid: string,
    content: {
      subject: string;
      body: string;
      ctaLabel?: string | null;
      ctaUrl?: string | null;
    },
  ): Promise<void> {
    const resultado = await this.mailer.send(this.compose(uid, to, content));

    if (resultado.failed > 0) {
      throw new BadRequestException(
        `Não consegui enviar o teste: ${resultado.error ?? 'falha desconhecida'}`,
      );
    }
  }

  /**
   * O envio em lotes, com o cursor gravado a cada um (decisão 4).
   *
   * **Um lote pode duplicar, e está aceito.** Se o envio do lote sete for aceito
   * pelo provedor e a gravação do cursor falhar logo depois, retomar reenvia
   * aquelas cem pessoas. Duplicar um e-mail para cem pessoas é um incômodo;
   * perder o envio para as outras mil é o recurso não funcionando. A alternativa
   * — um registro por destinatário — é fan-out de escrita.
   */
  private async dispatch(
    campaign: EmailCampaign,
    audiencia: readonly AudienceMember[],
  ): Promise<CampaignResult> {
    // Retomar começa **depois** do cursor, e nunca do início.
    const pendentes = campaign.cursorUid
      ? audiencia.filter((membro) => membro.uid > campaign.cursorUid!)
      : audiencia;

    let sentCount = campaign.sentCount;
    let failedCount = campaign.failedCount;
    let cursorUid = campaign.cursorUid;
    let erro: string | null = null;

    for (let inicio = 0; inicio < pendentes.length; inicio += BATCH_SIZE) {
      const lote = pendentes.slice(inicio, inicio + BATCH_SIZE);

      const resultado = await this.mailer.sendBatch(
        lote.map((membro) => this.compose(membro.uid, membro.email, campaign)),
      );

      if (resultado.failed > 0) {
        // O lote inteiro falhou. A campanha para aqui e fica `interrompida` com
        // o cursor no fim do último lote confirmado — "Retomar" continua dali.
        failedCount += resultado.failed;
        erro = resultado.error;
        break;
      }

      sentCount += resultado.sent;
      cursorUid = lote[lote.length - 1].uid;

      await this.repository.updateProgress(
        campaign.id,
        cursorUid,
        sentCount,
        failedCount,
      );
    }

    const status: CampaignStatus = erro ? 'interrompida' : 'concluida';
    await this.repository.finish(campaign.id, status, erro);

    if (erro) {
      this.logger.error(
        `Campanha ${campaign.id} interrompida em ${sentCount}/${campaign.audienceCount}: ${erro}`,
      );
    }

    return {
      id: campaign.id,
      status,
      audienceCount: campaign.audienceCount,
      sentCount,
      failedCount,
    };
  }

  /**
   * Monta a mensagem de uma pessoa.
   *
   * **O token do cabeçalho e o do rodapé são o mesmo, do mesmo `uid`**, e é por
   * isso que os dois saem daqui e de uma variável só: trocá-los descadastraria a
   * pessoa errada, e nada na tela denunciaria.
   *
   * Os cabeçalhos `List-Unsubscribe` e `List-Unsubscribe-Post` são **requisito
   * de remetente em massa do Gmail e do Yahoo desde 2024**, não refinamento: sem
   * eles a entrega degrada por política, independentemente do conteúdo.
   */
  private compose(
    uid: string,
    to: string,
    content: {
      subject: string;
      body: string;
      ctaLabel?: string | null;
      ctaUrl?: string | null;
    },
  ): OutgoingEmail {
    const token = signUnsubscribeToken(uid, this.unsubscribeSecret);
    const unsubscribeUrl = `${this.apiUrl}/emails/descadastro?token=${token}`;

    const { html, text } = renderEmail({
      subject: content.subject,
      body: content.body,
      ctaLabel: content.ctaLabel ?? null,
      ctaUrl: content.ctaUrl ?? null,
      unsubscribeUrl,
    });

    return {
      to,
      subject: content.subject,
      html,
      text,
      headers: this.listUnsubscribeHeaders
        ? {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }
        : // Sem cabeçalho nenhum, e **o rodapé continua lá**: quem quer sair
          // continua tendo um caminho de um clique, ele só deixa de ser o botão
          // nativo do cliente de e-mail.
          undefined,
    };
  }
}

/**
 * `true` quando o Firestore recusou por o documento já existir.
 *
 * A constante vem de `waitlist.repository.ts`, onde ela nasceu ocupando o lugar
 * do `23505` do Postgres. É a mesma corrida, na mesma casa.
 */
function isAlreadyExists(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === ALREADY_EXISTS
  );
}
