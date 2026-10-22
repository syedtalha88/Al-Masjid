// zod/mini (DECISIONS #92): these schemas ship in the musalli PWA's first load, where classic Zod alone would cost
// ≈ 25 kB gzip; Zod Mini builds the same validators from tree-shakable functions (≈ 7 kB). The API validates with the
// very same schemas (defineRoute accepts any Zod schema; OpenAPI gets them as JSON Schema).
import * as z from 'zod/mini';

// api-public contracts (03 §3, PHASE_02 T2.2) — the server validates its responses with these, the musalli PWA parses
// them. Field names are camelCase; ids are canonical lower-case UUID text; instants are ISO 8601 (UTC); calendar dates
// "YYYY-MM-DD" and wall-clock times "HH:mm" (CLAUDE.md §6 Time). Request objects are strict (unknown keys refused).

export const LOCALE_VALUES = ['en', 'hi', 'ur', 'te'] as const;
const LOCALE = z.enum(LOCALE_VALUES);
export const AUDIENCE_PREF_VALUES = ['brothers', 'sisters'] as const;
const AUDIENCE_PREF = z.enum(AUDIENCE_PREF_VALUES);
const AUDIENCE = z.enum(['everyone', 'brothers', 'sisters']);
export const PLATFORM_VALUES = ['android', 'ios', 'desktop', 'other'] as const;

/** Item types a musalli can see (02 §1 `item_type`). */
export const ITEM_TYPE_VALUES = [
  'announcement',
  'daily_content',
  'dua_request',
  'campaign',
  'chanda_update',
  'video',
  'timing_update',
] as const;
export type ItemType = (typeof ITEM_TYPE_VALUES)[number];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** A canonical lower-case UUID v4 (all ids the public API sends or accepts). */
export const uuidText = z.string().check(z.regex(UUID_V4, { error: 'must be a lower-case UUID v4' }));
/** `items.public_id` (12 URL-safe characters — used in URLs and push). */
export const publicIdText = z.string().check(z.regex(/^[A-Za-z0-9_-]{12}$/, { error: 'must be an item public id' }));
const calendarDate = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/));
const wallClock = z.string().check(z.regex(/^([01]\d|2[0-3]):[0-5]\d$/));
const instant = z.iso.datetime();
/** Content version (`masjids.content_version`) as sent in `?v=`. */
const version = z.int().check(z.minimum(1));
const intIn = (min: number, max: number) => z.int().check(z.minimum(min), z.maximum(max));

const i18nOptional = z.object({
  en: z.optional(z.string()),
  hi: z.optional(z.string()),
  ur: z.optional(z.string()),
  te: z.optional(z.string()),
});
const i18nAll = z.object({ en: z.string(), hi: z.string(), ur: z.string(), te: z.string() });

/** An image on the media origin: `media.<domain>/i/<480|960|1440>/<avif|webp>/<key>` + ThumbHash placeholder. */
export const mediaImageSchema = z.object({ key: z.string(), thumbhash: z.optional(z.string()) });
export type MediaImage = z.infer<typeof mediaImageSchema>;

// --- GET /config -------------------------------------------------------------------------------------------------------

