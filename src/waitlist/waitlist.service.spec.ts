import { Test, TestingModule } from '@nestjs/testing';
import { WaitlistService } from './waitlist.service';
import { WaitlistRepository } from './waitlist.repository';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

const mockRepository = {
  findByEmail: jest.fn(),
  create: jest.fn(),
};

describe('WaitlistService', () => {
  let service: WaitlistService;
  let repository: typeof mockRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WaitlistService,
        {
          provide: WaitlistRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<WaitlistService>(WaitlistService);
    repository = module.get(WaitlistRepository);
    jest.clearAllMocks();
  });

  it('should create new entry and return receipt', async () => {
    repository.findByEmail.mockResolvedValue({ found: false });
    repository.create.mockResolvedValue({
      entry: { id: 'uuid', createdAt: new Date('2026-08-13T18:20:31.412Z') },
    });

    const result = await service.create({
      name: 'Test Name',
      phone: '11999998888',
      email: 'test@test.com',
      consent: true,
    });

    expect(result).toEqual({ id: 'uuid', receivedAt: new Date('2026-08-13T18:20:31.412Z') });
    expect(repository.create).toHaveBeenCalledWith({
      name: 'Test Name',
      phone: '11999998888',
      email: 'test@test.com',
      consent: true,
    });
  });

  it('should normalize phone', async () => {
    repository.findByEmail.mockResolvedValue({ found: false });
    repository.create.mockResolvedValue({ entry: { id: 'uuid', createdAt: new Date() } });

    await service.create({
      name: 'Test',
      phone: '(11) 99999-8888',
      email: 'test@test.com',
      consent: true,
    });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ phone: '11999998888' }));
  });

  it('should normalize email', async () => {
    repository.findByEmail.mockResolvedValue({ found: false });
    repository.create.mockResolvedValue({ entry: { id: 'uuid', createdAt: new Date() } });

    await service.create({
      name: 'Test',
      phone: '11999998888',
      email: ' Test@EMAIL.com ',
      consent: true,
    });

    expect(repository.findByEmail).toHaveBeenCalledWith('test@email.com');
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'test@email.com' }));
  });

  it('should normalize name', async () => {
    repository.findByEmail.mockResolvedValue({ found: false });
    repository.create.mockResolvedValue({ entry: { id: 'uuid', createdAt: new Date() } });

    await service.create({
      name: '  Test   Name  ',
      phone: '11999998888',
      email: 'test@test.com',
      consent: true,
    });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test Name' }));
  });

  it('should throw BadRequestException if consent is false', async () => {
    await expect(service.create({
      name: 'Test',
      phone: '11999998888',
      email: 'test@test.com',
      consent: false,
    })).rejects.toThrow(BadRequestException);

    expect(repository.findByEmail).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('should not create if email already exists and return existing receipt', async () => {
    repository.findByEmail.mockResolvedValue({
      found: true,
      entry: { id: 'existing-uuid', createdAt: new Date('2026-08-13T18:20:31.412Z') },
    });

    const result = await service.create({
      name: 'Test',
      phone: '11999998888',
      email: 'test@test.com',
      consent: true,
    });

    expect(result).toEqual({ id: 'existing-uuid', receivedAt: new Date('2026-08-13T18:20:31.412Z') });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('should handle unique violation (23505) and return existing receipt', async () => {
    repository.findByEmail
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValueOnce({ found: true, entry: { id: 'existing-uuid', createdAt: new Date('2026-08-13T18:20:31.412Z') } });

    repository.create.mockRejectedValue({ code: '23505' });

    const result = await service.create({
      name: 'Test',
      phone: '11999998888',
      email: 'test@test.com',
      consent: true,
    });

    expect(result).toEqual({ id: 'existing-uuid', receivedAt: new Date('2026-08-13T18:20:31.412Z') });
    expect(repository.create).toHaveBeenCalled();
    expect(repository.findByEmail).toHaveBeenCalledTimes(2);
  });

  it('should handle generic error without leaking message', async () => {
    repository.findByEmail.mockResolvedValue({ found: false });
    repository.create.mockRejectedValue(new Error('Sensitive DB Error'));

    await expect(service.create({
      name: 'Test',
      phone: '11999998888',
      email: 'test@test.com',
      consent: true,
    })).rejects.toThrow(InternalServerErrorException);

    try {
      await service.create({
        name: 'Test',
        phone: '11999998888',
        email: 'test@test.com',
        consent: true,
      });
    } catch (e) {
      expect(e.message).not.toContain('Sensitive DB Error');
    }
  });
});
