import { FieldValue, Timestamp } from 'firebase-admin/firestore';

/**
 * Um Firestore de mentira, em memoria, com **a superficie exata** que o
 * `WatchedVideoRepository` usa (spec 019).
 *
 * Ele existe por uma razao so, e ela e a decisao 2 da spec: a invariante
 * **`xp === XP_PER_VIDEO x numero de documentos do razao`** nao e verificavel
 * com `jest.fn()`. Um mock prova que `batch.create` foi chamado; nao prova que a
 * segunda chamada falhou, que o incremento nao aconteceu por causa dela, e que o
 * numero final bate com a contagem. **A propriedade que a spec inteira existe
 * para garantir so pode ser testada contra um armazenamento que se comporta.**
 *
 * O que ele implementa, e nada alem disso:
 *
 * - `collection().doc().collection().withConverter().doc()`
 * - `get()`, `update()` com `FieldValue.increment`, `listDocuments()`
 * - `getAll(...refs)`
 * - `batch()` com `create()`, `update()` e `commit()` -- e o `commit()`
 *   **falha inteiro** com ALREADY_EXISTS quando um `create()` do lote atinge um
 *   caminho ocupado, que e exatamente a atomicidade de que a decisao 3 depende.
 *
 * Nao e um Firestore. E o suficiente para a unica pergunta que importa aqui.
 */

type Doc = Record<string, unknown>;

interface Converter<T> {
  toFirestore(value: T): Doc;
  fromFirestore(snapshot: { id: string; data: () => Doc }): T;
}

/** O codigo gRPC de ALREADY_EXISTS, o mesmo que o Firestore de verdade devolve. */
const ALREADY_EXISTS = 6;
const NOT_FOUND = 5;

class FakeError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

function applyPatch(current: Doc, patch: Doc): Doc {
  const next: Doc = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value instanceof FieldValue) {
      // So o `increment` e usado por este repositorio. Qualquer outro sentinela
      // chegando aqui e um caminho novo que este fake nao cobre, e falhar alto e
      // melhor do que gravar `[object Object]` no campo.
      const operand = (value as unknown as { operand?: number }).operand;
      if (typeof operand !== 'number') {
        throw new Error('fake-firestore: sentinela nao suportado no update');
      }
      const base = typeof next[key] === 'number' ? next[key] : 0;
      next[key] = base + operand;
      continue;
    }

    // O Firestore converte `Date` em `Timestamp` na escrita, e um `update()`
    // parcial nao passa pelo converter -- entao e aqui que a conversao acontece
    // de verdade. Sem isto, o fake guardaria um `Date` cru e a leitura seguinte
    // estouraria em `.toDate()`, num erro que so existe no teste.
    next[key] = value instanceof Date ? Timestamp.fromDate(value) : value;
  }

  return next;
}

class FakeDocumentReference<T = Doc> {
  constructor(
    private readonly store: Map<string, Doc>,
    readonly path: string,
    readonly converter?: Converter<T>,
  ) {}

  get id(): string {
    return this.path.slice(this.path.lastIndexOf('/') + 1);
  }

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this.store, `${this.path}/${name}`);
  }

  get(): Promise<{ exists: boolean; id: string; data: () => T | Doc }> {
    const raw = this.store.get(this.path);

    return Promise.resolve({
      exists: raw !== undefined,
      id: this.id,
      data: () => {
        if (raw === undefined) {
          return undefined as unknown as Doc;
        }

        return this.converter
          ? this.converter.fromFirestore({ id: this.id, data: () => raw })
          : raw;
      },
    });
  }

  update(patch: Doc): Promise<void> {
    const current = this.store.get(this.path);
    if (current === undefined) {
      throw new FakeError(`no document to update: ${this.path}`, NOT_FOUND);
    }

    this.store.set(this.path, applyPatch(current, patch));

    return Promise.resolve();
  }
}

class FakeCollectionReference<T = Doc> {
  constructor(
    private readonly store: Map<string, Doc>,
    private readonly path: string,
    private readonly converter?: Converter<T>,
  ) {}

  withConverter<U>(converter: Converter<U>): FakeCollectionReference<U> {
    return new FakeCollectionReference<U>(this.store, this.path, converter);
  }

