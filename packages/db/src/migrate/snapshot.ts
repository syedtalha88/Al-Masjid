// Schema snapshots (PHASE_01 T1.2): a migration applies a FROZEN copy of validators, indexes and views, stored as
// canonical Extended JSON next to it (exact BSON types — `long` bounds, int vs double — survive the round trip).
// Changing the live schema in src/schema without a new migration is caught by `db:schema:check` (drift).
import { createHash } from 'node:crypto';

import { BSON, type Db, type Document } from 'mongodb';

import type { CollectionName } from '../collections.ts';
import { SCHEMAS, VIEWS } from '../schema/index.ts';
import type { IndexSpec } from '../schema/types.ts';

export interface CollectionSnapshot {
  readonly name: CollectionName;
  readonly jsonSchema: Document;
  readonly indexes: readonly IndexSpec[];
}
export interface ViewSnapshot {
  readonly name: string;
  readonly viewOn: string;
  readonly pipeline: readonly Document[];
}
export interface SchemaSnapshot {
  readonly collections: readonly CollectionSnapshot[];
  readonly views: readonly ViewSnapshot[];
}

/** Canonical Extended JSON text of a snapshot (what the snapshot files contain). */
export function snapshotText(snapshot: SchemaSnapshot): string {
  return `${BSON.EJSON.stringify(snapshot, undefined, 2, { relaxed: false })}\n`;
}

/** Parses a snapshot file's text back into BSON values. */
export function parseSnapshot(text: string): SchemaSnapshot {
  return BSON.EJSON.parse(text, { relaxed: false }) as SchemaSnapshot; // produced by snapshotText(); shape validated by tests
}

/** sha256 of the canonical snapshot text — the migration's checksum. */
export function snapshotChecksum(snapshot: SchemaSnapshot): string {
  return createHash('sha256').update(snapshotText(snapshot)).digest('hex');
}

/** A snapshot of the CURRENT schema for the given collections/views (used to create a migration's file). */
export function currentSnapshot(collections: readonly CollectionName[], views: readonly string[] = []): SchemaSnapshot {
  return {
    collections: collections.map((name) => ({
      name,
      jsonSchema: SCHEMAS[name].jsonSchema,
      indexes: SCHEMAS[name].indexes,
    })),
    views: VIEWS.filter((view) => views.includes(view.name)).map((view) => ({
      name: view.name,
      viewOn: view.viewOn,
      pipeline: view.pipeline,
    })),
  };
}

const isCode = (error: unknown, code: number) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

/** Index options as the server stores them (for comparing an existing index with its spec). */
export function indexOptions(spec: IndexSpec): Document {
  return {
    ...(spec.unique ? { unique: true } : {}),
    ...(spec.partialFilterExpression ? { partialFilterExpression: spec.partialFilterExpression } : {}),
    ...(spec.default_language ? { default_language: spec.default_language } : {}),
  };
}

/**
 * Applies a snapshot idempotently: creates missing collections with their validator (strict/error — 02 §0) or
 * updates it with `collMod`; creates indexes, replacing an index whose name exists with a different definition;
 * creates views or updates their pipeline with `collMod`.
 *
 * @throws on any server error (the runner records nothing for a migration that threw).
 */
export async function applySnapshot(db: Db, snapshot: SchemaSnapshot): Promise<void> {
  const existing = new Map(
    (await db.listCollections({}, { nameOnly: false }).toArray()).map((info) => [info.name, info]),
  );
  for (const { name, jsonSchema, indexes } of snapshot.collections) {
    const validation = {
      validator: { $jsonSchema: jsonSchema },
      validationLevel: 'strict' as const,
      validationAction: 'error' as const,
    };
    if (existing.has(name)) await db.command({ collMod: name, ...validation });
    else await db.createCollection(name, validation);
    const collection = db.collection(name);
    const live = (await collection.listIndexes().toArray()) as Document[]; // the driver types index infos as any
    const current = new Map(live.map((index) => [String(index['name']), index]));
    for (const spec of indexes) {
      const have = current.get(spec.name);
      if (have && !sameIndex(have, spec)) await collection.dropIndex(spec.name);
      if (!have || !sameIndex(have, spec)) {
        await collection.createIndex({ ...spec.key }, { name: spec.name, ...indexOptions(spec) });
      }
    }
  }
  for (const { name, viewOn, pipeline } of snapshot.views) {
    if (existing.has(name)) await db.command({ collMod: name, viewOn, pipeline });
    else {
      try {
        await db.createCollection(name, { viewOn, pipeline: [...pipeline] });
      } catch (error) {
        /* v8 ignore next 3 -- race: another runner created the view between listCollections and here; the runner's lock
           makes this practically unreachable, but a view must never be left half-applied */
        if (!isCode(error, 48)) throw error; // NamespaceExists — collMod brings it in line
        await db.command({ collMod: name, viewOn, pipeline });
      }
    }
  }
}

/** True when a live index (from listIndexes) matches a spec's key and options. */
export function sameIndex(live: Document, spec: IndexSpec): boolean {
  const canon = (value: unknown) => BSON.EJSON.stringify(value ?? null, { relaxed: true });
  const isText = Object.values(spec.key).includes('text');
  const keyMatches = isText
    ? canon(live['weights']) === canon(Object.fromEntries(Object.keys(spec.key).map((field) => [field, 1])))
    : canon(live['key']) === canon(spec.key);
  return (
    keyMatches &&
    Boolean(live['unique']) === Boolean(spec.unique) &&
    canon(live['partialFilterExpression']) === canon(spec.partialFilterExpression) &&
    (!isText || live['default_language'] === spec.default_language)
  );
}
