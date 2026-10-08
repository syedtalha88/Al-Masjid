import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument } from '../src/openapi.ts';

describe('openapi.json', () => {
  it('is up to date — run `pnpm --filter @mc/api openapi:generate` and commit the result', () => {
    const committed = readFileSync(new URL('../openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
  });
});
