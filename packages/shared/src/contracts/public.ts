import { z } from 'zod';

// api-public contracts (03 §3, PHASE_02 T2.2) — the server validates its responses with these, the musalli PWA parses
// them. Field names are camelCase; ids are canonical lower-case UUID text; instants are ISO 8601 (UTC); calendar dates
// "YYYY-MM-DD" and wall-clock times "HH:mm" (CLAUDE.md §6 Time).

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
export const uuidText = z.string().regex(UUID_V4, { error: 'must be a lower-case UUID v4' });
/** `items.public_id` (12 URL-safe characters — used in URLs and push). */
export const publicIdText = z.string().regex(/^[A-Za-z0-9_-]{12}$/, { error: 'must be an item public id' });
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const wallClock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const instant = z.iso.datetime();
/** Content version (`masjids.content_version`) as sent in `?v=`. */
const version = z.number().int().min(1);

const i18nOptional = z.object({
  en: z.string().optional(),
  hi: z.string().optional(),
  ur: z.string().optional(),
  te: z.string().optional(),
});
const i18nAll = z.object({ en: z.string(), hi: z.string(), ur: z.string(), te: z.string() });

/** An image on the media origin: `media.<domain>/i/<480|960|1440>/<avif|webp>/<key>` + ThumbHash placeholder. */
export const mediaImageSchema = z.object({ key: z.string(), thumbhash: z.string().optional() });
export type MediaImage = z.infer<typeof mediaImageSchema>;

// --- GET /config -------------------------------------------------------------------------------------------------------

export const publicConfigSchema = z
  .object({
    globalHijriOffset: z.number().int().min(-2).max(2),
    maintenanceBanner: i18nAll.optional(),
    incidentBanner: i18nAll.optional(),
    legalVersions: z.object({ privacy: z.string(), terms: z.string() }),
    minClientVersion: z.string(),
    /** 05 §3: shown in Settings → Contact & Grievance; changes without deploys. */
    grievanceOfficer: z.object({ name: z.string(), email: z.string(), address: z.string(), city: z.string() }),
  })
  .meta({ id: 'PublicConfig' });
export type PublicConfig = z.infer<typeof publicConfigSchema>;

// --- devices -----------------------------------------------------------------------------------------------------------

const privacyVersion = z
  .string()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9._-]+$/);

/** `POST /devices` (Turnstile). */
export const registerDeviceRequestSchema = z
  .object({
    locale: LOCALE,
    audiencePref: AUDIENCE_PREF,
    platform: z.enum(PLATFORM_VALUES),
    /** The privacy notice version the person accepted on the onboarding page (05 §2). */
    privacyVersion,
    turnstileToken: z.string().min(1).max(2048),
  })
  .meta({ id: 'RegisterDeviceRequest' });
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;

