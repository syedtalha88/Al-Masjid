// `retention` (01 §5.8, 02 §6): daily at 03:00 IST the worker (`mc_system`) deletes what its retention period has
// ended for. First part (PHASE_05 T5.8, DECISIONS #104): needy people 90 days after they were fulfilled, closed or
// deleted, with their amount history; and (F65, DECISIONS #159) the admin alert subscriptions whose session has ended.
// The other collections' periods (02 §6) join here in Phase 8. Idempotent — a missed run is the next run's work. Logs
// counts only, never who.
import { type DbHandle, systemScope } from '@mc/db';
import { pruneAdminPushSubscriptions, purgeBeneficiaries } from '@mc/db/state';
import type { Clock } from '@mc/shared/clock';

import type { createLogger } from '../../logger.ts';

export interface RetentionDeps {
  readonly db: DbHandle;
  readonly clock: Clock;
  readonly logger: ReturnType<typeof createLogger>;
}

/**
 * One run: purges every needy person whose `purge_after` has passed, and every admin alert subscription whose session
 * no longer carries alerts.
 */
export async function processRetention(deps: RetentionDeps): Promise<{ beneficiaries: number; alertPhones: number }> {
  const now = deps.clock.now();
  const beneficiaries = await purgeBeneficiaries(deps.db, systemScope(), { now });
  if (beneficiaries > 0) deps.logger.info({ beneficiaries }, 'retention: needy people purged');
  const alertPhones = await pruneAdminPushSubscriptions(deps.db, systemScope(), now);
  if (alertPhones > 0)
    deps.logger.info({ alertPhones }, 'retention: admin alert subscriptions without a session removed');
  return { beneficiaries, alertPhones };
}
