import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/** Uma mensagem pronta para sair. O destinatário é um só por mensagem. */
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Cabeçalhos de lista (`List-Unsubscribe` e `List-Unsubscribe-Post`).
   *
   * São **por destinatário**, porque o token do descadastro é de um `uid` só —
   * é por isso que eles não moram no serviço e chegam com a mensagem.
   */
  headers?: Record<string, string>;
}

/** O que o envio em lote devolve: quantas saíram e quantas o provedor recusou. */
export interface BatchResult {
  sent: number;
  failed: number;
  error: string | null;
}

/**
 * A única porta de saída de e-mail do projeto (spec 014, decisão 1).
 *
 * **O pacote `resend` é importado aqui e em nenhum outro arquivo.** É a mesma
 * cerca que o `FirebaseService` faz em volta do `firebase-admin`, e ela já
 * provou o valor quando o Supabase virou Firestore em duas classes. Nenhum
 * service de campanha pode conhecer o nome do provedor.
 *
 * SMTP foi recusado pelo ambiente: a API roda em função serverless, e conexão
 * SMTP em serverless é o pior caso possível — handshake por invocação, sem lote,
 * e um disparo em massa vira N conexões abertas por uma função que pode morrer
 * no meio. A API HTTP tem envio em lote de 100 numa requisição, que é exatamente
 * a forma do problema aqui.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  /**
   * Nulo quando não há chave, e a ausência é o modo de operação (decisão 16).
   *
   * **O cliente nem é instanciado nesse caso.** O perigo real do desenvolvimento
   * não é o e-mail que não sai: é o e-mail que sai. Uma máquina de
   * desenvolvimento apontada para o Firestore de produção, um teste rodando o
   * gatilho de vídeo, e a base inteira recebe. O padrão precisa ser inofensivo,
   * e ligar precisa ser um ato deliberado — em produção o boot exige a chave
   * (`env.validation.ts`).
   */
  private readonly client: Resend | null;

  private readonly from: string;
  private readonly replyTo: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.client = apiKey ? new Resend(apiKey) : null;

    this.from = this.configService.getOrThrow<string>('EMAIL_FROM');
    this.replyTo = this.configService.getOrThrow<string>('EMAIL_REPLY_TO');

    if (!this.client) {
      this.logger.warn(
        'RESEND_API_KEY ausente: nenhum e-mail sera enviado. As mensagens vao para o log.',
      );
    }
  }

  /** Se este processo envia de verdade. O gatilho usa para decidir o que logar. */
  get enabled(): boolean {
    return this.client !== null;
  }

  async send(message: OutgoingEmail): Promise<BatchResult> {
    return this.sendBatch([message]);
  }

  /**
   * Envia um lote. **Nunca uma requisição por destinatário.**
   *
   * O provedor aceita 100 mensagens por requisição, e é esse número que a
   * campanha usa para fatiar a audiência. Um envio por pessoa transformaria mil
   * membros em mil chamadas HTTP dentro de uma função serverless.
   */
  async sendBatch(messages: readonly OutgoingEmail[]): Promise<BatchResult> {
    if (messages.length === 0) {
      return { sent: 0, failed: 0, error: null };
    }

    if (!this.client) {
      // Modo log: registra o suficiente para conferir a audiência e o assunto, e
      // **nada sai pela rede**. O corpo não vai para o log de propósito — ele é
      // longo e o que se quer conferir aqui é para quem foi.
      for (const message of messages) {
        this.logger.log(
          `[modo log] Para: ${message.to} | Assunto: ${message.subject}`,
        );
      }

      return { sent: messages.length, failed: 0, error: null };
    }

    try {
      const response = await this.client.batch.send(
        messages.map((message) => ({
          from: this.from,
          replyTo: this.replyTo,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: message.headers,
        })),
      );

      if (response.error) {
        return {
          sent: 0,
          failed: messages.length,
          error: response.error.message,
        };
      }

      return { sent: messages.length, failed: 0, error: null };
    } catch (error) {
      // Falha de rede derruba o lote inteiro, e quem decide o que fazer com isso
      // é a campanha: ela para, marca `interrompida` e guarda o cursor.
      return {
        sent: 0,
        failed: messages.length,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
