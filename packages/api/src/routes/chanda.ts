// Weekly chanda over HTTP (03 §4 "Chanda", 07 B9, PHASE_05 T5.5): the masjid's settings and weeks, saving a week's total
// (its feed item; "Notify followers" optional, only while shown) and the settings — "Show chanda to followers" (mirrored
// onto every week and chanda item, DECISIONS #152) and the day the week starts. Amounts are integer paise.
import { type DbHandle, parseId } from '@mc/db';
import { countNotifyAudience, getChandaForAdmin } from '@mc/db/repos';
import { setChandaSettings, setChandaWeek } from '@mc/db/state';
import {
  adminChandaSchema,
  chandaSettingsSchema,
  chandaWeekSavedSchema,
  chandaWeekSaveSchema,
} from '@mc/shared/contracts';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';
import type { PushNotifier } from '../queue/queues.ts';

export interface ChandaRouteDeps {
  readonly db: DbHandle;
  /** Hands a notifying save's outbox job to the worker after commit; absent → the outbox sweeper does. */
  readonly notifier?: PushNotifier | undefined;
}

const Params = z.object({ masjidId: z.string().max(64) });
const WeekParams = z.object({ masjidId: z.string().max(64), weekStart: z.string().max(10) });
const Empty = z.object({});

function masjidIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
  return id;
}

/** B9: the masjid admin's chanda routes (mounted under `/api/admin`). */
export function adminChandaRoutes(deps: ChandaRouteDeps): RouteDefinition[] {
  const { db } = deps;
  const writes = [{ bucket: 'adminWrites', key: 'session' }] as const;
  const afterCommit = (jobId: string | null) => deps.notifier?.afterCommit(jobId) ?? Promise.resolve();
  return [
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/chanda',
      summary: 'Weekly chanda — settings and the latest weeks, newest first (B9)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminChandaSchema },
      handler: async ({ auth, params, reply }) =>
        reply(200, await getChandaForAdmin(db, auth.scope, masjidIdOf(params.masjidId))),
    }),
    defineRoute({
      method: 'put',
      path: '/masjids/:masjidId/chanda/:weekStart',
      summary: "Save a week's chanda total — the masjid's week-start day, not a future week; one feed item per week",
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: WeekParams, body: chandaWeekSaveSchema },
      responses: { 200: chandaWeekSavedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        const saved = await setChandaWeek(db, auth.scope, {
          masjidId,
          weekStart: params.weekStart,
          amountPaise: body.amountPaise,
          ...(body.note === undefined ? {} : { note: body.note }),
          notify: body.notify,
          now: clock.now(),
          requestId,
        });
        await afterCommit(saved.notificationJobId);
        const notification =
          saved.quotaLeft === null
            ? null
            : {
                queued: true,
                targeted: await countNotifyAudience(db, auth.scope, masjidId, 'everyone'),
                quotaLeft: saved.quotaLeft,
              };
        return reply(200, { item: saved.item, created: saved.created, notification });
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/masjids/:masjidId/chanda/settings',
      summary: '"Show chanda to followers" (mirrored onto every week) and the day the week starts',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: chandaSettingsSchema },
      responses: { 204: Empty },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        await setChandaSettings(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          ...(body.show === undefined ? {} : { show: body.show }),
          ...(body.weekStart === undefined ? {} : { weekStart: body.weekStart }),
          now: clock.now(),
          requestId,
        });
        return reply(204, {});
      },
    }),
  ];
}
