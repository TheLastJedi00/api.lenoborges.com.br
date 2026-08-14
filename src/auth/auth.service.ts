import {
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { ProfileRepository } from '../profile/profile.repository';
import { WaitlistRepository } from '../waitlist/waitlist.repository';
import { SignupDto } from './dto/signup.dto';
import { SetPasswordDto } from './dto/set-password.dto';
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
      const waitlist = await this.waitlistRepository.findByEmail(normalizedEmail);
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
}
