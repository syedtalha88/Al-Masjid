import { z } from 'zod';

import { adminLibraryEntrySchema } from './library.ts';
import { ITEM_TYPE_VALUES } from './public.ts';
import { safeText } from './text.ts';

// api-admin masjid-scoped contracts (03 §4 "Masjid-scoped", PHASE_03) — the server validates its responses with these,
// the admin PWA parses them. Classic Zod like the other admin contracts (the public ones are Zod Mini — DECISIONS #92).

const count = z.number().int().min(0);
const wallClock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const intIn = (min: number, max: number) => z.number().int().min(min).max(max);

/** `GET /masjids/:masjidId/stats` (07 B3 header). `ameenThisWeek` may be up to an hour old. */
export const adminMasjidStatsSchema = z
  .object({ followers: count, itemsThisWeek: count, ameenThisWeek: count })
  .meta({ id: 'AdminMasjidStats' });
export type AdminMasjidStats = z.infer<typeof adminMasjidStatsSchema>;

/** `GET /masjids/:masjidId/notifications/quota` — notifying publishes today (IST) against the daily quota. */
export const pushQuotaSchema = z
  .object({
    used: count,
    limit: count,
    resetsAt: z.iso.datetime(),
    /** The Super Admin paused all notifications (T4.7): publishing works, notifications wait. */
    paused: z.boolean(),
    /** Followers a notification reaches now per item audience — "Will notify N people" (T4.5). */
    reach: z.object({ everyone: count, brothers: count, sisters: count }),
  })
  .meta({ id: 'PushQuota' });
export type PushQuota = z.infer<typeof pushQuotaSchema>;

/** `GET /masjids/:masjidId/notifications/jobs?cursor=` — the masjid's notifications, newest first (T4.5). */
export const notificationJobListSchema = z
  .object({
    jobs: z.array(
      z.object({
        id: z.string(),
        status: z.enum(['pending', 'running', 'completed', 'failed']),
        audience: z.enum(['everyone', 'brothers', 'sisters']),
        createdAt: z.iso.datetime(),
        completedAt: z.iso.datetime().optional(),
        targeted: count,
        sent: count,
        failed: count,
        pruned: count,
        item: z
          .object({
            id: z.string(),
            type: z.enum(ITEM_TYPE_VALUES),
            status: z.string(),
            category: z.string().optional(),
            title: z.string().optional(),
            templateKey: z.string().optional(),
          })
          .optional(),
      }),
    ),
    next: z.string().nullable(),
  })
  .meta({ id: 'NotificationJobList' });
export type NotificationJobList = z.infer<typeof notificationJobListSchema>;
export const notificationJobQuerySchema = z.object({ cursor: z.string().max(200).optional() });

/** One prayer's raw configuration — the same shape as the musalli bundle's (`prayerConfigSchema`). */
export const adminPrayerConfigSchema = z.object({
  adhanMode: z.enum(['auto', 'manual']),
  adhanTime: wallClock.optional(),
  adhanAdjustMin: intIn(-15, 15),
  jamaatMode: z.enum(['fixed', 'offset', 'none']),
  jamaatTime: wallClock.optional(),
  jamaatOffsetMin: intIn(0, 60).optional(),
});

/**
 * `GET /masjids/:masjidId/timings` — what the admin app needs to resolve today's times on the phone (today strip,
 * editor preview): location + calculation settings and the raw timings (`null` before the first save).
 */
export const adminScheduleSchema = z
  .object({
    masjid: z.object({
      name: z.string(),
      lat: z.number(),
      lng: z.number(),
      calcMethod: z.enum(['karachi', 'mwl', 'isna', 'egypt', 'umm_al_qura', 'other_custom']),
      asrMadhab: z.enum(['hanafi', 'shafi']),
      hijriOffset: intIn(-2, 2).optional(),
    }),
    timings: z
      .object({
        prayers: z.object({
          fajr: adminPrayerConfigSchema,
          dhuhr: adminPrayerConfigSchema,
          asr: adminPrayerConfigSchema,
          maghrib: adminPrayerConfigSchema,
          isha: adminPrayerConfigSchema,
        }),
        jumuah: z.array(z.object({ seq: intIn(1, 3), khutbahTime: wallClock.optional(), jamaatTime: wallClock })),
      })
      .nullable(),
    /** The saved timings' revision, sent back in `If-Match` on save (0 before the first save). */
    rev: intIn(0, 2_000_000_000),
  })
  .meta({ id: 'AdminSchedule' });
export type AdminSchedule = z.infer<typeof adminScheduleSchema>;

// --- PUT /masjids/:masjidId/timings (07 B4, PHASE_03 T3.2) ---------------------------------------------------------

