// Donation campaigns over HTTP (03 §4 "Campaigns", 07 B8, PHASE_05 T5.3): list, create (needs the masjid's active UPI
// details), edit (target only upward), "Update amount" (append-only history; "Notify followers" optional) and mark
// completed. A notifying write hands its outbox job to the worker after commit. Amounts are integer paise.
import { type DbHandle, parseId } from '@mc/db';
import { countNotifyAudience, listCampaignsForAdmin } from '@mc/db/repos';
import { completeCampaign, createCampaign, setCampaignReceived, updateCampaign } from '@mc/db/state';
import {
  adminCampaignListSchema,
  campaignCreateSchema,
  campaignPatchSchema,
  campaignReceivedResultSchema,
  campaignReceivedSchema,
  itemPublishedSchema,
} from '@mc/shared/contracts';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';
import type { PushNotifier } from '../queue/queues.ts';

export interface CampaignRouteDeps {
  readonly db: DbHandle;
  /** Hands a notifying write's outbox job to the worker after commit; absent → the outbox sweeper does. */
  readonly notifier?: PushNotifier | undefined;
}

const Params = z.object({ masjidId: z.string().max(64) });
const ItemParams = z.object({ masjidId: z.string().max(64), id: z.string().max(64) });
const Empty = z.object({});

function masjidIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
  return id;
}

/** A campaign id from the path; a malformed one answers like an unknown campaign. */
function campaignIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'CAMPAIGN_NOT_FOUND');
  return id;
}

/** B8: the masjid admin's campaign routes (mounted under `/api/admin/v1`). */
export function adminCampaignRoutes(deps: CampaignRouteDeps): RouteDefinition[] {
  const { db } = deps;
  const writes = [{ bucket: 'adminWrites', key: 'session' }] as const;
  const afterCommit = (jobId: string | null) => deps.notifier?.afterCommit(jobId) ?? Promise.resolve();
  return [
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/campaigns',
      summary: 'Donation drives — active, then completed, then closed (B8)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminCampaignListSchema },
      handler: async ({ auth, params, reply }) =>
        reply(200, await listCampaignsForAdmin(db, auth.scope, masjidIdOf(params.masjidId))),
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/campaigns',
      summary: "Start a donation drive — needs the masjid's active UPI details; at most 3 active (00 §4.3)",
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: campaignCreateSchema },
      responses: { 201: itemPublishedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        const { notify, description, endsOn, cover, ...rest } = body;
        const created = await createCampaign(db, auth.scope, {
          masjidId,
          campaign: {
            ...rest,
            description: description ?? '',
            ...(endsOn === undefined ? {} : { endsOn }),
            ...(cover === undefined ? {} : { cover }),
          },
          notify,
          now: clock.now(),
          requestId,
        });
        await afterCommit(created.notificationJobId);
        const notification =
          created.quotaLeft === null
            ? null
            : {
                queued: true,
                targeted: await countNotifyAudience(db, auth.scope, masjidId, 'everyone'),
                quotaLeft: created.quotaLeft,
              };
        return reply(201, { item: created.item, notification });
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/masjids/:masjidId/campaigns/:id',
      summary: 'Edit a donation drive — title, description, cover, end date; the target only upward (audited)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: ItemParams, body: campaignPatchSchema },
      responses: { 204: Empty },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        await updateCampaign(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          itemId: campaignIdOf(params.id),
          patch: body,
          now: clock.now(),
          requestId,
        });
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/campaigns/:id/received',
      summary: '"Update amount": what the masjid reports received (a history row each time; notify optional)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: ItemParams, body: campaignReceivedSchema },
      responses: { 200: campaignReceivedResultSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        const result = await setCampaignReceived(db, auth.scope, {
          masjidId,
          itemId: campaignIdOf(params.id),
          receivedPaise: body.receivedPaise,
          notify: body.notify,
          now: clock.now(),
          requestId,
        });
        await afterCommit(result.notificationJobId);
        const notification =
          result.quotaLeft === null
            ? null
            : {
                queued: true,
                targeted: await countNotifyAudience(db, auth.scope, masjidId, 'everyone'),
                quotaLeft: result.quotaLeft,
              };
        return reply(200, { notification });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/campaigns/:id/complete',
      summary: 'Mark a donation drive completed (it stays visible until it closes)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: ItemParams, body: Empty },
      responses: { 204: Empty },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        await completeCampaign(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          itemId: campaignIdOf(params.id),
          now: clock.now(),
          requestId,
        });
        return reply(204, {});
      },
    }),
  ];
}
