// 02 §2 "Timings" and "Content": masjid_timings, special_timings, items, ameens, ameen_counters,
// campaign_amount_history, chanda_weeks.
import { z } from 'zod';

import { type BsonSchema, documentSchema, f, type Field, MAX_PAISE, opt } from './dsl.ts';
import {
  ADHAN_MODE,
  ANNOUNCEMENT_CATEGORY,
  AUDIENCE,
  CAMPAIGN_PURPOSE,
  CAMPAIGN_STATUS,
  DUA_CATEGORY,
  ITEM_STATUS,
  ITEM_TYPE,
  JAMAAT_MODE,
  LOCALE,
  PRAYER,
  SPECIAL_TYPE,
} from './enums.ts';
import type { CollectionSpec } from './types.ts';

export const PUBLIC_ID_PATTERN = '^[A-Za-z0-9_-]{12}$';
export const YOUTUBE_ID_PATTERN = '^[A-Za-z0-9_-]{11}$';
export const TEMPLATE_KEY_PATTERN = '^[a-z0-9_]{1,64}$';
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

// --- masjid_timings: per-prayer mode rules (02 §2: manual ⇒ adhan_time; fixed ⇒ jamaat_time; offset ⇒
// jamaat_offset_min; none ⇒ neither) — validator `allOf`/`oneOf` + the same rules in Zod.
const prayerShape = f.object({
  adhan_mode: f.enum(ADHAN_MODE),
  adhan_time: opt(f.time()),
  adhan_adjust_min: f.int(-15, 15),
  jamaat_mode: f.enum(JAMAAT_MODE),
  jamaat_time: opt(f.time()),
  jamaat_offset_min: opt(f.int(0, 60)),
});
const mode = (name: string, value: string): BsonSchema => ({ properties: { [name]: { enum: [value] } } });
const absent = (...fields: string[]): BsonSchema => ({ not: { anyOf: fields.map((name) => ({ required: [name] })) } });
const prayerRules: readonly BsonSchema[] = [
  {
    oneOf: [
      { ...mode('adhan_mode', 'manual'), required: ['adhan_time'] },
      { ...mode('adhan_mode', 'auto'), ...absent('adhan_time') },
    ],
  },
  {
    oneOf: [
      { ...mode('jamaat_mode', 'fixed'), required: ['jamaat_time'], ...absent('jamaat_offset_min') },
      { ...mode('jamaat_mode', 'offset'), required: ['jamaat_offset_min'], ...absent('jamaat_time') },
      { ...mode('jamaat_mode', 'none'), ...absent('jamaat_time', 'jamaat_offset_min') },
    ],
  },
];
const prayer: Field = {
  optional: false,
  bson: { ...prayerShape.bson, allOf: prayerRules },
  zod: prayerShape.zod.superRefine((value, ctx) => {
    const v = value as {
      adhan_mode: string;
      adhan_time?: string;
      jamaat_mode: string;
      jamaat_time?: string;
      jamaat_offset_min?: number;
    }; // parsed by prayerShape above
    if ((v.adhan_mode === 'manual') !== (v.adhan_time !== undefined)) {
      ctx.addIssue({ code: 'custom', message: 'adhan_time is required for manual adhan and absent otherwise' });
    }
    const wantTime = v.jamaat_mode === 'fixed';
    const wantOffset = v.jamaat_mode === 'offset';
    if (wantTime !== (v.jamaat_time !== undefined) || wantOffset !== (v.jamaat_offset_min !== undefined)) {
      ctx.addIssue({ code: 'custom', message: 'jamaat fields do not match jamaat_mode' });
    }
  }),
};

const jumuahSlot = f.object({ seq: f.int(1, 3), khutbah_time: opt(f.time()), jamaat_time: f.time() });
const jumuah: Field = {
  ...f.array(jumuahSlot, { min: 1, max: 3 }),
  zod: z
    .array(jumuahSlot.zod)
    .min(1)
    .max(3)
    .refine(
      (slots) => {
        const seqs = (slots as { seq: number }[]).map((slot) => slot.seq); // parsed by jumuahSlot above
        return seqs.every((seq, index) => index === 0 || seq > (seqs[index - 1] ?? 0));
      },
      { error: 'jumuah slots must have unique seq values in ascending order' },
    ),
};

