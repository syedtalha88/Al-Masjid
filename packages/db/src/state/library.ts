// Content Library state functions (02 §3, 03 §5, PHASE_03 T3.4, DECISIONS #108): import as draft (★, all or
// nothing), edit, verify, retire — Super Admin only, each in one transaction with its audit entry. `search_text` is
// derived here on every content change (DECISIONS #106), never taken from the caller.
import { librarySearchText } from '@mc/domain/search';
import type { UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { StateError, writeAudit } from '../effects.ts';
import type { DHIKR_OCCASION, DUA_CATEGORY, LIBRARY_KIND } from '../schema/enums.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText, newId } from '../values.ts';
import { requireSuper } from './guards.ts';

type LocaleTexts = Readonly<Partial<Record<'en' | 'hi' | 'ur' | 'te', string>>>;
type Kind = (typeof LIBRARY_KIND)[number];

/** The content of one entry, already validated by the caller's contract (`libraryImportRowSchema`). */
export interface LibraryEntryInput {
  readonly kind: Kind;
  readonly arabic: string;
  readonly transliteration?: LocaleTexts;
  readonly translation: LocaleTexts & { readonly en: string };
  readonly reference: string;
  readonly sourceName: string;
  readonly sourceLicense: string;
  readonly tags?: readonly string[];
  readonly duaCategory?: (typeof DUA_CATEGORY)[number];
  readonly repeat?: number;
  readonly occasions?: readonly (typeof DHIKR_OCCASION)[number][];
}

/** `kind + reference` — what makes two entries the same (unique index `kind_reference_unique`). */
export interface LibraryKey {
  readonly kind: Kind;
  readonly reference: string;
}
export const libraryKey = (entry: LibraryKey): string => `${entry.kind}|${entry.reference}`;

const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

/** Fields only some kinds carry (02 content_library). */
function assertKindFields(entry: { kind: Kind; duaCategory?: unknown; repeat?: unknown; occasions?: unknown }): void {
  const wrong =
    (entry.duaCategory !== undefined && entry.kind !== 'dua') ||
    ((entry.repeat !== undefined || entry.occasions !== undefined) && entry.kind !== 'dhikr');
  if (wrong) throw new StateError('LIBRARY_FIELD_NOT_FOR_KIND');
}

const searchTextOf = (entry: LibraryEntryInput) =>
  librarySearchText({
    arabic: entry.arabic,
    transliteration: entry.transliteration ?? {},
    translation: entry.translation,
    reference: entry.reference,
    tags: entry.tags ?? [],
  });

/** Existing `kind + reference` pairs among `keys` (any status), read with a projection only. */
async function existingKeys(ctx: TxContext | { db: TxContext['db'] }, keys: readonly LibraryKey[]) {
  if (keys.length === 0) return new Set<string>();
  const docs = await ctx.db
    .collection<{ kind: Kind; reference: string }>('content_library')
    .find(
      {
        kind: { $in: [...new Set(keys.map((key) => key.kind))] },
        reference: { $in: [...new Set(keys.map((key) => key.reference))] },
      },
      { projection: { _id: 0, kind: 1, reference: 1 }, ...('session' in ctx ? { session: ctx.session } : {}) },
    )
    .toArray();
  // Two $in lists use the unique {kind, reference} index but also match crossed pairs: keep the exact ones.
  const wanted = new Set(keys.map(libraryKey));
  return new Set(docs.map(libraryKey).filter((key) => wanted.has(key)));
}

/**
 * Which of `keys` already exist in the library — draft, verified or retired (the dry-run report, DECISIONS #108).
 *
 * @returns the {@link libraryKey} strings that exist.
 * @throws StateError FORBIDDEN unless Super Admin.
 */
export async function findLibraryDuplicates(
  handle: DbHandle,
  scope: Scope,
  keys: readonly LibraryKey[],
): Promise<ReadonlySet<string>> {
  requireSuper(scope);
  return existingKeys({ db: await handle.db() }, keys);
}

/**
 * ★ Imports entries as `draft` with one new `import_batch_id` — all or nothing, in one transaction, with one
 * `library.import` audit entry.
 *
 * @returns the batch id and how many entries were inserted (all of them).
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED, LIBRARY_DUPLICATE (a `kind + reference` twice in `entries` or already
 *   in the library — nothing is written), LIBRARY_FIELD_NOT_FOR_KIND.
 */
export async function importLibraryEntries(
  handle: DbHandle,
  scope: Scope,
  input: { entries: readonly LibraryEntryInput[]; requestId?: string; now?: Date },
): Promise<{ batchId: UUID; imported: number }> {
  requireSuper(scope, { stepUp: true, ...(input.now ? { now: input.now } : {}) });
  for (const entry of input.entries) assertKindFields(entry);
  if (new Set(input.entries.map(libraryKey)).size !== input.entries.length) throw new StateError('LIBRARY_DUPLICATE');
  const batchId = newId();
  const now = input.now ?? new Date();
  await withTransaction(handle, scope, async (ctx) => {
    if ((await existingKeys(ctx, input.entries)).size > 0) throw new StateError('LIBRARY_DUPLICATE');
    const library = scoped(ctx, 'content_library');
    try {
      for (const entry of input.entries) {
        await library.insertOne({
          _id: newId(),
          kind: entry.kind,
          arabic: entry.arabic,
          transliteration: { ...entry.transliteration },
          translation: { ...entry.translation },
          reference: entry.reference,
          source_name: entry.sourceName,
          source_license: entry.sourceLicense,
          tags: [...(entry.tags ?? [])],
          ...(entry.duaCategory === undefined ? {} : { dua_category: entry.duaCategory }),
          ...(entry.repeat === undefined ? {} : { repeat: entry.repeat }),
          ...(entry.occasions === undefined ? {} : { occasions: [...entry.occasions] }),
          status: 'draft',
          import_batch_id: batchId,
          search_text: searchTextOf(entry),
          created_at: now,
          updated_at: now,
        });
      }
    } catch (error) {
      // Another import inserted the same key in between (unique index) — refuse the whole batch.
      if (isDuplicateKey(error)) throw new StateError('LIBRARY_DUPLICATE');
      throw error;
    }
    await writeAudit(ctx, {
      action: 'library.import',
      targetType: 'library_batch',
      targetId: idText(batchId),
      meta: { batch: idText(batchId), entries: input.entries.length },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
  return { batchId, imported: input.entries.length };
}

/** What a Super Admin edit may change (`null` clears an optional field). `kind` never changes. */
export interface LibraryPatch {
  readonly arabic?: string;
  readonly transliteration?: LocaleTexts;
  readonly translation?: LocaleTexts & { readonly en: string };
  readonly reference?: string;
  readonly sourceName?: string;
  readonly sourceLicense?: string;
  readonly tags?: readonly string[];
  readonly duaCategory?: LibraryEntryInput['duaCategory'] | null;
  readonly repeat?: number | null;
  readonly occasions?: LibraryEntryInput['occasions'] | null;
}

/** Fields whose change alters what the entry says — a verified entry goes back to draft (DECISIONS #108). */
const CONTENT_FIELDS = new Set([
  'arabic',
  'transliteration',
  'translation',
  'reference',
  'source_name',
  'source_license',
  'repeat',
  'occasions',
]);

/** A stored entry, as the edit needs it (validator-enforced shapes). */
interface StoredEntry {
  readonly _id: UUID;
  readonly kind: Kind;
  readonly status: 'draft' | 'verified' | 'retired';
  readonly arabic: string;
  readonly transliteration: LocaleTexts;
  readonly translation: LocaleTexts & { readonly en: string };
  readonly reference: string;
  readonly source_name: string;
  readonly source_license: string;
  readonly tags: readonly string[];
  readonly dua_category?: LibraryEntryInput['duaCategory'];
  readonly repeat?: number;
  readonly occasions?: LibraryEntryInput['occasions'];
}

async function loadEntry(ctx: TxContext, id: UUID): Promise<StoredEntry> {
  const doc = await scoped(ctx, 'content_library').findOne({ _id: id });
  if (!doc) throw new StateError('LIBRARY_ENTRY_NOT_FOUND');
  return doc as unknown as StoredEntry; // validator-enforced document shape (02 content_library)
}

/**
 * Edits a draft or verified entry. A change to what the entry says sends a verified entry back to `draft` (clearing
 * `verified_by` / `verified_at`); tags and the dua category keep the status. `search_text` is recomputed.
 *
 * @returns the changed database fields and whether the entry went back to draft.
 * @throws StateError FORBIDDEN, LIBRARY_ENTRY_NOT_FOUND, INVALID_TRANSITION (retired), NOTHING_TO_UPDATE,
 *   LIBRARY_FIELD_NOT_FOR_KIND, LIBRARY_DUPLICATE (the new reference is taken).
 */
export async function updateLibraryEntry(
  handle: DbHandle,
  scope: Scope,
  input: { id: UUID; patch: LibraryPatch; requestId?: string; now?: Date },
): Promise<{ fields: readonly string[]; backToDraft: boolean }> {
  requireSuper(scope);
  const p = input.patch;
  const set: Record<string, unknown> = {
    ...(p.arabic === undefined ? {} : { arabic: p.arabic }),
    ...(p.transliteration === undefined ? {} : { transliteration: { ...p.transliteration } }),
    ...(p.translation === undefined ? {} : { translation: { ...p.translation } }),
    ...(p.reference === undefined ? {} : { reference: p.reference }),
    ...(p.sourceName === undefined ? {} : { source_name: p.sourceName }),
    ...(p.sourceLicense === undefined ? {} : { source_license: p.sourceLicense }),
    ...(p.tags === undefined ? {} : { tags: [...p.tags] }),
    ...(p.duaCategory === undefined || p.duaCategory === null ? {} : { dua_category: p.duaCategory }),
    ...(p.repeat === undefined || p.repeat === null ? {} : { repeat: p.repeat }),
    ...(p.occasions === undefined || p.occasions === null ? {} : { occasions: [...p.occasions] }),
  };
  const unset = Object.fromEntries(
    (
      [
        ['dua_category', p.duaCategory],
        ['repeat', p.repeat],
        ['occasions', p.occasions],
      ] as const
    ).flatMap(([field, value]) => (value === null ? [[field, '']] : [])),
  );
  const fields = [...Object.keys(set), ...Object.keys(unset)];
  if (fields.length === 0) throw new StateError('NOTHING_TO_UPDATE');
  const now = input.now ?? new Date();
  let backToDraft = false;
  await withTransaction(handle, scope, async (ctx) => {
    const current = await loadEntry(ctx, input.id);
    if (current.status === 'retired') throw new StateError('INVALID_TRANSITION');
    assertKindFields({
      kind: current.kind,
      ...(p.duaCategory ? { duaCategory: p.duaCategory } : {}),
      ...(p.repeat ? { repeat: p.repeat } : {}),
      ...(p.occasions ? { occasions: p.occasions } : {}),
    });
    backToDraft = current.status === 'verified' && fields.some((field) => CONTENT_FIELDS.has(field));
    const next: LibraryEntryInput = {
      kind: current.kind,
      arabic: p.arabic ?? current.arabic,
      transliteration: p.transliteration ?? current.transliteration,
      translation: p.translation ?? current.translation,
      reference: p.reference ?? current.reference,
      sourceName: p.sourceName ?? current.source_name,
      sourceLicense: p.sourceLicense ?? current.source_license,
      tags: p.tags ?? current.tags,
    };
    try {
      await scoped(ctx, 'content_library').updateOne(
        { _id: input.id },
        {
          $set: {
            ...set,
            search_text: searchTextOf(next),
            ...(backToDraft ? { status: 'draft' } : {}),
            updated_at: now,
          },
          ...(Object.keys(unset).length > 0 || backToDraft
            ? { $unset: { ...unset, ...(backToDraft ? { verified_by: '', verified_at: '' } : {}) } }
            : {}),
        },
      );
    } catch (error) {
      if (isDuplicateKey(error)) throw new StateError('LIBRARY_DUPLICATE');
      throw error;
    }
    await writeAudit(ctx, {
      action: 'library.update',
      targetType: 'library_entry',
      targetId: idText(input.id),
      meta: { fields, back_to_draft: backToDraft },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
  return { fields, backToDraft };
}

/**
 * Verifies a draft entry: from now on admins may pick it and musallis see it (`v_pub_library`).
 *
 * @param input.verifiedBy - the scholar or reviewer who checked it against its source (05 §9).
 * @throws StateError FORBIDDEN, LIBRARY_ENTRY_NOT_FOUND, INVALID_TRANSITION (not a draft).
 */
export async function verifyLibraryEntry(
  handle: DbHandle,
  scope: Scope,
  input: { id: UUID; verifiedBy: string; requestId?: string; now?: Date },
): Promise<void> {
  requireSuper(scope);
  const now = input.now ?? new Date();
  await withTransaction(handle, scope, async (ctx) => {
    if ((await loadEntry(ctx, input.id)).status !== 'draft') throw new StateError('INVALID_TRANSITION');
    await scoped(ctx, 'content_library').updateOne(
      { _id: input.id, status: 'draft' },
      { $set: { status: 'verified', verified_by: input.verifiedBy, verified_at: now, updated_at: now } },
    );
    await writeAudit(ctx, {
      action: 'library.verify',
      targetType: 'library_entry',
      targetId: idText(input.id),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}

/**
 * Retires a draft or verified entry (final): admins can no longer pick it and the public view hides it.
 *
 * @throws StateError FORBIDDEN, LIBRARY_ENTRY_NOT_FOUND, INVALID_TRANSITION (already retired).
 */
export async function retireLibraryEntry(
  handle: DbHandle,
  scope: Scope,
  input: { id: UUID; requestId?: string; now?: Date },
): Promise<void> {
  requireSuper(scope);
  const now = input.now ?? new Date();
  await withTransaction(handle, scope, async (ctx) => {
    const current = await loadEntry(ctx, input.id);
    if (current.status === 'retired') throw new StateError('INVALID_TRANSITION');
    await scoped(ctx, 'content_library').updateOne({ _id: input.id }, { $set: { status: 'retired', updated_at: now } });
    await writeAudit(ctx, {
      action: 'library.retire',
      targetType: 'library_entry',
      targetId: idText(input.id),
      meta: { from: current.status },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}