/** The secret is returned exactly once; the server keeps only its SHA-256. */
export const registerDeviceResponseSchema = z
  .object({ deviceId: uuidText, secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .meta({ id: 'RegisterDeviceResponse' });
export type RegisterDeviceResponse = z.infer<typeof registerDeviceResponseSchema>;

/** `PATCH /devices/me`. */
export const updateDeviceRequestSchema = z
  .object({
    locale: LOCALE.optional(),
    audiencePref: AUDIENCE_PREF.optional(),
    privacyVersion: privacyVersion.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), { error: 'nothing to update' })
  .meta({ id: 'UpdateDeviceRequest' });
export type UpdateDeviceRequest = z.infer<typeof updateDeviceRequestSchema>;

/** `GET /devices/me` — exactly what the server stores about this device (05 §4 "what we store"). */
export const deviceRecordSchema = z
  .object({
    deviceId: uuidText,
    locale: LOCALE,
    audiencePref: AUDIENCE_PREF,
    platform: z.enum(PLATFORM_VALUES),
    privacyVersion: z.string(),
    pushEnabled: z.boolean(),
    followCount: z.number().int().min(0).max(20),
    createdAt: instant,
    lastSeenAt: instant,
  })
  .meta({ id: 'DeviceRecord' });
export type DeviceRecord = z.infer<typeof deviceRecordSchema>;

// --- masjids -----------------------------------------------------------------------------------------------------------

/** Preview of a masjid (follow sheet, `/m/:code` landing). */
export const masjidSummarySchema = z
  .object({
    id: uuidText,
    followCode: z.string(),
    name: z.string(),
    nameI18n: z.object({ hi: z.string().optional(), ur: z.string().optional(), te: z.string().optional() }),
    area: z.string(),
    city: z.string(),
    state: z.string(),
    photo: mediaImageSchema.optional(),
    verified: z.boolean(),
  })
  .meta({ id: 'MasjidSummary' });
export type MasjidSummary = z.infer<typeof masjidSummarySchema>;

/** `GET /masjids/resolve/:code`. */
export const resolveMasjidResponseSchema = z.object({ masjid: masjidSummarySchema }).meta({ id: 'ResolveMasjid' });
export type ResolveMasjidResponse = z.infer<typeof resolveMasjidResponseSchema>;

/** `GET /masjids/versions?ids=` — unknown, pending and deleted ids are simply absent. */
export const masjidVersionsSchema = z
  .record(uuidText, z.object({ v: version, status: z.enum(['active', 'suspended']) }))
  .meta({ id: 'MasjidVersions' });
export type MasjidVersions = z.infer<typeof masjidVersionsSchema>;

export const prayerConfigSchema = z.object({
  adhanMode: z.enum(['auto', 'manual']),
  adhanTime: wallClock.optional(),
  adhanAdjustMin: z.number().int().min(-15).max(15),
  jamaatMode: z.enum(['fixed', 'offset', 'none']),
  jamaatTime: wallClock.optional(),
  jamaatOffsetMin: z.number().int().min(0).max(60).optional(),
});

export const masjidProfileSchema = masjidSummarySchema.extend({
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  calcMethod: z.enum(['karachi', 'mwl', 'isna', 'egypt', 'umm_al_qura', 'other_custom']),
  asrMadhab: z.enum(['hanafi', 'shafi']),
  /** Absent → the global offset from `/config`. */
  hijriOffset: z.number().int().min(-2).max(2).optional(),
  showChanda: z.boolean(),
  chandaWeekStart: z.number().int().min(1).max(7),
});
export type MasjidProfile = z.infer<typeof masjidProfileSchema>;

export const specialDateSchema = z.object({
  id: uuidText,
  type: z.enum(['eid_ul_fitr', 'eid_ul_adha', 'taraweeh', 'shab_e_barat', 'shab_e_qadr', 'other']),
  date: calendarDate,
  label: z.string().optional(),
  times: z.array(z.object({ time: wallClock, label: z.string().optional() })),
  note: z.string().optional(),
});
export type SpecialDate = z.infer<typeof specialDateSchema>;

/** `GET /masjids/:id/bundle?v=` — everything a follower needs offline (01 §5.2). */
export const masjidBundleSchema = z
  .discriminatedUnion('status', [
    z.object({
      status: z.literal('active'),
      v: version,
      masjid: masjidProfileSchema,
      /** Raw configuration — the app resolves times on the device (01 §5.7). `null` until the admin sets them. */
      timings: z
        .object({
          prayers: z.object({
            fajr: prayerConfigSchema,
            dhuhr: prayerConfigSchema,
            asr: prayerConfigSchema,
            maghrib: prayerConfigSchema,
            isha: prayerConfigSchema,
          }),
          jumuah: z.array(
            z.object({ seq: z.number().int().min(1).max(3), khutbahTime: wallClock.optional(), jamaatTime: wallClock }),
          ),
        })
        .nullable(),
      /** From 7 days ago onwards (DateStepper range), sorted by date; the app shows what falls in its window. */
      specialDates: z.array(specialDateSchema),
      ramadan: z
        .object({
          start: calendarDate,
          end: calendarDate,
          sehriPrecautionMin: z.number().int().min(0).max(15),
          iftarPrecautionMin: z.number().int().min(0).max(10),
        })
        .nullable(),
      /** Phase 5 (donations): present but empty until then. */
      payment: z.object({ vpa: z.string(), payeeName: z.string(), effectiveAt: instant }).nullable(),
      campaigns: z.array(z.object({ publicId: publicIdText })),
      chanda: z
        .object({ weeks: z.array(z.object({ weekStart: calendarDate, amountPaise: z.number().int() })) })
        .nullable(),
    }),
    /** A followed masjid that was suspended: the app shows "temporarily unavailable" (00 §4.1). */
    z.object({ status: z.literal('suspended'), v: version }),
  ])
  .meta({ id: 'MasjidBundle' });
export type MasjidBundle = z.infer<typeof masjidBundleSchema>;
export type ActiveMasjidBundle = Extract<MasjidBundle, { status: 'active' }>;

// --- follows -----------------------------------------------------------------------------------------------------------

/** `PUT /devices/me/follows/:masjidId`. */
export const followResponseSchema = z
  .object({ status: z.enum(['followed', 'already']) })
  .meta({ id: 'FollowResponse' });
/** `PATCH /devices/me/follows/:masjidId`. */
export const followPatchRequestSchema = z.object({ muted: z.boolean() }).meta({ id: 'FollowPatchRequest' });
/** `GET /devices/me/follows` — the server's copy, used to reconcile the local store. */
export const followListSchema = z
  .object({ follows: z.array(z.object({ masjidId: uuidText, muted: z.boolean(), followedAt: instant })) })
  .meta({ id: 'FollowList' });
export type FollowList = z.infer<typeof followListSchema>;

// --- content -----------------------------------------------------------------------------------------------------------

/** A verified Content Library entry (Arabic, transliterations, translations, attribution — 05 §9). */
export const libraryEntrySchema = z
  .object({
    id: uuidText,
    kind: z.enum(['hadith', 'ayah', 'dua']),
    arabic: z.string(),
    transliteration: i18nOptional,
    translation: i18nOptional.extend({ en: z.string() }),
    reference: z.string(),
    sourceName: z.string(),
    sourceLicense: z.string(),
  })
  .meta({ id: 'LibraryEntry' });
export type LibraryEntry = z.infer<typeof libraryEntrySchema>;

/**
 * A notice template parameter value (`items.template_params`): times "HH:mm", dates "YYYY-MM-DD", ranges as
 * `{start, end}`, a prayer name, a number or short text — formatted per locale by the app.
 */
export const templateParamValueSchema = z.union([
  z.string().max(120),
  z.number(),
  z.object({ start: z.string().max(10), end: z.string().max(10) }),
]);
export type TemplateParamValue = z.infer<typeof templateParamValueSchema>;

export const feedItemSchema = z
  .object({
    publicId: publicIdText,
    masjidId: uuidText,
    type: z.enum(ITEM_TYPE_VALUES),
    audience: AUDIENCE,
    title: z.string().optional(),
    body: z.string().optional(),
    contentLocale: LOCALE.optional(),
    templateKey: z.string().optional(),
    templateParams: z.record(z.string(), templateParamValueSchema).optional(),
    isImportant: z.boolean(),
    image: mediaImageSchema.optional(),
    publishedAt: instant,
    editedAt: instant.optional(),
    announcement: z
      .object({ category: z.enum(['general', 'event', 'facilities', 'timing']), eventAt: instant.optional() })
      .optional(),
    daily: z
      .object({ kind: z.enum(['hadith', 'ayah']), note: z.string().optional(), library: libraryEntrySchema.optional() })
      .optional(),
    dua: z
      .object({
        category: z.enum(['illness', 'inteqal', 'other']),
        /** Only when the family allowed it — private names never leave the database (02 §4.2). */
        personName: z.string().optional(),
        namePrivate: z.boolean(),
        janazaAt: instant.optional(),
        janazaPlace: z.string().optional(),
        archivedAt: instant.optional(),
        library: libraryEntrySchema.optional(),
      })
      .optional(),
    campaign: z
      .object({
        purpose: z.enum(['renovation', 'repair', 'utilities', 'welfare', 'other']),
        targetPaise: z.number().int(),
        receivedPaise: z.number().int(),
        receivedUpdatedAt: instant.optional(),
        startsOn: calendarDate,
        endsOn: calendarDate.optional(),
        status: z.enum(['active', 'completed', 'closed']),
        cover: mediaImageSchema.optional(),
      })
      .optional(),
    video: z
      .object({
        youtubeId: z.string(),
        startS: z.number().int().optional(),
        speaker: z.string().optional(),
        thumb: mediaImageSchema,
      })
      .optional(),
  })
  .meta({ id: 'FeedItem' });
export type FeedItem = z.infer<typeof feedItemSchema>;

/** `GET /masjids/:id/feed` query. */
export const feedQuerySchema = z.object({
  v: z.coerce.number().int().min(1).optional(),
  type: z.enum(ITEM_TYPE_VALUES).optional(),
  aud: AUDIENCE_PREF.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(30).optional(),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

/** `GET /masjids/:id/feed` — newest first; `next` is an opaque cursor or `null` at the end. */
export const feedPageSchema = z
  .object({ items: z.array(feedItemSchema), next: z.string().nullable() })
  .meta({ id: 'FeedPage' });
export type FeedPage = z.infer<typeof feedPageSchema>;

/** `GET /items/:publicId?v=&aud=` — the item plus its masjid (the `/p/:publicId` landing may not follow it). */
export const itemDetailSchema = z
  .object({ item: feedItemSchema, masjid: masjidSummarySchema })
  .meta({ id: 'ItemDetail' });
export type ItemDetail = z.infer<typeof itemDetailSchema>;

/** `POST /items/:publicId/ameen`. */
export const ameenResponseSchema = z.object({ count: z.number().int().min(0) }).meta({ id: 'AmeenResponse' });
/** `GET /items/ameen-counts?ids=` — live counts, kept out of the immutable item responses (DECISIONS #91). */
export const ameenCountsSchema = z
  .object({ counts: z.record(publicIdText, z.number().int().min(0)) })
  .meta({ id: 'AmeenCounts' });
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
export const templateListSchema = z.object({ templates: z.array(noticeTemplateSchema) }).meta({ id: 'TemplateList' });
export type TemplateList = z.infer<typeof templateListSchema>;

/** `GET /library/:id`. */
export const libraryEntryResponseSchema = z.object({ entry: libraryEntrySchema }).meta({ id: 'LibraryEntryResponse' });
