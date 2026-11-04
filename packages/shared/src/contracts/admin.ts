import { z } from 'zod';

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
  .object({ used: count, limit: count, resetsAt: z.iso.datetime() })
  .meta({ id: 'PushQuota' });
export type PushQuota = z.infer<typeof pushQuotaSchema>;

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
export const announcementPublishSchema = z
  .strictObject({
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
    notify: z.boolean(),
  })
  .refine((value) => value.eventAt === undefined || value.category === 'event', {
    message: 'eventAt goes with an event only',
    path: ['eventAt'],
  })
  .refine((value) => value.content.kind === 'text' || Object.keys(value.content.params).length <= 4, {
    message: 'at most four params',
    path: ['content', 'params'],
  })
  .meta({ id: 'AnnouncementPublish' });
export type AnnouncementPublish = z.infer<typeof announcementPublishSchema>;

/**
 * Every publish answers with the item and, when it notifies, the notification about to go out (03 §4): `targeted` =
 * followers with notifications on for the item's audience, `quotaLeft` = notifications left today. Sending is Phase 4.
 */
export const itemPublishedSchema = z
  .object({
    item: z.object({ id: z.string(), publicId: z.string() }),
    notification: z.object({ queued: z.boolean(), targeted: count, quotaLeft: count }).nullable(),
  })
  .meta({ id: 'ItemPublished' });
export type ItemPublished = z.infer<typeof itemPublishedSchema>;
