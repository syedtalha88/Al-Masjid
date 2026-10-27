// Masjid-scoped admin API (03 §4 "Masjid-scoped", PHASE_03): `/masjids/:masjidId/...` for the masjid's own admins. The
// repositories re-resolve the id under the session's scope (02 §4.1), so another masjid — or a malformed id — answers
// exactly like an unknown one (404 `MASJID_NOT_FOUND`).
import { type DbHandle, parseId } from '@mc/db';
import { getAdminSchedule, getMasjidStats, getPushQuota } from '@mc/db/repos';
import { adminMasjidStatsSchema, adminScheduleSchema, pushQuotaSchema } from '@mc/shared/contracts';
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

/** PHASE_03 T3.1: the Admin Home's reads. */
export function adminMasjidRoutes(deps: AdminMasjidRouteDeps): RouteDefinition[] {
  const { db } = deps;
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
  ];
}
