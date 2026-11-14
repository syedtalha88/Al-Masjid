// PHASE_08 T8.10 — the pure parts of Stats: Cloudinary's usage answer (credits when the plan reports them, else the
// highest of storage / bandwidth / transformations), the reader's request (fixed host, Basic auth, status-only errors),
// the 70 / 90 % crossings, and the Stats answer from snapshots (rates, one trend point per India day).
import type { StatsCounts, StatsSnapshot } from '@mc/db/state';
import { describe, expect, it } from 'vitest';

import { crossedThresholds } from '../src/jobs/stats/snapshot.ts';
import { cloudinaryUsageReader, parseCloudinaryUsage } from '../src/media/usage.ts';
import { statsOut } from '../src/routes/super-stats.ts';

describe('Cloudinary usage', () => {
  it('uses credits when the plan reports them', () => {
    expect(
      parseCloudinaryUsage({
        plan: 'Plus',
        credits: { usage: 18.756, limit: 25, used_percent: 75.024 },
        storage: { usage: 1, used_percent: 3 },
      }),
    ).toEqual({ usedPercent: 75.02, credits: { usage: 18.756, limit: 25 }, plan: 'Plus' });
  });

  it('without credits: the highest of storage, bandwidth and transformations (the documented sample shape)', () => {
    expect(
      parseCloudinaryUsage({
        plan: 'Basic',
        last_updated: '2026-11-12',
        transformations: { usage: 10151688, limit: 40003000, used_percent: 25.38 },
        bandwidth: { usage: 1, limit: 2, used_percent: 41.2 },
        storage: { usage: 1, limit: 2, used_percent: 7 },
        requests: 12,
      }),
    ).toEqual({ usedPercent: 41.2, plan: 'Basic' });
    expect(parseCloudinaryUsage({})).toEqual({ usedPercent: 0 });
  });

  it('refuses an answer that is not usage', () => {
    expect(() => parseCloudinaryUsage({ credits: { usage: 'x' } })).toThrow();
    expect(() => parseCloudinaryUsage('nope')).toThrow();
  });

  it('the reader calls the fixed Admin API host with Basic auth; errors carry the status only', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    let answer = Response.json({ credits: { usage: 1, limit: 25, used_percent: 4 } });
    const fakeFetch: typeof fetch = (input, init) => {
      calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
      return Promise.resolve(answer);
    };
    const read = cloudinaryUsageReader({ cloudName: 'test-cloud', apiKey: 'k1', apiSecret: 's1', fetch: fakeFetch });
    expect(await read()).toEqual({ usedPercent: 4, credits: { usage: 1, limit: 25 } });
    expect(calls[0]?.url).toBe('https://api.cloudinary.com/v1_1/test-cloud/usage');
    expect(new Headers(calls[0]?.init?.headers).get('Authorization')).toBe(`Basic ${btoa('k1:s1')}`);
    expect(calls[0]?.init?.redirect).toBe('error');

    answer = new Response('{"error":{"message":"secret detail"}}', { status: 401 });
    await expect(read()).rejects.toThrow(/^cloudinary usage failed with HTTP 401$/);
  });
});

describe('Cloudinary thresholds', () => {
  it('alerts on crossing only', () => {
    expect(crossedThresholds(undefined, 10)).toEqual([]);
    expect(crossedThresholds(undefined, 95)).toEqual([70, 90]);
    expect(crossedThresholds(60, 75)).toEqual([70]);
    expect(crossedThresholds(75, 80)).toEqual([]);
    expect(crossedThresholds(80, 91)).toEqual([90]);
    expect(crossedThresholds(95, 3)).toEqual([]); // a new month
  });
});

const counts = (over: { active: number; devices: number; sent?: number; failed?: number }): StatsCounts => ({
  masjids: { pending: 1, active: over.active, suspended: 0, deleted: 0 },
  devices: {
    total: over.devices,
    platform: { android: over.devices, ios: 0, desktop: 0, other: 0 },
    locale: { en: over.devices, hi: 0, ur: 0, te: 0 },
    push: { active: over.devices, dead: 0, none: 0 },
  },
  follows: over.devices * 2,
  push24h: { jobs: 1, sent: over.sent ?? 0, failed: over.failed ?? 0 },
  sla: {
    reports: { onTime: 3, late: 1 },
    grievanceAck: { onTime: 0, late: 0 },
    grievanceResolve: { onTime: 1, late: 0 },
  },
});
const snap = (iso: string, c: StatsCounts): StatsSnapshot => ({ hour: iso.slice(0, 13), at: new Date(iso), counts: c });

describe('statsOut', () => {
  it('before the first snapshot: nothing, no trend', () => {
    expect(statsOut([])).toEqual({ at: null, now: null, trend: [] });
  });

  it('now = the newest; rates worked out; one trend point per India day (its last snapshot), oldest first', () => {
    const out = statsOut([
      // newest first; 2026-11-13T19:00Z is already 14 Nov in India
      snap('2026-11-13T19:00:00.000Z', counts({ active: 5, devices: 40, sent: 9, failed: 1 })),
      snap('2026-11-13T17:00:00.000Z', counts({ active: 4, devices: 30 })),
      snap('2026-11-13T06:00:00.000Z', counts({ active: 3, devices: 20 })),
      snap('2026-11-12T06:00:00.000Z', counts({ active: 2, devices: 10 })),
    ]);
    expect(out.at).toBe('2026-11-13T19:00:00.000Z');
    expect(out.now?.push24h).toEqual({ jobs: 1, sent: 9, failed: 1, successRate: 0.9 });
    expect(out.now?.sla.reports).toEqual({ onTime: 3, late: 1, rate: 0.75 });
    expect(out.now?.sla.grievanceAck.rate).toBeNull();
    expect(out.trend.map((p) => [p.day, p.activeMasjids, p.devices])).toEqual([
      ['2026-11-12', 2, 10],
      ['2026-11-13', 4, 30],
      ['2026-11-14', 5, 40],
    ]);
  });
});
