import { Test, TestingModule } from '@nestjs/testing';
import { AdminEmailsController } from './admin-emails.controller';
import { AudienceService } from './audience.service';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

describe('AdminEmailsController', () => {
  let controller: AdminEmailsController;
  let audience: { count: jest.Mock; build: jest.Mock };

  beforeEach(async () => {
    audience = { count: jest.fn().mockResolvedValue(42), build: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminEmailsController],
      providers: [{ provide: AudienceService, useValue: audience }],
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
});
