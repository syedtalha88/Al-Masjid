import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { libraryImportJsonSchema } from './library-schema.ts';

describe('scripts/library.schema.json', () => {
  it('is up to date — run `pnpm library:schema` and commit the result', () => {
    const committed = readFileSync(new URL('../../../../scripts/library.schema.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(libraryImportJsonSchema(), null, 2)}\n`);
  });

  it('requires the attribution fields of every entry (T3.4 acceptance)', () => {
    const schema = libraryImportJsonSchema() as {
      properties: { entries: { items: { required: string[]; properties: Record<string, unknown> } } };
    };
    const row = schema.properties.entries.items;
    expect(row.required).toEqual(
      expect.arrayContaining(['kind', 'arabic', 'translation', 'reference', 'source_name', 'source_license']),
    );
  });
});
