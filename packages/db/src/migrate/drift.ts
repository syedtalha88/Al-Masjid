// `pnpm db:schema:check` (02 header, PHASE_01 T1.2): compares the live database with the CURRENT schema in src/schema
// — validators, validation level/action, every index, every view pipeline. Any difference is drift: a hand edit on
// the server, or a schema change committed without a new migration. CI runs it on a freshly migrated database.
import { BSON, type Db, type Document } from 'mongodb';

import { SCHEMAS, VIEWS } from '../schema/index.ts';
import { sameIndex } from './snapshot.ts';

const canon = (value: unknown) => BSON.EJSON.stringify(value ?? null, { relaxed: false });

/**
 * Lists every difference between `db` and the current schema.
 *
 * @returns human-readable lines (empty = no drift). Never contains document data, only schema names.
 */
export async function schemaDrift(db: Db): Promise<string[]> {
  // promoteLongs off: a stored int64 bound must compare as int64, not as a JS number (exact BSON types).
  const infos = (await db.listCollections({}, { nameOnly: false, promoteLongs: false }).toArray()) as Document[]; // driver types as any
  const live = new Map(infos.map((info) => [String(info['name']), info]));
  const problems: string[] = [];

  for (const spec of Object.values(SCHEMAS)) {
    const info = live.get(spec.name);
    if (!info) {
      problems.push(`${spec.name}: collection missing`);
      continue;
    }
    const options = (info['options'] ?? {}) as Document;
    const validator = (options['validator'] ?? {}) as Document;
    if (canon(validator['$jsonSchema']) !== canon(spec.jsonSchema)) problems.push(`${spec.name}: validator differs`);
    if (options['validationLevel'] !== 'strict') problems.push(`${spec.name}: validationLevel is not strict`);
    if (options['validationAction'] !== 'error') problems.push(`${spec.name}: validationAction is not error`);
    const indexes = (await db.collection(spec.name).listIndexes().toArray()) as Document[];
    for (const index of spec.indexes) {
      const have = indexes.find((candidate) => candidate['name'] === index.name);
      if (!have) problems.push(`${spec.name}: index ${index.name} missing`);
      else if (!sameIndex(have, index)) problems.push(`${spec.name}: index ${index.name} differs`);
    }
    for (const have of indexes) {
      const name = String(have['name']);
      if (name !== '_id_' && !spec.indexes.some((index) => index.name === name)) {
        problems.push(`${spec.name}: unexpected index ${name}`);
      }
    }
  }
  for (const view of VIEWS) {
    const info = live.get(view.name);
    const options = (info?.['options'] ?? {}) as Document;
    if (!info || info['type'] !== 'view') problems.push(`${view.name}: view missing`);
    else if (options['viewOn'] !== view.viewOn || canon(options['pipeline']) !== canon(view.pipeline)) {
      problems.push(`${view.name}: view definition differs`);
    }
  }
  const known = new Set<string>([...Object.keys(SCHEMAS), ...VIEWS.map((view) => view.name)]);
  for (const name of live.keys()) {
    if (!known.has(name) && !name.startsWith('system.')) problems.push(`${name}: unexpected collection`);
  }
  return problems;
}
