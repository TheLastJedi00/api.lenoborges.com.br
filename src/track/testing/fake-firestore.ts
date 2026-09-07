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
 * - `get()`, `set()`, `update()` com `FieldValue.increment`, `delete()`,
 *   `listDocuments()`
 * - `getAll(...refs)`
 * - `batch()` com `create()`, `update()`, `delete()` e `commit()` -- e o
 *   `commit()` **falha inteiro** com ALREADY_EXISTS quando um `create()` do lote
 *   atinge um caminho ocupado, que e exatamente a atomicidade de que a decisao 3
 *   depende.
 * - consulta: `where(campo, '==', valor)`, `orderBy(campo)`, `count()` e `get()`
 *   -- acrescentados pela spec 022, que trouxe a primeira colecao deste produto
 *   consultada por dois campos ao mesmo tempo.
 *
 * **O `where` so entende `==`, de proposito.** Nenhum repositorio daqui usa
 * outro operador, e no dia em que usar o fake precisa falhar alto em vez de
 * fingir que filtrou -- um fake mais capaz que o codigo real vira um segundo
 * banco com semantica propria, e o teste passa a provar o fake.
 *
 * E ele reproduz a regra que ja custou duas specs: **documento sem o campo nao
 * casa com nenhum filtro e nao aparece em consulta ordenada por ele.** E a
 * armadilha do `tab` (spec 021) e do `promotedTo == null` (spec 016), e um fake
 * que a ignorasse deixaria as duas passarem verdes.
 *
 * Nao e um Firestore. E o suficiente para as perguntas que importam aqui.
 */

type Doc = Record<string, unknown>;

interface Converter<T> {
  toFirestore(value: T): Doc;
  fromFirestore(snapshot: { id: string; data: () => Doc }): T;
}

/**
 * **O mesmo "ja existe", escrito de dois jeitos, e o fake sabe os dois.**
 *
 * O `6` e o codigo gRPC; o `409` e o status HTTP com que o transporte REST --
 * o `preferRest: true` que a aplicacao usa na Vercel -- recusa a mesma coisa.
 * Ate 2026-09-01 este fake so sabia emitir o `6`, e foi exatamente por isso que
 * **a suite ficou verde com o produto travado em producao**: nenhum teste
 * chegava a exercitar o codigo que a aplicacao de verdade recebe.
 *
 * Quem escolhe e o `transport` do `FakeFirestore`. O padrao continua sendo
 * `grpc`, que e o do emulador e o de todos os testes que ja existiam.
 */
const ALREADY_EXISTS = 6;
const ALREADY_EXISTS_REST = 409;
const NOT_FOUND = 5;

/** Qual transporte este fake esta imitando. */
export type FakeTransport = 'grpc' | 'rest';

function alreadyExistsCode(transport: FakeTransport): number {
  return transport === 'rest' ? ALREADY_EXISTS_REST : ALREADY_EXISTS;
}

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
    readonly transport: FakeTransport = 'grpc',
  ) {}

  get id(): string {
    return this.path.slice(this.path.lastIndexOf('/') + 1);
  }

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(
      this.store,
      `${this.path}/${name}`,
      undefined,
      this.transport,
    );
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

  /**
   * Sobrescreve o documento inteiro, passando pelo converter.
   *
   * **Existe para o `update` do `GymQuestionRepository`, e a diferenca para o
   * `update()` acima e o converter.** O `update()` do Firestore e um patch de
   * campos crus e nao passa pelo converter; o `set()` recebe a entidade e a
   * converte. Um fake que tratasse os dois igual esconderia o unico bug que essa
   * distincao produz: gravar um `Date` onde o banco espera `Timestamp`.
   */
  set(data: T): Promise<void> {
    this.store.set(
      this.path,
      this.converter ? this.converter.toFirestore(data) : (data as Doc),
    );

    return Promise.resolve();
  }

  /**
   * `create()` solto, fora de lote -- e ele falha com ALREADY_EXISTS igual ao do
   * lote.
   *
   * **A regra do repositorio e `create()`, nunca `set()`**, e o fake so consegue
   * defende-la se as duas se comportarem diferente aqui dentro. Um fake em que
   * `create` fosse apelido de `set` deixaria passar exatamente o defeito que a
   * regra existe para impedir.
   */
  create(data: T): Promise<void> {
    if (this.store.has(this.path)) {
      throw new FakeError(
        `document already exists: ${this.path}`,
        alreadyExistsCode(this.transport),
      );
    }

    return this.set(data);
  }

  delete(): Promise<void> {
    this.store.delete(this.path);

    return Promise.resolve();
  }
}

/** Um `where` guardado ate a hora do `get()`. So o `==` e usado por este produto. */
interface FakeFilter {
  field: string;
  value: unknown;
}

