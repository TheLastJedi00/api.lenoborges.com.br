import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  /**
   * Cliente administrativo, compartilhado por todo o processo.
   *
   * Pode ser singleton porque as operacoes que ele executa (createUser,
   * updateUserById, resetPasswordForEmail) nao produzem sessao: nenhuma delas
   * chama _saveSession, entao o cliente nao acumula estado de usuario nenhum.
   */
  readonly adminClient: SupabaseClient<any, any, any>;

  private readonly supabaseUrl: string;
  private readonly anonKey: string;

  constructor(private readonly configService: ConfigService) {
    this.supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
    const serviceRoleKey = this.configService.getOrThrow<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );
    this.anonKey = this.configService.getOrThrow<string>('SUPABASE_ANON_KEY');

    this.adminClient = createClient(this.supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  /**
   * Cliente novo para cada operacao que representa um usuario: login, refresh,
   * verifyOtp e logout.
   *
   * Nao existe cliente publico compartilhado de proposito. `persistSession:
   * false` nao torna o cliente sem estado: no @supabase/auth-js ele apenas troca
   * o storage por um adaptador em memoria, e _saveSession continua gravando a
   * sessao ali a cada login, refresh e verifyOtp. Uma instancia compartilhada
   * portanto carrega a sessao do ultimo usuario que passou por ela, e um
   * signOut() dispararia sobre essa sessao, nao sobre a de quem pediu.
   */
  createUserClient(): SupabaseClient<any, any, any> {
    return createClient(this.supabaseUrl, this.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  get admin(): SupabaseClient<any, any, any> {
    return this.adminClient;
  }
}
