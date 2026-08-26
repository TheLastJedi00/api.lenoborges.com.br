import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BATCH_SIZE, EmailCampaignService } from './email-campaign.service';
import { EmailCampaignRepository } from './email-campaign.repository';
import { AudienceService } from './audience.service';
import { MailerService, OutgoingEmail } from './mailer.service';
import { EmailCampaign } from './entities/email-campaign.entity';
import { verifyUnsubscribeToken } from './unsubscribe-token';

const SEGREDO = 'segredo-de-teste';

const env: Record<string, string> = {
  EMAIL_UNSUBSCRIBE_SECRET: SEGREDO,
  API_PUBLIC_URL: 'https://api.exemplo.com',
};

function campanha(overrides: Partial<EmailCampaign> = {}): EmailCampaign {
  return {
    id: 'camp-1',
    kind: 'manual',
    subject: 'Assunto',
    body: 'Corpo com mais de dez caracteres.',
    ctaLabel: null,
    ctaUrl: null,
    filters: { tiers: null, gradeMin: null, gradeMax: null },
    recipientUid: null,
    recipientLabel: null,
    status: 'enviando',
    audienceCount: 0,
    sentCount: 0,
    failedCount: 0,
    cursorUid: null,
    createdBy: 'admin-1',
    createdAt: new Date('2026-08-25T12:00:00.000Z'),
    finishedAt: null,
    error: null,
    ...overrides,
  };
}

/** N membros com uid ordenável: uid-000, uid-001, … */
function membros(quantidade: number) {
  return Array.from({ length: quantidade }, (_, indice) => ({
    uid: `uid-${String(indice).padStart(3, '0')}`,
    email: `membro${indice}@exemplo.com`,
  }));
}

interface Mocks {
  service: EmailCampaignService;
  repository: {
    create: jest.Mock;
    findById: jest.Mock;
    findSending: jest.Mock;
    updateProgress: jest.Mock;
    finish: jest.Mock;
    listRecent: jest.Mock;
  };
  audience: { build: jest.Mock; buildOne: jest.Mock; count: jest.Mock };
  mailer: { send: jest.Mock; sendBatch: jest.Mock };
}

function build(): Mocks {
  const repository = {
    create: jest.fn(),
    findById: jest.fn(),
    findSending: jest.fn().mockResolvedValue({ found: false, entry: null }),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    finish: jest.fn().mockResolvedValue(undefined),
    listRecent: jest.fn().mockResolvedValue([]),
  };

  const audience = {
    build: jest.fn().mockResolvedValue([]),
    buildOne: jest.fn(),
    count: jest.fn(),
  };

  const mailer = {
    send: jest.fn().mockResolvedValue({ sent: 1, failed: 0, error: null }),
    sendBatch: jest.fn(),
  };

  const service = new EmailCampaignService(
    repository as unknown as EmailCampaignRepository,
    audience as unknown as AudienceService,
    mailer as unknown as MailerService,
    {
      get: (k: string) => env[k],
      getOrThrow: (k: string) => env[k],
    } as ConfigService,
  );

  return { service, repository, audience, mailer };
}

/** O lote inteiro aceito pelo provedor. */
function loteOk() {
  return (mensagens: OutgoingEmail[]) =>
    Promise.resolve({ sent: mensagens.length, failed: 0, error: null });
}