/** A prayer as the editor saves it: the mode rules of 02 masjid_timings (manual ⇒ adhan time; fixed ⇒ jamaat time; …). */
export const timingsPrayerInputSchema = adminPrayerConfigSchema.superRefine((value, ctx) => {
  if ((value.adhanMode === 'manual') !== (value.adhanTime !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['adhanTime'], message: 'adhanTime goes with a manual adhan only' });
  }
  if ((value.jamaatMode === 'fixed') !== (value.jamaatTime !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['jamaatTime'], message: 'jamaatTime goes with a fixed jamaat only' });
  }
  if ((value.jamaatMode === 'offset') !== (value.jamaatOffsetMin !== undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: ['jamaatOffsetMin'],
      message: 'jamaatOffsetMin goes with an offset jamaat only',
    });
  }
});

/** Body of `PUT /masjids/:masjidId/timings` (with `If-Match: "<rev>"`). */
export const timingsSaveSchema = z
  .object({
    prayers: z.object({
      fajr: timingsPrayerInputSchema,
      dhuhr: timingsPrayerInputSchema,
      asr: timingsPrayerInputSchema,
      maghrib: timingsPrayerInputSchema,
      isha: timingsPrayerInputSchema,
    }),
    jumuah: z
      .array(z.object({ seq: intIn(1, 3), khutbahTime: wallClock.optional(), jamaatTime: wallClock }))
      .min(1)
      .max(3)
      .refine((slots) => new Set(slots.map((slot) => slot.seq)).size === slots.length, {
        message: 'seq must be unique',
      }),
    /** "Notify followers": publishes a timing update (counts against today's quota). */
    notify: z.boolean(),
  })
  .meta({ id: 'TimingsSave' });
export type TimingsSave = z.infer<typeof timingsSaveSchema>;

export const timingsSavedSchema = z
  .object({ rev: intIn(1, 2_000_000_000), item: z.object({ publicId: z.string() }).nullable() })
  .meta({ id: 'TimingsSaved' });
export type TimingsSaved = z.infer<typeof timingsSavedSchema>;

/** `GET /masjids/:masjidId/timings/preview?date=` — the saved timings resolved for one IST day (as musallis see it). */
export const timingsPreviewSchema = z
  .object({
    date: z.iso.date(),
    sunrise: wallClock,
    prayers: z.array(
      z.object({
        prayer: z.enum(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']),
        adhan: wallClock,
        calculated: z.boolean(),
        jamaat: wallClock.nullable(),
      }),
    ),
    jumuah: z.array(z.object({ seq: intIn(1, 3), khutbahTime: wallClock.optional(), jamaatTime: wallClock })),
  })
  .meta({ id: 'TimingsPreview' });
export type TimingsPreview = z.infer<typeof timingsPreviewSchema>;

// --- Special dates & Ramadan (07 B11, PHASE_03 T3.3) ----------------------------------------------------------------

/** 00 §4.2 special date types (= `@mc/db/schema` SPECIAL_TYPE). */
export const SPECIAL_TYPES = [
  'eid_ul_fitr',
  'eid_ul_adha',
  'taraweeh',
  'shab_e_barat',
  'shab_e_qadr',
  'other',
] as const;
export type SpecialType = (typeof SPECIAL_TYPES)[number];

/**
 * Body of `POST /special` and `PATCH /special/:id` — the whole entry (a PATCH replaces it; a label or note left out is
 * removed). The ±400-day window and duplicate times are `@mc/domain/special` rules, checked by the data layer.
 */
export const specialDateSaveSchema = z
  .strictObject({
    type: z.enum(SPECIAL_TYPES),
    date: z.iso.date(),
    label: safeText(80, { min: 1 }).optional(),
    times: z
      .array(z.strictObject({ time: wallClock, label: safeText(40, { min: 1 }).optional() }))
      .min(1)
      .max(5),
    note: safeText(300, { min: 1, multiline: true }).optional(),
    /** "Notify followers": publishes a timing update for the date (counts against today's quota). */
    notify: z.boolean(),
  })
  .meta({ id: 'SpecialDateSave' });
export type SpecialDateSave = z.infer<typeof specialDateSaveSchema>;

/** One special date as the admin screens read it (responses carry plain strings — see super.ts). */
export const adminSpecialDateSchema = z.object({
  id: z.string(),
  type: z.enum(SPECIAL_TYPES),
  date: z.iso.date(),
  label: z.string().optional(),
  times: z.array(z.object({ time: wallClock, label: z.string().optional() })),
  note: z.string().optional(),
});
export type AdminSpecialDate = z.infer<typeof adminSpecialDateSchema>;

/** `GET /special` — from 30 days ago onwards, by date. */
export const adminSpecialDatesSchema = z
  .object({ specialDates: z.array(adminSpecialDateSchema) })
  .meta({ id: 'AdminSpecialDates' });
export type AdminSpecialDates = z.infer<typeof adminSpecialDatesSchema>;

export const specialDateSavedSchema = z
  .object({ id: z.string(), item: z.object({ publicId: z.string() }).nullable() })
  .meta({ id: 'SpecialDateSaved' });
export type SpecialDateSaved = z.infer<typeof specialDateSavedSchema>;

/**
 * `GET /ramadan` and the body of `PUT /ramadan` (03 §4): Ramadan mode is on from `start` to `end` (both `null` = off);
 * the precautions stay when it is off. Start ≤ end and the 30-day limit are `@mc/domain/special` rules.
 */
const ramadanFields = {
  start: z.iso.date().nullable(),
  end: z.iso.date().nullable(),
  sehriPrecaution: intIn(0, 15),
  iftarPrecaution: intIn(0, 10),
};
export const ramadanSchema = z.object(ramadanFields).meta({ id: 'Ramadan' });
export type Ramadan = z.infer<typeof ramadanSchema>;
export const ramadanSaveSchema = z
  .strictObject(ramadanFields)
  .refine((value) => (value.start === null) === (value.end === null), {
    message: 'start and end are set together',
    path: ['end'],
  })
  .meta({ id: 'RamadanSave' });
export type RamadanSave = z.infer<typeof ramadanSaveSchema>;

// --- Photos (01 §5.5, 03 §4 `POST /images`, PHASE_03 T3.6) ----------------------------------------------------------

/**
 * Query of `POST /masjids/:masjidId/images` (the body is the photo, multipart field `file`): what it is for, and the
 * admin's confirmation that the masjid may publish it (B5 ownership checkbox — recorded in the audit log).
 */
export const imageUploadQuerySchema = z.strictObject({
  purpose: z.enum(['announcement', 'campaign']),
  rightsConfirmed: z.literal('true'),
});

/** The stored photo: its key (sent with the post), ThumbHash placeholder, size, and the delivery URLs (WebP). */
export const imageUploadedSchema = z
  .object({
    imageKey: z.string(),
    thumbhash: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    urls: z.object({ w480: z.string(), w960: z.string(), w1440: z.string() }),
  })
  .meta({ id: 'ImageUploaded' });
export type ImageUploaded = z.infer<typeof imageUploadedSchema>;

// --- Notices (07 B5, 00 §4.3 Announcements, PHASE_03 T3.6) ---------------------------------------------------------

/** `m/<masjidId>/<random uuid>` (01 §5.5): the key `POST /images` returns — the only shape Caddy's media route serves. */
export const IMAGE_KEY =
  /^m\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** `m/<masjidId>/a/<random uuid>` (01 §5.5 Audio): the key `POST /audio` returns — the only shape the media route serves. */
export const AUDIO_KEY =
  /^m\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/a\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * `POST /masjids/:masjidId/audio?rightsConfirmed=true&durationS=&peaks=` (multipart `file`, 07 B14): the ownership
 * tick, and what the admin's browser measured while decoding the recording for its preview — the length in seconds
 * (≤ 600) and 48 peaks 0…255 as a comma list. The server bounds both; the storage's own duration decides when it has
 * one (DECISIONS #126).
 */
export const audioUploadQuerySchema = z.strictObject({
  rightsConfirmed: z.literal('true'),
  durationS: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,3})?$/)
    .transform(Number)
    .pipe(z.number().min(0.5).max(600.5)),
  peaks: z
    .string()
    .max(48 * 4)
    .regex(/^\d{1,3}(,\d{1,3}){47}$/)
    .transform((value) => value.split(',').map(Number))
    .pipe(z.array(z.int().min(0).max(255)).length(48)),
});

