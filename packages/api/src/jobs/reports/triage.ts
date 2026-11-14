// `report-triage` (01 §5.8, 05 §3, PHASE_08 T8.1): every minute the worker (`mc_system`) looks at the reports that
// arrived since its last run. Each urgent one raises the immediate Super Admin alert (job id per report — raised once);
// a post reported by `report_autohide_threshold` distinct devices within an hour is hidden pending review and the
// Super Admin is told (once: only a published post can be hidden). Then the reports are marked as looked at. Nothing
// else is hidden automatically — one report never hides a post (brigading, 05 §3). Ids only in logs.
import { type DbHandle, idText, systemScope } from '@mc/db';
import {
  autoHideItem,
  countRecentReporters,
  listUntriagedReports,
  markReportsTriaged,
  readAutohideThreshold,
} from '@mc/db/state';
import type { Clock } from '@mc/shared/clock';
import { REPORT_AUTOHIDE_DEFAULT_THRESHOLD, REPORT_AUTOHIDE_WINDOW_MS } from '@mc/shared/compliance';

import type { createLogger } from '../../logger.ts';
import type { JobQueues } from '../../queue/queues.ts';

export interface ReportTriageDeps {
  readonly db: DbHandle;
  readonly queues: JobQueues;
  readonly clock: Clock;
  readonly logger: ReturnType<typeof createLogger>;
}

export interface ReportTriageResult {
  readonly triaged: number;
  readonly urgent: number;
  readonly hidden: number;
}

/**
 * One run of the job.
 *
 * @returns how many reports were looked at, urgent alerts raised and posts hidden. A failed enqueue throws before the
 *   reports are marked, so the next run raises it again (the alert's job id keeps it to one push).
 */
export async function processReportTriage(deps: ReportTriageDeps): Promise<ReportTriageResult> {
  const scope = systemScope();
  const now = deps.clock.now();
  const reports = await listUntriagedReports(deps.db, scope);
  if (reports.length === 0) return { triaged: 0, urgent: 0, hidden: 0 };

  let urgent = 0;
  for (const report of reports.filter((entry) => entry.urgent)) {
    const alertId = `report_urgent.${idText(report.id)}`;
    await deps.queues.enqueue(
      'alert-send',
      { alertId, to: { kind: 'super' }, alert: { type: 'report_urgent', params: {} } },
      { jobId: `alert.${alertId}` },
    );
    urgent += 1;
  }

  const threshold = await readAutohideThreshold(deps.db, scope, REPORT_AUTOHIDE_DEFAULT_THRESHOLD);
  const since = new Date(now.getTime() - REPORT_AUTOHIDE_WINDOW_MS);
  const items = new Map(
    reports.filter((entry) => entry.targetType === 'item').map((entry) => [idText(entry.targetId), entry.targetId]),
  );
  let hidden = 0;
  for (const [itemText, itemId] of items) {
    const reporters = await countRecentReporters(deps.db, scope, itemId, since);
    if (reporters < threshold) continue;
    const outcome = await autoHideItem(deps.db, scope, { itemId, reporters, now });
    // Already hidden (a run that hid it but failed to enqueue): raise again — the job id keeps it to one push.
    if (outcome.status !== 'hidden') continue;
    if (outcome.result === 'hidden') hidden += 1;
    // One hide = one alert / purge / file check; a hide after a restore is a new one (security re-review N-L2).
    const hide = `${itemText}.${String(outcome.hiddenAt?.getTime() ?? 0)}`;
    const alertId = `report_autohide.${hide}`;
    await deps.queues.enqueue(
      'alert-send',
      { alertId, to: { kind: 'super' }, alert: { type: 'report_autohide', params: {} } },
      { jobId: `alert.${alertId}` },
    );
    // Hidden must mean gone (security review M4): the CDN's cached copies of the post and its masjid (old `?v=` URLs
    // stay immutable otherwise) and its files (restricted while not published). One job each per post.
    if (outcome.target) {
      await deps.queues.enqueue(
        'cdn-purge',
        { tags: [`i-${outcome.target.publicId}`, `m-${idText(outcome.target.masjidId)}`] },
        { jobId: `cdn.autohide.${hide}` },
      );
      await deps.queues.enqueue('media-access', { itemId: itemText }, { jobId: `media.autohide.${hide}` });
    }
    if (outcome.result === 'hidden') {
      deps.logger.warn({ item: itemText, reporters }, 'post hidden pending review after many reports');
    }
  }

  const triaged = await markReportsTriaged(
    deps.db,
    scope,
    reports.map((entry) => entry.id),
    now,
  );
  return { triaged, urgent, hidden };
}
