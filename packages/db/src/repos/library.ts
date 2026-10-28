// Content Library read repositories (PHASE_03 T3.4): the Super Admin review list (C8 — every status) and, for masjid
// admins, browse/search and today's suggestion (B6/B7 — verified entries only: the admin policy cell filters on
// `status: 'verified'` and hides `search_text` / `import_batch_id`, 02 §4.1). Search uses the `search_text` text index
// with every query word quoted, so all words must match (DECISIONS #106).
import { dailyIndex } from '@mc/domain/rotation';
import { searchTerms } from '@mc/domain/search';
import { calendarDateInZone } from '@mc/domain/time';
import type { Document, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { StateError } from '../effects.ts';
import { DHIKR_OCCASION, DUA_CATEGORY, LIBRARY_KIND, LIBRARY_STATUS } from '../schema/enums.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { requireOwnMasjid } from './admin.ts';
import { compact, idOf, iso, maybeOneOf, need, numberOf, objectOf, oneOf, text } from './read.ts';

const PAGE = 30;
/** Deepest page reachable by cursor — the review list is filtered, never paged through thousands of rows. */
const MAX_OFFSET = 3000;
/** 07 B6: a published hadith/ayah is not suggested again to the same masjid for 60 days. */
export const SUGGESTION_REPEAT_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const LOCALES = ['en', 'hi', 'ur', 'te'] as const;

type Kind = (typeof LIBRARY_KIND)[number];

/** Offset cursors (base64url JSON) — a forged or stale cursor is just "no such page". */
const encodeOffset = (offset: number) => Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const offset = typeof parsed === 'object' && parsed !== null && 'o' in parsed ? parsed.o : undefined;
    if (typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 && offset <= MAX_OFFSET) return offset;
  } catch {
    // fall through
  }
  throw new StateError('INVALID_CURSOR');
}

const locales = (doc: Document | undefined) => {
  const out: Partial<Record<(typeof LOCALES)[number], string>> = {};
  if (!doc) return out;
  for (const locale of LOCALES) {
    const value = text(doc, locale);
    if (value !== undefined) out[locale] = value;
  }
  return out;
};
const strings = (doc: Document, key: string): string[] => {
  const value: unknown = doc[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
};
const occasionsOf = (doc: Document) =>
  Array.isArray(doc['occasions'])
    ? strings(doc, 'occasions').map((entry) => oneOf({ entry }, 'entry', DHIKR_OCCASION))
    : undefined;

/** Content and chips — what both the Super Admin and admins see. */
const contentOf = (doc: Document) => ({
  id: idOf(doc),
  kind: oneOf(doc, 'kind', LIBRARY_KIND),
  arabic: need(doc, 'arabic'),
  transliteration: locales(objectOf(doc, 'transliteration')),
  translation: { ...locales(objectOf(doc, 'translation')), en: need(objectOf(doc, 'translation') ?? {}, 'en') },
  reference: need(doc, 'reference'),
  sourceName: need(doc, 'source_name'),
  sourceLicense: need(doc, 'source_license'),
  tags: strings(doc, 'tags'),
  ...compact({
    duaCategory: maybeOneOf(doc, 'dua_category', DUA_CATEGORY),
    repeat: numberOf(doc, 'repeat'),
    occasions: occasionsOf(doc),
  }),
});
export type AdminLibraryRow = ReturnType<typeof contentOf>;

const superRowOf = (doc: Document) => ({
  ...contentOf(doc),
  status: oneOf(doc, 'status', LIBRARY_STATUS),
  importBatchId: idOf(doc, 'import_batch_id'),
  updatedAt: iso(doc, 'updated_at') ?? '',
  ...compact({ verifiedBy: text(doc, 'verified_by'), verifiedAt: iso(doc, 'verified_at') }),
});
export type SuperLibraryRow = ReturnType<typeof superRowOf>;

export interface LibraryFilter {
  readonly kind?: Kind;
  readonly category?: (typeof DUA_CATEGORY)[number];
  readonly tag?: string;
  readonly q?: string;
}

/** The query for a filter; `terms` non-empty → `$text` with every word quoted (AND). */
function filterOf(filter: LibraryFilter & { status?: (typeof LIBRARY_STATUS)[number] }) {
  const terms = filter.q ? searchTerms(filter.q) : [];
  return {
    terms,
    query: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.category ? { dua_category: filter.category } : {}),
      ...(filter.tag ? { tags: filter.tag } : {}),
      ...(terms.length > 0 ? { $text: { $search: terms.map((term) => `"${term}"`).join(' ') } } : {}),
    },
  };
}

