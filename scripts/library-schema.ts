// Writes scripts/library.schema.json — the Content Library import format as JSON Schema (PHASE_03 T3.4).
// Run: pnpm library:schema. A test in @mc/shared fails while the committed file is stale.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { libraryImportJsonSchema } from '../packages/shared/src/contracts/library-schema.ts';

const target = new URL('library.schema.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(libraryImportJsonSchema(), null, 2)}\n`);
process.stdout.write(`wrote ${fileURLToPath(target)}\n`);
