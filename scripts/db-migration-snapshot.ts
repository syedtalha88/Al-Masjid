// `pnpm db:migration:snapshot <id>` — freezes the CURRENT schema of a schema migration's area (packages/db/migrations/
// areas.ts) into packages/db/migrations/<id>.snapshot.json. Refuses to overwrite: an applied migration never changes;
// a schema change gets a new id (PHASE_01 T1.2).
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { currentSnapshot, snapshotText } from '@mc/db/migrate';
import { SCHEMA_AREAS } from '@mc/db/migrations/areas';

const ids = process.argv.slice(2);
if (ids.length === 0) throw new Error('usage: pnpm db:migration:snapshot <id> [<id>…]');
for (const id of ids) {
  const area = SCHEMA_AREAS[id];
  if (!area) throw new Error(`${id}: not in packages/db/migrations/areas.ts`);
  const out = fileURLToPath(new URL(`../packages/db/migrations/${id}.snapshot.json`, import.meta.url));
  if (existsSync(out)) throw new Error(`${id}: snapshot exists — applied migrations never change; add a new id`);
  writeFileSync(out, snapshotText(currentSnapshot(area.collections, area.views ?? [])));
  process.stdout.write(`db:migration:snapshot — ${id}.snapshot.json written\n`);
}
