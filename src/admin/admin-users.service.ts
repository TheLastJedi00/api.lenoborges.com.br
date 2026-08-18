import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRecord } from 'firebase-admin/auth';
import { DocumentReference } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import {
  PROFILE_COLLECTION,
  ProfileRepository,
} from '../profile/profile.repository';
import { Profile, profileConverter } from '../profile/entities/profile.entity';
import { roleOf } from '../auth/role';
import { AdminUserDto } from './dto/admin-user.dto';
import { AdminUserPageDto } from './dto/admin-user-page.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly profileRepository: ProfileRepository,
  ) {}

  /**
   * Lista os usuários cadastrados, juntando as duas fontes.
   *
   * **A paginação é a do Firebase Auth**, com `pageToken`, e não a do Firestore.
   * A razão está na decisão 10 da spec 009: o Auth é a fonte de quem existe, e
   * paginar pelo Firestore esconderia todo usuário que ainda não tem documento
   * de perfil — que é exatamente a pessoa que o admin mais precisa ver, a que se
   * cadastrou e não terminou o onboarding.
   *
   * A leitura dos perfis da página é um `getAll` por caminho: sem consulta, sem
   * índice, uma ida só para a página inteira.
   */
  async list(limit: number, pageToken?: string): Promise<AdminUserPageDto> {
    const page = await this.firebase.auth.listUsers(limit, pageToken);

    if (page.users.length === 0) {
      return { users: [], nextPageToken: page.pageToken ?? null };
    }

    const profiles = await this.readProfiles(page.users.map((u) => u.uid));

    return {
      users: page.users.map((user) => this.toDto(user, profiles.get(user.uid))),
      nextPageToken: page.pageToken ?? null,
    };
  }

  async updateUser(userId: string, dto: UpdateUserDto): Promise<void> {
    if (dto.grade === undefined) {
      // PATCH sem campo nenhum não é erro: é um pedido que não pediu nada.
      return;
    }

    try {
      await this.profileRepository.update(userId, { grade: dto.grade });
    } catch {
      // O repository levanta erro cru quando o documento não existe. Para o
      // admin isso é "esse usuário não tem perfil ainda", não uma falha de
      // servidor.
      throw new NotFoundException(
        'Esse usuário ainda não tem perfil — ele precisa concluir o onboarding antes.',
      );
    }
  }

  /** Perfis da página, por caminho. Documento ausente vira `undefined`. */
  private async readProfiles(uids: string[]): Promise<Map<string, Profile>> {
    const collection = this.firebase.firestore
      .collection(PROFILE_COLLECTION)
      .withConverter(profileConverter);

    const snapshots = await this.firebase.firestore.getAll(
      ...uids.map((uid) => collection.doc(uid) as DocumentReference),
    );

    const profiles = new Map<string, Profile>();
    for (const snapshot of snapshots) {
      if (snapshot.exists) {
        profiles.set(snapshot.id, snapshot.data() as Profile);
      }
    }

    return profiles;
  }

  private toDto(user: UserRecord, profile?: Profile): AdminUserDto {
    return {
      id: user.uid,
      email: user.email ?? null,
      emailVerified: user.emailVerified,
      disabled: user.disabled,
      role: roleOf(user),
      createdAt: user.metadata.creationTime,
      lastSignInAt: user.metadata.lastSignInTime || null,
      // Nulos aqui são informação, não ausência de dado: é o retrato de quem
      // criou conta e parou antes do onboarding.
      name: profile?.name ?? null,
      phone: profile?.phone ?? null,
      grade: profile?.grade ?? null,
      profileCompleted: profile?.completedAt != null,
    };
  }
}
