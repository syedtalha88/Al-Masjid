// `payment-activate` (01 §5.8, 04 R1, PHASE_05 T5.2): every 10 minutes the worker (`mc_system`) puts approved UPI
// details live whose hold has passed (`activateDuePaymentProfiles` — one transaction each, idempotent), then starts the
// "Payment details updated" fan-out (the outbox sweeper would re-enqueue it anyway) and tells the masjid's owners.
import { type DbHandle, idText, systemScope } from '@mc/db';
import { activateDuePaymentProfiles } from '@mc/db/state';
import type { Clock } from '@mc/shared/clock';

import type { createLogger } from '../../logger.ts';
import type { JobQueues } from '../../queue/queues.ts';

export interface PaymentActivateDeps {
  readonly db: DbHandle;
  readonly queues: JobQueues;
  readonly clock: Clock;
  readonly logger: ReturnType<typeof createLogger>;
}

/**
 * One run of the job.
 *
 * @returns how many profiles went live. A failed enqueue throws (the job retries; activation itself is idempotent and
 *   a lost fan-out is re-enqueued by the outbox sweeper).
 */
export async function processPaymentActivate(deps: PaymentActivateDeps): Promise<{ activated: number }> {
  const { activated, heldBack, stopped } = await activateDuePaymentProfiles(deps.db, systemScope(), {
    now: deps.clock.now(),
  });
  // The requester lost access before the change went live (DECISIONS #161): closed, never live. Ids only.
  if (stopped.length > 0) {
    deps.logger.warn({ stopped: stopped.map((id) => idText(id)) }, 'payment changes stopped: requester lost access');
  }
  // Masjid suspended, or the notice template not active (DECISIONS #160): they wait for a later run. Ids only.
  if (heldBack.length > 0) {
    deps.logger.warn({ heldBack: heldBack.map((id) => idText(id)) }, 'payment profiles due but held back');
  }
  for (const entry of activated) {
    const profileId = idText(entry.profileId);
    if (entry.noticeJobId) {
      await deps.queues.enqueue('push-fanout', { jobId: entry.noticeJobId }, { jobId: entry.noticeJobId });
    }
    await deps.queues.enqueue(
      'alert-send',
      {
        alertId: `payment_active.${profileId}`,
        // Every owner of the masjid, and the requester (DECISIONS #161, F69); ≤ 5 admins per masjid.
        to: {
          kind: 'admins',
          adminIds: [...new Set([entry.requestedBy, ...entry.ownerIds].map((id) => idText(id)))].sort(),
        },
        alert: { type: 'payment_active', params: {} },
      },
      { jobId: `alert.payment_active.${profileId}` },
    );
  }
  // Ids only — never the VPA or payee name (CLAUDE.md §6 logging).
  if (activated.length > 0) {
    deps.logger.info({ activated: activated.map((entry) => idText(entry.profileId)) }, 'payment profiles activated');
  }
  return { activated: activated.length };
}
