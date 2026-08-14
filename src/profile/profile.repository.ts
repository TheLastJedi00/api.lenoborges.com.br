import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from './entities/profile.entity';

@Injectable()
export class ProfileRepository {
  constructor(
    @InjectRepository(Profile)
    private readonly repository: Repository<Profile>,
  ) {}

  async findById(
    id: string,
  ): Promise<{ found: boolean; entry: Profile | null }> {
    const entry = await this.repository.findOne({ where: { id } });
    if (entry) {
      return { found: true, entry };
    }
    return { found: false, entry: null };
  }

  async create(data: Partial<Profile>): Promise<{ entry: Profile }> {
    const entity = this.repository.create(data);
    const saved = await this.repository.save(entity);
    return { entry: saved };
  }

  async update(
    id: string,
    data: Partial<Profile>,
  ): Promise<{ entry: Profile }> {
    await this.repository.update(id, data);
    const entry = await this.repository.findOneByOrFail({ id });
    return { entry };
  }
}
