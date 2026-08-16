import { Injectable } from '@nestjs/common';
import { CollectionReference, Timestamp } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import { Profile, profileConverter } from './entities/profile.entity';

export const PROFILE_COLLECTION = 'profiles';

/** Campos que o chamador informa ao criar; o resto o repository preenche. */
export type CreateProfileData = Pick<
  Profile,
  'id' | 'name' | 'phone' | 'bio' | 'grade' | 'completedAt' | 'waitlistEntryId'
>;

@Injectable()
export class ProfileRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<Profile> {
    return this.firebase.firestore
      .collection(PROFILE_COLLECTION)
      .withConverter(profileConverter);
  }

  async findById(
    id: string,
  ): Promise<{ found: boolean; entry: Profile | null }> {
    const snapshot = await this.collection.doc(id).get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.data()! };
  }

  async create(data: CreateProfileData): Promise<{ entry: Profile }> {
    // Sem ORM nao ha @CreateDateColumn: quem preenche os carimbos e este metodo.
    const now = new Date();
    const entry: Profile = { ...data, createdAt: now, updatedAt: now };

    await this.collection.doc(data.id).create(entry);

    return { entry };
  }

  async update(
    id: string,
    data: Partial<Omit<Profile, 'id' | 'createdAt'>>,
  ): Promise<{ entry: Profile }> {
    const ref = this.collection.doc(id);

    // update() parcial nao passa pelo converter, entao a conversao de Date para
    // Timestamp acontece aqui. E o preco de nao reescrever o documento inteiro,
    // que apagaria campos que este update nem menciona.
    const patch: Record<string, unknown> = { updatedAt: Timestamp.now() };
    for (const [key, value] of Object.entries(data)) {
      patch[key] = value instanceof Date ? Timestamp.fromDate(value) : value;
    }

    await ref.update(patch);

    const snapshot = await ref.get();
    if (!snapshot.exists) {
      // Era findOneByOrFail no TypeORM. Devolver um perfil vazio esconderia uma
      // inconsistencia real atras de uma tela em branco.
      throw new Error(`Perfil ${id} nao encontrado apos o update.`);
    }

    return { entry: snapshot.data()! };
  }
}
