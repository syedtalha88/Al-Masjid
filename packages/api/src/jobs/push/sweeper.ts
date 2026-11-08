// `outbox-sweeper` (01 §5.3 step 7, PHASE_04 T4.4): every minute, hands every outbox job still `pending` after two
// minutes to `push-fanout` again (the API's after-commit enqueue was lost — Redis down, process killed), and fails
// running jobs without progress for ten minutes and nothing left in the queues (the stuck-job detector) with a Super
// Admin alert.
import { type DbHandle, systemScope } from '@mc/db';
import { failJob, isPushPaused, listStalledPendingJobs, listStuckCandidates, touchJobProgress } from '@mc/db/state';
import { LOCALES as PUSH_LOCALES } from '@mc/i18n/locales';
import type { Clock } from '@mc/shared/clock';

import type { createLogger } from '../../logger.ts';
import { sendBatchJobId } from '../../queue/jobs.ts';
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
  // The stuck-job detector. While the kill switch is on nothing progresses by design, so it does not run then; a job
  // whose work still waits in the queues (resumed after a pause, the worker back after a stop / reboot) is on its way
  // and is only noted as such — only a job with nothing left anywhere is failed (DECISIONS #142).
  let failedStuck = 0;
  if (!(await isPushPaused(deps.db, scope))) {
    for (const candidate of await listStuckCandidates(deps.db, scope, new Date(now.getTime() - STUCK_AFTER_MS))) {
      const jobId = candidate.jobId.toHexString(true);
      if (await hasQueuedWork(deps.queues, jobId, candidate.fanoutPages)) {
        await touchJobProgress(deps.db, scope, candidate.jobId, now);
        continue;
      }
      if (!(await failJob(deps.db, scope, candidate.jobId, 'no progress for 10 minutes', now))) continue;
      failedStuck += 1;
      deps.logger.error({ jobId }, 'push job stuck: failed after 10 minutes without progress');
      await deps.queues.enqueue(
        'alert-send',
        { alertId: `push_job_stuck.${jobId}`, to: { kind: 'super' }, alert: { type: 'push_job_stuck', params: {} } },
        { jobId: `alert.push_job_stuck.${jobId}` },
      );
    }
  }
  if (requeued > 0) deps.logger.warn({ requeued }, 'outbox sweeper re-enqueued pending push jobs');
  return { requeued, failedStuck };
}

/** BullMQ states in which a job will still run. */
const LIVE_STATES: ReadonlySet<string> = new Set(['waiting', 'delayed', 'active', 'prioritized', 'waiting-children']);

/** Whether the job's fan-out or any of its send batches still waits in (or runs from) the queues. */
async function hasQueuedWork(queues: JobQueues, jobId: string, fanoutPages: number): Promise<boolean> {
  const live = async (queue: 'push-fanout' | 'push-send-batch', id: string) => {
    const job = await queues.queue(queue).getJob(id);
    return job !== undefined && LIVE_STATES.has(await job.getState());
  };
  if (await live('push-fanout', jobId)) return true;
  for (let page = 0; page < fanoutPages; page += 1)
    for (const locale of PUSH_LOCALES)
      if (await live('push-send-batch', sendBatchJobId(jobId, page, locale))) return true;
  return false;
}
