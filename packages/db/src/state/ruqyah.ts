// Ruqyah (00 §4.10, 07 B15, DECISIONS #104, PHASE_03 T3.15): the masjid's own section. Each entry is a verified
// library entry (any kind), text the masjid entered ("Added by <masjid>" — never shown as a verified source) or a
// recording it uploaded with the ownership tick. Every write is one transaction with the version bump (followers
// refetch the bundle's section count and the list) and the audit entry; the bump also serializes concurrent adds, so
// the 50-entry limit holds under parallel requests (the second transaction conflicts on the masjid and re-counts).
import type { UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import { idOf, numberOf } from '../repos/read.ts';
import type { LOCALE, RUQYAH_CATEGORY } from '../schema/enums.ts';
import { RUQYAH_MAX } from '../schema/sections.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText, newId } from '../values.ts';

type Locale = (typeof LOCALE)[number];

/** What an entry shows: exactly one source (02 ruqyah_entries `oneOf`). */
export type RuqyahContent =
  | { readonly source: 'library'; readonly libraryId: UUID }
  | {
      readonly source: 'text';
      readonly text: {
        readonly arabic: string;
        readonly translation: string;
        readonly translationLocale: Locale;
        readonly reference?: string | undefined;
      };
    }
  | {
      readonly source: 'audio';
      readonly audio: {
        /** `m/<this masjid>/a/<recording>` — from `POST /audio`. */
        readonly key: string;
        readonly durationS: number;
        readonly peaks?: readonly number[] | undefined;
        /** "This recording is ours or we have permission to share it" (05 §9) — must be true. */
        readonly rightsConfirmed: boolean;
      };
    };

/** A Ruqyah entry as the admin saves it (the contracts checked lengths and formats). */
export type RuqyahEntryInput = RuqyahContent & {
  readonly category: (typeof RUQYAH_CATEGORY)[number];
  /** Optional; required with a recording. */
  readonly title?: string | undefined;
  /** The masjid's own note (e.g. when to listen), in the language it was written in. */
  readonly instructions?: { readonly text: string; readonly locale: Locale } | undefined;
};

interface WriteOptions {
  readonly masjidId: UUID;
  readonly requestId?: string | undefined;
  readonly now?: Date | undefined;
}

const OPTIONAL = ['title', 'library_id', 'text', 'audio', 'instructions', 'instructions_locale'] as const;

/** The stored fields of an entry, and the optional ones it does not have (to `$unset` on a replacement). */
function fieldsOf(entry: RuqyahEntryInput, masjidId: UUID) {
  const content = (() => {
    switch (entry.source) {
      case 'library':
        return { library_id: entry.libraryId };
      case 'text': {
        const { arabic, translation, translationLocale, reference } = entry.text;
        return {
          text: {
            arabic,
            translation,
            translation_locale: translationLocale,
            ...(reference === undefined ? {} : { reference }),
          },
        };
      }
      case 'audio': {
        const { key, durationS, peaks, rightsConfirmed } = entry.audio;
        // The masjid's own recording, with the tick, and a title (what lists and screen readers show).
        if (!rightsConfirmed || !key.startsWith(`m/${idText(masjidId)}/a/`) || entry.title === undefined) {
          throw new StateError('RUQYAH_INVALID');
        }
        return {
          audio: {
            key,
            duration_s: durationS,
            ...(peaks === undefined ? {} : { peaks: [...peaks] }),
            rights_confirmed: true,
          },
        };
      }
    }
  })();
  const set = {
    category: entry.category,
    source: entry.source,
    ...(entry.title === undefined ? {} : { title: entry.title }),
    ...content,
    ...(entry.instructions === undefined
      ? {}
      : { instructions: entry.instructions.text, instructions_locale: entry.instructions.locale }),
  };
  const unset = Object.fromEntries(OPTIONAL.filter((name) => !(name in set)).map((name) => [name, '']));
  return { set, unset };
}

function adminOf(scope: Scope, masjidId: UUID): UUID {
  requireOwnMasjid(scope, masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  return scope.adminId;
}

/** The masjid inside the transaction (`MASJID_NOT_FOUND` outside the scope). */
async function ownMasjidVisible(ctx: TxContext, masjidId: UUID): Promise<boolean> {
  const masjid = await scoped(ctx, 'masjids').findOne({ _id: masjidId });
  if (!masjid) throw new StateError('MASJID_NOT_FOUND');
  return masjid['status'] === 'active';
}

/** A library entry must be verified (the admin cell reads nothing else); any kind is allowed (00 §4.10). */
async function requireLibraryEntry(ctx: TxContext, entry: RuqyahEntryInput): Promise<void> {
  if (entry.source !== 'library') return;
  if ((await scoped(ctx, 'content_library').count({ _id: entry.libraryId })) !== 1) {
    throw new StateError('LIBRARY_ENTRY_NOT_FOUND');
  }
}

const auditMeta = (entry: RuqyahEntryInput) => ({
  source: entry.source,
  category: entry.category,
  ...(entry.source === 'audio' ? { rights_confirmed: true } : {}),
});

/**
 * Adds a Ruqyah entry at the end of the masjid's list.
 *
 * @returns the new entry's id.
 * @throws StateError MASJID_NOT_FOUND (outside the scope), RUQYAH_INVALID (a recording that is not the masjid's own, has
 *   no ownership tick or no title), LIBRARY_ENTRY_NOT_FOUND (not a verified entry), RUQYAH_LIMIT_REACHED (50 active).
 */
export async function addRuqyahEntry(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly entry: RuqyahEntryInput },
): Promise<{ id: string }> {
  const adminId = adminOf(scope, input.masjidId);
  const now = input.now ?? new Date();
  const { set } = fieldsOf(input.entry, input.masjidId);
  return withTransaction(handle, scope, async (ctx) => {
    const visible = await ownMasjidVisible(ctx, input.masjidId);
    await requireLibraryEntry(ctx, input.entry);
    const id = newId();
    await contentWrite(ctx, input.masjidId, async (content) => {
      const store = scoped(content, 'ruqyah_entries');
      const active = { masjid_id: input.masjidId, status: 'active' };
      if ((await store.count(active)) >= RUQYAH_MAX) throw new StateError('RUQYAH_LIMIT_REACHED');
      const [last] = await store.find(active, { sort: { sort: -1 }, limit: 1 });
      await store.insertOne({
        _id: id,
        masjid_id: input.masjidId,
        ...set,
        sort: last ? (numberOf(last, 'sort') ?? 0) + 1 : 0,
        status: 'active',
        masjid_visible: visible,
        created_by: adminId,
        created_at: now,
        updated_at: now,
      });
    });
    await writeAudit(ctx, {
      action: 'ruqyah.create',
      masjidId: input.masjidId,
      targetType: 'ruqyah_entries',
      targetId: idText(id),
      meta: auditMeta(input.entry),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return { id: idText(id) };
  });
}

/**
 * Replaces an entry (its place in the list stays; a title, instruction or reference left out is removed; the source
 * may change).
 *
 * @throws StateError MASJID_NOT_FOUND, RUQYAH_NOT_FOUND (unknown or deleted), RUQYAH_INVALID, LIBRARY_ENTRY_NOT_FOUND.
 */
export async function updateRuqyahEntry(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly id: UUID; readonly entry: RuqyahEntryInput },
): Promise<void> {
  adminOf(scope, input.masjidId);
  const now = input.now ?? new Date();
  const { set, unset } = fieldsOf(input.entry, input.masjidId);
  await withTransaction(handle, scope, async (ctx) => {
    await ownMasjidVisible(ctx, input.masjidId);
    await requireLibraryEntry(ctx, input.entry);
    await contentWrite(ctx, input.masjidId, async (content) => {
      const matched = await scoped(content, 'ruqyah_entries').updateOne(
        { _id: input.id, masjid_id: input.masjidId, status: 'active' },
        { $set: { ...set, updated_at: now }, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) },
      );
      if (matched !== 1) throw new StateError('RUQYAH_NOT_FOUND');
    });
    await writeAudit(ctx, {
      action: 'ruqyah.update',
      masjidId: input.masjidId,
      targetType: 'ruqyah_entries',
      targetId: idText(input.id),
      meta: auditMeta(input.entry),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}

/**
 * Deletes an entry (`status: 'deleted'` + `deleted_at` — gone for followers after their next poll; purged with its
 * recording 30 days later by `retention`, 02 §6).
 *
 * @throws StateError MASJID_NOT_FOUND, RUQYAH_NOT_FOUND (unknown or already deleted).
 */
export async function deleteRuqyahEntry(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly id: UUID },
): Promise<void> {
  adminOf(scope, input.masjidId);
  const now = input.now ?? new Date();
  await withTransaction(handle, scope, async (ctx) => {
    await ownMasjidVisible(ctx, input.masjidId);
    await contentWrite(ctx, input.masjidId, async (content) => {
      const matched = await scoped(content, 'ruqyah_entries').updateOne(
        { _id: input.id, masjid_id: input.masjidId, status: 'active' },
        { $set: { status: 'deleted', deleted_at: now, updated_at: now } },
      );
      if (matched !== 1) throw new StateError('RUQYAH_NOT_FOUND');
    });
    await writeAudit(ctx, {
      action: 'ruqyah.delete',
      masjidId: input.masjidId,
      targetType: 'ruqyah_entries',
      targetId: idText(input.id),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}

/**
 * Puts the masjid's active entries in the given order (B15 drag to reorder; A19 groups them by category, each heading
 * keeping this order).
 *
 * @param input.ids - every active entry exactly once.
 * @throws StateError MASJID_NOT_FOUND, RUQYAH_ORDER_INVALID (a missing, extra, repeated or deleted id — the list
 *   changed since it was read).
 */
export async function orderRuqyahEntries(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly ids: readonly UUID[] },
): Promise<void> {
  adminOf(scope, input.masjidId);
  const now = input.now ?? new Date();
  const wanted = input.ids.map(idText);
  if (new Set(wanted).size !== wanted.length) throw new StateError('RUQYAH_ORDER_INVALID');
  await withTransaction(handle, scope, async (ctx) => {
    await ownMasjidVisible(ctx, input.masjidId);
    await contentWrite(ctx, input.masjidId, async (content) => {
      const store = scoped(content, 'ruqyah_entries');
      const active = await store.find({ masjid_id: input.masjidId, status: 'active' });
      const have = new Set(active.map((doc) => idOf(doc)));
      if (have.size !== wanted.length || !wanted.every((id) => have.has(id))) {
        throw new StateError('RUQYAH_ORDER_INVALID');
      }
      for (const [sort, id] of input.ids.entries()) {
        await store.updateOne(
          { _id: id, masjid_id: input.masjidId, status: 'active' },
          { $set: { sort, updated_at: now } },
        );
      }
    });
    await writeAudit(ctx, {
      action: 'ruqyah.order',
      masjidId: input.masjidId,
      targetType: 'masjids',
      targetId: idText(input.masjidId),
      meta: { count: wanted.length },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}
