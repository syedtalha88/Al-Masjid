// Masjid-scoped admin API (03 §4 "Masjid-scoped", PHASE_03): `/masjids/:masjidId/...` for the masjid's own admins. The
// repositories re-resolve the id under the session's scope (02 §4.1), so another masjid — or a malformed id — answers
// exactly like an unknown one (404 `MASJID_NOT_FOUND`).
import { type DbHandle, parseId } from '@mc/db';
import { getAdminSchedule, getMasjidStats, getPushQuota } from '@mc/db/repos';
import { saveTimings } from '@mc/db/state';
import { resolveSchedule } from '@mc/domain/prayer';
import {
  adminMasjidStatsSchema,
  adminScheduleSchema,
  pushQuotaSchema,
  timingsPreviewSchema,
  timingsSavedSchema,
  timingsSaveSchema,
} from '@mc/shared/contracts';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';

export interface AdminMasjidRouteDeps {
  readonly db: DbHandle;
}

const Params = z.object({ masjidId: z.string().max(64) });

/** The masjid id from the path; a malformed one answers like an unknown masjid. */
function masjidIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
  return id;
}

const PreviewQuery = z.object({ date: z.iso.date() });

/** PHASE_03 T3.1: the Admin Home's reads; T3.2: saving timings and the preview of a day. */
export function adminMasjidRoutes(deps: AdminMasjidRouteDeps): RouteDefinition[] {
  const { db } = deps;
  const writes = [{ bucket: 'adminWrites', key: 'session' }] as const;
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
