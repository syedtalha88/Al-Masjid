// Ruqyah reads (03 §3 `GET /masjids/:id/ruqyah`, §4 `GET /ruqyah`, PHASE_03 T3.15): the musalli's list through
// `v_pub_ruqyah` + `v_pub_library` (public scope), and the admin's B15 list through the admin cells. Library content
// is expanded; a library entry retired since is left out for musallis and shown to the admin as unavailable.
import { type Document, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { LOCALE, RUQYAH_CATEGORY, RUQYAH_SOURCE } from '../schema/enums.ts';
import { publicScope, type Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { requireOwnMasjid } from './admin.ts';
import { type AdminLibraryRow, contentOf } from './library.ts';
import { libraryOf, type PublicLibraryEntry } from './public.ts';
import { compact, idOf, maybeOneOf, need, numberOf, objectOf, oneOf, text } from './read.ts';

/** An entry's own fields, as both apps read them (`ruqyahEntrySchema`); `library` is filled in by the caller. */
const entryOf = <L>(doc: Document, library: ReadonlyMap<string, L>) => {
  const libraryId: unknown = doc['library_id'];
  const entryText = objectOf(doc, 'text');
  const audio = objectOf(doc, 'audio');
  return compact({
    id: idOf(doc),
    category: oneOf(doc, 'category', RUQYAH_CATEGORY),
    source: oneOf(doc, 'source', RUQYAH_SOURCE),
    title: text(doc, 'title'),
    libraryId: libraryId instanceof UUID ? idText(libraryId) : undefined,
    library: libraryId instanceof UUID ? library.get(idText(libraryId)) : undefined,
    text: entryText
      ? compact({
          arabic: need(entryText, 'arabic'),
          translation: need(entryText, 'translation'),
          translationLocale: oneOf(entryText, 'translation_locale', LOCALE),
          reference: text(entryText, 'reference'),
        })
      : undefined,
    audio: audio
      ? compact({
          key: need(audio, 'key'),
          durationS: numberOf(audio, 'duration_s') ?? 1,
          peaks: Array.isArray(audio['peaks'])
            ? audio['peaks'].filter((peak): peak is number => typeof peak === 'number')
            : undefined,
        })
      : undefined,
    instructions: text(doc, 'instructions'),
    instructionsLocale: maybeOneOf(doc, 'instructions_locale', LOCALE),
  });
};
export type RuqyahEntryRow = ReturnType<typeof entryOf<PublicLibraryEntry>>;
export type AdminRuqyahEntryRow = ReturnType<typeof entryOf<AdminLibraryRow>>;

const libraryIds = (docs: readonly Document[]): UUID[] =>
  docs.map((doc): unknown => doc['library_id']).filter((id): id is UUID => id instanceof UUID);

/** Entries grouped under their headings, in A19's order (nazar … general), empty headings left out. */
const byCategory = <E extends { readonly category: (typeof RUQYAH_CATEGORY)[number] }>(entries: readonly E[]) =>
  RUQYAH_CATEGORY.map((category) => ({
    category,
    entries: entries.filter((entry) => entry.category === category),
  })).filter((section) => section.entries.length > 0);

/**
 * `GET /masjids/:id/ruqyah`: the active entries of a visible masjid, grouped by heading, in the masjid's order; an
 * entry whose library entry is no longer verified is left out.
 *
 * @returns `{sections: []}` for a masjid without entries (and for unknown or hidden masjids — the caller checks those).
 */
export async function getPublicRuqyah(handle: DbHandle, masjidId: UUID) {
  const db = await handle.db();
  const docs = await scoped({ scope: publicScope(), db }, 'v_pub_ruqyah').find({ masjid_id: masjidId }); // the view sorts
  const ids = libraryIds(docs);
  const library =
    ids.length > 0
      ? new Map(
          (await scoped({ scope: publicScope(), db }, 'v_pub_library').find({ _id: { $in: ids } })).map((doc) => [
            idOf(doc),
            libraryOf(doc),
          ]),
        )
      : new Map<string, PublicLibraryEntry>();
  const entries = docs
    .map((doc) => entryOf(doc, library))
    .filter((entry) => entry.source !== 'library' || entry.library !== undefined)
    .map(({ libraryId: _id, ...entry }) => entry);
  return { sections: byCategory(entries) };
}

/**
 * B15: the masjid's active entries in its order (flat — the screen groups them), library content expanded; a library
 * entry no longer verified comes back with `libraryId` and without `library`, so the admin can replace it.
 *
 * @throws StateError MASJID_NOT_FOUND for a masjid outside the scope.
 */
export async function listRuqyahForAdmin(handle: DbHandle, scope: Scope, masjidId: UUID) {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const docs = await scoped({ scope, db }, 'ruqyah_entries').find(
    { masjid_id: masjidId, status: 'active' },
    { sort: { sort: 1, _id: 1 } },
  );
  const ids = libraryIds(docs);
  const library =
    ids.length > 0
      ? new Map(
          (await scoped({ scope, db }, 'content_library').find({ _id: { $in: ids } })).map((doc) => [
            idOf(doc),
            contentOf(doc),
          ]),
        )
      : new Map<string, AdminLibraryRow>();
  return { entries: docs.map((doc) => entryOf(doc, library)) };
}
