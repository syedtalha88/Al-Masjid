// The only gateway from repositories to collections (02 §0, §4.1, PHASE_01 T1.4): every call resolves its policy cell,
// ANDs the tenant filter into the query (a caller's filter can never widen it), requires inserted documents to lie
// inside the tenant, restricts updates to the cell's writable fields, hides fields, and rejects operator-shaped keys
// (`$…`, dotted) in data — the NoSQL-injection guard of 02 §0.
import { Binary, type Document, type Filter, Long, ObjectId, type UpdateFilter } from 'mongodb';

import { CONTENT_COLLECTIONS, type Namespace } from './collections.ts';
import { type Cell, cellFor, type Operation, type PolicyContext, PolicyDeniedError } from './policy.ts';

const ALLOWED_UPDATE_OPERATORS = new Set(['$set', '$unset', '$inc', '$push', '$pull', '$setOnInsert', '$addToSet']);

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !(value instanceof Binary) &&
  !(value instanceof Date) &&
  !(value instanceof Long) &&
  !(value instanceof ObjectId) &&
  !Array.isArray(value);

/**
 * Throws when any key inside `value` starts with `$` or contains `.` (02 §0 injection guard).
 *
 * @throws PolicyDeniedError naming the namespace and the offending key path.
 */
export function assertSafeKeys(value: unknown, namespace: string, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSafeKeys(item, namespace, `${path}[${String(index)}]`);
    });
    return;
  }
  if (!isPlain(value)) return;
  for (const [key, inner] of Object.entries(value)) {
    if (key.startsWith('$') || key.includes('.')) {
      throw new PolicyDeniedError(namespace, 'write', 'any', `unsafe key ${path}${key}`);
    }
    assertSafeKeys(inner, namespace, `${path}${key}.`);
  }
}

const same = (a: unknown, b: unknown): boolean => {
  if (a instanceof Binary && b instanceof Binary)
    return a.sub_type === b.sub_type && Buffer.compare(a.buffer, b.buffer) === 0;
  return a === b;
};

/** Whether a document satisfies a tenant filter (top-level equality and `$in` — the only shapes cells produce). */
export function matchesTenant(doc: Document, filter: Filter<Document>): boolean {
  return Object.entries(filter).every(([field, condition]) => {
    if (field === '$and' && Array.isArray(condition)) {
      return (condition as Filter<Document>[]).every((part) => matchesTenant(doc, part));
    }
    const value: unknown = doc[field];
    if (isPlain(condition) && '$in' in condition && Array.isArray(condition['$in'])) {
      return (condition['$in'] as unknown[]).some((candidate) => same(value, candidate));
    }
    return same(value, condition);
  });
}

const tenantOf = async (cell: Cell, ctx: PolicyContext): Promise<Filter<Document>> =>
  cell.filter ? await cell.filter(ctx) : {};
const withTenant = (filter: QueryFilter, tenant: Filter<Document>): Filter<Document> =>
  Object.keys(tenant).length === 0 ? filter : { $and: [filter, tenant] };
const sessionOf = (ctx: PolicyContext) => (ctx.session ? { session: ctx.session } : {});
const hiddenProjection = (cell: Cell) =>
  cell.hidden && cell.hidden.length > 0 ? { projection: Object.fromEntries(cell.hidden.map((f) => [f, 0])) } : {};
const present = (cell: Cell, doc: Document): Document => (cell.redact ? cell.redact(doc) : doc);

function assertWritable(cell: Cell, namespace: string, scope: string, update: UpdateFilter<Document>) {
  const writable = new Set([...(cell.writable ?? []), 'updated_at']);
  const values: Record<string, unknown> = {};
  for (const [operator, fields] of Object.entries(update)) {
    if (!ALLOWED_UPDATE_OPERATORS.has(operator) || !isPlain(fields)) {
      throw new PolicyDeniedError(namespace, 'update', scope, `operator ${operator} not allowed`);
    }
    for (const [path, value] of Object.entries(fields)) {
      const field = path.split('.')[0] ?? path;
      if (!writable.has('*') && !writable.has(field)) {
        throw new PolicyDeniedError(namespace, 'update', scope, `field ${field} not writable`);
      }
      assertSafeKeys(value, namespace);
      values[field] = operator === '$unset' ? undefined : value;
    }
  }
  const refused = cell.check?.(values);
  if (refused) throw new PolicyDeniedError(namespace, 'update', scope, refused);
}