describe('EmailCampaignService', () => {
  describe('createAndSend', () => {
    const pedido = {
      kind: 'manual' as const,
      subject: 'Assunto',
      body: 'Corpo com mais de dez caracteres.',
      ctaLabel: null,
      ctaUrl: null,
      filters: { tiers: null, gradeMin: null, gradeMax: null },
      createdBy: 'admin-1',
    };

    /**
     * Dois disparos concorrentes estouram o limite do provedor, embaralham os
     * dois cursores e, no pior caso, mandam duas campanhas para a mesma pessoa
     * no mesmo minuto. O sintoma sem este teste é e-mail duplicado sob carga — o
     * pior bug possível desta spec para reproduzir depois.
     */
    it('teste-trava: com outra campanha enviando, responde 409 e nada comeca', async () => {
      const { service, repository, audience, mailer } = build();
      repository.findSending.mockResolvedValue({
        found: true,
        entry: campanha(),
      });

      await expect(service.createAndSend(pedido)).rejects.toThrow(
        ConflictException,
      );

      expect(audience.build).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(mailer.sendBatch).not.toHaveBeenCalled();
    });

    it('audiencia zero responde 400 e nao cria campanha', async () => {
      // Campanha para zero pessoa é sempre engano: filtro trocado, faixa
      // invertida, tier que não existe mais.
      const { service, repository } = build();
      repository.findSending.mockResolvedValue({ found: false, entry: null });

      await expect(service.createAndSend(pedido)).rejects.toThrow(
        BadRequestException,
      );

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('teste-trava: audiencia de 250 vira tres lotes', async () => {
      const { service, repository, audience, mailer } = build();
      audience.build.mockResolvedValue(membros(250));
      repository.create.mockImplementation((data: { audienceCount: number }) =>
        Promise.resolve({
          entry: campanha({ audienceCount: data.audienceCount }),
        }),
      );
      mailer.sendBatch.mockImplementation(loteOk());

      const resultado = await service.createAndSend(pedido);

      expect(mailer.sendBatch).toHaveBeenCalledTimes(3);
      const tamanhos = (mailer.sendBatch.mock.calls as unknown[][]).map(
        (call) => (call[0] as unknown[]).length,
      );
      expect(tamanhos).toEqual([BATCH_SIZE, BATCH_SIZE, 50]);
      expect(resultado.sentCount).toBe(250);
      expect(resultado.status).toBe('concluida');
    });

    it('grava o cursor depois de CADA lote, e nao so no fim', async () => {
      const { service, repository, audience, mailer } = build();
      audience.build.mockResolvedValue(membros(250));
      repository.create.mockResolvedValue({
        entry: campanha({ audienceCount: 250 }),
      });
      mailer.sendBatch.mockImplementation(loteOk());

      await service.createAndSend(pedido);

      expect(repository.updateProgress).toHaveBeenCalledTimes(3);
      const cursores = (
        repository.updateProgress.mock.calls as unknown[][]
      ).map((call) => call[1] as string);
      expect(cursores).toEqual(['uid-099', 'uid-199', 'uid-249']);
    });

    /**
     * O cursor é o que torna a falha recuperável. Sem ele, retomar reenviaria
     * do começo — e o começo já recebeu.
     */
    it('teste-trava: falha no terceiro lote deixa interrompida com o cursor no fim do segundo', async () => {
      const { service, repository, audience, mailer } = build();
      audience.build.mockResolvedValue(membros(250));
      repository.create.mockResolvedValue({
        entry: campanha({ audienceCount: 250 }),
      });
      mailer.sendBatch
        .mockImplementationOnce(loteOk())
        .mockImplementationOnce(loteOk())
        .mockResolvedValueOnce({ sent: 0, failed: 50, error: 'rate limit' });

      const resultado = await service.createAndSend(pedido);

      expect(resultado.status).toBe('interrompida');
      expect(resultado.sentCount).toBe(200);
      expect(resultado.failedCount).toBe(50);

      const ultimoCursor = (
        repository.updateProgress.mock.calls as unknown[][]
      ).at(-1)?.[1];
      expect(ultimoCursor).toBe('uid-199');
      expect(repository.finish).toHaveBeenCalledWith(
        'camp-1',
        'interrompida',
        'rate limit',
      );
    });

    it('campanha de video que ja existe nao lanca e nao envia de novo', async () => {
      // É o ALREADY_EXISTS que impede um retry de rede de anunciar o mesmo
      // vídeo duas vezes para a base inteira.
      const { service, repository, audience, mailer } = build();
      audience.build.mockResolvedValue(membros(10));
      repository.create.mockRejectedValue(
        Object.assign(new Error('already exists'), { code: 6 }),
      );

      const resultado = await service.createAndSend({
        ...pedido,
        id: 'video__logica__abc',
        kind: 'video',
      });

      expect(resultado.status).toBe('concluida');
      expect(resultado.sentCount).toBe(0);
      expect(mailer.sendBatch).not.toHaveBeenCalled();
    });

    it('outro erro na criacao continua estourando', async () => {
      const { service, repository, audience } = build();
      audience.build.mockResolvedValue(membros(10));
      repository.create.mockRejectedValue(new Error('firestore offline'));

      await expect(
        service.createAndSend({ ...pedido, id: 'video__x__y' }),
      ).rejects.toThrow('firestore offline');
    });
  });

  describe('cabecalhos de lista', () => {
    /**
     * Trocar os tokens descadastraria a pessoa errada, e nada na tela
     * denunciaria. Os dois saem da mesma variável de propósito.
     */
    it('teste-trava: o token do cabecalho e o do rodape sao do MESMO uid', async () => {
      const { service, repository, audience, mailer } = build();
      audience.build.mockResolvedValue(membros(2));
      repository.create.mockResolvedValue({
        entry: campanha({ audienceCount: 2 }),
      });
      mailer.sendBatch.mockImplementation(loteOk());

      await service.createAndSend({
        kind: 'manual',
        subject: 'Assunto',
        body: 'Corpo com mais de dez caracteres.',
        ctaLabel: null,
        ctaUrl: null,
        filters: { tiers: null, gradeMin: null, gradeMax: null },
        createdBy: 'admin-1',
      });

      const lote = (
        mailer.sendBatch.mock.calls[0] as unknown[]
      )[0] as OutgoingEmail[];

      lote.forEach((mensagem, indice) => {
        const uidEsperado = `uid-${String(indice).padStart(3, '0')}`;

        const doCabecalho = /token=([^>]+)>/.exec(
          mensagem.headers!['List-Unsubscribe'],
        )![1];
        const doRodape = /token=([^"\s]+)/.exec(mensagem.text)![1];

        expect(doCabecalho).toBe(doRodape);
        expect(verifyUnsubscribeToken(doCabecalho, SEGREDO)).toBe(uidEsperado);
      });
    });

    it('todo e-mail sai com o One-Click, que e requisito do Gmail e do Yahoo', async () => {
      const { service, repository, audience, mailer } = build();
      audience.build.mockResolvedValue(membros(1));
      repository.create.mockResolvedValue({
        entry: campanha({ audienceCount: 1 }),
      });
      mailer.sendBatch.mockImplementation(loteOk());

      await service.createAndSend({
        kind: 'manual',
        subject: 'Assunto',
        body: 'Corpo com mais de dez caracteres.',
        ctaLabel: null,
        ctaUrl: null,
        filters: { tiers: null, gradeMin: null, gradeMax: null },
        createdBy: 'admin-1',
      });

      const [mensagem] = (
        mailer.sendBatch.mock.calls[0] as unknown[]
      )[0] as OutgoingEmail[];
      expect(mensagem.headers!['List-Unsubscribe-Post']).toBe(
        'List-Unsubscribe=One-Click',
      );
      expect(mensagem.headers!['List-Unsubscribe']).toMatch(
        /^<https:\/\/api\.exemplo\.com\/emails\/descadastro\?token=.+>$/,
      );
    });
  });

  describe('resume', () => {
    it('teste-trava: retomar comeca DEPOIS do cursor, e nao do inicio', async () => {
      const { service, repository, audience, mailer } = build();
      repository.findById.mockResolvedValue({
        found: true,
        entry: campanha({
          status: 'interrompida',
          audienceCount: 250,
          sentCount: 200,
          cursorUid: 'uid-199',
        }),
      });
      audience.build.mockResolvedValue(membros(250));
      mailer.sendBatch.mockImplementation(loteOk());

      const resultado = await service.resume('camp-1');

      expect(mailer.sendBatch).toHaveBeenCalledTimes(1);
      const lote = (
        mailer.sendBatch.mock.calls[0] as unknown[]
      )[0] as OutgoingEmail[];
      expect(lote.length).toBe(50);
      expect(lote[0].to).toBe('membro200@exemplo.com');
      expect(resultado.sentCount).toBe(250);
      expect(resultado.status).toBe('concluida');
    });

    it('campanha concluida responde 409', async () => {
      // Retomar algo que terminou seria reenviar.
      const { service, repository } = build();
      repository.findById.mockResolvedValue({
        found: true,
        entry: campanha({ status: 'concluida' }),
      });

      await expect(service.resume('camp-1')).rejects.toThrow(ConflictException);
    });

    it('campanha inexistente responde 404', async () => {
      const { service, repository } = build();
      repository.findById.mockResolvedValue({ found: false, entry: null });

      await expect(service.resume('sumiu')).rejects.toThrow(/não encontrada/);
    });
  });

  describe('sendTest', () => {
    it('manda para um endereco so e NAO cria campanha', async () => {
      const { service, repository, mailer } = build();

      await service.sendTest('admin@exemplo.com', 'admin-1', {
        subject: 'Assunto',
        body: 'Corpo com mais de dez caracteres.',
      });

      expect(mailer.send).toHaveBeenCalledTimes(1);
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.findSending).not.toHaveBeenCalled();
    });

    it('o teste tambem sai com o rodape de descadastro', async () => {
      const { service, mailer } = build();

      await service.sendTest('admin@exemplo.com', 'admin-1', {
        subject: 'Assunto',
        body: 'Corpo com mais de dez caracteres.',
      });

      const [mensagem] = mailer.send.mock.calls[0] as unknown[] as [
        OutgoingEmail,
      ];
      expect(mensagem.text).toContain('Cancelar inscrição');
    });

    it('falha do provedor no teste vira 400, para o admin ver antes de disparar', async () => {
      const { service, mailer } = build();
      mailer.send.mockResolvedValue({
        sent: 0,
        failed: 1,
        error: 'domain not verified',
      });

      await expect(
        service.sendTest('admin@exemplo.com', 'admin-1', {
          subject: 'Assunto',
          body: 'Corpo com mais de dez caracteres.',
        }),
      ).rejects.toThrow(/domain not verified/);
    });
  });

  describe('sendDirect — o e-mail direto (spec 015)', () => {
    const recado = {
      recipientUid: 'uid-membro',
      subject: 'Sobre a sua dúvida no Mural',
      body: 'Oi, Leno.\n\nVi sua pergunta e queria responder por aqui.',
      createdBy: 'admin-1',
    };

    function comDestinatario(mocks: Mocks) {
      mocks.audience.buildOne.mockResolvedValue({
        member: { uid: 'uid-membro', email: 'membro@exemplo.com' },
        reason: null,
        label: 'Leno Borges',
      });
      mocks.repository.create.mockImplementation(
        (data: Record<string, unknown>) =>
          Promise.resolve({ entry: campanha({ ...data, id: 'camp-direto' }) }),
      );
      mocks.mailer.sendBatch.mockImplementation(loteOk());
    }

    /**
     * **Nenhum caminho de envio novo** (decisão 10). O recado cai no mesmo
     * `dispatch` da campanha: o mesmo lote, o mesmo template, o mesmo rodapé.
     */
    it('teste-trava: escreve campanha `direto` e envia para UMA pessoa', async () => {
      const mocks = build();
      comDestinatario(mocks);

      const resultado = await mocks.service.sendDirect(recado);

      expect(mocks.repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'direto',
          recipientUid: 'uid-membro',
          recipientLabel: 'Leno Borges',
          audienceCount: 1,
          // Sem botao de acao: um recado para uma pessoa nao tem para onde
          // apontar (decisao 12).
          ctaLabel: null,
          ctaUrl: null,
        }),
      );

      const [lote] = mocks.mailer.sendBatch.mock.calls[0] as [OutgoingEmail[]];
      expect(lote).toHaveLength(1);
      expect(lote[0].to).toBe('membro@exemplo.com');
      expect(resultado).toMatchObject({ status: 'concluida', sentCount: 1 });
    });

    /**
     * **O rodapé de descadastro vai neste e-mail também** (decisão 13). É o
     * teste que documenta a decisão: e-mail com o remetente e o template do
     * produto é e-mail do produto, mesmo com um destinatário só.
     */
    it('teste-trava: o recado sai com rodapé de descadastro e List-Unsubscribe', async () => {
      const mocks = build();
      comDestinatario(mocks);

      await mocks.service.sendDirect(recado);

      const [lote] = mocks.mailer.sendBatch.mock.calls[0] as [OutgoingEmail[]];
      expect(lote[0].html).toContain('/emails/descadastro?token=');
      expect(lote[0].text).toContain('/emails/descadastro?token=');
      expect(lote[0].headers!['List-Unsubscribe']).toMatch(
        /^<https:\/\/api\.exemplo\.com\/emails\/descadastro\?token=.+>$/,
      );
      expect(lote[0].headers!['List-Unsubscribe-Post']).toBe(
        'List-Unsubscribe=One-Click',
      );
    });

    /**
     * O escape é do `renderEmail`, e é de lá (spec 014). Ninguém reimplementa
     * sanitização neste caminho: o corpo é texto puro, e marcação digitada sai
     * como texto.
     */
    it('teste-trava: marcação no corpo sai escapada, pelo template da spec 014', async () => {
      const mocks = build();
      comDestinatario(mocks);

      await mocks.service.sendDirect({
        ...recado,
        body: 'Olha isto: <b>negrito</b> e <script>alert(1)</script>.',
      });

      const [lote] = mocks.mailer.sendBatch.mock.calls[0] as [OutgoingEmail[]];
      expect(lote[0].html).toContain('&lt;b&gt;negrito&lt;/b&gt;');
      expect(lote[0].html).not.toContain('<script>');
    });

    describe('os três cortes valem, e o motivo volta nomeado', () => {
      const casos = [
        'desativado',
        'email-nao-verificado',
        'descadastrado',
      ] as const;

      // Um teste por corte. Nao ha excecao para "e so uma pessoa": o 422 e a
      // resposta, e nao o 400 de audiencia zero — que nao diria a tela o que
      // escrever.
      it.each(casos)('%s responde 422 com o reason', async (reason) => {
        const mocks = build();
        mocks.audience.buildOne.mockResolvedValue({
          member: null,
          reason,
          label: 'Leno Borges',
        });

        await expect(mocks.service.sendDirect(recado)).rejects.toMatchObject({
          status: 422,
          response: expect.objectContaining({ reason }) as unknown,
        });

        expect(mocks.repository.create).not.toHaveBeenCalled();
        expect(mocks.mailer.sendBatch).not.toHaveBeenCalled();
      });
    });

    it('uid que o Auth não conhece responde 404, e não 422', async () => {
      const mocks = build();
      mocks.audience.buildOne.mockResolvedValue({
        member: null,
        reason: null,
        label: null,
      });

      await expect(mocks.service.sendDirect(recado)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    /**
     * **O trinco de um disparo por vez vale aqui também** (decisão 14). É um
     * incômodo real e aceito: abrir exceção significaria uma segunda porta para
     * o provedor no mesmo instante, e o trinco existe para não haver duas.
     */
    it('teste-trava: campanha enviando responde 409, e reusa o findSending', async () => {
      const mocks = build();
      comDestinatario(mocks);
      mocks.repository.findSending.mockResolvedValue({
        found: true,
        entry: campanha({ status: 'enviando' }),
      });

      await expect(mocks.service.sendDirect(recado)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(mocks.repository.findSending).toHaveBeenCalled();
      expect(mocks.repository.create).not.toHaveBeenCalled();
    });

    it('o rótulo gravado é o que veio no instante do envio', async () => {
      const mocks = build();
      comDestinatario(mocks);
      mocks.audience.buildOne.mockResolvedValue({
        member: { uid: 'uid-membro', email: 'membro@exemplo.com' },
        reason: null,
        // Sem nome no perfil, o rotulo e o e-mail: a linha do historico precisa
        // continuar legivel de qualquer forma.
        label: 'membro@exemplo.com',
      });

      await mocks.service.sendDirect(recado);

      expect(mocks.repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ recipientLabel: 'membro@exemplo.com' }),
      );
    });
  });
});