const masjidTimings = documentSchema({
  _id: f.uuid(),
  prayers: f.object(Object.fromEntries(PRAYER.map((name) => [name, prayer]))),
  jumuah,
  masjid_visible: f.bool(),
  rev: f.int(0, 2_000_000_000),
  updated_by: f.uuid(),
  updated_at: f.instant(),
});

const specialTimings = documentSchema({
  _id: f.uuid(),
  masjid_id: f.uuid(),
  type: f.enum(SPECIAL_TYPE),
  date: f.date(),
  label: opt(f.string(80)),
  times: f.array(f.object({ time: f.time(), label: opt(f.string(40)) }), { min: 1, max: 5 }),
  note: opt(f.string(300)),
  masjid_visible: f.bool(),
  created_by: f.uuid(),
  created_at: f.instant(),
  updated_at: f.instant(),
  deleted_at: opt(f.instant()),
});

// --- items: type-specific detail objects, exactly one present (02 §2, DECISIONS #26a) --------------------------------
const DETAILS = {
  announcement: f.object({ category: f.enum(ANNOUNCEMENT_CATEGORY), event_at: opt(f.instant()) }),
  daily: f.object({ library_id: f.uuid(), kind: f.enum(['hadith', 'ayah']), note: opt(f.string(200)) }),
  dua: f.object({
    category: f.enum(DUA_CATEGORY),
    person_name: opt(f.string(80)),
    name_private: f.bool(),
    library_id: f.uuid(),
    janaza_at: opt(f.instant()),
    janaza_place: opt(f.string(120)),
    archived_at: opt(f.instant()),
  }),
  campaign: f.object({
    purpose: f.enum(CAMPAIGN_PURPOSE),
    target_paise: f.long(100_000, MAX_PAISE),
    received_paise: f.long(0, MAX_PAISE),
    received_updated_at: opt(f.instant()),
    received_updated_by: opt(f.uuid()),
    starts_on: f.date(),
    ends_on: opt(f.date()),
    status: f.enum(CAMPAIGN_STATUS),
    payment_profile_id: f.uuid(),
    cover_key: opt(f.string(200)),
    cover_thumbhash: opt(f.string(64)),
  }),
  chanda: f.object({ chanda_week_id: f.uuid() }),
  video: f.object({
    youtube_id: f.string(11, { pattern: YOUTUBE_ID_PATTERN }),
    start_s: opt(f.int(0, 86_400)),
    speaker: opt(f.string(80)),
    thumb_key: f.string(200),
    thumb_thumbhash: f.string(64),
  }),
} as const;
type Detail = keyof typeof DETAILS;
/** Which detail object each item type carries. */
export const ITEM_DETAIL: Readonly<Record<(typeof ITEM_TYPE)[number], Detail>> = {
  announcement: 'announcement',
  timing_update: 'announcement',
  daily_content: 'daily',
  dua_request: 'dua',
  campaign: 'campaign',
  chanda_update: 'chanda',
  video: 'video',
};
const detailNames = Object.keys(DETAILS) as Detail[]; // keys of the literal above
const itemOneOf: BsonSchema[] = detailNames.map((detail) => ({
  properties: { type: { enum: ITEM_TYPE.filter((type) => ITEM_DETAIL[type] === detail) } },
  required: [detail],
  ...absent(...detailNames.filter((other) => other !== detail)),
}));

/** Widens a detail field to the generic Field before marking it optional (the detail types differ). */
const optionalField = (value: Field) => opt(value);

