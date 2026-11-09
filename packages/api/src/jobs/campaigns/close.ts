// `campaign-close` (01 §5.8, 00 §4.3, PHASE_05 T5.3): daily at 00:10 IST the worker (`mc_system`) closes donation
// drives whose end date has passed. Idempotent — a missed run is the next run's work.
import { type DbHandle, systemScope } from '@mc/db';
import { closeEndedCampaigns } from '@mc/db/state';
import { calendarDateInZone } from '@mc/domain/time';
import type { Clock } from '@mc/shared/clock';

import type { createLogger } from '../../logger.ts';

export interface CampaignCloseDeps {
  readonly db: DbHandle;
  readonly clock: Clock;
  readonly logger: ReturnType<typeof createLogger>;
}

/** One run: closes every campaign with `ends_on` before today (IST). */
export async function processCampaignClose(deps: CampaignCloseDeps): Promise<{ closed: number }> {
  const now = deps.clock.now();
  const closed = await closeEndedCampaigns(deps.db, systemScope(), { today: calendarDateInZone(now), now });
  if (closed > 0) deps.logger.info({ closed }, 'donation drives closed');
  return { closed };
}
