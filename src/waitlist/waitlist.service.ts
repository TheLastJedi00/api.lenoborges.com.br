import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { WaitlistRepository } from './waitlist.repository';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';
import { WaitlistReceiptDto } from './dto/waitlist-receipt.dto';

@Injectable()
export class WaitlistService {
  constructor(private readonly repository: WaitlistRepository) {}

  async create(dto: CreateWaitlistEntryDto): Promise<WaitlistReceiptDto> {
    if (dto.consent !== true) {
      throw new BadRequestException('Consent is required');
    }

    const normalizedEmail = dto.email.trim().toLowerCase();
    const normalizedPhone = dto.phone.replace(/\D/g, '');
    const normalizedName = dto.name.trim().replace(/\s+/g, ' ');

    try {
      const existing = await this.repository.findByEmail(normalizedEmail);
      if (existing.found && existing.entry) {
        return {
          id: existing.entry.id,
          receivedAt: existing.entry.createdAt,
        };
      }

      const created = await this.repository.create({
        name: normalizedName,
        phone: normalizedPhone,
        email: normalizedEmail,
        consent: dto.consent,
      });

      return {
        id: created.entry.id,
        receivedAt: created.entry.createdAt,
      };
    } catch (error: any) {
      if (error?.code === '23505') { // PostgreSQL unique violation
        const existing = await this.repository.findByEmail(normalizedEmail);
        if (existing.found && existing.entry) {
          return {
            id: existing.entry.id,
            receivedAt: existing.entry.createdAt,
          };
        }
      }
      // Do not leak database error
      throw new InternalServerErrorException('Failed to process waitlist entry');
    }
  }
}
