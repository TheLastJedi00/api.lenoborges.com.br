import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  readonly adminClient: SupabaseClient<any, any, any>;
  readonly publicClient: SupabaseClient<any, any, any>;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
    const serviceRoleKey = this.configService.getOrThrow<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );
    const anonKey = this.configService.getOrThrow<string>('SUPABASE_ANON_KEY');

    this.adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    this.publicClient = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  get admin(): SupabaseClient<any, any, any> {
    return this.adminClient;
  }

  get public(): SupabaseClient<any, any, any> {
    return this.publicClient;
  }
}
