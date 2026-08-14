import { ConfigService } from '@nestjs/config';
import { SupabaseService } from './supabase.service';

describe('SupabaseService', () => {
  let service: SupabaseService;
  let configService: ConfigService;

  beforeEach(() => {
    configService = {
      getOrThrow: jest.fn((key: string) => {
        switch (key) {
          case 'SUPABASE_URL':
            return 'https://mock.supabase.co';
          case 'SUPABASE_SERVICE_ROLE_KEY':
            return 'mock-service-role-key';
          case 'SUPABASE_ANON_KEY':
            return 'mock-anon-key';
          default:
            throw new Error(`Unexpected key: ${key}`);
        }
      }),
    } as unknown as ConfigService;

    service = new SupabaseService(configService);
  });

  it('should be defined and expose a shared admin client', () => {
    expect(service).toBeDefined();
    expect(service.adminClient).toBeDefined();
    expect(service.admin).toBe(service.adminClient);
  });

  it('deve devolver uma instancia nova a cada createUserClient', () => {
    // Cliente de usuario compartilhado carregaria a sessao de quem passou por
    // ele por ultimo. Ver o achado A1 do review da spec 005.
    const first = service.createUserClient();
    const second = service.createUserClient();

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });
});