/** The stored recording: its key (sent with the post), whole seconds and the waveform. */
export const audioUploadedSchema = z
  .object({
    audioKey: z.string(),
    durationS: z.int().min(1).max(600),
    peaks: z.array(z.int().min(0).max(255)).length(48),
  })
  .meta({ id: 'AudioUploaded' });
export type AudioUploaded = z.infer<typeof audioUploadedSchema>;

/** 00 §4.3: a free-text notice's title and body. */
export const NOTICE_TITLE_MAX = 80;
export const NOTICE_BODY_MAX = 1000;

/**
 * A template param's value as the admin filled it in (02 items.template_params): text (times, dates, prayers, short
 * texts, phones), a whole number, or a range. Whether it fits the param's declared type is checked against the template
 * by the data layer (`@mc/i18n/template-args` `templateValueProblems`).
 */
const templateValueSchema = z.union([
  safeText(80, { min: 1 }),
  z.number().int().min(0).max(1_000_000),
  z.strictObject({ start: z.string().max(10), end: z.string().max(10) }),
]);

/**
 * Body of `POST /masjids/:masjidId/items/announcement` (07 B5): a template with its params, or the admin's own title +
 * body in a stated language; category and Important (preset from the template, editable); an event time (category
 * `event` only); an optional photo from `POST /images` (with the ownership tick again); "Notify followers".
 */
/**
 * A voice note from `POST /audio` (T3.13, DECISIONS #104) on a notice, hadith / ayah or dua request, and the post's
 * title, which a voice note always needs: a free-text notice has its own; the others send `title`.
 */
