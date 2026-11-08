// `outbox-sweeper` (01 §5.3 step 7, PHASE_04 T4.4): every minute, hands every outbox job still `pending` after two
// minutes to `push-fanout` again (the API's after-commit enqueue was lost — Redis down, process killed), and fails
// running jobs without progress for ten minutes (the stuck-job detector) with a Super Admin alert.
import { type DbHandle, systemScope } from '@mc/db';
import { failStuckJobs, listStalledPendingJobs } from '@mc/db/state';
import type { Clock } from '@mc/shared/clock';

import type { createLogger } from '../../logger.ts';
import type { JobQueues } from '../../queue/queues.ts';

type Logger = ReturnType<typeof createLogger>;

export const OUTBOX_STALE_MS = 2 * 60_000;
export const STUCK_AFTER_MS = 10 * 60_000;
const SWEEP_LIMIT = 200;

export interface SweeperDeps {
  readonly db: DbHandle;
  readonly queues: JobQueues;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface SweepResult {
  readonly requeued: number;
  readonly failedStuck: number;
}

/** One sweep. */
export async function processOutboxSweep(deps: SweeperDeps): Promise<SweepResult> {
  const scope = systemScope();
  const now = deps.clock.now();
  const fanout = deps.queues.queue('push-fanout');
  let requeued = 0;
  for (const id of await listStalledPendingJobs(
    deps.db,
    scope,
    new Date(now.getTime() - OUTBOX_STALE_MS),
    SWEEP_LIMIT,
  )) {
    const jobId = id.toHexString(true);
    const existing = await fanout.getJob(jobId);
    const state = existing ? await existing.getState() : 'unknown';
    if (existing && state === 'failed') {
      await existing.retry(); // its attempts ran out while Redis or MongoDB was away; the job is still pending
      requeued += 1;
    } else if (!existing || state === 'completed' || state === 'unknown') {
      if (existing) await existing.remove(); // a finished BullMQ job under this id would swallow the re-add
      await deps.queues.enqueue('push-fanout', { jobId }, { jobId });
      requeued += 1;
    } // waiting / delayed / active: already on its way
  }
  const stuck = await failStuckJobs(deps.db, scope, new Date(now.getTime() - STUCK_AFTER_MS), now);
  for (const entry of stuck) {
    const jobId = entry.jobId.toHexString(true);
    deps.logger.error({ jobId }, 'push job stuck: failed after 10 minutes without progress');
    await deps.queues.enqueue(
      'alert-send',
      { alertId: `push_job_stuck.${jobId}`, to: { kind: 'super' }, alert: { type: 'push_job_stuck', params: {} } },
      { jobId: `alert.push_job_stuck.${jobId}` },
    );
  }
  if (requeued > 0) deps.logger.warn({ requeued }, 'outbox sweeper re-enqueued pending push jobs');
  return { requeued, failedStuck: stuck.length };
}
