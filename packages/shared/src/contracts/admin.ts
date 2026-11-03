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