const voiceFields = {
  voice: z
    .strictObject({
      key: z.string().regex(AUDIO_KEY),
      durationS: z.int().min(1).max(600),
      peaks: z.array(z.int().min(0).max(255)).length(48),
    })
    .optional(),
  title: safeText(120, { min: 1 }).optional(),
};
/** A voice note needs a title — the post's own (free-text notice) or `title`; `title` comes only with a voice note. */
const checkVoice = (
  value: { readonly voice?: unknown; readonly title?: string | undefined; readonly ownTitle?: boolean },
  ctx: z.RefinementCtx,
) => {
  if (value.voice !== undefined && value.title === undefined && value.ownTitle !== true) {
    ctx.addIssue({ code: 'custom', message: 'a voice note needs a title', path: ['title'] });
  }
  // The title goes with a voice note only — hadith, ayah and dua posts carry no free text of their own (00 §4.3).
  if (value.voice === undefined && value.title !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'a title goes with a voice note', path: ['title'] });
  }
};

/** A notice's fields — published (with "Notify followers") or edited (T3.9) alike. */
const announcementFields = {
  ...voiceFields,
  content: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('template'),
      key: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
      params: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/), templateValueSchema),
    }),
    z.strictObject({
      kind: z.literal('text'),
      title: safeText(NOTICE_TITLE_MAX, { min: 1 }),
      body: safeText(NOTICE_BODY_MAX, { min: 1, multiline: true }),
      locale: z.enum(['en', 'hi', 'ur', 'te']),
    }),
  ]),
  category: z.enum(['general', 'event', 'facilities', 'timing']),
  isImportant: z.boolean(),
  eventAt: z.iso.datetime().optional(),
  image: z
    .strictObject({
      key: z.string().regex(IMAGE_KEY),
      thumbhash: z
        .string()
        .max(64)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      /** The B5 ownership checkbox: the masjid may publish this photo (05 §9). */
      rightsConfirmed: z.literal(true),
    })
    .optional(),
};
/** A notice's own rules: an event time only on an event; at most four template params. */
const checkAnnouncement = (
  value: {
    readonly eventAt?: string | undefined;
    readonly category: string;
    readonly voice?: unknown;
    readonly title?: string | undefined;
    readonly content:
      { readonly kind: 'template'; readonly params: Readonly<Record<string, unknown>> } | { readonly kind: 'text' };
  },
  ctx: z.RefinementCtx,
) => {
  if (value.eventAt !== undefined && value.category !== 'event') {
    ctx.addIssue({ code: 'custom', message: 'eventAt goes with an event only', path: ['eventAt'] });
  }
  if (value.content.kind === 'template' && Object.keys(value.content.params).length > 4) {
    ctx.addIssue({ code: 'custom', message: 'at most four params', path: ['content', 'params'] });
  }
  // A free-text notice has its own title; a template notice with a voice note sends `title`.
  if (value.content.kind === 'text' && value.title !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'a free-text notice has its own title', path: ['title'] });
  }
  checkVoice({ voice: value.voice, title: value.title, ownTitle: value.content.kind === 'text' }, ctx);
};

export const announcementPublishSchema = z
  .strictObject({ ...announcementFields, notify: z.boolean() })
  .superRefine(checkAnnouncement)
  .meta({ id: 'AnnouncementPublish' });
export type AnnouncementPublish = z.infer<typeof announcementPublishSchema>;

// --- Daily hadith / ayah (07 B6, 00 §4.3 Daily, PHASE_03 T3.7) ------------------------------------------------------

/** A canonical lower-case UUID v4 (ids the admin API accepts in bodies). */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 00 §4.3: the masjid's optional short note under today's hadith / ayah. */
export const DAILY_NOTE_MAX = 200;

/**
 * Body of `POST /masjids/:masjidId/items/daily-content` (07 B6): a verified hadith or ayah of the Content Library — the
 * kind is the entry's own; free-form hadith/ayah text is not allowed (00 §4.3) — the optional note, "Notify followers".
 */
/** Today's hadith / ayah fields — published or edited (T3.9) alike. */
const dailyFields = {
  ...voiceFields,
  libraryId: z.string().regex(UUID_V4),
  note: safeText(DAILY_NOTE_MAX, { min: 1, multiline: true }).optional(),
};

export const dailyContentPublishSchema = z
  .strictObject({ ...dailyFields, notify: z.boolean() })
  .superRefine(checkVoice)
  .meta({ id: 'DailyContentPublish' });
export type DailyContentPublish = z.infer<typeof dailyContentPublishSchema>;

// --- Dua requests (07 B7, 00 §4.3 Dua requests, PHASE_03 T3.8) ----------------------------------------------------

/** 00 §4.3 / 02 items.dua: the message, the person's name and the janaza place. */
export const DUA_MESSAGE_MAX = 500;
export const DUA_NAME_MAX = 80;
export const JANAZA_PLACE_MAX = 120;

/**
 * Body of `POST /masjids/:masjidId/items/dua` (07 B7): the category, the message in a stated language (template-assisted
 * in the app), the person's name — optional, and kept from musallis while `namePrivate` is on (02 §4.2) — a verified
 * dua of the Content Library, and for inteqal an optional janaza time and place. The title is the category's ("Request
 * for Dua"), never sent.
 */
