import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WaitlistEntry } from './entities/waitlist-entry.entity';

@Injectable()
export class WaitlistRepository {
  constructor(
    @InjectRepository(WaitlistEntry)
    private readonly repository: Repository<WaitlistEntry>,
  ) {}

  async findByEmail(email: string): Promise<{ found: boolean; entry?: WaitlistEntry }> {
    const entry = await this.repository.findOne({ where: { email } });
    if (entry) {
      return { found: true, entry };
    }
    return { found: false };
  }

  async create(data: Partial<WaitlistEntry>): Promise<{ entry: WaitlistEntry }> {
    const entry = this.repository.create(data);
    const savedEntry = await this.repository.save(entry);
    return { entry: savedEntry };
  }
}
