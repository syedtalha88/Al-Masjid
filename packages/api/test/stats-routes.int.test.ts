// PHASE_08 T8.10 — `GET /api/super/stats` (07 C12): empty before the first snapshot; then the newest snapshot as "now"
// (rates worked out) and a per-day trend of the last 30 days only; Super Admin only; aggregates only.
import { superStatsSchema } from '@mc/shared/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { CSRF, superHarness } from './super-harness.ts';

const NOW = new Date('2026-11-13T08:00:00Z');
const harness = superHarness('stats_routes', NOW);
const { app, asSuper, register, db } = harness;

const counts = (active: number, devices: number) => ({
  masjids: { pending: 1, active, suspended: 0, deleted: 0 },
  devices: {
    total: devices,
    platform: { android: devices, ios: 0, desktop: 0, other: 0 },
    locale: { en: devices, hi: 0, ur: 0, te: 0 },
    push: { active: devices, dead: 0, none: 0 },
  },
  follows: devices,
  push24h: { jobs: 2, sent: 8, failed: 2 },
  queues: { waiting: 1, active: 0, delayed: 0, failed: 0, lagS: 4 },
  cloudinary: { usedPercent: 12.5, plan: 'Plus' },
  sla: {
    reports: { onTime: 9, late: 1 },
    grievanceAck: { onTime: 0, late: 0 },
    grievanceResolve: { onTime: 2, late: 0 },
  },
});
const snapshot = (at: string, active: number, devices: number) => ({
  _id: at.slice(0, 13),
  counts: counts(active, devices),
  created_at: new Date(at),
});

let adminCookie = '';
beforeAll(async () => {
  const created = await asSuper('post', '/masjids').send({
    name: 'Test Masjid Stats',
    area: 'Test Area',
    city: 'Hyderabad',
    state: 'Telangana',
    address: 'Test address',
    lat: 17.385,
    lng: 78.4867,
  });
  const admin = await asSuper('post', '/admins').send({
    displayName: 'Test Admin',
    uiLocale: 'en',
    masjidId: (created.body as { id: string }).id,
    role: 'owner',
  });
  adminCookie = await register((admin.body as { inviteUrl: string }).inviteUrl);
});

describe('GET /stats (T8.10)', () => {
  it('before the first snapshot: nothing yet', async () => {
    const response = await asSuper('get', '/stats');
    expect(response.status).toBe(200);
    expect(superStatsSchema.parse(response.body)).toEqual({ at: null, now: null, trend: [] });
  });

  it('the newest snapshot is "now"; the trend has one point per India day within 30 days', async () => {
    await db()
      .collection<{ _id: string }>('stats_snapshots')
      .insertMany([
        snapshot('2026-09-01T06:05:00.000Z', 1, 1), // older than 30 days: left out
        snapshot('2026-11-12T06:05:00.000Z', 2, 10),
        snapshot('2026-11-13T05:05:00.000Z', 3, 20),
        snapshot('2026-11-13T07:05:00.000Z', 4, 30),
      ]);
    const stats = superStatsSchema.parse((await asSuper('get', '/stats')).body);
    expect(stats.at).toBe('2026-11-13T07:05:00.000Z');
    expect(stats.now?.masjids.active).toBe(4);
    expect(stats.now?.push24h.successRate).toBe(0.8);
    expect(stats.now?.sla.reports.rate).toBe(0.9);
    expect(stats.now?.sla.grievanceAck.rate).toBeNull();
    expect(stats.now?.queues?.lagS).toBe(4);
    expect(stats.now?.cloudinary).toEqual({ usedPercent: 12.5, plan: 'Plus' });
    expect(stats.trend.map((p) => [p.day, p.activeMasjids])).toEqual([
      ['2026-11-12', 2],
      ['2026-11-13', 4],
    ]);
  });

  it('only the Super Admin', async () => {
    const response = await request(app()).get('/api/super/stats').set('Cookie', adminCookie).set(CSRF);
    expect(response.status).toBe(403);
  });
});
