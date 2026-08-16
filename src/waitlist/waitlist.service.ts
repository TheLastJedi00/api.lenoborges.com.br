import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { WaitlistRepository, ALREADY_EXISTS } from './waitlist.repository';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';
import { WaitlistReceiptDto } from './dto/waitlist-receipt.dto';
import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
} from '../common/normalize';

@Injectable()
export class WaitlistService {
  constructor(private readonly repository: WaitlistRepository) {}

  async create(dto: CreateWaitlistEntryDto): Promise<WaitlistReceiptDto> {
    if (dto.consent !== true) {
      throw new BadRequestException('Consent is required');
    }

    const normalizedEmail = normalizeEmail(dto.email);
    const normalizedPhone = normalizePhone(dto.phone);
    const normalizedName = normalizeName(dto.name);

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
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === ALREADY_EXISTS
      ) {
        // Documento ja existe: outra requisicao gravou o mesmo e-mail entre o
        // findByEmail e o create. Era a unique violation 23505 do Postgres; com
        // o e-mail como ID do documento, o Firestore recusa pelo mesmo motivo e
        // na mesma janela. A releitura vai dentro do seu proprio try para nao
        // escapar do catch e vazar o erro cru do driver.
        try {
          const existing = await this.repository.findByEmail(normalizedEmail);
          if (existing.found && existing.entry) {
            return {
              id: existing.entry.id,
              receivedAt: existing.entry.createdAt,
            };
          }
        } catch {
          // cai no 500 generico abaixo
        }
      }
      // Do not leak database error
      throw new InternalServerErrorException(
        'Failed to process waitlist entry',
      );
    }
  }
}
