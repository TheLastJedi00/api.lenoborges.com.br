import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailerService } from './mailer.service';

const batchSend = jest.fn();
const construidos: string[] = [];

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation((apiKey: string) => {
    construidos.push(apiKey);
    return { batch: { send: batchSend } };
  }),
}));

function build(
  env: Record<string, string | undefined>,
): Promise<MailerService> {
  return Test.createTestingModule({
    providers: [
      MailerService,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => env[key],
          getOrThrow: (key: string) => {
            const value = env[key];
            if (!value) {
              throw new Error(`${key} ausente`);
            }
            return value;
          },
        },
      },
    ],
  })
    .compile()
    .then((module: TestingModule) => module.get(MailerService));
}

const baseEnv = {
  EMAIL_FROM: 'Liga Dev <comunidade@lenoborges.com.br>',
  EMAIL_REPLY_TO: 'leno@lenoborges.com.br',
};

const mensagem = {
  to: 'membro@exemplo.com',
  subject: 'Vídeo novo',
  html: '<p>oi</p>',
  text: 'oi',
};

describe('MailerService', () => {
  beforeEach(() => {
    batchSend.mockReset();
    construidos.length = 0;
  });

  describe('sem RESEND_API_KEY', () => {
    /**
     * O perigo real do desenvolvimento não é o e-mail que não sai: é o e-mail
     * que sai. Uma máquina de desenvolvimento apontada para o Firestore de
     * produção, um teste rodando o gatilho de vídeo, e a base inteira recebe.
     */
    it('teste-trava: nenhuma chamada de rede sai, e o cliente nem e instanciado', async () => {
      const mailer = await build({ ...baseEnv });

      const resultado = await mailer.send(mensagem);

      expect(resultado).toEqual({ sent: 1, failed: 0, error: null });
      expect(batchSend).not.toHaveBeenCalled();
      expect(construidos).toEqual([]);
      expect(mailer.enabled).toBe(false);
    });

    it('loga e devolve sucesso, para o chamador nao tratar como falha', async () => {
      const mailer = await build({ ...baseEnv });

      await expect(
        mailer.sendBatch([mensagem, { ...mensagem, to: 'outro@exemplo.com' }]),
      ).resolves.toEqual({ sent: 2, failed: 0, error: null });
    });
  });

  describe('com RESEND_API_KEY', () => {
    it('instancia o cliente uma vez e manda o lote inteiro numa requisicao', async () => {
      batchSend.mockResolvedValue({ data: {}, error: null });
      const mailer = await build({ ...baseEnv, RESEND_API_KEY: 're_x' });

      const resultado = await mailer.sendBatch([
        mensagem,
        { ...mensagem, to: 'outro@exemplo.com' },
      ]);

      expect(construidos).toEqual(['re_x']);
      expect(batchSend).toHaveBeenCalledTimes(1);
      const enviadas = (batchSend.mock.calls[0] as unknown[])[0] as unknown[];
      expect(enviadas.length).toBe(2);
      expect(resultado).toEqual({ sent: 2, failed: 0, error: null });
    });

    it('o remetente e o reply-to vem da configuracao, e nao do chamador', async () => {
      batchSend.mockResolvedValue({ data: {}, error: null });
      const mailer = await build({ ...baseEnv, RESEND_API_KEY: 're_x' });

      await mailer.send(mensagem);

      const [primeira] = (batchSend.mock.calls[0] as unknown[])[0] as {
        from: string;
        replyTo: string;
        headers?: Record<string, string>;
      }[];
      expect(primeira.from).toBe('Liga Dev <comunidade@lenoborges.com.br>');
      expect(primeira.replyTo).toBe('leno@lenoborges.com.br');
    });

    it('repassa os cabecalhos de lista, que sao por destinatario', async () => {
      batchSend.mockResolvedValue({ data: {}, error: null });
      const mailer = await build({ ...baseEnv, RESEND_API_KEY: 're_x' });

      await mailer.send({
        ...mensagem,
        headers: { 'List-Unsubscribe': '<https://api/x?token=a>' },
      });

      const [primeira] = (batchSend.mock.calls[0] as unknown[])[0] as {
        headers?: Record<string, string>;
      }[];
      expect(primeira.headers?.['List-Unsubscribe']).toBe(
        '<https://api/x?token=a>',
      );
    });

    it('recusa do provedor conta o lote inteiro como falha, sem lancar', async () => {
      // Quem decide o que fazer com isso e a campanha: ela para, marca
      // `interrompida` e guarda o cursor.
      batchSend.mockResolvedValue({
        data: null,
        error: { message: 'rate limit' },
      });
      const mailer = await build({ ...baseEnv, RESEND_API_KEY: 're_x' });

      await expect(mailer.sendBatch([mensagem])).resolves.toEqual({
        sent: 0,
        failed: 1,
        error: 'rate limit',
      });
    });

    it('falha de rede tambem vira resultado, e nao excecao', async () => {
      batchSend.mockRejectedValue(new Error('socket hang up'));
      const mailer = await build({ ...baseEnv, RESEND_API_KEY: 're_x' });

      await expect(mailer.sendBatch([mensagem])).resolves.toEqual({
        sent: 0,
        failed: 1,
        error: 'socket hang up',
      });
    });
  });

  it('lote vazio nao chama o provedor', async () => {
    batchSend.mockResolvedValue({ data: {}, error: null });
    const mailer = await build({ ...baseEnv, RESEND_API_KEY: 're_x' });

    await expect(mailer.sendBatch([])).resolves.toEqual({
      sent: 0,
      failed: 0,
      error: null,
    });
    expect(batchSend).not.toHaveBeenCalled();
  });
});