async function page<T>(
  handle: DbHandle,
  scope: Scope,
  query: Record<string, unknown>,
  sort: Document,
  cursor: string | undefined,
  read: (doc: Document) => T,
): Promise<{ rows: T[]; next: string | undefined }> {
  const offset = decodeOffset(cursor);
  const docs = await scoped({ scope, db: await handle.db() }, 'content_library').find(query, {
    sort,
    skip: offset,
    limit: PAGE + 1,
  });
  const next = docs.length > PAGE && offset + PAGE <= MAX_OFFSET ? encodeOffset(offset + PAGE) : undefined;
  return { rows: docs.slice(0, PAGE).map(read), next };
}

/**
 * C8 review list: every status, newest change first, filtered by status / kind / dua category / tag / search words.
 *
 * @throws StateError FORBIDDEN (not super), INVALID_CURSOR.
 */
export async function listLibraryForSuper(
  handle: DbHandle,
  scope: Scope,
  input: LibraryFilter & { status?: (typeof LIBRARY_STATUS)[number]; cursor?: string },
): Promise<{ rows: SuperLibraryRow[]; next: string | undefined }> {
  if (scope.kind !== 'super') throw new StateError('FORBIDDEN');
  const { query } = filterOf(input);
  return page(handle, scope, query, { updated_at: -1, _id: -1 }, input.cursor, superRowOf);
}

/**
 * C8 review screen: one entry, any status.
 *
 * @returns `null` for an unknown id.
 * @throws StateError FORBIDDEN (not super).
 */
export async function getLibraryEntryForSuper(
  handle: DbHandle,
  scope: Scope,
  id: UUID,
): Promise<SuperLibraryRow | null> {
  if (scope.kind !== 'super') throw new StateError('FORBIDDEN');
  const doc = await scoped({ scope, db: await handle.db() }, 'content_library').findOne({ _id: id });
  return doc ? superRowOf(doc) : null;
}

/**
 * B6/B7 browse: verified entries only (policy cell), best match first when searching, else by kind and reference.
 *
 * @throws StateError MASJID_NOT_FOUND (not one of the admin's masjids), INVALID_CURSOR.
 */
export async function listLibraryForAdmin(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
  input: LibraryFilter & { cursor?: string },
): Promise<{ rows: AdminLibraryRow[]; next: string | undefined }> {
  requireOwnMasjid(scope, masjidId);
  const { query, terms } = filterOf(input);
  const sort = terms.length > 0 ? { score: { $meta: 'textScore' }, _id: 1 } : { kind: 1, reference: 1 };
  return page(handle, scope, query, sort, input.cursor, contentOf);
}

/**
 * B6 "Today's suggestion": one verified hadith/ayah per masjid and IST day, the same all day, never one the masjid
 * published as daily content in the last {@link SUGGESTION_REPEAT_DAYS} days — unless every entry was (then any).
 *
 * @returns `null` when the library has no verified entry of the kind.
 * @throws StateError MASJID_NOT_FOUND (not one of the admin's masjids).
 */
export async function suggestLibraryEntry(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
  input: { kind: 'hadith' | 'ayah'; now: Date },
): Promise<AdminLibraryRow | null> {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const items = await scoped({ scope, db }, 'items').find({
    masjid_id: masjidId,
    type: 'daily_content',
    published_at: { $gte: new Date(input.now.getTime() - SUGGESTION_REPEAT_DAYS * DAY_MS) },
  });
  const used = items.flatMap((item) => {
    const library: unknown = objectOf(item, 'daily')?.['library_id'];
    return library === undefined ? [] : [library];
  });
  const library = scoped({ scope, db }, 'content_library');
  const day = calendarDateInZone(input.now);
  for (const query of [{ kind: input.kind, _id: { $nin: used } }, { kind: input.kind }]) {
    const count = await library.count(query);
    if (count === 0) continue;
    const [doc] = await library.find(query, {
      sort: { _id: 1 },
      skip: dailyIndex(idText(masjidId), day, count),
      limit: 1,
    });
    if (doc) return contentOf(doc);
  }
  return null;
}