/**
 * O pedaco de consulta que o fake entende: `where('campo', '==', v)`,
 * `orderBy(campo)` e `count()`.
 *
 * **Deliberadamente so o `==`.** Nenhum repositorio deste produto usa outro
 * operador -- e no dia em que usar, o fake precisa falhar alto em vez de fingir
 * que filtrou. Um fake que aceita mais do que o codigo real usa vira um segundo
 * banco de dados com semantica propria, e o teste passa a provar o fake.
 *
 * A ordenacao ignora `undefined`, do mesmo jeito que o Firestore ignora
 * documento sem o campo do `orderBy` -- que e a armadilha do `tab` da spec 021
 * e do `promotedTo` da 016, e vale demais ela existir aqui.
 */
/** Um `orderBy` guardado, com a direcao. */
interface FakeOrder {
  field: string;
  desc: boolean;
}

class FakeQuery<T = Doc> {
  constructor(
    private readonly store: Map<string, Doc>,
    private readonly path: string,
    private readonly converter: Converter<T> | undefined,
    private readonly filters: FakeFilter[] = [],
    private readonly orders: FakeOrder[] = [],
    private readonly cursor: unknown[] | null = null,
    private readonly max: number | null = null,
  ) {}

  private derive(patch: {
    filters?: FakeFilter[];
    orders?: FakeOrder[];
    cursor?: unknown[] | null;
    max?: number | null;
  }): FakeQuery<T> {
    return new FakeQuery<T>(
      this.store,
      this.path,
      this.converter,
      patch.filters ?? this.filters,
      patch.orders ?? this.orders,
      patch.cursor !== undefined ? patch.cursor : this.cursor,
      patch.max !== undefined ? patch.max : this.max,
    );
  }

  where(field: string, op: string, value: unknown): FakeQuery<T> {
    if (op !== '==') {
      throw new Error(`fake-firestore: operador nao suportado: ${op}`);
    }

    return this.derive({ filters: [...this.filters, { field, value }] });
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): FakeQuery<T> {
    return this.derive({
      orders: [...this.orders, { field, desc: direction === 'desc' }],
    });
  }

  /**
   * O cursor de paginacao, com **um valor por `orderBy`**.
   *
   * E aqui que a decisao do desempate por `uid` se prova: com um `orderBy` so
   * sobre um campo que empata, o cursor nao consegue apontar para uma linha
   * especifica, e a pagina seguinte pula ou repete quem tem o mesmo valor.
   */
  startAfter(...values: unknown[]): FakeQuery<T> {
    return this.derive({ cursor: values });
  }

  limit(n: number): FakeQuery<T> {
    return this.derive({ max: n });
  }

  count(): { get: () => Promise<{ data: () => { count: number } }> } {
    return {
      get: () =>
        Promise.resolve({ data: () => ({ count: this.matches().length }) }),
    };
  }

  get(): Promise<{
    empty: boolean;
    size: number;
    docs: { id: string; data: () => T | Doc }[];
  }> {
    const matches = this.matches();

    return Promise.resolve({
      empty: matches.length === 0,
      size: matches.length,
      docs: matches.map(([key, raw]) => ({
        id: key.slice(key.lastIndexOf('/') + 1),
        data: () =>
          this.converter
            ? this.converter.fromFirestore({
                id: key.slice(key.lastIndexOf('/') + 1),
                data: () => raw,
              })
            : raw,
      })),
    });
  }

  private matches(): [string, Doc][] {
    const prefix = `${this.path}/`;
    const rows: [string, Doc][] = [];

    for (const [key, raw] of this.store.entries()) {
      if (!key.startsWith(prefix) || key.slice(prefix.length).includes('/')) {
        continue;
      }

      // **Documento sem o campo nunca casa**, nem quando o valor procurado e
      // `null` -- e essa e a regra do Firestore que ja custou duas specs.
      const ok = this.filters.every(
        (filter) =>
          Object.hasOwn(raw, filter.field) &&
          raw[filter.field] === filter.value,
      );

      if (!ok) {
        continue;
      }

      // O `orderBy` do Firestore tambem exclui quem nao tem o campo -- em
      // qualquer um dos campos ordenados.
      if (this.orders.some((order) => !Object.hasOwn(raw, order.field))) {
        continue;
      }

      rows.push([key, raw]);
    }

    if (this.orders.length > 0) {
      rows.sort(([, a], [, b]) => {
        for (const order of this.orders) {
          const diff = compare(a[order.field], b[order.field]);

          if (diff !== 0) {
            return order.desc ? -diff : diff;
          }
        }

        return 0;
      });
    }

    let result = rows;

    if (this.cursor !== null) {
      // O cursor aponta para uma linha; a pagina comeca **depois** dela. A
      // comparacao percorre os campos ordenados na ordem, exatamente como o
      // Firestore faz -- e e por isso que um cursor com menos valores que
      // `orderBy` nao consegue desempatar.
      const values = this.cursor;
      const index = result.findIndex(([, raw]) => {
        for (let i = 0; i < values.length; i += 1) {
          const order = this.orders[i];
          const diff = compare(raw[order.field], values[i]);

          if (diff !== 0) {
            return order.desc ? diff < 0 : diff > 0;
          }
        }

        return false;
      });

      result = index === -1 ? [] : result.slice(index);
    }

    if (this.max !== null) {
      result = result.slice(0, this.max);
    }

    return result;
  }
}

