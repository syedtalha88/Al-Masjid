import { z } from 'zod';

import { LIBRARY_IMPORT_FORMAT, libraryImportFileTypedSchema } from './library.ts';

/**
 * The Content Library import file as JSON Schema (draft 2020-12) — `scripts/library.schema.json`, for the owner's editor
 * and content partners (`docs/content-library-format.md`). The API validates with the Zod schemas themselves; rules
 * JSON Schema cannot express (kind-specific fields, unique tags, unsafe characters) are checked there and show in the
 * dry-run report. Regenerate with `pnpm library:schema`; a test fails while the committed file is stale.
 */
export function libraryImportJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(libraryImportFileTypedSchema, { io: 'input', unrepresentable: 'any' }),
    $id: 'https://almasjids.com/schemas/library-import-v1.json',
    title: `Content Library import file (${LIBRARY_IMPORT_FORMAT}, version 1)`,
  };
}
