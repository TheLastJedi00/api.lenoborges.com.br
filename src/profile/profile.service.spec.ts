import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileRepository } from './profile.repository';

describe('ProfileService', () => {
  let service: ProfileService;
  let repository: {
    findById: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        {
          provide: ProfileRepository,
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
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

      const profile = await service.getProfile('user-1', 'leno@borges.com.br');

      expect(profile).toEqual({
        id: 'user-1',
        email: 'leno@borges.com.br',
        name: 'Leno Borges',
        phone: '47999990000',
        bio: 'Engenheiro de Software',
        grade: 1,
        profileCompleted: true,
      });
    });

    it('deve lancar NotFoundException se perfil nao for encontrado', async () => {
      repository.findById.mockResolvedValue({ found: false, entry: null });

      await expect(service.getProfile('user-unknown', 'u@test.com')).rejects.toThrow(
        NotFoundException,
      );
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

      await service.updateProfile('user-1', 'fulano@email.com', {
        name: '  Fulano    de    Tal  ',
        phone: '(11) 99999-8888',
        bio: '  Bio com espaços ajustados.  ',
      });

      expect(repository.update).toHaveBeenCalledWith('user-1', {
        name: 'Fulano de Tal',
        phone: '11999998888',
        bio: 'Bio com espaços ajustados.',
        completedAt: expect.any(Date),
      });
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

      await service.updateProfile('user-1', 'email@test.com', {
        name: 'Nome',
        phone: '11999998888',
        bio: 'Bio valida para onboarding.',
      });

      expect(repository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          completedAt: expect.any(Date),
        }),
      );
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

      await service.updateProfile('user-1', 'email@test.com', {
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
        service.updateProfile('user-1', 'email@test.com', {
          name: 'Nome',
          phone: '11999998888',
          bio: 'Curta',
        }),
      ).rejects.toThrow(BadRequestException);

      const longBio = 'a'.repeat(501);
      await expect(
        service.updateProfile('user-1', 'email@test.com', {
          name: 'Nome',
          phone: '11999998888',
          bio: longBio,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('caso 5: perfil inexistente lanca NotFoundException', async () => {
      repository.findById.mockResolvedValue({ found: false, entry: null });

      await expect(
        service.updateProfile('user-inexistente', 'email@test.com', {
          name: 'Nome',
          phone: '11999998888',
          bio: 'Bio valida para teste.',
        }),
      ).rejects.toThrow(NotFoundException);
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

      const bodyWithGrade = {
        name: 'Nome',
        phone: '11999998888',
        bio: 'Bio valida para teste.',
        grade: 33,
      } as any;

      await service.updateProfile('user-1', 'email@test.com', bodyWithGrade);

      expect(repository.update).not.toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ grade: 33 }),
      );
    });
  });
});
