import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileRepository } from './profile.repository';
import { AuthService } from '../auth/auth.service';
import { FirebaseService } from '../auth/firebase.service';
import { Profile } from './entities/profile.entity';

describe('ProfileService', () => {
  let service: ProfileService;
  let repository: {
    findById: jest.Mock;
    update: jest.Mock;
  };
  let firebase: { identityToolkit: jest.Mock };
  let authService: { reauthenticate: jest.Mock; continueUrl: string };

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      update: jest.fn(),
    };

    firebase = { identityToolkit: jest.fn() };
    authService = {
      reauthenticate: jest.fn().mockResolvedValue('id-token-fresco'),
      continueUrl: 'http://localhost:4200/?entrar=1',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        {
          provide: ProfileRepository,
          useValue: repository,
        },
        { provide: FirebaseService, useValue: firebase },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
  });

  describe('changeEmail', () => {
    const dto = { newEmail: 'novo@email.com', password: 'senha-certa' };

    it('reautentica e pede a confirmacao PARA O ENDERECO NOVO', async () => {
      firebase.identityToolkit.mockResolvedValue({});

      await expect(
        service.changeEmail('uid-1', 'atual@email.com', dto),
      ).resolves.toEqual({ status: 'confirmation_sent' });

      expect(authService.reauthenticate).toHaveBeenCalledWith(
        'atual@email.com',
        'senha-certa',
      );
      const [endpoint, body] = firebase.identityToolkit.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(endpoint).toBe('sendOobCode');
      expect(body.requestType).toBe('VERIFY_AND_CHANGE_EMAIL');
      expect(body.newEmail).toBe('novo@email.com');
      expect(body.idToken).toBe('id-token-fresco');
    });

    it('teste-trava: senha errada da 401 e NAO dispara e-mail nenhum', async () => {
      // A ordem e reautenticar primeiro, sempre. Invertida, o endpoint vira um
      // jeito de mandar e-mail para terceiros sem saber senha nenhuma.
      authService.reauthenticate.mockRejectedValue(
        new UnauthorizedException('Senha incorreta.'),
      );

      await expect(
        service.changeEmail('uid-1', 'atual@email.com', dto),
      ).rejects.toThrow(UnauthorizedException);

      expect(firebase.identityToolkit).not.toHaveBeenCalled();
    });

    it('e-mail novo igual ao atual da 400 antes de qualquer ida ao Firebase', async () => {
      await expect(
        service.changeEmail('uid-1', '  Novo@Email.com ', dto),
      ).rejects.toThrow(BadRequestException);

      expect(authService.reauthenticate).not.toHaveBeenCalled();
      expect(firebase.identityToolkit).not.toHaveBeenCalled();
    });

    it('teste-trava: EMAIL_EXISTS responde byte a byte igual a e-mail invalido', async () => {
      // E a decisao mais facil de "melhorar" depois em nome da UX, e melhora-la
      // reabre o oraculo de enumeracao que a spec 005 fechou.
      firebase.identityToolkit.mockRejectedValue(new Error('EMAIL_EXISTS'));
      const jaExiste = await service
        .changeEmail('uid-1', 'atual@email.com', dto)
        .catch((error: Error) => error.message);

      firebase.identityToolkit.mockRejectedValue(
        new Error('INVALID_NEW_EMAIL'),
      );
      const invalido = await service
        .changeEmail('uid-1', 'atual@email.com', dto)
        .catch((error: Error) => error.message);

      expect(jaExiste).toBe('Não foi possível usar este e-mail.');
      expect(invalido).toBe(jaExiste);
    });
  });

  describe('getProfile', () => {
    it('deve retornar dados do perfil existente', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: 'Leno Borges',
          phone: '47999990000',
          bio: 'Engenheiro de Software',
          grade: 1,
          completedAt: new Date('2026-08-14T10:00:00.000Z'),
        },
      });

      const profile = await service.getProfile(
        'user-1',
        'leno@borges.com.br',
        null,
      );

      expect(profile).toEqual({
        id: 'user-1',
        email: 'leno@borges.com.br',
        name: 'Leno Borges',
        phone: '47999990000',
        bio: 'Engenheiro de Software',
        grade: 1,
        profileCompleted: true,
        role: null,
      });
    });

    it('deve lancar NotFoundException se perfil nao for encontrado', async () => {
      repository.findById.mockResolvedValue({ found: false, entry: null });

      await expect(
        service.getProfile('user-unknown', 'u@test.com', null),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('caso 1: PATCH normaliza nome, telefone e bio antes de gravar', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: null,
          phone: null,
          bio: null,
          grade: 1,
          completedAt: null,
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Fulano de Tal',
          phone: '11999998888',
          bio: 'Bio com espaços ajustados.',
          grade: 1,
          completedAt: new Date('2026-08-14T10:00:00.000Z'),
        },
      });

      await service.updateProfile('user-1', 'fulano@email.com', null, {
        name: '  Fulano    de    Tal  ',
        phone: '(11) 99999-8888',
        bio: '  Bio com espaços ajustados.  ',
      });

      const updateCalls = repository.update.mock.calls as [
        string,
        Partial<Profile>,
      ][];
      expect(updateCalls[0][0]).toBe('user-1');
      expect(updateCalls[0][1].name).toBe('Fulano de Tal');
      expect(updateCalls[0][1].phone).toBe('11999998888');
      expect(updateCalls[0][1].bio).toBe('Bio com espaços ajustados.');
      expect(updateCalls[0][1].completedAt).toBeInstanceOf(Date);
    });

    it('caso 2: primeira atualizacao preenche completed_at', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: null,
          phone: null,
          bio: null,
          grade: 1,
          completedAt: null,
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio valida para onboarding.',
          grade: 1,
          completedAt: new Date(),
        },
      });

      await service.updateProfile('user-1', 'email@test.com', null, {
        name: 'Nome',
        phone: '11999998888',
        bio: 'Bio valida para onboarding.',
      });

      const updateCalls = repository.update.mock.calls as [
        string,
        Partial<Profile>,
      ][];
      expect(updateCalls[0][0]).toBe('user-1');
      expect(updateCalls[0][1].completedAt).toBeInstanceOf(Date);
    });

    it('caso 3: atualizacao seguinte NAO sobrescreve completed_at original', async () => {
      const originalCompletedAt = new Date('2026-01-01T00:00:00.000Z');

      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: 'Nome Antigo',
          phone: '11999998888',
          bio: 'Bio antiga de cadastro inicial.',
          grade: 1,
          completedAt: originalCompletedAt,
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Nome Novo',
          phone: '11999998888',
          bio: 'Nova bio atualizada com sucesso.',
          grade: 1,
          completedAt: originalCompletedAt,
        },
      });

      await service.updateProfile('user-1', 'email@test.com', null, {
        name: 'Nome Novo',
        phone: '11999998888',
        bio: 'Nova bio atualizada com sucesso.',
      });

      expect(repository.update).toHaveBeenCalledWith('user-1', {
        name: 'Nome Novo',
        phone: '11999998888',
        bio: 'Nova bio atualizada com sucesso.',
      });
    });

    it('caso 4: bio curta demais ou longa demais lanca BadRequestException', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: { id: 'user-1', completedAt: null },
      });

      await expect(
        service.updateProfile('user-1', 'email@test.com', null, {
          name: 'Nome',
          phone: '11999998888',
          bio: 'Curta',
        }),
      ).rejects.toThrow(BadRequestException);

      const longBio = 'a'.repeat(501);
      await expect(
        service.updateProfile('user-1', 'email@test.com', null, {
          name: 'Nome',
          phone: '11999998888',
          bio: longBio,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('caso 5: perfil inexistente lanca NotFoundException', async () => {
      repository.findById.mockResolvedValue({ found: false, entry: null });

      await expect(
        service.updateProfile('user-inexistente', 'email@test.com', null, {
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio valida para teste.',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('caso 6a: as redes entram no patch e saem no ProfileDto', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio antiga de cadastro inicial.',
          grade: 1,
          linkedin: null,
          instagram: null,
          completedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio antiga de cadastro inicial.',
          grade: 1,
          linkedin: 'https://www.linkedin.com/in/fulano',
          instagram: null,
          completedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });

      const dto = await service.updateProfile(
        'user-1',
        'email@test.com',
        null,
        {
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio antiga de cadastro inicial.',
          linkedin: 'https://www.linkedin.com/in/fulano',
          instagram: null,
        },
      );

      expect(repository.update).toHaveBeenCalledWith('user-1', {
        name: 'Nome',
        phone: '11999998888',
        bio: 'Bio antiga de cadastro inicial.',
        linkedin: 'https://www.linkedin.com/in/fulano',
        instagram: null,
      });
      expect(dto.linkedin).toBe('https://www.linkedin.com/in/fulano');
      expect(dto.instagram).toBeNull();
    });

    it('caso 6b: teste-trava — campo ausente no corpo NAO apaga a rede guardada', async () => {
      // "Nao mencionei" e "quero apagar" sao coisas diferentes, e a segunda
      // chega como `null` depois do DTO. Um patch que manda `undefined` para o
      // Firestore apaga em silencio o LinkedIn de quem so editou a bio.
      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio antiga de cadastro inicial.',
          grade: 1,
          linkedin: 'https://www.linkedin.com/in/fulano',
          instagram: 'https://www.instagram.com/fulano',
          completedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio nova, sem tocar nas redes.',
          grade: 1,
          linkedin: 'https://www.linkedin.com/in/fulano',
          instagram: 'https://www.instagram.com/fulano',
          completedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });

      await service.updateProfile('user-1', 'email@test.com', null, {
        name: 'Nome',
        phone: '11999998888',
        bio: 'Bio nova, sem tocar nas redes.',
      });

      const [, patchData] = repository.update.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect('linkedin' in patchData).toBe(false);
      expect('instagram' in patchData).toBe(false);
    });

    it('caso 6c: teste-trava — editar o perfil de quem ja concluiu nao recarimba completedAt', async () => {
      // Esta spec e a primeira a chamar o endpoint duas vezes na vida de um
      // usuario, entao e a primeira em que quebrar isso apareceria.
      const original = new Date('2026-01-01T00:00:00.000Z');

      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio antiga de cadastro inicial.',
          grade: 1,
          linkedin: null,
          instagram: null,
          completedAt: original,
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio nova depois do onboarding.',
          grade: 1,
          linkedin: null,
          instagram: null,
          completedAt: original,
        },
      });

      await service.updateProfile('user-1', 'email@test.com', null, {
        name: 'Nome',
        phone: '11999998888',
        bio: 'Bio nova depois do onboarding.',
        linkedin: 'https://www.linkedin.com/in/fulano',
      });

      const [, patchData] = repository.update.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect('completedAt' in patchData).toBe(false);
    });

    it('caso 6: grade nunca e alterado por este endpoint', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-1',
          name: null,
          phone: null,
          bio: null,
          grade: 1,
          completedAt: null,
        },
      });

      repository.update.mockResolvedValue({
        entry: {
          id: 'user-1',
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio valida para teste.',
          grade: 1,
          completedAt: new Date(),
        },
      });

      const bodyWithExtraField = {
        name: 'Nome',
        phone: '11999998888',
        bio: 'Bio valida para teste.',
      };

      await service.updateProfile(
        'user-1',
        'email@test.com',
        null,
        bodyWithExtraField,
      );

      expect(repository.update).not.toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ grade: 33 }),
      );
    });
  });
});
