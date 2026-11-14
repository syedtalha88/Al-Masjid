// `sla-alerts` (01 §5.8, 05 §3, PHASE_08 T8.3): every 15 minutes the worker (`mc_system`) reads the open SLA timers and
// tells the Super Admin when one passes 50 %, 80 % and 100 % of its time — one alert per (target, threshold), recorded
// on the target. A timer that jumped several thresholds since the last run (the worker was down) alerts once, at the
// highest. Fixed words per threshold; ids only in logs.
import { type DbHandle, idText, systemScope } from '@mc/db';
import { listSlaTimers, markSlaAlerted } from '@mc/db/state';
import type { Clock } from '@mc/shared/clock';
import { slaProgress } from '@mc/shared/compliance';

import type { createLogger } from '../../logger.ts';
import type { JobQueues } from '../../queue/queues.ts';

/** One alert type per threshold (fixed words). */
const ALERT = { 50: 'sla_50', 80: 'sla_80', 100: 'sla_100' } as const;

export interface SlaAlertDeps {
  readonly db: DbHandle;
  readonly queues: JobQueues;
  readonly clock: Clock;
  readonly logger: ReturnType<typeof createLogger>;
  /** Sentry (outside local): a passed deadline is also reported, so it reaches the owner by e-mail (T8.3). */
  readonly report?: ((error: unknown) => void) | undefined;
}

/** A deadline passed (100 %): reported to Sentry as its own issue — the e-mail fallback when a push is missed. */
export class SlaBreachError extends Error {
  override readonly name = 'SlaBreachError';
  constructor(kind: string) {
    super(`SLA deadline passed: ${kind}`);
  }
}

/**
 * One run of the job.
 *
 * @returns how many alerts were raised. A failed enqueue throws before its threshold is recorded (the next run raises
 *   it again; the alert's job id keeps it to one push).
 */
export async function processSlaAlerts(deps: SlaAlertDeps): Promise<{ readonly alerts: number }> {
  const scope = systemScope();
  const now = deps.clock.now();
  let alerts = 0;
  for (const timer of await listSlaTimers(deps.db, scope, { pendingAlertsOnly: true })) {
    const { level } = slaProgress(timer.startAt, timer.dueAt, now);
    if (level === 0 || level <= timer.alerted) continue;
    const alertId = `sla.${timer.kind}.${idText(timer.id)}.${String(level)}`;
    await deps.queues.enqueue(
      'alert-send',
      { alertId, to: { kind: 'super' }, alert: { type: ALERT[level], params: {} } },
      { jobId: `alert.${alertId}` },
    );
    await markSlaAlerted(deps.db, scope, timer, level);
    if (level === 100) deps.report?.(new SlaBreachError(timer.kind));
    alerts += 1;
  }
  if (alerts > 0) deps.logger.info({ alerts }, 'sla alerts raised');
  return { alerts };
}