/**
 * The document an upsert would insert: MongoDB seeds it from the equality conditions of the FULL query — the caller's
 * filter and the tenant fence, also inside `$and` — plus `$setOnInsert` / `$set` (security review M-B). Operator
 * conditions (`$ne`, …) seed nothing; `$eq` and a one-value `$in` do (as in MongoDB — so an admin's own-masjid fence
 * plus the contentWrite() masjid already seed `masjid_id` twice, and MongoDB refuses such upserts itself).
 *
 * @returns the seed, or `null` when a field is seeded twice (MongoDB refuses that upsert; the caller must not repeat a
 *   fenced field such as `masjid_id`).
 */
function upsertSeed(query: QueryFilter, update: UpdateFilter<Document>): Document | null {
  const seed: Document = {};
  const state = { conflict: false };
  const put = (field: string, value: unknown) => {
    if (field in seed) state.conflict = true;
    seed[field] = value;
  };
  const take = (part: Readonly<Record<string, unknown>>) => {
    for (const [field, condition] of Object.entries(part)) {
      if (field === '$and' && Array.isArray(condition)) {
        for (const inner of condition) if (isPlain(inner)) take(inner);
      } else if (!field.startsWith('$')) {
        if (!isPlain(condition)) put(field, condition);
        else if ('$eq' in condition) put(field, condition['$eq']);
        else if (Array.isArray(condition['$in']) && condition['$in'].length === 1) put(field, condition['$in'][0]);
        else if (!Object.keys(condition).some((key) => key.startsWith('$'))) put(field, condition);
      }
    }
  };
  take(query);
  for (const operator of ['$setOnInsert', '$set'] as const) {
    const fields: unknown = update[operator];
    if (isPlain(fields)) for (const [field, value] of Object.entries(fields)) put(field, value);
  }
  return state.conflict ? null : seed;
}

/** A filter built by a repository from typed values (UUID ids included); the tenant filter is ANDed in. */
export type QueryFilter = Readonly<Record<string, unknown>>;

export interface ScopedCollection {
  find(filter: QueryFilter, options?: { sort?: Document; limit?: number; skip?: number }): Promise<Document[]>;
  findOne(filter: QueryFilter): Promise<Document | null>;
  count(filter: QueryFilter): Promise<number>;
  insertOne(doc: Document): Promise<void>;
  /** @returns how many documents matched INSIDE the tenant (0 for another tenant's id — never an error). */
  updateOne(filter: QueryFilter, update: UpdateFilter<Document>, options?: { upsert?: boolean }): Promise<number>;
  updateMany(filter: QueryFilter, update: UpdateFilter<Document>): Promise<number>;
  deleteOne(filter: QueryFilter): Promise<number>;
}

/**
 * The policy-enforced view of one namespace for one scope.
 *
 * @throws PolicyDeniedError from each method when the scope has no cell for that operation, an insert lies outside the
 *   tenant, an update touches a non-writable field or uses another operator, or data carries operator-shaped keys.
 */
/**
 * Content writes (02 §5): outside the system scope they need `contentWrite()` and are confined to its masjid — the
 * field naming the masjid is `_id` for masjid_timings, `masjid_id` elsewhere.
 */
function contentConfinement(ctx: PolicyContext, namespace: Namespace, operation: Operation): Filter<Document> {
  if (
    !(CONTENT_COLLECTIONS as readonly Namespace[]).includes(namespace) ||
    operation === 'find' ||
    (namespace === 'masjids' && operation === 'insert') ||
    ctx.scope.kind === 'system'
  ) {
    return {};
  }
  if (!ctx.contentMasjidId) {
    throw new PolicyDeniedError(namespace, operation, ctx.scope.kind, 'content writes go through contentWrite()');
  }
  return { [namespace === 'masjid_timings' || namespace === 'masjids' ? '_id' : 'masjid_id']: ctx.contentMasjidId };
}