const itemFields = {
  _id: f.uuid(),
  public_id: f.string(12, { pattern: PUBLIC_ID_PATTERN }),
  masjid_id: f.uuid(),
  type: f.enum(ITEM_TYPE),
  status: f.enum(ITEM_STATUS),
  audience: f.enum(AUDIENCE),
  title: opt(f.string(120)),
  body: opt(f.string(1500)),
  content_locale: opt(f.enum(LOCALE)),
  template_key: opt(f.string(64, { pattern: TEMPLATE_KEY_PATTERN })),
  template_params: opt(f.anyObject()),
  is_important: f.bool(),
  image_key: opt(f.string(200)),
  image_thumbhash: opt(f.string(64)),
  rights_confirmed: opt(f.bool()),
  notify: f.bool(),
  masjid_visible: f.bool(),
  published_at: opt(f.instant()),
  published_version: opt(f.long(1, MAX_SAFE)),
  edited_at: opt(f.instant()),
  created_by: f.uuid(),
  deleted_at: opt(f.instant()),
  removed_at: opt(f.instant()),
  removed_reason: opt(f.string(300)),
  purge_after: opt(f.instant()),
  ...Object.fromEntries(detailNames.map((detail) => [detail, optionalField(DETAILS[detail])])),
  created_at: f.instant(),
  updated_at: f.instant(),
};
const itemsBase = documentSchema(itemFields, { oneOf: itemOneOf });
const items = {
  jsonSchema: itemsBase.jsonSchema,
  zod: itemsBase.zod.superRefine((value, ctx) => {
    const doc = value as Record<string, unknown> & { type: (typeof ITEM_TYPE)[number] }; // parsed by itemsBase above
    const want = ITEM_DETAIL[doc.type];
    for (const detail of detailNames) {
      if ((detail === want) !== (doc[detail] !== undefined)) {
        ctx.addIssue({ code: 'custom', path: [detail], message: `type ${doc.type} carries exactly "${want}"` });
      }
    }
  }),
};

const ameens = documentSchema({
  _id: f.uuid(),
  dua_item_id: f.uuid(),
  masjid_id: f.uuid(),
  device_id: f.uuid(),
  created_at: f.instant(),
});
const ameenCounters = documentSchema({ _id: f.uuid(), count: f.int(0, 2_000_000_000), updated_at: f.instant() });
const campaignAmountHistory = documentSchema({
  _id: f.uuid(),
  campaign_item_id: f.uuid(),
  masjid_id: f.uuid(),
  received_paise: f.long(0, MAX_PAISE),
  updated_by: f.uuid(),
  created_at: f.instant(),
});
const chandaWeeks = documentSchema({
  _id: f.uuid(),
  masjid_id: f.uuid(),
  week_start: f.date(),
  amount_paise: f.long(0, MAX_PAISE),
  note: opt(f.string(200)),
  item_id: opt(f.uuid()),
  visible: f.bool(),
  masjid_visible: f.bool(),
  created_by: f.uuid(),
  created_at: f.instant(),
  updated_at: f.instant(),
});

const feed = (extra: Record<string, 1 | -1>) => ({ masjid_id: 1, ...extra, published_at: -1, _id: -1 }) as const;

export const CONTENT_COLLECTIONS: readonly CollectionSpec[] = [
  { name: 'masjid_timings', ...masjidTimings, indexes: [] },
  {
    name: 'special_timings',
    ...specialTimings,
    indexes: [{ name: 'masjid_date', key: { masjid_id: 1, date: 1 } }],
  },
  {
    name: 'items',
    ...items,
    indexes: [
      { name: 'public_id_unique', key: { public_id: 1 }, unique: true },
      { name: 'feed_status', key: feed({ status: 1 }) },
      { name: 'feed_type', key: feed({ type: 1, status: 1 }) },
      {
        name: 'feed_audience_published',
        key: feed({ audience: 1, status: 1 }),
        partialFilterExpression: { status: 'published' },
      },
      { name: 'purge_after', key: { purge_after: 1 }, partialFilterExpression: { purge_after: { $type: 'date' } } },
      {
        name: 'campaign_status_ends',
        key: { 'campaign.status': 1, 'campaign.ends_on': 1 },
        partialFilterExpression: { type: 'campaign' },
      },
    ],
  },
  {
    name: 'ameens',
    ...ameens,
    indexes: [
      { name: 'dua_device_unique', key: { dua_item_id: 1, device_id: 1 }, unique: true },
      { name: 'device', key: { device_id: 1 } },
      { name: 'masjid_created', key: { masjid_id: 1, created_at: -1 } },
    ],
  },
  { name: 'ameen_counters', ...ameenCounters, indexes: [] },
  {
    name: 'campaign_amount_history',
    ...campaignAmountHistory,
    indexes: [{ name: 'campaign_created', key: { campaign_item_id: 1, created_at: -1 } }],
  },
  {
    name: 'chanda_weeks',
    ...chandaWeeks,
    indexes: [{ name: 'masjid_week_unique', key: { masjid_id: 1, week_start: 1 }, unique: true }],
  },
];
