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
  })
  .meta({ id: 'AdminSchedule' });
export type AdminSchedule = z.infer<typeof adminScheduleSchema>;
