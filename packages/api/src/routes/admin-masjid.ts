// Masjid-scoped admin API (03 §4 "Masjid-scoped", PHASE_03): `/masjids/:masjidId/...` for the masjid's own admins. The
// repositories re-resolve the id under the session's scope (02 §4.1), so another masjid — or a malformed id — answers
// exactly like an unknown one (404 `MASJID_NOT_FOUND`).
import { type DbHandle, idText, parseId } from '@mc/db';
import {
  getAdminSchedule,
  getMasjidStats,
  getPushQuota,
  getRamadan,
  listSpecialDates,
  requireOwnMasjid,
} from '@mc/db/repos';
import { deleteSpecialDate, recordImageUpload, saveRamadan, saveSpecialDate, saveTimings } from '@mc/db/state';
import { resolveSchedule } from '@mc/domain/prayer';
import { addDays, calendarDateInZone } from '@mc/domain/time';
import {
  adminMasjidStatsSchema,
  adminScheduleSchema,
  adminSpecialDatesSchema,
  imageUploadedSchema,
  imageUploadQuerySchema,
  pushQuotaSchema,
  ramadanSaveSchema,
  ramadanSchema,
  specialDateSavedSchema,
  specialDateSaveSchema,
  timingsPreviewSchema,
  timingsSavedSchema,
  timingsSaveSchema,
} from '@mc/shared/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';
import { IMAGE_MAX_BYTES, ImageRejected, sanitizeImage } from '../media/image.ts';
import { type MediaStore, newImageKey } from '../media/store.ts';

export interface AdminMasjidRouteDeps {
  readonly db: DbHandle;
  /** Photo storage and the origin its delivery URLs are on (T3.6); absent → `POST /images` answers 503. */
  readonly media?: { readonly store: MediaStore; readonly origin: string } | undefined;
}

const Params = z.object({ masjidId: z.string().max(64) });

/** The masjid id from the path; a malformed one answers like an unknown masjid. */
function masjidIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
  return id;
}

const PreviewQuery = z.object({ date: z.iso.date() });
const SpecialParams = z.object({ masjidId: z.string().max(64), id: z.string().max(64) });
const Empty = z.object({});
/** The B11 list starts this many days back (recent entries stay editable). */
const SPECIAL_LIST_PAST_DAYS = 30;

/** A special date's id from the path; a malformed one answers like an unknown entry. */
function specialIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'SPECIAL_DATE_NOT_FOUND');
  return id;
}

/**
 * PHASE_03 T3.1: the Admin Home's reads; T3.2: saving timings and the preview of a day; T3.3: special dates, Ramadan;
 * T3.6: photos.
 */
