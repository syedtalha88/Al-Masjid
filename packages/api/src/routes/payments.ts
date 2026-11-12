// The UPI change-lock over HTTP (03 §4 "Payment", §5 "Payments", 04 R1, PHASE_05 T5.2). An admin reads the status and
// a masjid owner requests a change (the Super Admin and the other owners are alerted — #161); the Super Admin lists
// open requests, approves ★ (fresh step-up — at the route and again in the state function) or rejects (every owner is
// alerted either way). Nothing here makes details live: only the worker's `payment-activate` job does, after the hold.
import { type DbHandle, idText, parseId } from '@mc/db';
import { getAdminPayment, listOpenPayments } from '@mc/db/repos';
import {
  approvePaymentChange,
  PAYMENT_HOLD_MIN_PRODUCTION,
  rejectPaymentChange,
  requestPaymentChange,
} from '@mc/db/state';
import {
  adminPaymentSchema,
  paymentApprovedSchema,
  paymentRequestedSchema,
  paymentRequestSchema,
  reasonSchema,
  superPaymentListSchema,
} from '@mc/shared/contracts';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';
import type { AlertService } from '../queue/alerts.ts';

export interface PaymentRouteDeps {
  readonly db: DbHandle;
  /** Alert pushes (T4.6): the Super Admin and the other owners on a request, every owner on a decision (#161). */
  readonly alerts?: AlertService | undefined;
  /** env `PAYMENT_HOLD_MINUTES` (≥ 1440 in production — env.ts); 24 h when not given. */
  readonly paymentHoldMinutes?: number | undefined;
}

const MasjidParams = z.object({ masjidId: z.string().max(64) });
const IdParams = z.object({ id: z.string().max(64) });
const Empty = z.object({});

function masjidIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
  return id;
}

/** A payment request id from the path; a malformed one answers like an unknown one. */
function profileIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'PAYMENT_NOT_FOUND');
  return id;
}

/**
 * Who hears about a decision (DECISIONS #161, F69): every owner of the masjid, and the requester (an owner when they
 * asked; kept if they were since made an editor). At most 5 admins per masjid.
 */
type Id = Parameters<typeof idText>[0];
function recipients(decided: { readonly requestedBy: Id; readonly ownerIds: readonly Id[] }): string[] {
  return [...new Set([decided.requestedBy, ...decided.ownerIds].map((id) => idText(id)))].sort(); // stable order
}

/** B8: the masjid admin's routes (mounted under `/api/admin/v1`). */
export function adminPaymentRoutes(deps: PaymentRouteDeps): RouteDefinition[] {
  const { db } = deps;
  const writes = [{ bucket: 'adminWrites', key: 'session' }] as const;
  return [
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/payment',
      summary: 'UPI details shown to followers now, and the change request in progress (B8)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: MasjidParams },
      responses: { 200: adminPaymentSchema },
      handler: async ({ auth, params, reply }) =>
        reply(200, await getAdminPayment(db, auth.scope, masjidIdOf(params.masjidId))),
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/payment/requests',
      summary: 'Ask to set or change the UPI details — live only after Super Admin approval and the hold (04 R1)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: MasjidParams, body: paymentRequestSchema },
      responses: { 201: paymentRequestedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const created = await requestPaymentChange(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          vpa: body.vpa,
          payeeName: body.payeeName,
          note: body.note,
          sessionId: auth.session.sessionId,
          now: clock.now(),
          requestId,
        });
        await deps.alerts?.raise({ type: 'payment_request', to: { kind: 'super' }, key: created.id });
        // #161: every owner hears about it at once — the requester's other phones too, so a hijacked session is
        // noticed even in a masjid with a single owner.
        await deps.alerts?.raise({
          type: 'payment_request_owner',
          to: { kind: 'admins', adminIds: created.ownerIds.map((id) => idText(id)).sort() },
          key: created.id,
        });
        return reply(201, { id: created.id });
      },
    }),
  ];
}

/** C4: the Super Admin's routes (mounted under `/api/super/v1`). */
export function superPaymentRoutes(deps: PaymentRouteDeps): RouteDefinition[] {
  const { db } = deps;
  const holdMinutes = deps.paymentHoldMinutes ?? PAYMENT_HOLD_MIN_PRODUCTION;
  const writes = [{ bucket: 'adminWrites', key: 'session' }] as const;
  return [
    defineRoute({
      method: 'get',
      path: '/payments/pending',
      summary: 'Open UPI change requests — pending and on hold — oldest first, with the live details (C4)',
      tags: ['super'],
      auth: 'super',
      responses: { 200: superPaymentListSchema },
      handler: async ({ auth, reply }) => reply(200, await listOpenPayments(db, auth.scope)),
    }),
    defineRoute({
      method: 'post',
      path: '/payments/:id/approve',
      summary: '★ Approve a UPI change — it goes live after the hold (PAYMENT_HOLD_MINUTES, ≥ 24 h in production)',
      tags: ['super'],
      auth: 'super_step_up', // ★ at the route too (04 §5); approvePaymentChange checks it again
      rateLimit: writes,
      request: { params: IdParams, body: Empty },
      responses: { 200: paymentApprovedSchema },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        const approved = await approvePaymentChange(db, auth.scope, {
          profileId: profileIdOf(params.id),
          holdMinutes,
          now: clock.now(),
          requestId,
        });
        await deps.alerts?.raise({
          type: 'payment_approved',
          to: { kind: 'admins', adminIds: recipients(approved) },
          key: params.id,
        });
        return reply(200, { effectiveAt: approved.effectiveAt.toISOString() });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/payments/:id/reject',
      summary: 'Turn down a UPI change — while pending, or during the hold to stop it (DECISIONS #146)',
      tags: ['super'],
      auth: 'super',
      rateLimit: writes,
      request: { params: IdParams, body: reasonSchema },
      responses: { 204: Empty },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const rejected = await rejectPaymentChange(db, auth.scope, {
          profileId: profileIdOf(params.id),
          reason: body.reason,
          now: clock.now(),
          requestId,
        });
        await deps.alerts?.raise({
          type: 'payment_rejected',
          to: { kind: 'admins', adminIds: recipients(rejected) },
          key: params.id,
        });
        return reply(204, {});
      },
    }),
  ];
}
