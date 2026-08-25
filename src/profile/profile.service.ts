import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileDto } from './dto/profile.dto';
import type { UserRole } from '../auth/decorators/current-user.decorator';
import {
  normalizeName,
  normalizePhone,
  normalizeBio,
} from '../common/normalize';

@Injectable()
export class ProfileService {
  constructor(private readonly repository: ProfileRepository) {}

  async getProfile(
    userId: string,
    email: string,
    role: UserRole | null,
  ): Promise<ProfileDto> {
    const profile = await this.repository.findById(userId);
    if (!profile.found || !profile.entry) {
      throw new NotFoundException('Perfil não encontrado.');
    }

    return {
      id: profile.entry.id,
      email,
      name: profile.entry.name,
      phone: profile.entry.phone,
      bio: profile.entry.bio,
      grade: profile.entry.grade,
      linkedin: profile.entry.linkedin,
      instagram: profile.entry.instagram,
      profileCompleted: profile.entry.completedAt !== null,
      role,
      tier: profile.entry.tier,
    };
  }

  async updateProfile(
    userId: string,
    email: string,
    role: UserRole | null,
    dto: UpdateProfileDto,
  ): Promise<ProfileDto> {
    const profile = await this.repository.findById(userId);
    if (!profile.found || !profile.entry) {
      throw new NotFoundException('Perfil não encontrado.');
    }

    const normalizedName = normalizeName(dto.name);
    const normalizedPhone = normalizePhone(dto.phone);
    const normalizedBio = normalizeBio(dto.bio);

    if (normalizedBio.length < 10 || normalizedBio.length > 500) {
      throw new BadRequestException('Bio deve ter entre 10 e 500 caracteres.');
    }

    const patchData: {
      name: string;
      phone: string;
      bio: string;
      linkedin?: string | null;
      instagram?: string | null;
      completedAt?: Date;
    } = {
      name: normalizedName,
      phone: normalizedPhone,
      bio: normalizedBio,
    };

    // **Campo ausente no corpo nao apaga o valor guardado.** O DTO ja traduziu
    // string vazia em `null`, entao o que chega aqui como `undefined` e
    // "nao mencionei" -- e "nao mencionei" nunca entra no patch. E a diferenca
    // que todo update parcial erra quando ninguem escreve o teste.
    if (dto.linkedin !== undefined) {
      patchData.linkedin = dto.linkedin;
    }
    if (dto.instagram !== undefined) {
      patchData.instagram = dto.instagram;
    }

    if (!profile.entry.completedAt) {
      patchData.completedAt = new Date();
    }

    const updated = await this.repository.update(userId, patchData);

    return {
      id: updated.entry.id,
      email,
      name: updated.entry.name,
      phone: updated.entry.phone,
      bio: updated.entry.bio,
      grade: updated.entry.grade,
      linkedin: updated.entry.linkedin,
      instagram: updated.entry.instagram,
      profileCompleted: updated.entry.completedAt !== null,
      role,
      tier: updated.entry.tier,
    };
  }
}
