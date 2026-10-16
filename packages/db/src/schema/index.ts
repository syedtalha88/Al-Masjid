// The database schema (02 §2, §4.2): one spec per collection (validator + indexes) and every view.
import { type CollectionName, COLLECTIONS } from '../collections.ts';
import { CONTENT_COLLECTIONS } from './content.ts';
import { MASJID_COLLECTIONS } from './masjids.ts';
import { PLATFORM_COLLECTIONS } from './platform.ts';
import type { CollectionSpec } from './types.ts';

export * from './dsl.ts';
export * from './enums.ts';
export type { CollectionSpec, IndexSpec } from './types.ts';
export { VIEWS, type ViewSpec } from './views.ts';

const ALL = [...MASJID_COLLECTIONS, ...CONTENT_COLLECTIONS, ...PLATFORM_COLLECTIONS];

/** Collection specs by name; a collection without a spec is a build error (checked below and by tests). */
export const SCHEMAS: Readonly<Record<CollectionName, CollectionSpec>> = Object.fromEntries(
  ALL.map((spec) => [spec.name, spec]),
) as Record<CollectionName, CollectionSpec>; // completeness asserted right below

const missing = COLLECTIONS.filter((name) => !(name in SCHEMAS));
if (missing.length > 0 || ALL.length !== COLLECTIONS.length) {
  throw new Error(`schema: specs missing or duplicated for ${missing.join(', ') || '(duplicate names)'}`);
}
