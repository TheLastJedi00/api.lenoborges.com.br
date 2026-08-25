import { Test, TestingModule } from '@nestjs/testing';
import { AdminEmailsController } from './admin-emails.controller';
import { AudienceService } from './audience.service';
import { EmailCampaignService } from './email-campaign.service';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

describe('AdminEmailsController', () => {
  let controller: AdminEmailsController;
  let audience: { count: jest.Mock; build: jest.Mock };
  let campaigns: {
    createAndSend: jest.Mock;
    resume: jest.Mock;
    sendTest: jest.Mock;
    listRecent: jest.Mock;
  };

  const admin: CurrentUserData = {
    id: 'admin-1',
    email: 'admin@exemplo.com',
    role: 'admin',
  };

  beforeEach(async () => {
    audience = { count: jest.fn().mockResolvedValue(42), build: jest.fn() };
    campaigns = {
      createAndSend: jest.fn(),
      resume: jest.fn(),
      sendTest: jest.fn(),
      listRecent: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminEmailsController],
      providers: [
        { provide: AudienceService, useValue: audience },
        { provide: EmailCampaignService, useValue: campaigns },
      ],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AdminEmailsController);
  });

  describe('POST /admin/emails/audiencia', () => {
    /**
     * Uma rota que despeja a base de e-mails a cada mudança de filtro é um
     * vazamento esperando um bug de autorização.
     */
    it('teste-trava: a resposta nao contem e-mail nenhum', async () => {
      const resposta = await controller.countAudience({});

      expect(resposta).toEqual({ count: 42 });
      expect(Object.keys(resposta)).toEqual(['count']);
      expect(JSON.stringify(resposta)).not.toContain('@');
    });

    it('repassa os filtros, e ausencia vira null e nunca lista vazia', async () => {
      // `tiers: []` significaria "nenhum tier" e mandaria para zero pessoa.
      await controller.countAudience({});

      expect(audience.count).toHaveBeenCalledWith({
        tiers: null,
        gradeMin: null,
        gradeMax: null,
      });
    });

    it('repassa tier e faixa de insignia quando vem no corpo', async () => {
      await controller.countAudience({
        tiers: ['ultra-dev-tier'],
        gradeMin: 3,
        gradeMax: 8,
      });

      expect(audience.count).toHaveBeenCalledWith({
        tiers: ['ultra-dev-tier'],
        gradeMin: 3,
        gradeMax: 8,
      });
    });
  });

  describe('os endpoints de campanha', () => {
    const corpo = {
      subject: 'Assunto',
      body: 'Corpo com mais de dez caracteres.',
    };

    it('POST /admin/emails cria como manual e repassa os filtros', async () => {
      campaigns.createAndSend.mockResolvedValue({
        id: 'camp-1',
        status: 'concluida',
        audienceCount: 42,
        sentCount: 42,
        failedCount: 0,
      });

      await controller.createCampaign(admin, {
        ...corpo,
        tiers: ['ultra-dev-tier'],
      });

      expect(campaigns.createAndSend).toHaveBeenCalledWith({
        kind: 'manual',
        subject: 'Assunto',
        body: 'Corpo com mais de dez caracteres.',
        ctaLabel: null,
        ctaUrl: null,
        filters: {
          tiers: ['ultra-dev-tier'],
          gradeMin: null,
          gradeMax: null,
        },
        createdBy: 'admin-1',
      });
    });

    it('POST /admin/emails/teste manda para o proprio admin e nao cria campanha', async () => {
      campaigns.sendTest.mockResolvedValue(undefined);

      await controller.sendTest(admin, corpo);

      expect(campaigns.sendTest).toHaveBeenCalledWith(
        'admin@exemplo.com',
        'admin-1',
        {
          subject: 'Assunto',
          body: 'Corpo com mais de dez caracteres.',
          ctaLabel: null,
          ctaUrl: null,
        },
      );
      expect(campaigns.createAndSend).not.toHaveBeenCalled();
    });

    it('POST /admin/emails/:id/retomar chama o resume', async () => {
      campaigns.resume.mockResolvedValue({
        id: 'camp-1',
        status: 'concluida',
        audienceCount: 250,
        sentCount: 250,
        failedCount: 0,
      });

      await controller.resumeCampaign('camp-1');

      expect(campaigns.resume).toHaveBeenCalledWith('camp-1');
    });

    /**
     * A listagem existe para responder "o que saiu e para quantos". O corpo do
     * e-mail é peso morto nela — até cinco mil caracteres por linha, vinte
     * linhas por resposta.
     */
    it('teste-trava: GET /admin/emails NAO devolve o corpo do e-mail', async () => {
      campaigns.listRecent.mockResolvedValue([
        {
          id: 'camp-1',
          kind: 'video',
          subject: 'Vídeo novo',
          body: 'O corpo inteiro que nao pode aparecer aqui.',
          ctaLabel: null,
          ctaUrl: null,
          filters: { tiers: null, gradeMin: null, gradeMax: null },
          status: 'concluida',
          audienceCount: 42,
          sentCount: 42,
          failedCount: 0,
          cursorUid: 'uid-041',
          createdBy: 'admin-1',
          createdAt: new Date('2026-08-25T12:00:00.000Z'),
          finishedAt: new Date('2026-08-25T12:00:05.000Z'),
          error: null,
        },
      ]);

      const linhas = await controller.listCampaigns();

      expect(linhas).toHaveLength(1);
      expect('body' in linhas[0]).toBe(false);
      expect(JSON.stringify(linhas)).not.toContain('O corpo inteiro');
      expect(linhas[0].createdAt).toBe('2026-08-25T12:00:00.000Z');
    });

    it('a listagem tambem nao devolve o cursor nem quem criou', async () => {
      // Sao detalhes de execucao, e a lista e para leitura humana.
      campaigns.listRecent.mockResolvedValue([
        {
          id: 'camp-1',
          kind: 'manual',
          subject: 'Assunto',
          body: 'corpo',
          ctaLabel: null,
          ctaUrl: null,
          filters: { tiers: null, gradeMin: null, gradeMax: null },
          status: 'interrompida',
          audienceCount: 250,
          sentCount: 200,
          failedCount: 50,
          cursorUid: 'uid-199',
          createdBy: 'admin-1',
          createdAt: new Date('2026-08-25T12:00:00.000Z'),
          finishedAt: null,
          error: 'rate limit',
        },
      ]);

      const [linha] = await controller.listCampaigns();

      expect('cursorUid' in linha).toBe(false);
      expect('createdBy' in linha).toBe(false);
      expect(linha.error).toBe('rate limit');
      expect(linha.finishedAt).toBeNull();
    });
  });
});