  doc(id: string): FakeDocumentReference<T> {
    return new FakeDocumentReference<T>(
      this.store,
      `${this.path}/${id}`,
      this.converter,
    );
  }

  listDocuments(): Promise<FakeDocumentReference<T>[]> {
    const prefix = `${this.path}/`;
    const refs: FakeDocumentReference<T>[] = [];

    for (const key of this.store.keys()) {
      // So filhos diretos: um caminho com mais uma barra e uma subcolecao.
      if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
        refs.push(
          new FakeDocumentReference<T>(this.store, key, this.converter),
        );
      }
    }

    return Promise.resolve(refs);
  }
}

interface PendingWrite {
  kind: 'create' | 'update' | 'delete';
  ref: FakeDocumentReference<unknown>;
  data: Doc;
}

class FakeWriteBatch {
  private readonly writes: PendingWrite[] = [];

  constructor(private readonly store: Map<string, Doc>) {}

  create(ref: FakeDocumentReference<unknown>, data: unknown): void {
    this.writes.push({ kind: 'create', ref, data: toRaw(ref, data) });
  }

  update(ref: FakeDocumentReference<unknown>, data: Doc): void {
    this.writes.push({ kind: 'update', ref, data });
  }

  delete(ref: FakeDocumentReference<unknown>): void {
    this.writes.push({ kind: 'delete', ref, data: {} });
  }

  /**
   * **Ou tudo, ou nada** -- e e disso que a decisao 3 depende.
   *
   * Um `create()` sobre caminho ocupado derruba o lote inteiro com
   * ALREADY_EXISTS, e o incremento de `xp` que ia junto **nao acontece**. E o
   * que impede o farm por duplo clique sem transacao, sem leitura previa e sem
   * janela entre conferir e escrever.
   */
  commit(): Promise<void> {
    for (const write of this.writes) {
      if (write.kind === 'create' && this.store.has(write.ref.path)) {
        throw new FakeError(
          `document already exists: ${write.ref.path}`,
          ALREADY_EXISTS,
        );
      }
      if (write.kind === 'update' && !this.store.has(write.ref.path)) {
        throw new FakeError(
          `no document to update: ${write.ref.path}`,
          NOT_FOUND,
        );
      }
    }

    for (const write of this.writes) {
      if (write.kind === 'delete') {
        this.store.delete(write.ref.path);
      } else if (write.kind === 'create') {
        this.store.set(write.ref.path, write.data);
      } else {
        this.store.set(
          write.ref.path,
          applyPatch(this.store.get(write.ref.path)!, write.data),
        );
      }
    }

    return Promise.resolve();
  }
}

/** O converter roda na escrita, como no Firestore de verdade. */
function toRaw(ref: FakeDocumentReference<unknown>, data: unknown): Doc {
  return ref.converter ? ref.converter.toFirestore(data) : (data as Doc);
}

export class FakeFirestore {
  readonly docs = new Map<string, Doc>();

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this.docs, name);
  }

  batch(): FakeWriteBatch {
    return new FakeWriteBatch(this.docs);
  }

  getAll(
    ...refs: FakeDocumentReference<unknown>[]
  ): Promise<{ exists: boolean; id: string; data: () => Doc }[]> {
    return Promise.all(
      refs.map((ref) =>
        ref.get().then((snapshot) => ({
          exists: snapshot.exists,
          id: snapshot.id,
          // O `getAll` do Firestore **perde o converter** no caminho de volta, e
          // este fake perde tambem: o repositorio faz o cast por conta propria, e
          // um fake que devolvesse o objeto convertido esconderia isso.
          data: () => this.docs.get(ref.path) as Doc,
        })),
      ),
    );
  }

  /** Atalho de leitura para os testes, sem passar pelo converter. */
  raw(path: string): Doc | undefined {
    return this.docs.get(path);
  }

  /** Quantos documentos existem sob um caminho, contando so os filhos diretos. */
  countUnder(path: string): number {
    const prefix = `${path}/`;
    let total = 0;

    for (const key of this.docs.keys()) {
      if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
        total += 1;
      }
    }

    return total;
  }

  /** Semeia um perfil, que e o que o incremento de `xp` precisa encontrar. */
  seedProfile(uid: string, xp = 0): void {
    this.docs.set(`profiles/${uid}`, {
      xp,
      updatedAt: Timestamp.now(),
    });
  }
}
