// `stats-snapshot` (01 §5.8, PHASE_08 T8.10): every hour the worker (`mc_system`) writes the hour's platform stats
// (`stats_snapshots`, read by the Super Admin's Stats screen), recomputes each masjid's Ameens of the last 7 days, adds
// the job queues' backlog and lag, and reads Cloudinary's monthly usage — alerting the Super Admin when it crosses 70 %
// or 90 % since the previous snapshot (once a month per threshold; the alert's job id is the month too). Cloudinary and
// queue trouble never fails the run: the snapshot is written without them (logged).
import { type DbHandle, systemScope } from '@mc/db';
import {
  type CloudinaryStats,
  computeStatsCounts,
  latestSnapshotForSystem,
  type QueueStats,
  refreshAmeens7d,
  writeStatsSnapshot,
} from '@mc/db/state';
import type { Clock } from '@mc/shared/clock';

import type { createLogger } from '../../logger.ts';
import type { AlertService } from '../../queue/alerts.ts';
import { JOB_NAMES } from '../../queue/jobs.ts';
import type { JobQueues } from '../../queue/queues.ts';

/** Cloudinary usage thresholds that alert the Super Admin (01 §5.8). */
export const CLOUDINARY_THRESHOLDS = [70, 90] as const;
type Threshold = (typeof CLOUDINARY_THRESHOLDS)[number];
/** One fixed-words alert per threshold. */
const ALERT = { 70: 'cloudinary_70', 90: 'cloudinary_90' } as const satisfies Record<Threshold, string>;

export interface StatsSnapshotDeps {
  readonly db: DbHandle;
  readonly clock: Clock;
  readonly logger: ReturnType<typeof createLogger>;
  readonly queues: JobQueues;
  readonly alerts?: AlertService | undefined;
  /** Cloudinary's usage (absent locally — nothing to read). */
  readonly cloudinaryUsage?: (() => Promise<CloudinaryStats>) | undefined;
}

/**
 * The backlog of every queue together: jobs waiting / running / delayed / failed, and the age of the oldest waiting
 * job. BullMQ 6.3: `getJobs(['waiting'], 0, 0, true)` is the oldest (a list read ascending is reversed — pinned by the
 * integration test).
 */
export async function queueStats(queues: JobQueues, now: Date): Promise<QueueStats> {
  let waiting = 0;
  let active = 0;
  let delayed = 0;
  let failed = 0;
  let oldest = now.getTime();
  for (const name of JOB_NAMES) {
    const queue = queues.queue(name);
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    waiting += counts['waiting'] ?? 0;
    active += counts['active'] ?? 0;
    delayed += counts['delayed'] ?? 0;
    failed += counts['failed'] ?? 0;
    if ((counts['waiting'] ?? 0) > 0) {
      const [first] = await queue.getJobs(['waiting'], 0, 0, true);
      if (first) oldest = Math.min(oldest, first.timestamp);
    }
  }
  return { waiting, active, delayed, failed, lagS: Math.max(0, Math.round((now.getTime() - oldest) / 1000)) };
}

/** Thresholds crossed between two readings (no previous reading: every threshold already reached). */
export const crossedThresholds = (previous: number | undefined, current: number): readonly Threshold[] =>
  CLOUDINARY_THRESHOLDS.filter((t) => current >= t && (previous === undefined || previous < t));

/** One run. @returns the snapshot's hour and how many masjids' Ameen counts changed. */
export async function processStatsSnapshot(
  deps: StatsSnapshotDeps,
): Promise<{ readonly hour: string; readonly ameensChanged: number }> {
  const scope = systemScope();
  const now = deps.clock.now();
  const previous = await latestSnapshotForSystem(deps.db, scope);
  const counts = await computeStatsCounts(deps.db, scope, now);

  let queues: QueueStats | undefined;
  try {
    queues = await queueStats(deps.queues, now);
  } catch (error) {
    deps.logger.warn({ err: error }, 'stats: queue counts unavailable');
  }
  let cloudinary: CloudinaryStats | undefined;
  if (deps.cloudinaryUsage) {
    try {
      cloudinary = await deps.cloudinaryUsage();
    } catch (error) {
      deps.logger.warn({ err: error }, 'stats: cloudinary usage unavailable');
    }
  }

  const hour = await writeStatsSnapshot(deps.db, scope, {
    now,
    counts: { ...counts, ...(queues ? { queues } : {}), ...(cloudinary ? { cloudinary } : {}) },
  });
  const ameensChanged = await refreshAmeens7d(deps.db, scope, now);

  if (cloudinary) {
    // Usage restarts every month, so "crossed since the last reading" fires once a month per threshold.
    const month = now.toISOString().slice(0, 7);
    for (const threshold of crossedThresholds(previous?.counts.cloudinary?.usedPercent, cloudinary.usedPercent)) {
      await deps.alerts?.raise({ type: ALERT[threshold], to: { kind: 'super' }, key: month });
    }
  }
  deps.logger.info({ hour, ameensChanged }, 'stats snapshot written');
  return { hour, ameensChanged };
}
