// Writes packages/api/openapi.json from the routes registered by both apps (03 header).
// Run: pnpm --filter @mc/api openapi:generate. CI fails when the committed file is stale (test/openapi.test.ts).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildOpenApiDocument } from '../src/openapi.ts';

const target = new URL('../openapi.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
process.stdout.write(`wrote ${fileURLToPath(target)}\n`);