export function adminMasjidRoutes(deps: AdminMasjidRouteDeps): RouteDefinition[] {
  const { db, media } = deps;
  const writes = [{ bucket: 'adminWrites', key: 'session' }] as const;
  // 03 §2: 30 uploads per hour per masjid (whichever admin uploads), and the session's write budget.
  const uploads = [
    { bucket: 'adminUploads', key: (req: Request) => req.params['masjidId']?.toString() },
    ...writes,
  ] as const;
  return [
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/stats',
      summary: 'Followers, items published and Ameens in the last 7 days (B3 header)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminMasjidStatsSchema },
      handler: async ({ auth, params, clock, reply }) =>
        reply(200, await getMasjidStats(db, auth.scope, masjidIdOf(params.masjidId), clock.now())),
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/notifications/quota',
      summary: "Today's notifying publishes against the masjid's daily push quota (IST day)",
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: pushQuotaSchema },
      handler: async ({ auth, params, clock, reply }) => {
        const quota = await getPushQuota(db, auth.scope, masjidIdOf(params.masjidId), clock.now());
        return reply(200, { used: quota.used, limit: quota.limit, resetsAt: quota.resetsAt.toISOString() });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/timings',
      summary: 'Location, calculation settings and raw timings — resolved on the phone (today strip, editor)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminScheduleSchema },
      handler: async ({ auth, params, reply }) =>
        reply(200, await getAdminSchedule(db, auth.scope, masjidIdOf(params.masjidId))),
    }),
    defineRoute({
      method: 'put',
      path: '/masjids/:masjidId/timings',
      summary: 'Save the five prayers and Jumu’ah at once (If-Match: "<rev>"; 412 when someone saved in between)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: timingsSaveSchema },
      responses: { 200: timingsSavedSchema },
      handler: async ({ auth, params, body, req, clock, requestId, reply }) => {
        const { notify, ...timings } = body;
        const saved = await saveTimings(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          timings,
          expectedRev: revOf(req.get('if-match')),
          notify,
          now: clock.now(),
          requestId,
        });
        return reply(200, saved);
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/timings/preview',
      summary: 'The saved timings resolved for one IST day, as musallis see them',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params, query: PreviewQuery },
      responses: { 200: timingsPreviewSchema },
      handler: async ({ auth, params, query, reply }) => {
        const schedule = await getAdminSchedule(db, auth.scope, masjidIdOf(params.masjidId));
        if (!schedule.timings) throw new ApiProblem(404, 'NOT_FOUND');
        const day = resolveSchedule(
          {
            coordinates: { lat: schedule.masjid.lat, lng: schedule.masjid.lng },
            method: schedule.masjid.calcMethod,
            madhab: schedule.masjid.asrMadhab,
            prayers: schedule.timings.prayers,
            jumuah: schedule.timings.jumuah,
          },
          query.date,
        );
        return reply(200, {
          date: query.date,
          sunrise: day.sunrise,
          prayers: day.prayers.map(({ prayer, adhan, adhanCalculated, jamaat }) => ({
            prayer,
            adhan,
            calculated: adhanCalculated,
            jamaat,
          })),
          jumuah: schedule.timings.jumuah,
        });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/special',
      summary: 'Special dates from 30 days ago onwards, by date (B11)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminSpecialDatesSchema },
      handler: async ({ auth, params, clock, reply }) => {
        const from = addDays(calendarDateInZone(clock.now()), -SPECIAL_LIST_PAST_DAYS);
        const specialDates = await listSpecialDates(db, auth.scope, masjidIdOf(params.masjidId), from);
        return reply(200, { specialDates });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/special',
      summary: 'Add a special date (1–5 times, within 400 days; optionally notify followers)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: specialDateSaveSchema },
      responses: { 201: specialDateSavedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const { notify, ...entry } = body;
        const saved = await saveSpecialDate(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          entry,
          notify,
          now: clock.now(),
          requestId,
        });
        return reply(201, saved);
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/masjids/:masjidId/special/:id',
      summary: 'Replace a special date (a label or note left out is removed)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: SpecialParams, body: specialDateSaveSchema },
      responses: { 200: specialDateSavedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const { notify, ...entry } = body;
        const saved = await saveSpecialDate(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          id: specialIdOf(params.id),
          entry,
          notify,
          now: clock.now(),
          requestId,
        });
        return reply(200, saved);
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/masjids/:masjidId/special/:id',
      summary: 'Delete a special date (followers stop seeing it after their next version poll)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: SpecialParams },
      responses: { 204: Empty },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        await deleteSpecialDate(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          id: specialIdOf(params.id),
          now: clock.now(),
          requestId,
        });
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/images',
      summary: 'Upload a photo (≤ 10 MB; JPEG, PNG, WebP or AVIF by content): sanitized, re-encoded, then stored',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: uploads,
      upload: { maxBytes: IMAGE_MAX_BYTES },
      request: { params: Params, query: imageUploadQuerySchema },
      responses: { 201: imageUploadedSchema },
      handler: async ({ auth, params, query, file, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        requireOwnMasjid(auth.scope, masjidId);
        if (!media || !file) throw new ApiProblem(503, 'SERVICE_UNAVAILABLE');
        let image: Awaited<ReturnType<typeof sanitizeImage>>;
        try {
          image = await sanitizeImage(file.bytes);
        } catch (error) {
          if (error instanceof ImageRejected) throw new ApiProblem(422, 'IMAGE_INVALID');
          throw error;
        }
        const key = newImageKey(idText(masjidId));
        await media.store.putImage(key, image.master);
        await recordImageUpload(db, auth.scope, { masjidId, key, purpose: query.purpose, requestId });
        const origin = media.origin.endsWith('/') ? media.origin.slice(0, -1) : media.origin;
        const url = (width: number) => `${origin}/i/${String(width)}/webp/${key}`;
        return reply(201, {
          imageKey: key,
          thumbhash: image.thumbhash,
          width: image.width,
          height: image.height,
          urls: { w480: url(480), w960: url(960), w1440: url(1440) },
        });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/ramadan',
      summary: 'Ramadan mode (start/end, null when off) and the Sehri / Iftar precautions',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: ramadanSchema },
      handler: async ({ auth, params, reply }) =>
        reply(200, await getRamadan(db, auth.scope, masjidIdOf(params.masjidId))),
    }),
    defineRoute({
      method: 'put',
      path: '/masjids/:masjidId/ramadan',
      summary: 'Save Ramadan mode (start ≤ end, at most 30 days; both null = off) and the precautions',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: ramadanSaveSchema },
      responses: { 200: ramadanSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        await saveRamadan(db, auth.scope, {
          masjidId,
          ramadan: {
            start: body.start,
            end: body.end,
            sehriPrecautionMin: body.sehriPrecaution,
            iftarPrecautionMin: body.iftarPrecaution,
          },
          now: clock.now(),
          requestId,
        });
        return reply(200, await getRamadan(db, auth.scope, masjidId));
      },
    }),
  ];
}

/** `If-Match: "<rev>"` (quotes optional; "0" = no timings saved yet). Missing or malformed → 400. */
const IfMatch = z
  .string()
  .regex(/^"?\d{1,10}"?$/)
  .transform((value) => Number(value.replaceAll('"', '')));

function revOf(header: string | undefined): number {
  const parsed = IfMatch.safeParse(header);
  if (!parsed.success) throw new ApiProblem(400, 'VALIDATION_FAILED');
  return parsed.data;
}