export function scoped(ctx: PolicyContext, namespace: Namespace): ScopedCollection {
  const collection = ctx.db.collection(namespace);
  const cell = (operation: Operation) => cellFor(namespace, ctx.scope, operation);
  /** Tenant filter plus, for content writes, the contentWrite() masjid. */
  // Combined with $and, never merged: both may constrain the same field (masjid_id), and a merge would let the
  // contentWrite() masjid replace the tenant filter (caught by the isolation test, 16 Oct 2026).
  const fence = async (c: Cell, operation: Operation): Promise<Filter<Document>> => {
    const parts = [await tenantOf(c, ctx), contentConfinement(ctx, namespace, operation)].filter(
      (part) => Object.keys(part).length > 0,
    );
    if (parts.length === 0) return {};
    return parts.length === 1 ? (parts[0] ?? {}) : { $and: parts };
  };
  return {
    async find(filter, options = {}) {
      const c = cell('find');
      const cursor = collection.find(withTenant(filter, await tenantOf(c, ctx)), {
        ...hiddenProjection(c),
        ...sessionOf(ctx),
      });
      if (options.sort) cursor.sort(options.sort);
      if (options.skip !== undefined) cursor.skip(options.skip);
      if (options.limit !== undefined) cursor.limit(options.limit);
      return (await cursor.toArray()).map((doc) => present(c, doc));
    },
    async findOne(filter) {
      const c = cell('find');
      const doc = await collection.findOne(withTenant(filter, await tenantOf(c, ctx)), {
        ...hiddenProjection(c),
        ...sessionOf(ctx),
      });
      return doc ? present(c, doc) : null;
    },
    async count(filter) {
      const c = cell('find');
      return collection.countDocuments(withTenant(filter, await tenantOf(c, ctx)), sessionOf(ctx));
    },
    async insertOne(doc) {
      const c = cell('insert');
      assertSafeKeys(doc, namespace);
      const tenant = await fence(c, 'insert');
      if (!matchesTenant(doc, tenant))
        throw new PolicyDeniedError(namespace, 'insert', ctx.scope.kind, 'outside tenant');
      const refused = c.check?.(doc);
      if (refused) throw new PolicyDeniedError(namespace, 'insert', ctx.scope.kind, refused);
      await collection.insertOne(doc, sessionOf(ctx));
    },
    async updateOne(filter, update, options = {}) {
      const c = cell('update');
      assertWritable(c, namespace, ctx.scope.kind, update);
      if (options.upsert) {
        // An upsert may INSERT: the new document must pass the insert cell too — tenant and value rules (review M-B).
        const insertCell = cell('insert');
        const seed = upsertSeed(withTenant(filter, await fence(c, 'update')), update);
        if (!seed) throw new PolicyDeniedError(namespace, 'insert', ctx.scope.kind, 'upsert seeds a field twice');
        if (!matchesTenant(seed, await fence(insertCell, 'insert')))
          throw new PolicyDeniedError(namespace, 'insert', ctx.scope.kind, 'upsert outside tenant');
        const refused = insertCell.check?.(seed);
        if (refused) throw new PolicyDeniedError(namespace, 'insert', ctx.scope.kind, refused);
      }
      const result = await collection.updateOne(withTenant(filter, await fence(c, 'update')), update, {
        ...sessionOf(ctx),
        ...(options.upsert ? { upsert: true } : {}),
      });
      return result.matchedCount + result.upsertedCount;
    },
    async updateMany(filter, update) {
      const c = cell('update');
      assertWritable(c, namespace, ctx.scope.kind, update);
      const result = await collection.updateMany(withTenant(filter, await fence(c, 'update')), update, sessionOf(ctx));
      return result.matchedCount;
    },
    async deleteOne(filter) {
      const c = cell('delete');
      const result = await collection.deleteOne(withTenant(filter, await fence(c, 'delete')), sessionOf(ctx));
      return result.deletedCount;
    },
  };
}