/** Ordena Timestamp, numero e string -- os tres tipos que este produto ordena. */
function compare(a: unknown, b: unknown): number {
  const left = a instanceof Timestamp ? a.toMillis() : a;
  const right = b instanceof Timestamp ? b.toMillis() : b;

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  return String(left).localeCompare(String(right));
}

let autoId = 0;

class FakeCollectionReference<T = Doc> {
  constructor(
    private readonly store: Map<string, Doc>,
    private readonly path: string,
    private readonly converter?: Converter<T>,
    private readonly transport: FakeTransport = 'grpc',
  ) {}

  withConverter<U>(converter: Converter<U>): FakeCollectionReference<U> {
    return new FakeCollectionReference<U>(
      this.store,
      this.path,
      converter,
      this.transport,
    );
  }

  doc(id?: string): FakeDocumentReference<T> {
    // Sem id, o Firestore gera um. O contador basta: o teste so precisa que dois
    // `doc()` seguidos nao colidam.
    const docId = id ?? `auto-${(autoId += 1)}`;

    return new FakeDocumentReference<T>(
      this.store,
      `${this.path}/${docId}`,
      this.converter,
      this.transport,
    );
  }

  where(field: string, op: string, value: unknown): FakeQuery<T> {
    return new FakeQuery<T>(this.store, this.path, this.converter).where(
      field,
      op,
      value,
    );
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): FakeQuery<T> {
    return new FakeQuery<T>(this.store, this.path, this.converter).orderBy(
      field,
      direction,
    );
  }

  limit(n: number): FakeQuery<T> {
    return new FakeQuery<T>(this.store, this.path, this.converter).limit(n);
  }

  count(): { get: () => Promise<{ data: () => { count: number } }> } {
    return new FakeQuery<T>(this.store, this.path, this.converter).count();
  }

  get(): Promise<{
    empty: boolean;
    size: number;
    docs: { id: string; data: () => T | Doc }[];
  }> {
    return new FakeQuery<T>(this.store, this.path, this.converter).get();
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
  kind: 'create' | 'set' | 'update' | 'delete';
  ref: FakeDocumentReference<unknown>;
  data: Doc;
}

class FakeWriteBatch {
  private readonly writes: PendingWrite[] = [];

  constructor(
    private readonly store: Map<string, Doc>,
    private readonly transport: FakeTransport = 'grpc',
  ) {}

  create(ref: FakeDocumentReference<unknown>, data: unknown): void {
    this.writes.push({ kind: 'create', ref, data: toRaw(ref, data) });
  }

  /**
   * `set()` dentro do lote: sobrescreve, e **nao falha em caminho ocupado**.
   *
   * E o que o `GymChallengeRepository` usa para o documento de estado, que muda
   * a cada rodada. A diferenca para o `create()` acima e exatamente a que o
   * codigo real depende, e por isso o fake nao pode trata-los igual.
   */
  set(ref: FakeDocumentReference<unknown>, data: unknown): void {
    this.writes.push({ kind: 'set', ref, data: toRaw(ref, data) });
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
          alreadyExistsCode(this.transport),
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
      } else if (write.kind === 'create' || write.kind === 'set') {
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

  /**
   * O transporte que este fake imita, e por que ele e um parametro.
   *
   * `new FakeFirestore()` continua sendo gRPC, que e o que o emulador fala e o
   * que todos os testes anteriores a 2026-09-01 assumiam. `'rest'` faz o
   * `create()` sobre caminho ocupado recusar com `409` em vez de `6` --
   * **o codigo que a aplicacao de verdade recebe**, porque ela roda com
   * `preferRest: true`.
   *
   * Sem essa chave, um `catch` que so conhecesse o `6` passaria verde aqui e
   * devolveria `500` em producao. Foi o que aconteceu.
   */
  constructor(private readonly transport: FakeTransport = 'grpc') {}

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(
      this.docs,
      name,
      undefined,
      this.transport,
    );
  }

  batch(): FakeWriteBatch {
    return new FakeWriteBatch(this.docs, this.transport);
  }

  getAll(
    ...refs: FakeDocumentReference<unknown>[]
  ): Promise<{ exists: boolean; id: string; data: () => Doc }[]> {
    return Promise.all(
      refs.map((ref) =>
        ref.get().then((snapshot) => ({
          exists: snapshot.exists,
          id: snapshot.id,
          // **O converter acompanha a referencia, e nao o `getAll`.** No
          // firebase-admin o retorno e `DocumentSnapshot<T>` das refs que
          // entraram: ref com converter volta convertida, ref sem converter
          // volta crua. Os dois casos existem neste produto -- o
          // `WatchedVideoRepository` passa `profileDoc()` sem converter e faz o
          // cast na mao; o `GymQuestionRepository` passa refs tipadas e espera a
          // entidade. Um fake que escolhesse um dos dois quebraria o outro.
          data: () => snapshot.data() as Doc,
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