/** A dua request's fields — published or edited (T3.9) alike. */
const duaFields = {
  ...voiceFields,
  category: z.enum(['illness', 'inteqal', 'other']),
  message: safeText(DUA_MESSAGE_MAX, { min: 1, multiline: true }),
  locale: z.enum(['en', 'hi', 'ur', 'te']),
  personName: safeText(DUA_NAME_MAX, { min: 1 }).optional(),
  namePrivate: z.boolean(),
  libraryId: z.string().regex(UUID_V4),
  janazaAt: z.iso.datetime().optional(),
  janazaPlace: safeText(JANAZA_PLACE_MAX, { min: 1 }).optional(),
};
/** A janaza goes with inteqal only; a voice note needs a title. */
const checkDua = (
  value: {
    readonly category: string;
    readonly janazaAt?: string | undefined;
    readonly janazaPlace?: string | undefined;
    readonly voice?: unknown;
    readonly title?: string | undefined;
  },
  ctx: z.RefinementCtx,
) => {
  checkVoice(value, ctx);
  if (value.category !== 'inteqal' && (value.janazaAt !== undefined || value.janazaPlace !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'a janaza goes with inteqal only', path: ['janazaAt'] });
  }
};

export const duaPublishSchema = z
  .strictObject({ ...duaFields, notify: z.boolean() })
  .superRefine(checkDua)
  .meta({ id: 'DuaPublish' });
export type DuaPublish = z.infer<typeof duaPublishSchema>;

// --- My Posts (07 B12, 03 §4 Items, PHASE_03 T3.9) ----------------------------------------------------------------

export const ITEM_STATUS_VALUES = ['published', 'deleted', 'removed'] as const;
export type AdminItemStatus = (typeof ITEM_STATUS_VALUES)[number];

/** `GET /masjids/:masjidId/items?type=&status=&cursor=`. */
export const adminItemListQuerySchema = z.object({
  type: z.enum(ITEM_TYPE_VALUES).optional(),
  status: z.enum(ITEM_STATUS_VALUES).optional(),
  cursor: z.string().max(200).optional(),
});

/**
 * Body of `PATCH /masjids/:masjidId/items/:itemId` (If-Match: `"<updatedAt>"`; ≤ 24 h after publishing): the post's
 * type and its new content — the publish body without "Notify followers" (edits never notify — 00 §4.3).
 */
export const itemEditSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('announcement'), ...announcementFields }),
    z.strictObject({ type: z.literal('daily_content'), ...dailyFields }),
    z.strictObject({ type: z.literal('dua_request'), ...duaFields }),
  ])
  .superRefine((value, ctx) => {
    if (value.type === 'announcement') checkAnnouncement(value, ctx);
    if (value.type === 'daily_content') checkVoice(value, ctx);
    if (value.type === 'dua_request') checkDua(value, ctx);
  })
  .meta({ id: 'ItemEdit' });
export type ItemEditBody = z.infer<typeof itemEditSchema>;
export const itemEditedSchema = z.object({ updatedAt: z.iso.datetime() }).meta({ id: 'ItemEdited' });

// --- Masjid Profile (07 B13, 03 §4 Profile, PHASE_03 T3.10) -------------------------------------------------------

/** `GET /masjids/:masjidId` (and the answer of `PATCH` / `POST /photo`): what B13 shows. */
export const adminMasjidProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    nameI18n: z.object({ hi: z.string().optional(), ur: z.string().optional(), te: z.string().optional() }),
    area: z.string(),
    city: z.string(),
    state: z.string(),
    address: z.string(),
    photo: z.object({ key: z.string(), thumbhash: z.string().optional(), url: z.string().optional() }).optional(),
    /** The masjid's own Hijri adjustment; `null` = the app's global one. */
    hijriOffset: z.int().min(-2).max(2).nullable(),
    globalHijriOffset: z.int().min(-2).max(2),
  })
  .meta({ id: 'AdminMasjidProfile' });
export type AdminMasjidProfile = z.infer<typeof adminMasjidProfileSchema>;

/** `PATCH /masjids/:masjidId` — the Hijri adjustment only (the photo has its own upload; names go through a request). */
export const masjidProfilePatchSchema = z
  .strictObject({ hijriOffset: z.int().min(-2).max(2).nullable() })
  .meta({ id: 'MasjidProfilePatch' });
export type MasjidProfilePatchBody = z.infer<typeof masjidProfilePatchSchema>;

/** `POST /masjids/:masjidId/photo?rightsConfirmed=true` — the ownership tick, as for notice photos (05 §9). */
export const masjidPhotoQuerySchema = z.strictObject({ rightsConfirmed: z.literal('true') });

/** `POST /masjids/:masjidId/change-requests` — names, area or address: a note for the Super Admin. */
export const masjidChangeRequestSchema = z
  .strictObject({ note: safeText(300, { min: 1, multiline: true }) })
  .meta({ id: 'MasjidChangeRequest' });

// --- Adhkar after salah (07 B16, 00 §4.11, PHASE_03 T3.14) -------------------------------------------------------

/** Most `dhikr` entries in a masjid's set (00 §4.11; mirrors `@mc/db/schema`). */
export const ADHKAR_MAX = 30;

