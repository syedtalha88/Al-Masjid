// 02 §2 "Masjid sections" (DECISIONS #104): ruqyah_entries. Each entry is exactly one of a verified library entry, text
// the masjid entered or a recording it uploaded — the validator's `oneOf` by `source`, mirrored in Zod.
import { absent, mode, VOICE_KEY_PATTERN } from './content.ts';
import { type BsonSchema, documentSchema, f, opt } from './dsl.ts';
import { LOCALE, RECORD_STATUS, RUQYAH_CATEGORY, RUQYAH_SOURCE } from './enums.ts';
import type { CollectionSpec } from './types.ts';

/** Most active Ruqyah entries per masjid (00 §4.10). */
export const RUQYAH_MAX = 50;

const SOURCE_FIELDS = { library: 'library_id', text: 'text', audio: 'audio' } as const;
const sourceFields = Object.values(SOURCE_FIELDS);

const ruqyahBase = documentSchema(
  {
    _id: f.uuid(),
    masjid_id: f.uuid(),
    category: f.enum(RUQYAH_CATEGORY),
    source: f.enum(RUQYAH_SOURCE),
    title: opt(f.string(80, { minLength: 1 })),
    library_id: opt(f.uuid()),
    text: opt(
      f.object({
        arabic: f.string(4000, { minLength: 1 }),
        translation: f.string(2000, { minLength: 1 }),
        translation_locale: f.enum(LOCALE),
        reference: opt(f.string(200, { minLength: 1 })),
      }),
    ),
    audio: opt(
      f.object({
        key: f.string(200, { pattern: VOICE_KEY_PATTERN }),
        duration_s: f.int(1, 600),
        peaks: opt(f.array(f.int(0, 255), { max: 48 })),
        rights_confirmed: f.confirmed(),
      }),
    ),
    instructions: opt(f.string(300, { minLength: 1 })),
    instructions_locale: opt(f.enum(LOCALE)),
    sort: f.int(0, 1_000_000),
    status: f.enum(RECORD_STATUS),
    masjid_visible: f.bool(),
    created_by: f.uuid(),
    created_at: f.instant(),
    updated_at: f.instant(),
    deleted_at: opt(f.instant()),
  },
  {
    // One source, its own field only; a recording always has a title (it is what lists and screen readers show).
    oneOf: RUQYAH_SOURCE.map((source): BsonSchema => ({
      ...mode('source', source),
      required: source === 'audio' ? ['audio', 'title'] : [SOURCE_FIELDS[source]],
      ...absent(...sourceFields.filter((name) => name !== SOURCE_FIELDS[source])),
    })),
    allOf: [
      // An instruction names its language, and only then.
      {
        anyOf: [{ required: ['instructions', 'instructions_locale'] }, absent('instructions', 'instructions_locale')],
      },
      // `deleted_at` exactly when deleted (the retention clock — 02 §6).
      {
        oneOf: [
          { ...mode('status', 'deleted'), required: ['deleted_at'] },
          { ...mode('status', 'active'), ...absent('deleted_at') },
        ],
      },
    ],
  },
);

const ruqyahEntries = {
  jsonSchema: ruqyahBase.jsonSchema,
  zod: ruqyahBase.zod.superRefine((doc, ctx) => {
    for (const source of RUQYAH_SOURCE) {
      const name = SOURCE_FIELDS[source];
      if ((doc.source === source) !== (doc[name] !== undefined)) {
        ctx.addIssue({ code: 'custom', path: [name], message: `source ${doc.source} carries exactly "${name}"` });
      }
    }
    if (doc.source === 'audio' && doc.title === undefined) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: 'a recording needs a title' });
    }
    if ((doc.instructions === undefined) !== (doc.instructions_locale === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['instructions_locale'], message: 'instructions name their language' });
    }
    if ((doc.status === 'deleted') !== (doc.deleted_at !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['deleted_at'], message: 'deleted_at is set exactly when deleted' });
    }
  }),
};

export const SECTION_COLLECTIONS: readonly CollectionSpec[] = [
  {
    name: 'ruqyah_entries',
    ...ruqyahEntries,
    indexes: [
      { name: 'masjid_status_category_sort', key: { masjid_id: 1, status: 1, category: 1, sort: 1 } },
      // Retention (02 §6): deleted entries are purged 30 days later.
      { name: 'deleted_at', key: { deleted_at: 1 }, partialFilterExpression: { deleted_at: { $type: 'date' } } },
    ],
  },
];
