// The database schema (02 §2, §4.2): one spec per collection (validator + indexes) and every view.
import { type CollectionName, COLLECTIONS } from '../collections.ts';
import { BENEFICIARY_COLLECTIONS } from './beneficiaries.ts';
import { CONTENT_COLLECTIONS } from './content.ts';
import { MASJID_COLLECTIONS } from './masjids.ts';
import { PLATFORM_COLLECTIONS } from './platform.ts';
import { SECTION_COLLECTIONS } from './sections.ts';
import type { CollectionSpec } from './types.ts';

export {
  BENEFICIARIES_ACTIVE_MAX,
  BENEFICIARY_CAP_MAX_PAISE,
  BENEFICIARY_CAP_MIN_PAISE,
  BENEFICIARY_PURGE_DAYS,
} from './beneficiaries.ts';
export * from './dsl.ts';
export * from './enums.ts';
export { ADHKAR_MAX, INDIA } from './masjids.ts';
export { CONTACTS_MAX, E164_PATTERN, RUQYAH_MAX } from './sections.ts';
export type { CollectionSpec, IndexSpec } from './types.ts';
export { VIEWS, type ViewSpec } from './views.ts';

const ALL = [
  ...MASJID_COLLECTIONS,
  ...CONTENT_COLLECTIONS,
  ...SECTION_COLLECTIONS,
  ...PLATFORM_COLLECTIONS,
  ...BENEFICIARY_COLLECTIONS,
];

/** Collection specs by name; a collection without a spec is a build error (checked below and by tests). */
export const SCHEMAS: Readonly<Record<CollectionName, CollectionSpec>> = Object.fromEntries(
  ALL.map((spec) => [spec.name, spec]),
) as Record<CollectionName, CollectionSpec>; // completeness asserted right below

const missing = COLLECTIONS.filter((name) => !(name in SCHEMAS));
if (missing.length > 0 || ALL.length !== COLLECTIONS.length) {
  throw new Error(`schema: specs missing or duplicated for ${missing.join(', ') || '(duplicate names)'}`);
}
