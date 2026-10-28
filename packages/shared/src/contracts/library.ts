import { z } from 'zod';

import { safeText } from './text.ts';

// Content Library contracts (PHASE_03 T3.4; 02 content_library, 03 §4–5). The import file is the owner's format
// (`docs/content-library-format.md`, JSON Schema in `scripts/library.schema.json`): snake_case like the data model.
// Enums and bounds mirror `@mc/db/schema` (packages/api/test/contracts-sync.test.ts keeps them equal).

export const LIBRARY_KINDS = ['hadith', 'ayah', 'dua', 'dhikr'] as const;
export const LIBRARY_STATUSES = ['draft', 'verified', 'retired'] as const;
export const DUA_CATEGORIES = ['illness', 'inteqal', 'other'] as const;
export const DHIKR_OCCASIONS = ['after_salah', 'morning', 'evening'] as const;
/** Entries per import file — larger libraries are imported in several files. */
export const LIBRARY_IMPORT_MAX_ENTRIES = 500;
/** Largest import file: 500 entries of a few kB each, with room for long ones. */
export const LIBRARY_IMPORT_MAX_BYTES = 4 * 1024 * 1024;
/** The `format` marker of an import file (a wrong file is refused before any row is read). */
export const LIBRARY_IMPORT_FORMAT = 'masjid-connect-library';
/** Row problems listed in one report; the count is always complete. */
export const LIBRARY_REPORT_MAX_ISSUES = 200;

/** Tags are lower-case slugs ("shifa", "after-fajr") — chips in the admin search. */
export const libraryTagSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
const content = (max: number) => safeText(max, { min: 1, multiline: true });
const locales = (max: number) =>
  z.strictObject({
    en: content(max).optional(),
    hi: content(max).optional(),
    ur: content(max).optional(),
    te: content(max).optional(),
  });

/** The fields of an entry an import row and a Super Admin edit both carry. */
const entryFields = {
  arabic: safeText(4000, { min: 1, multiline: true, arabicSigns: true }),
  transliteration: locales(4000).optional(),
  translation: locales(4000).extend({ en: content(4000) }),
  reference: safeText(200, { min: 1 }),
  source_name: safeText(120, { min: 1 }),
  source_license: safeText(200, { min: 1 }),
  tags: z.array(libraryTagSchema).max(20).optional(),
  dua_category: z.enum(DUA_CATEGORIES).optional(),
  repeat: z.int().min(1).max(1000).optional(),
  occasions: z.array(z.enum(DHIKR_OCCASIONS)).min(1).max(3).optional(),
};

type KindRules = {
  kind: (typeof LIBRARY_KINDS)[number];
  tags?: readonly string[] | undefined;
  dua_category?: unknown;
  repeat?: unknown;
  occasions?: readonly string[] | undefined;
};
/** Kind-specific fields: `dua_category` only on duas, `repeat` / `occasions` only on dhikr; no repeated tag/occasion. */
function checkKind(row: KindRules, ctx: z.RefinementCtx): void {
  const refuse = (path: string, message: string) => {
    ctx.addIssue({ code: 'custom', path: [path], message });
  };
  if (row.dua_category !== undefined && row.kind !== 'dua') refuse('dua_category', 'only for kind dua');
  if (row.repeat !== undefined && row.kind !== 'dhikr') refuse('repeat', 'only for kind dhikr');
  if (row.occasions !== undefined && row.kind !== 'dhikr') refuse('occasions', 'only for kind dhikr');
  if (row.tags && new Set(row.tags).size !== row.tags.length) refuse('tags', 'repeated tag');
  if (row.occasions && new Set(row.occasions).size !== row.occasions.length) refuse('occasions', 'repeated occasion');
}

/** One entry of an import file. Unknown keys are refused (a typo such as `sourceName` must not vanish silently). */
export const libraryImportRowSchema = z
  .strictObject({ kind: z.enum(LIBRARY_KINDS), ...entryFields })
  .superRefine(checkKind);
export type LibraryImportRow = z.output<typeof libraryImportRowSchema>;

/**
 * The import file: a format marker, the format version and the entries. Entries are checked one by one afterwards
 * ({@link libraryImportRowSchema}), so one bad row is reported with its number instead of failing the whole file.
 */
export const libraryImportFileSchema = z.strictObject({
  format: z.literal(LIBRARY_IMPORT_FORMAT),
  version: z.literal(1),
  entries: z.array(z.unknown()).min(1).max(LIBRARY_IMPORT_MAX_ENTRIES),
});

/** The file with typed entries — for the JSON Schema the owner's editor validates with. */
export const libraryImportFileTypedSchema = libraryImportFileSchema.extend({
  entries: z.array(libraryImportRowSchema).min(1).max(LIBRARY_IMPORT_MAX_ENTRIES),
});

