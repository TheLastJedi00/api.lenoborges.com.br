import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { ProfileRepository } from '../profile/profile.repository';
import { WaitlistRepository } from '../waitlist/waitlist.repository';
import { SignupDto } from './dto/signup.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { LoginDto } from './dto/login.dto';
import { SessionResponseDto } from './dto/session.dto';
import { normalizeEmail } from '../common/normalize';

@Injectable()
export class AuthService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly profileRepository: ProfileRepository,
    private readonly waitlistRepository: WaitlistRepository,
  ) {}

  async signup(dto: SignupDto): Promise<{ status: 'confirmation_sent' }> {
    const normalizedEmail = normalizeEmail(dto.email);
    const normalizedConfirmation = normalizeEmail(dto.emailConfirmation);

    if (normalizedEmail !== normalizedConfirmation) {
      throw new BadRequestException('E-mails não conferem');
    }

    const { data, error } =
      await this.supabaseService.adminClient.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: false,
      });

    if (!error && data?.user) {
      const waitlist =
        await this.waitlistRepository.findByEmail(normalizedEmail);
      const waitlistEntry =
        waitlist.found && waitlist.entry ? waitlist.entry : null;

      await this.profileRepository.create({
        id: data.user.id,
        name: waitlistEntry ? waitlistEntry.name : null,
        phone: waitlistEntry ? waitlistEntry.phone : null,
        bio: null,
        grade: 1,
        completedAt: null,
        waitlistEntryId: waitlistEntry ? waitlistEntry.id : null,
      });
    }

    await this.supabaseService.adminClient.auth.resetPasswordForEmail(
      normalizedEmail,
    );

    return { status: 'confirmation_sent' };
  }

  async setPassword(dto: SetPasswordDto): Promise<void> {
    if (dto.password !== dto.passwordConfirmation) {
      throw new BadRequestException('Senhas não conferem.');
    }

    const { data: verifyData, error: verifyError } =
      await this.supabaseService.publicClient.auth.verifyOtp({
        token_hash: dto.tokenHash,
        type: 'recovery',
      });

    if (verifyError || !verifyData?.user) {
      throw new BadRequestException('Link inválido ou expirado, peça um novo.');
    }

    const { error: updateError } =
      await this.supabaseService.adminClient.auth.admin.updateUserById(
        verifyData.user.id,
        {
          password: dto.password,
        },
      );

    if (updateError) {
      throw new BadRequestException('Link inválido ou expirado, peça um novo.');
    }
  }

  async login(
    dto: LoginDto,
  ): Promise<{ session: SessionResponseDto; refreshToken: string }> {
    const normalizedEmail = normalizeEmail(dto.email);

    const { data, error } =
      await this.supabaseService.publicClient.auth.signInWithPassword({
        email: normalizedEmail,
        password: dto.password,
      });

    if (error || !data?.session || !data?.user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    let profile = await this.profileRepository.findById(data.user.id);
    if (!profile.found || !profile.entry) {
      const waitlist =
        await this.waitlistRepository.findByEmail(normalizedEmail);
      const waitlistEntry =
        waitlist.found && waitlist.entry ? waitlist.entry : null;

      const created = await this.profileRepository.create({
        id: data.user.id,
        name: waitlistEntry ? waitlistEntry.name : null,
        phone: waitlistEntry ? waitlistEntry.phone : null,
        bio: null,
        grade: 1,
        completedAt: null,
        waitlistEntryId: waitlistEntry ? waitlistEntry.id : null,
      });
      profile = { found: true, entry: created.entry };
    }

    const session: SessionResponseDto = {
      accessToken: data.session.access_token,
      expiresIn: data.session.expires_in,
      user: {
        id: data.user.id,
        email: data.user.email ?? normalizedEmail,
      },
      profileCompleted: profile.entry!.completedAt !== null,
      grade: profile.entry!.grade,
    };

    return {
      session,
      refreshToken: data.session.refresh_token,
    };
  }

  async refresh(
    refreshToken?: string,
  ): Promise<{ session: SessionResponseDto; refreshToken: string }> {
    if (!refreshToken) {
      throw new UnauthorizedException('Sessão expirada ou inválida.');
    }

    const { data, error } =
      await this.supabaseService.publicClient.auth.refreshSession({
        refresh_token: refreshToken,
      });

    if (error || !data?.session || !data?.user) {
      throw new UnauthorizedException('Sessão expirada ou inválida.');
    }

    let profile = await this.profileRepository.findById(data.user.id);
    if (!profile.found || !profile.entry) {
      const email = data.user.email ? normalizeEmail(data.user.email) : '';
      const waitlist = email
        ? await this.waitlistRepository.findByEmail(email)
        : { found: false, entry: null };
      const waitlistEntry =
        waitlist.found && waitlist.entry ? waitlist.entry : null;

      const created = await this.profileRepository.create({
        id: data.user.id,
        name: waitlistEntry ? waitlistEntry.name : null,
        phone: waitlistEntry ? waitlistEntry.phone : null,
        bio: null,
        grade: 1,
        completedAt: null,
        waitlistEntryId: waitlistEntry ? waitlistEntry.id : null,
      });
      profile = { found: true, entry: created.entry };
    }

    const session: SessionResponseDto = {
      accessToken: data.session.access_token,
      expiresIn: data.session.expires_in,
      user: {
        id: data.user.id,
        email: data.user.email ?? '',
      },
      profileCompleted: profile.entry!.completedAt !== null,
      grade: profile.entry!.grade,
    };

    return {
      session,
      refreshToken: data.session.refresh_token,
    };
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      return;
    }

    try {
      await this.supabaseService.publicClient.auth.signOut();
    } catch {
      // Idempotent: ignore error
    }
  }
}