export const publicConfigSchema = z.object({
  globalHijriOffset: intIn(-2, 2),
  maintenanceBanner: z.optional(i18nAll),
  incidentBanner: z.optional(i18nAll),
  legalVersions: z.object({ privacy: z.string(), terms: z.string() }),
  minClientVersion: z.string(),
  /** 05 §3: shown in Settings → Contact & Grievance; changes without deploys. */
  grievanceOfficer: z.object({ name: z.string(), email: z.string(), address: z.string(), city: z.string() }),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;

// --- devices -----------------------------------------------------------------------------------------------------------

const privacyVersion = z.string().check(z.minLength(1), z.maxLength(20), z.regex(/^[A-Za-z0-9._-]+$/));

/** `POST /devices` (Turnstile). */
export const registerDeviceRequestSchema = z.strictObject({
  locale: LOCALE,
  audiencePref: AUDIENCE_PREF,
  platform: z.enum(PLATFORM_VALUES),
  /** The privacy notice version the person accepted on the onboarding page (05 §2). */
  privacyVersion,
  turnstileToken: z.string().check(z.minLength(1), z.maxLength(2048)),
});
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;

/** The secret is returned exactly once; the server keeps only its SHA-256. */
export const registerDeviceResponseSchema = z.object({
  deviceId: uuidText,
  secret: z.string().check(z.regex(/^[A-Za-z0-9_-]{43}$/)),
});
export type RegisterDeviceResponse = z.infer<typeof registerDeviceResponseSchema>;

/** `PATCH /devices/me`. */
export const updateDeviceRequestSchema = z
  .strictObject({
    locale: z.optional(LOCALE),
    audiencePref: z.optional(AUDIENCE_PREF),
    privacyVersion: z.optional(privacyVersion),
  })
  .check(
    z.refine((value) => Object.values(value).some((field) => field !== undefined), { error: 'nothing to update' }),
  );
export type UpdateDeviceRequest = z.infer<typeof updateDeviceRequestSchema>;

/** `GET /devices/me` — exactly what the server stores about this device (05 §4 "what we store"). */
export const deviceRecordSchema = z.object({
  deviceId: uuidText,
  locale: LOCALE,
  audiencePref: AUDIENCE_PREF,
  platform: z.enum(PLATFORM_VALUES),
  privacyVersion: z.string(),
  pushEnabled: z.boolean(),
  followCount: intIn(0, 20),
  createdAt: instant,
  lastSeenAt: instant,
});
export type DeviceRecord = z.infer<typeof deviceRecordSchema>;

// --- masjids -----------------------------------------------------------------------------------------------------------

const masjidSummaryShape = {
  id: uuidText,
  followCode: z.string(),
  name: z.string(),
  nameI18n: z.object({ hi: z.optional(z.string()), ur: z.optional(z.string()), te: z.optional(z.string()) }),
  area: z.string(),
  city: z.string(),
  state: z.string(),
  photo: z.optional(mediaImageSchema),
  verified: z.boolean(),
};
/** Preview of a masjid (follow sheet, `/m/:code` landing). */
export const masjidSummarySchema = z.object(masjidSummaryShape);
export type MasjidSummary = z.infer<typeof masjidSummarySchema>;

/** `GET /masjids/resolve/:code`. */
export const resolveMasjidResponseSchema = z.object({ masjid: masjidSummarySchema });
export type ResolveMasjidResponse = z.infer<typeof resolveMasjidResponseSchema>;

/** `GET /masjids/versions?ids=` — unknown, pending and deleted ids are simply absent. */
export const masjidVersionsSchema = z.record(
  uuidText,
  z.object({ v: version, status: z.enum(['active', 'suspended']) }),
);
export type MasjidVersions = z.infer<typeof masjidVersionsSchema>;

export const prayerConfigSchema = z.object({
  adhanMode: z.enum(['auto', 'manual']),
  adhanTime: z.optional(wallClock),
  adhanAdjustMin: intIn(-15, 15),
  jamaatMode: z.enum(['fixed', 'offset', 'none']),
  jamaatTime: z.optional(wallClock),
  jamaatOffsetMin: z.optional(intIn(0, 60)),
});

export const masjidProfileSchema = z.object({
  ...masjidSummaryShape,
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  calcMethod: z.enum(['karachi', 'mwl', 'isna', 'egypt', 'umm_al_qura', 'other_custom']),
  asrMadhab: z.enum(['hanafi', 'shafi']),
  /** Absent → the global offset from `/config`. */
  hijriOffset: z.optional(intIn(-2, 2)),
  showChanda: z.boolean(),
  chandaWeekStart: intIn(1, 7),
});
export type MasjidProfile = z.infer<typeof masjidProfileSchema>;

export const specialDateSchema = z.object({
  id: uuidText,
  type: z.enum(['eid_ul_fitr', 'eid_ul_adha', 'taraweeh', 'shab_e_barat', 'shab_e_qadr', 'other']),
  date: calendarDate,
  label: z.optional(z.string()),
  times: z.array(z.object({ time: wallClock, label: z.optional(z.string()) })),
  note: z.optional(z.string()),
});
export type SpecialDate = z.infer<typeof specialDateSchema>;

/** `GET /masjids/:id/bundle?v=` — everything a follower needs offline (01 §5.2). */
export const masjidBundleSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('active'),
    v: version,
    masjid: masjidProfileSchema,
    /** Raw configuration — the app resolves times on the device (01 §5.7). `null` until the admin sets them. */
    timings: z.nullable(
      z.object({
        prayers: z.object({
          fajr: prayerConfigSchema,
          dhuhr: prayerConfigSchema,
          asr: prayerConfigSchema,
          maghrib: prayerConfigSchema,
          isha: prayerConfigSchema,
        }),
        jumuah: z.array(z.object({ seq: intIn(1, 3), khutbahTime: z.optional(wallClock), jamaatTime: wallClock })),
      }),
    ),
    /** From 7 days ago onwards (DateStepper range), sorted by date; the app shows what falls in its window. */
    specialDates: z.array(specialDateSchema),
    ramadan: z.nullable(
      z.object({
        start: calendarDate,
        end: calendarDate,
        sehriPrecautionMin: intIn(0, 15),
        iftarPrecautionMin: intIn(0, 10),
      }),
    ),
    /** Phase 5 (donations): present but empty until then. */
    payment: z.nullable(z.object({ vpa: z.string(), payeeName: z.string(), effectiveAt: instant })),
    campaigns: z.array(z.object({ publicId: publicIdText })),
    chanda: z.nullable(z.object({ weeks: z.array(z.object({ weekStart: calendarDate, amountPaise: z.int() })) })),
  }),
  /** A followed masjid that was suspended: the app shows "temporarily unavailable" (00 §4.1). */
  z.object({ status: z.literal('suspended'), v: version }),
]);
export type MasjidBundle = z.infer<typeof masjidBundleSchema>;
export type ActiveMasjidBundle = Extract<MasjidBundle, { status: 'active' }>;

