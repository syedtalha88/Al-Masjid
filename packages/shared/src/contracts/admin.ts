import { z } from 'zod';

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