/** `GET /masjids/:masjidId/adhkar` (and the answer of `PUT`): on/off and the verified entries in the masjid's order. */
export const adminAdhkarSchema = z
  .object({ enabled: z.boolean(), entries: z.array(adminLibraryEntrySchema) })
  .meta({ id: 'AdminAdhkar' });
export type AdminAdhkar = z.infer<typeof adminAdhkarSchema>;

/** `PUT /masjids/:masjidId/adhkar` — the whole set, in order: verified `dhikr` entries only, ≤ 30, none twice. */
export const adhkarPutSchema = z
  .strictObject({ enabled: z.boolean(), libraryIds: z.array(z.string().regex(UUID_V4)).max(ADHKAR_MAX) })
  .refine((body) => new Set(body.libraryIds).size === body.libraryIds.length, {
    path: ['libraryIds'],
    message: 'an entry is listed twice',
  })
  .meta({ id: 'AdhkarPut' });
export type AdhkarPut = z.infer<typeof adhkarPutSchema>;

/**
 * Every publish answers with the item and, when it notifies, the notification about to go out (03 §4): `targeted` =
 * followers with notifications on for the item's audience, `quotaLeft` = notifications left today; the worker sends it.
 */
export const itemPublishedSchema = z
  .object({
    item: z.object({ id: z.string(), publicId: z.string() }),
    notification: z.object({ queued: z.boolean(), targeted: count, quotaLeft: count }).nullable(),
  })
  .meta({ id: 'ItemPublished' });
export type ItemPublished = z.infer<typeof itemPublishedSchema>;

// --- Ruqyah (07 B15, 00 §4.10, PHASE_03 T3.15) ---------------------------------------------------------------------

/** Most active Ruqyah entries per masjid (00 §4.10; mirrors `@mc/db/schema`). */
export const RUQYAH_MAX = 50;
/** The headings, in the order A19 shows them (DECISIONS #104). */
export const RUQYAH_CATEGORIES = ['nazar', 'sihr', 'shifa', 'protection', 'general'] as const;
export type RuqyahCategory = (typeof RUQYAH_CATEGORIES)[number];
export const RUQYAH_TITLE_MAX = 80;
export const RUQYAH_ARABIC_MAX = 4000;
export const RUQYAH_TRANSLATION_MAX = 2000;
export const RUQYAH_REFERENCE_MAX = 200;
export const RUQYAH_INSTRUCTIONS_MAX = 300;
const contentLocale = z.enum(['en', 'hi', 'ur', 'te']);

const ruqyahCommon = {
  category: z.enum(RUQYAH_CATEGORIES),
  title: safeText(RUQYAH_TITLE_MAX, { min: 1 }).optional(),
  /** The masjid's own note (e.g. when to listen), in the language it is written in. */
  instructions: z
    .strictObject({ text: safeText(RUQYAH_INSTRUCTIONS_MAX, { min: 1, multiline: true }), locale: contentLocale })
    .optional(),
};

/**
 * Body of `POST /ruqyah` and `PATCH /ruqyah/:id` — the whole entry (a PATCH replaces it; what is left out is removed):
 * a verified library entry (any kind), text the masjid enters (Arabic + one translation + optional reference — shown as
 * "Added by <masjid>"), or a recording from `POST /audio` with a title and the ownership tick (05 §9).
 */
export const ruqyahSaveSchema = z
  .discriminatedUnion('source', [
    z.strictObject({ ...ruqyahCommon, source: z.literal('library'), libraryId: z.string().regex(UUID_V4) }),
    z.strictObject({
      ...ruqyahCommon,
      source: z.literal('text'),
      text: z.strictObject({
        arabic: safeText(RUQYAH_ARABIC_MAX, { min: 1, multiline: true, arabicSigns: true }),
        translation: safeText(RUQYAH_TRANSLATION_MAX, { min: 1, multiline: true }),
        translationLocale: contentLocale,
        reference: safeText(RUQYAH_REFERENCE_MAX, { min: 1 }).optional(),
      }),
    }),
    z.strictObject({
      ...ruqyahCommon,
      source: z.literal('audio'),
      title: safeText(RUQYAH_TITLE_MAX, { min: 1 }),
      audio: z.strictObject({
        key: z.string().regex(AUDIO_KEY),
        durationS: z.int().min(1).max(600),
        peaks: z.array(z.int().min(0).max(255)).max(48).optional(),
        /** "This recording is ours or we have permission to share it". */
        rightsConfirmed: z.literal(true),
      }),
    }),
  ])
  .meta({ id: 'RuqyahSave' });
export type RuqyahSave = z.infer<typeof ruqyahSaveSchema>;

/** One entry as B15 reads it; `libraryId` without `library` = a library entry no longer verified (replace it). */
export const adminRuqyahEntrySchema = z.object({
  id: z.string(),
  category: z.enum(RUQYAH_CATEGORIES),
  source: z.enum(['library', 'text', 'audio']),
  title: z.string().optional(),
  libraryId: z.string().optional(),
  library: adminLibraryEntrySchema.optional(),
  text: z
    .object({
      arabic: z.string(),
      translation: z.string(),
      translationLocale: contentLocale,
      reference: z.string().optional(),
    })
    .optional(),
  audio: z.object({ key: z.string(), durationS: z.int(), peaks: z.array(z.int()).optional() }).optional(),
  instructions: z.string().optional(),
  instructionsLocale: contentLocale.optional(),
});
export type AdminRuqyahEntry = z.infer<typeof adminRuqyahEntrySchema>;

