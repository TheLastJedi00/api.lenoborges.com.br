import { Injectable } from '@nestjs/common';
import { CollectionReference, Timestamp } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import {
  EmailOptOutReason,
  Profile,
  profileConverter,
} from './entities/profile.entity';
import { NOTIFICATION_READ_SUBCOLLECTION } from '../notifications/notification-read.repository';

export const PROFILE_COLLECTION = 'profiles';

/** Campos que o chamador informa ao criar; o resto o repository preenche. */
export type CreateProfileData = Pick<
  Profile,
  'id' | 'name' | 'phone' | 'bio' | 'grade' | 'completedAt' | 'waitlistEntryId'
> & {
  /** Opcional na criacao: sem valor, o repository grava 'dev-tier'. */
  tier?: Profile['tier'];
};

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

  /**
   * Os perfis de uma lista de UIDs, **por caminho**.
   *
   * Um `getAll` só para o conjunto inteiro: sem consulta, sem índice, uma ida
   * de rede para a página toda. Nunca N leituras em laço, que é o que
   * transforma uma listagem em conta no fim do mês.
   *
   * **UID sem documento simplesmente não entra no mapa**, e a ausência é
   * informação: é o retrato de quem criou conta e parou antes do onboarding.
   * Quem chama decide o que fazer com isso — a Administração mostra a linha com
   * nulos, a audiência de e-mail corta a pessoa fora.
   *
   * Nasceu privado dentro do `AdminUsersService` e saiu para cá na spec 014,
   * quando a audiência do disparo passou a precisar da mesma junção.
   */
  async findManyByIds(uids: readonly string[]): Promise<Map<string, Profile>> {
    if (uids.length === 0) {
      // getAll() sem documento nenhum estoura no Firestore, e lista vazia é
      // normal — uma página de usuários sem ninguém, por exemplo.
      return new Map();
    }

    // O getAll perde o converter no caminho de volta: ele devolve
    // DocumentSnapshot<DocumentData>, e nao o tipo da colecao. O cast e aqui, num
    // lugar so, e nao espalhado por quem chama.
    const snapshots = await this.firebase.firestore.getAll(
      ...uids.map((uid) => this.collection.doc(uid)),
    );

    const profiles = new Map<string, Profile>();
    for (const snapshot of snapshots) {
      if (snapshot.exists) {
        profiles.set(snapshot.id, snapshot.data() as Profile);
      }
    }

    return profiles;
  }

  async create(data: CreateProfileData): Promise<{ entry: Profile }> {
    // Sem ORM nao ha @CreateDateColumn: quem preenche os carimbos e este metodo.
    const now = new Date();
    // Todo perfil nasce no Dev Tier. O default vive aqui, e nao no chamador,
    // para nao existir caminho de criacao que esqueca de defini-lo.
    const entry: Profile = {
      tier: 'dev-tier',
      // Perfil nasce sem rede social. O default vive aqui, e nao no chamador,
      // pelo mesmo motivo do `tier`: para nao existir caminho de criacao que
      // esqueca de definir o campo e grave `undefined` no documento.
      linkedin: null,
      instagram: null,
      // E nasce recebendo. Quem entra na comunidade consentiu com o contato do
      // produto; a saida existe e esta a um clique no rodape de todo e-mail.
      emailOptOut: false,
      emailOptOutReason: null,
      emailOptOutAt: null,
      // E nasce sem ter aceitado nada (spec 018). O mapa vazio -- e nao
      // `undefined` -- e o que faz o guard responder 428 no primeiro request em
      // vez de estourar, e e ele que trava o onboarding ate os dois aceites.
      legalAcceptances: {},
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    await this.collection.doc(data.id).create(entry);

    return { entry };
  }

  /**
   * Apaga o perfil **e a subcolecao de leituras de notificacao** (spec 013).
   *
   * **Subcolecao nao some com o pai no Firestore.** Um `delete()` sozinho em
   * `profiles/{uid}` deixaria `notification_reads` orfa: invisivel no console,
   * cobrada na fatura e impossivel de achar depois, porque nao ha mais documento
   * pai por onde chegar nela. A instrucao ja estava escrita em
   * `notification-read.repository.ts` desde a spec 012; este e o metodo que a
   * cumpre.
   *
   * Ordem: a subcolecao primeiro, o pai depois. Invertida, uma falha no meio
   * deixaria exatamente a orfandade que este metodo existe para evitar.
   */
  async remove(id: string): Promise<void> {
    const ref = this.collection.doc(id);
    const reads = await ref
      .collection(NOTIFICATION_READ_SUBCOLLECTION)
      .listDocuments();

    const batch = this.firebase.firestore.batch();
    for (const read of reads) {
      batch.delete(read);
    }
    batch.delete(ref);

    await batch.commit();
  }

  /**
   * Liga e desliga o recebimento de e-mail (spec 014, decisao 8).
   *
   * **Idempotente de proposito.** Descadastrar duas vezes nao e erro: o link do
   * rodape nao expira e pode ser clicado de novo, o webhook do provedor repete
   * evento, e o "cancelar inscricao" nativo do Gmail dispara um `POST` sem
   * pedir confirmacao. E a mesma inversao que a spec 012 registrou para
   * `notification_reads` -- um 409 em "ja sai da lista" seria um erro sem nada
   * a consertar.
   *
   * Perfil inexistente e ignorado em silencio, e nao e falha: o endpoint publico
   * responde 204 de qualquer forma, e distinguir seria um oraculo de `uid`.
   */
  async setEmailOptOut(
    id: string,
    optOut: boolean,
    reason: EmailOptOutReason | null,
  ): Promise<{ found: boolean }> {
    const ref = this.collection.doc(id);
    const snapshot = await ref.get();

    if (!snapshot.exists) {
      return { found: false };
    }

    await ref.update({
      emailOptOut: optOut,
      emailOptOutReason: optOut ? reason : null,
      emailOptOutAt: optOut ? Timestamp.now() : null,
      updatedAt: Timestamp.now(),
    });

    return { found: true };
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
