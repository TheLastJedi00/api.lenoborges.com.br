import { Injectable } from '@nestjs/common';
import { CollectionReference } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import {
  WaitlistEntry,
  waitlistEntryConverter,
} from './entities/waitlist-entry.entity';

export const WAITLIST_COLLECTION = 'waitlist_entries';

/**
 * Codigo de erro do Firestore para documento que ja existe (gRPC ALREADY_EXISTS).
 *
 * Ocupa o lugar que o `23505` do Postgres ocupava: e o que o `create()` devolve
 * quando duas requisicoes tentam gravar o mesmo e-mail ao mesmo tempo. Exportado
 * porque quem traduz a corrida em resposta HTTP e o service, nao este arquivo.
 */
export const ALREADY_EXISTS = 6;

/**
 * O mesmo "documento ja existe", **como o transporte REST o escreve**: o status
 * HTTP `409`, e nao o codigo gRPC.
 *
 * O `FirebaseService` liga o Firestore com `preferRest: true` -- ha um motivo
 * documentado la, e ele continua valendo. Com ele quem recusa a duplicata e a
 * API REST, e ela responde `409 Conflict`. O `6` so aparece quando o transporte
 * e gRPC: o emulador, os testes, e qualquer script local.
 *
 * **Os dois codigos significam a mesma coisa e a aplicacao precisa aceitar os
 * dois**, porque o mesmo build roda nos dois transportes.
 */
export const ALREADY_EXISTS_REST = 409;

/**
 * `true` quando o Firestore recusou a escrita por o documento ja existir.
 *
 * **Este e o unico lugar do produto que sabe como essa recusa chega.** A regra
 * "`create()`, nunca `set()`" e a unicidade deste produto inteiro -- o
 * `ALREADY_EXISTS` ocupa o lugar da unique violation `23505` do Postgres --, e
 * cerca de dez `catch` dependem de reconhece-la. Todos compararem contra um
 * numero so foi o que quebrou em 2026-09-01: no `firebase-admin@13` com
 * `preferRest`, a promessa do `create()` sobre caminho ocupado **nunca
 * resolvia** e a requisicao ficava pendurada; subir para a 14 devolveu o erro,
 * mas como `409`, e cada `if` que so conhecia o `6` teria trocado o travamento
 * por um `500`.
 *
 * Uma funcao, e nao a constante solta, para que um transporte com um terceiro
 * codigo custe uma linha aqui em vez de dez espalhadas.
 */
export function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const { code } = error as { code?: unknown };

  return code === ALREADY_EXISTS || code === ALREADY_EXISTS_REST;
}

@Injectable()
export class WaitlistRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<WaitlistEntry> {
    return this.firebase.firestore
      .collection(WAITLIST_COLLECTION)
      .withConverter(waitlistEntryConverter);
  }

  async findByEmail(
    email: string,
  ): Promise<{ found: boolean; entry?: WaitlistEntry }> {
    // Leitura por caminho, nao consulta: o e-mail normalizado E o ID do
    // documento. Trocar isto por um where() custaria um indice e, pior,
    // devolveria a unicidade ao acaso -- e ela hoje so existe por ser o caminho.
    const snapshot = await this.collection.doc(email).get();

    if (!snapshot.exists) {
      return { found: false };
    }

    return { found: true, entry: snapshot.data()! };
  }

  /**
   * Apaga a inscricao na lista de espera (spec 013).
   *
   * Ela guarda nome, telefone e e-mail: e dado pessoal puro, e e o registro mais
   * facil de esquecer numa exclusao de conta, porque nenhuma tela do painel o
   * mostra. O ID e o e-mail normalizado, que e o caminho do documento.
   *
   * `delete()` em documento inexistente nao e erro no Firestore, e aqui isso e
   * o comportamento certo: quem entrou direto, sem passar pela lista, nao tem o
   * que apagar.
   */
  async remove(id: string): Promise<void> {
    await this.collection.doc(id).delete();
  }

  async create(
    data: Pick<WaitlistEntry, 'name' | 'phone' | 'email' | 'consent'>,
  ): Promise<{ entry: WaitlistEntry }> {
    const createdAt = new Date();
    const ref = this.collection.doc(data.email);

    // create(), nunca set(): set sobrescreveria a inscricao anterior em
    // silencio. E o create que recusa duplicata com ALREADY_EXISTS, e essa
    // recusa e a unica coisa segurando a unicidade do e-mail.
    await ref.create({ ...data, id: data.email, createdAt });

    return { entry: { ...data, id: ref.id, createdAt } };
  }
}