/** `GET /ruqyah` (and the answer of `PUT /ruqyah/order`): the active entries in the masjid's order. */
export const adminRuqyahListSchema = z
  .object({ entries: z.array(adminRuqyahEntrySchema) })
  .meta({ id: 'AdminRuqyahList' });
export type AdminRuqyahList = z.infer<typeof adminRuqyahListSchema>;

export const ruqyahSavedSchema = z.object({ id: z.string() }).meta({ id: 'RuqyahSaved' });

/** `PUT /ruqyah/order` — every active entry exactly once, in the new order. */
export const ruqyahOrderSchema = z
  .strictObject({ ids: z.array(z.string().regex(UUID_V4)).min(1).max(RUQYAH_MAX) })
  .refine((body) => new Set(body.ids).size === body.ids.length, { path: ['ids'], message: 'an entry is listed twice' })
  .meta({ id: 'RuqyahOrder' });
export type RuqyahOrder = z.infer<typeof ruqyahOrderSchema>;

// --- Ilm contacts (07 B17, 00 §4.12, PHASE_03 T3.16) -------------------------------------------------------------------

/** Most active Ilm contacts per masjid (00 §4.12; mirrors `@mc/db/schema`). */
export const CONTACTS_MAX = 10;
export const CONTACT_NAME_MAX = 80;
export const CONTACT_ROLE_MAX = 60;
export const CONTACT_TOPICS_MAX = 120;
/** E.164: "+", then 7–15 ASCII digits without a leading zero (`@mc/domain/phone` `isE164`, the DB validator). */
export const E164 = /^\+[1-9][0-9]{6,14}$/;

/**
 * Body of `POST /contacts` and `PATCH /contacts/:id` — the whole contact (a PATCH replaces it; a role or topics left
 * out is removed). `consentConfirmed: true` is required on every save: "This person agreed to be listed — their name and
 * WhatsApp will be visible to app users" (05 §2).
 */
export const contactSaveSchema = z
  .strictObject({
    name: safeText(CONTACT_NAME_MAX, { min: 1 }),
    role: safeText(CONTACT_ROLE_MAX, { min: 1 }).optional(),
    topics: safeText(CONTACT_TOPICS_MAX, { min: 1 }).optional(),
    whatsapp: z.string().regex(E164),
    audience: z.enum(['brothers', 'sisters']),
    consentConfirmed: z.literal(true),
  })
  .meta({ id: 'ContactSave' });
export type ContactSave = z.infer<typeof contactSaveSchema>;

/** One contact as B17 reads it. */
export const adminContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().optional(),
  topics: z.string().optional(),
  whatsapp: z.string(),
  audience: z.enum(['brothers', 'sisters']),
});
export type AdminContact = z.infer<typeof adminContactSchema>;

/** `GET /contacts`: the active contacts, brothers' first, each audience in the masjid's order. */
export const adminContactListSchema = z
  .object({ contacts: z.array(adminContactSchema) })
  .meta({ id: 'AdminContactList' });
export type AdminContactList = z.infer<typeof adminContactListSchema>;

export const contactSavedSchema = z.object({ id: z.string() }).meta({ id: 'ContactSaved' });

// --- UPI payment details (B8, 04 R1, PHASE_05 T5.2) ----------------------------------------------------------------------

/**
 * Body of `POST /masjids/:masjidId/payment/requests`: the UPI details the masjid wants shown. Nothing goes live until
 * the Super Admin approves and the hold has passed. The VPA is checked by the data layer exactly as the database
 * accepts it (`@mc/domain/upi`, 400 `PAYMENT_INVALID`); here only its size is bounded.
 */
export const paymentRequestSchema = z
  .strictObject({
    vpa: z.string().min(3).max(256),
    payeeName: safeText(100, { min: 1 }),
    note: safeText(300, { multiline: true }).optional(),
  })
  .meta({ id: 'PaymentRequest' });
export type PaymentRequest = z.infer<typeof paymentRequestSchema>;

export const livePaymentSchema = z
  .object({ vpa: z.string(), payeeName: z.string(), effectiveAt: z.string() })
  .meta({ id: 'LivePayment' });
export type LivePayment = z.infer<typeof livePaymentSchema>;

export const PAYMENT_REQUEST_STATUSES = ['pending', 'approved_on_hold', 'rejected'] as const;

export const paymentRequestRowSchema = z
  .object({
    id: z.string(),
    status: z.enum(PAYMENT_REQUEST_STATUSES),
    vpa: z.string(),
    payeeName: z.string(),
    note: z.string().optional(),
    requestedAt: z.string(),
    reviewedAt: z.string().optional(),
    /** When approved: the moment the details go live (approval + hold). */
    effectiveAt: z.string().optional(),
    rejectReason: z.string().optional(),
  })
  .meta({ id: 'PaymentRequestRow' });
