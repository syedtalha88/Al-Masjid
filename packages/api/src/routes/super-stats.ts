// `GET /api/super/stats` body (07 C12, PHASE_08 T8.10) from the hourly snapshots: the newest one as "now" (SLA rates
// and push success worked out here, not on the phone), and the last snapshot of each India day as the 30-day trend.
import type { SlaTally, StatsSnapshot } from '@mc/db/state';
import { calendarDateInZone } from '@mc/domain/time';
import type { SuperStats } from '@mc/shared/contracts';

const rate = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);
const tally = (t: SlaTally) => ({ onTime: t.onTime, late: t.late, rate: rate(t.onTime, t.onTime + t.late) });

/**
 * Builds the Stats answer.
 *
 * @param snapshots - newest first (as `listStatsSnapshots` returns them).
 * @returns `now: null` and an empty trend before the first snapshot.
 */
export function statsOut(snapshots: readonly StatsSnapshot[]): SuperStats {
  const newest = snapshots[0];
  const byDay = new Map<string, StatsSnapshot>();
  for (const snapshot of snapshots) {
    const day = calendarDateInZone(snapshot.at);
    if (!byDay.has(day)) byDay.set(day, snapshot); // newest first → the day's last snapshot wins
  }
  const trend = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, { counts }]) => ({
      day,
      activeMasjids: counts.masjids.active,
      devices: counts.devices.total,
      follows: counts.follows,
      pushSent: counts.push24h.sent,
      pushFailed: counts.push24h.failed,
    }));
  if (!newest) return { at: null, now: null, trend };
  const c = newest.counts;
  return {
    at: newest.at.toISOString(),
    now: {
      masjids: { ...c.masjids },
      devices: {
        total: c.devices.total,
        platform: { ...c.devices.platform },
        locale: { ...c.devices.locale },
        push: { ...c.devices.push },
      },
      follows: c.follows,
      push24h: { ...c.push24h, successRate: rate(c.push24h.sent, c.push24h.sent + c.push24h.failed) },
      ...(c.queues ? { queues: { ...c.queues } } : {}),
      ...(c.cloudinary
        ? {
            cloudinary: {
              usedPercent: c.cloudinary.usedPercent,
              ...(c.cloudinary.plan ? { plan: c.cloudinary.plan } : {}),
              ...(c.cloudinary.credits ? { credits: { ...c.cloudinary.credits } } : {}),
            },
          }
        : {}),
      sla: {
        reports: tally(c.sla.reports),
        grievanceAck: tally(c.sla.grievanceAck),
        grievanceResolve: tally(c.sla.grievanceResolve),
      },
    },
    trend,
  };
}