/** `POST /library/import/dry-run` and `POST /library/import`: what the file holds and what is wrong with it. */
export const libraryImportReportSchema = z
  .object({
    entries: z.int(),
    /** Rows without errors and without duplicates — importable. */
    valid: z.int(),
    /** Every row problem: row number (1-based), field path, reason. */
    errors: z.array(z.object({ row: z.int(), path: z.string(), message: z.string() })),
    /** Same kind + reference twice in the file, or already in the library (draft, verified or retired). */
    duplicates: z.array(
      z.object({ row: z.int(), kind: z.enum(LIBRARY_KINDS), reference: z.string(), in: z.enum(['file', 'library']) }),
    ),
    /** More problems than {@link LIBRARY_REPORT_MAX_ISSUES}: the lists are cut, the counts are not. */
    truncated: z.boolean(),
    /** Imported as `draft` (0 on a dry run, or when anything is wrong — an import is all or nothing). */
    imported: z.int(),
    batchId: z.string().optional(),
  })
  .meta({ id: 'SuperLibraryImportReport' });
export type LibraryImportReport = z.infer<typeof libraryImportReportSchema>;

// --- Super Admin review (C8) -----------------------------------------------------------------------------------------

const localesOut = z.object({
  en: z.string().optional(),
  hi: z.string().optional(),
  ur: z.string().optional(),
  te: z.string().optional(),
});

/** One entry as the Super Admin reviews it: everything, including status and verification. */
export const superLibraryEntrySchema = z
  .object({
    id: z.string(),
    kind: z.enum(LIBRARY_KINDS),
    status: z.enum(LIBRARY_STATUSES),
    arabic: z.string(),
    transliteration: localesOut,
    translation: localesOut.extend({ en: z.string() }),
    reference: z.string(),
    sourceName: z.string(),
    sourceLicense: z.string(),
    tags: z.array(z.string()),
    duaCategory: z.enum(DUA_CATEGORIES).optional(),
    repeat: z.int().optional(),
    occasions: z.array(z.enum(DHIKR_OCCASIONS)).optional(),
    verifiedBy: z.string().optional(),
    verifiedAt: z.iso.datetime().optional(),
    importBatchId: z.string(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'SuperLibraryEntry' });
export type SuperLibraryEntry = z.infer<typeof superLibraryEntrySchema>;

export const superLibraryListQuerySchema = z.object({
  status: z.enum(LIBRARY_STATUSES).optional(),
  kind: z.enum(LIBRARY_KINDS).optional(),
  category: z.enum(DUA_CATEGORIES).optional(),
  tag: libraryTagSchema.optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(200).optional(),
});
export const superLibraryListSchema = z
  .object({ entries: z.array(superLibraryEntrySchema), next: z.string().optional() })
  .meta({ id: 'SuperLibraryList' });

/**
 * `PATCH /library/:id` (draft and verified entries). Changing what an entry says — Arabic, translations,
 * transliterations, reference, source, repeat, occasions — sends a verified entry back to `draft` for a new
 * verification (DECISIONS #108); tags and the dua category are metadata and keep the status.
 */
export const superLibraryPatchSchema = z
  .strictObject({
    arabic: entryFields.arabic.optional(),
    transliteration: entryFields.transliteration,
    translation: entryFields.translation.optional(),
    reference: entryFields.reference.optional(),
    source_name: entryFields.source_name.optional(),
    source_license: entryFields.source_license.optional(),
    tags: entryFields.tags,
    dua_category: entryFields.dua_category.nullable(),
    repeat: entryFields.repeat.nullable(),
    occasions: entryFields.occasions.nullable(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'nothing to change' });
export type SuperLibraryPatch = z.output<typeof superLibraryPatchSchema>;

/** `POST /library/:id/verify` — the scholar or reviewer who checked the entry against its source (05 §9). */
export const libraryVerifySchema = z.strictObject({ verifiedBy: safeText(120, { min: 2 }) });

export const superLibraryEntryResponseSchema = z
  .object({ entry: superLibraryEntrySchema })
  .meta({ id: 'SuperLibraryEntryResponse' });

// --- masjid admins: browse and today's suggestion (B6 / B7) ------------------------------------------------------------

/** A verified entry as an admin picks it: content, attribution and the chips (tags, dua category). */
export const adminLibraryEntrySchema = z
  .object({
    id: z.string(),
    kind: z.enum(LIBRARY_KINDS),
    arabic: z.string(),
    transliteration: localesOut,
    translation: localesOut.extend({ en: z.string() }),
    reference: z.string(),
    sourceName: z.string(),
    sourceLicense: z.string(),
    tags: z.array(z.string()),
    duaCategory: z.enum(DUA_CATEGORIES).optional(),
    repeat: z.int().optional(),
    occasions: z.array(z.enum(DHIKR_OCCASIONS)).optional(),
  })
  .meta({ id: 'AdminLibraryEntry' });
export type AdminLibraryEntry = z.infer<typeof adminLibraryEntrySchema>;

export const adminLibraryQuerySchema = z.object({
  kind: z.enum(LIBRARY_KINDS).optional(),
  category: z.enum(DUA_CATEGORIES).optional(),
  tag: libraryTagSchema.optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(200).optional(),
});
export const adminLibraryListSchema = z
  .object({ entries: z.array(adminLibraryEntrySchema), next: z.string().optional() })
  .meta({ id: 'AdminLibraryList' });

/** `GET /masjids/:masjidId/library/suggestion?kind=` — daily content is a hadith or an ayah (02 items.daily). */
export const librarySuggestionQuerySchema = z.object({ kind: z.enum(['hadith', 'ayah']) });
export const librarySuggestionSchema = z
  .object({ entry: adminLibraryEntrySchema.nullable() })
  .meta({ id: 'AdminLibrarySuggestion' });