export type PaymentRequestRow = z.infer<typeof paymentRequestRowSchema>;

/** `GET /masjids/:masjidId/payment`: what followers see now, and the request in progress (or the latest rejection). */
export const adminPaymentSchema = z
  .object({ active: livePaymentSchema.nullable(), request: paymentRequestRowSchema.nullable() })
  .meta({ id: 'AdminPayment' });
export type AdminPayment = z.infer<typeof adminPaymentSchema>;

export const paymentRequestedSchema = z.object({ id: z.string() }).meta({ id: 'PaymentRequested' });

// --- Donation campaigns (B8, 00 §4.3, PHASE_05 T5.3) ---------------------------------------------------------------

export const CAMPAIGN_PURPOSES = ['renovation', 'repair', 'utilities', 'welfare', 'other'] as const;
export type CampaignPurpose = (typeof CAMPAIGN_PURPOSES)[number];
export const CAMPAIGN_STATUSES = ['active', 'completed', 'closed'] as const;
/** 00 §4.3: at most 3 active campaigns; a target of at least ₹1,000 (mirrors `@mc/db/state`). */
export const CAMPAIGNS_ACTIVE_MAX = 3;
export const CAMPAIGN_TARGET_MIN_PAISE = 100_000;
export const CAMPAIGN_TITLE_MAX = 120;
export const CAMPAIGN_DESCRIPTION_MAX = 1500;

/** Integer paise, 0 … 10^12 (CLAUDE.md §6 money). */
const paise = z.int().min(0).max(1_000_000_000_000);

const campaignCoverSchema = z.strictObject({
  key: z.string().regex(IMAGE_KEY),
  thumbhash: z
    .string()
    .max(64)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  /** The B8 ownership checkbox: the masjid may publish this photo (05 §9). */
  rightsConfirmed: z.literal(true),
});

/** Body of `POST /masjids/:masjidId/campaigns` (B8 create flow → Publish). */
export const campaignCreateSchema = z
  .strictObject({
    title: safeText(CAMPAIGN_TITLE_MAX, { min: 1 }),
    description: safeText(CAMPAIGN_DESCRIPTION_MAX, { multiline: true }).optional(),
    purpose: z.enum(CAMPAIGN_PURPOSES),
    targetPaise: paise.min(CAMPAIGN_TARGET_MIN_PAISE),
    startsOn: z.iso.date(),
    endsOn: z.iso.date().optional(),
    cover: campaignCoverSchema.optional(),
    notify: z.boolean(),
  })
  .meta({ id: 'CampaignCreate' });
export type CampaignCreate = z.infer<typeof campaignCreateSchema>;

/** Body of `PATCH /masjids/:masjidId/campaigns/:id`: what may change; the target only upward. */
export const campaignPatchSchema = z
  .strictObject({
    title: safeText(CAMPAIGN_TITLE_MAX, { min: 1 }).optional(),
    description: safeText(CAMPAIGN_DESCRIPTION_MAX, { multiline: true }).optional(),
    endsOn: z.iso.date().nullable().optional(),
    targetPaise: paise.optional(),
    cover: campaignCoverSchema.nullable().optional(),
  })
  .meta({ id: 'CampaignPatch' });
export type CampaignPatchBody = z.infer<typeof campaignPatchSchema>;

/** Body of `POST /masjids/:masjidId/campaigns/:id/received` ("Update amount"; "Notify followers" off by default). */
export const campaignReceivedSchema = z
  .strictObject({ receivedPaise: paise, notify: z.boolean() })
  .meta({ id: 'CampaignReceived' });
export type CampaignReceived = z.infer<typeof campaignReceivedSchema>;

export const adminCampaignSchema = z
  .object({
    id: z.string(),
    publicId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    purpose: z.enum(CAMPAIGN_PURPOSES),
    status: z.enum(CAMPAIGN_STATUSES),
    targetPaise: z.number(),
    receivedPaise: z.number(),
    receivedUpdatedAt: z.string().optional(),
    startsOn: z.string(),
    endsOn: z.string().optional(),
    cover: z.object({ key: z.string(), thumbhash: z.string() }).optional(),
    publishedAt: z.string(),
  })
  .meta({ id: 'AdminCampaign' });
export type AdminCampaign = z.infer<typeof adminCampaignSchema>;

/** `GET /masjids/:masjidId/campaigns`: active, then completed, then closed; newest first in each. */
export const adminCampaignListSchema = z
  .object({ campaigns: z.array(adminCampaignSchema) })
  .meta({ id: 'AdminCampaignList' });
export type AdminCampaignList = z.infer<typeof adminCampaignListSchema>;

/** "Update amount" result: the notification when it notifies. */
export const campaignReceivedResultSchema = z
  .object({ notification: z.object({ queued: z.boolean(), targeted: count, quotaLeft: count }).nullable() })
  .meta({ id: 'CampaignReceivedResult' });