// --- follows -----------------------------------------------------------------------------------------------------------

/** `PUT /devices/me/follows/:masjidId`. */
export const followResponseSchema = z.object({ status: z.enum(['followed', 'already']) });
/** `PATCH /devices/me/follows/:masjidId`. */
export const followPatchRequestSchema = z.strictObject({ muted: z.boolean() });
/** `GET /devices/me/follows` — the server's copy, used to reconcile the local store. */
export const followListSchema = z.object({
  follows: z.array(z.object({ masjidId: uuidText, muted: z.boolean(), followedAt: instant })),
});
export type FollowList = z.infer<typeof followListSchema>;

// --- content -----------------------------------------------------------------------------------------------------------

/** A verified Content Library entry (Arabic, transliterations, translations, attribution — 05 §9). */
export const libraryEntrySchema = z.object({
  id: uuidText,
  kind: z.enum(['hadith', 'ayah', 'dua']),
  arabic: z.string(),
  transliteration: i18nOptional,
  translation: z.object({
    en: z.string(),
    hi: z.optional(z.string()),
    ur: z.optional(z.string()),
    te: z.optional(z.string()),
  }),
  reference: z.string(),
  sourceName: z.string(),
  sourceLicense: z.string(),
});
export type LibraryEntry = z.infer<typeof libraryEntrySchema>;

/**
 * A notice template parameter value (`items.template_params`): times "HH:mm", dates "YYYY-MM-DD", ranges as
 * `{start, end}`, a prayer name, a number or short text — formatted per locale by the app.
 */
export const templateParamValueSchema = z.union([
  z.string().check(z.maxLength(120)),
  z.number(),
  z.object({ start: z.string().check(z.maxLength(10)), end: z.string().check(z.maxLength(10)) }),
]);
export type TemplateParamValue = z.infer<typeof templateParamValueSchema>;

export const feedItemSchema = z.object({
  publicId: publicIdText,
  masjidId: uuidText,
  type: z.enum(ITEM_TYPE_VALUES),
  audience: AUDIENCE,
  title: z.optional(z.string()),
  body: z.optional(z.string()),
  contentLocale: z.optional(LOCALE),
  templateKey: z.optional(z.string()),
  templateParams: z.optional(z.record(z.string(), templateParamValueSchema)),
  isImportant: z.boolean(),
  image: z.optional(mediaImageSchema),
  publishedAt: instant,
  editedAt: z.optional(instant),
  announcement: z.optional(
    z.object({ category: z.enum(['general', 'event', 'facilities', 'timing']), eventAt: z.optional(instant) }),
  ),
  daily: z.optional(
    z.object({
      kind: z.enum(['hadith', 'ayah']),
      note: z.optional(z.string()),
      library: z.optional(libraryEntrySchema),
    }),
  ),
  dua: z.optional(
    z.object({
      category: z.enum(['illness', 'inteqal', 'other']),
      /** Only when the family allowed it — private names never leave the database (02 §4.2). */
      personName: z.optional(z.string()),
      namePrivate: z.boolean(),
      janazaAt: z.optional(instant),
      janazaPlace: z.optional(z.string()),
      archivedAt: z.optional(instant),
      library: z.optional(libraryEntrySchema),
    }),
  ),
  campaign: z.optional(
    z.object({
      purpose: z.enum(['renovation', 'repair', 'utilities', 'welfare', 'other']),
      targetPaise: z.int(),
      receivedPaise: z.int(),
      receivedUpdatedAt: z.optional(instant),
      startsOn: calendarDate,
      endsOn: z.optional(calendarDate),
      status: z.enum(['active', 'completed', 'closed']),
      cover: z.optional(mediaImageSchema),
    }),
  ),
  video: z.optional(
    z.object({
      youtubeId: z.string(),
      startS: z.optional(z.int()),
      speaker: z.optional(z.string()),
      thumb: mediaImageSchema,
    }),
  ),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

/** `GET /masjids/:id/feed` — newest first; `next` is an opaque cursor or `null` at the end. */
export const feedPageSchema = z.object({ items: z.array(feedItemSchema), next: z.nullable(z.string()) });
export type FeedPage = z.infer<typeof feedPageSchema>;

/** `GET /items/:publicId?v=&aud=` — the item plus its masjid (the `/p/:publicId` landing may not follow it). */
export const itemDetailSchema = z.object({ item: feedItemSchema, masjid: masjidSummarySchema });
export type ItemDetail = z.infer<typeof itemDetailSchema>;

/** `POST /items/:publicId/ameen`. */
export const ameenResponseSchema = z.object({ count: z.int().check(z.minimum(0)) });
/** `GET /ameens?items=` — live counts, kept out of the immutable item responses (DECISIONS #91). */
export const ameenCountsSchema = z.object({ counts: z.record(publicIdText, z.int().check(z.minimum(0))) });
export type AmeenCounts = z.infer<typeof ameenCountsSchema>;

/** A notice template (all four languages; ICU MessageFormat with named params — 02 §2). */
export const noticeTemplateSchema = z.object({
  key: z.string(),
  category: z.enum(['general', 'event', 'facilities', 'timing']),
  icon: z.string(),
  isImportantDefault: z.boolean(),
  title: i18nAll,
  body: i18nAll,
  params: z.array(
    z.object({
      name: z.string(),
      type: z.enum(['time', 'date', 'date_range', 'time_range', 'prayer', 'number', 'short_text']),
      required: z.boolean(),
    }),
  ),
  system: z.boolean(),
});
export type NoticeTemplate = z.infer<typeof noticeTemplateSchema>;

/** `GET /templates`. */
export const templateListSchema = z.object({ templates: z.array(noticeTemplateSchema) });
export type TemplateList = z.infer<typeof templateListSchema>;

/** `GET /library/:id`. */
export const libraryEntryResponseSchema = z.object({ entry: libraryEntrySchema });
