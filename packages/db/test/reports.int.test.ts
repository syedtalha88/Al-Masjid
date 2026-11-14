// PHASE_08 T8.1 — reports as the real process users: a device (mc_public) reports a published post or an active masjid;
// unknown, hidden or non-public targets are refused; the device id is stored (and later unset by retention) but no
// report can be read back by mc_public; `report-triage` (mc_system) lists untriaged reports once, counts distinct
// reporters in a window and auto-hides a post exactly once (status `hidden`, version bump, `item.autohide` audit).
import { createHash, randomBytes } from 'node:crypto';

import type { Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getPublicItem } from '../src/repos/index.ts';
import { deviceScope, publicScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, seedPublicId, writeDevSeed } from '../src/seed/index.ts';
import {
  autoHideItem,
  countRecentReporters,
  createReport,
  listUntriagedReports,
  markReportsTriaged,
  readAutohideThreshold,
  registerDevice,
  type ReportInput,
} from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { newId } from '../src/values.ts';

const NOW = new Date('2026-11-13T06:30:00Z');
const TODAY = '2026-11-13';
const ALPHA = seedId('masjid-alpha');
const HOUR = 60 * 60 * 1000;

let test: TestDatabase | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const pub = (): DbHandle => {
  if (!asPublic) throw new Error('no mc_public handle');
  return asPublic.handle;
};
const sys = (): DbHandle => {
  if (!asSystem) throw new Error('no mc_system handle');
  return asSystem.handle;
};
const raw = (name: string) => t().db.collection<{ _id: UUID | string } & Record<string, unknown>>(name);
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    throw error;
  }
};
const newDevice = async () =>
  registerDevice(pub(), publicScope(), {
    secretHash: createHash('sha256').update(randomBytes(32)).digest(),
    locale: 'en',
    audiencePref: 'brothers',
    platform: 'android',
    privacyVersion: 'draft-1',
    now: NOW,
  });
const version = async (id: UUID) => {
  const masjid = await raw('masjids').findOne({ _id: id }, { promoteLongs: false });
  return (masjid?.['content_version'] as Long).toNumber(); // int64 by schema
};
const itemReport = (publicId: string, overrides: Partial<ReportInput> = {}): ReportInput => ({
  target: { kind: 'item', publicId },
  reason: 'misleading',
  urgent: false,
  slaDueAt: new Date(NOW.getTime() + 36 * HOUR),
  now: NOW,
  ...overrides,
});

beforeAll(async () => {
  test = await createTestDatabase('reports-state');
  await runMigrations(t().db, MIGRATIONS);
  asSystem = await processUserHandle(t(), 'mc_system');
  asPublic = await processUserHandle(t(), 'mc_public');
  await writeDevSeed(asSystem.handle, systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  await asSystem?.dispose();
  await asPublic?.dispose();
  await test?.dispose();
});

describe('createReport (device)', () => {
  it('stores a post report with its masjid, reason, details, urgency and due time', async () => {
    const device = await newDevice();
    const id = await createReport(
      pub(),
      deviceScope(device),
      itemReport(seedPublicId('alpha', 0), {
        reason: 'private_info',
        details: 'Placeholder details',
        urgent: true,
        slaDueAt: new Date(NOW.getTime() + 2 * HOUR),
      }),
    );
    const doc = await raw('reports').findOne({ _id: id });
    expect(doc).toMatchObject({
      target_type: 'item',
      reason: 'private_info',
      details: 'Placeholder details',
      urgent: true,
      status: 'open',
      sla_due_at: new Date(NOW.getTime() + 2 * HOUR),
      created_at: NOW,
    });
    expect(String(doc?.['masjid_id'])).toBe(String(ALPHA));
    expect(String(doc?.['device_id'])).toBe(String(device));
    expect(doc).not.toHaveProperty('triaged_at');
  });

  it('stores a masjid report against the masjid itself', async () => {
    const device = await newDevice();
    const id = await createReport(pub(), deviceScope(device), {
      ...itemReport(''),
      target: { kind: 'masjid', masjidId: ALPHA },
      reason: 'fraud',
    });
    const doc = await raw('reports').findOne({ _id: id });
    expect(doc).toMatchObject({ target_type: 'masjid', reason: 'fraud' });
    expect(String(doc?.['target_id'])).toBe(String(ALPHA));
    expect(doc).not.toHaveProperty('details');
  });

  it('refuses unknown targets and anything but a device', async () => {
    const device = await newDevice();
    expect(await code(createReport(pub(), deviceScope(device), itemReport('seedZ0000000')))).toBe('TARGET_NOT_FOUND');
    expect(
      await code(
        createReport(pub(), deviceScope(device), {
          ...itemReport(''),
          target: { kind: 'masjid', masjidId: newId() },
        }),
      ),
    ).toBe('TARGET_NOT_FOUND');
    expect(await code(createReport(pub(), publicScope(), itemReport(seedPublicId('alpha', 0))))).toBe('FORBIDDEN');
    expect(await code(createReport(sys(), systemScope(), itemReport(seedPublicId('alpha', 0))))).toBe('FORBIDDEN');
  });

  it('mc_public can insert reports but never read them back', async () => {
    await expect((await pub().db()).collection('reports').findOne({})).rejects.toThrow(/not authorized/u);
  });
});

describe('report-triage state (system)', () => {
  it('lists untriaged open reports once; marking twice changes nothing', async () => {
    const device = await newDevice();
    const id = await createReport(pub(), deviceScope(device), itemReport(seedPublicId('alpha', 1)));
    const first = await listUntriagedReports(sys(), systemScope());
    expect(first.some((report) => String(report.id) === String(id))).toBe(true);
    const ids = first.map((report) => report.id);
    expect(await markReportsTriaged(sys(), systemScope(), ids, NOW)).toBe(ids.length);
    expect(await markReportsTriaged(sys(), systemScope(), ids, NOW)).toBe(0);
    expect(await listUntriagedReports(sys(), systemScope())).toEqual([]);
    expect(await code(listUntriagedReports(pub(), deviceScope(device)))).toBe('FORBIDDEN');
    expect(await code(markReportsTriaged(pub(), deviceScope(device), ids, NOW))).toBe('FORBIDDEN');
  });

  it('counts distinct devices within the window, not reports', async () => {
    const publicId = seedPublicId('alpha', 2);
    const [a, b] = [await newDevice(), await newDevice()];
    await createReport(pub(), deviceScope(a), itemReport(publicId));
    await createReport(pub(), deviceScope(a), itemReport(publicId, { reason: 'other' }));
    await createReport(pub(), deviceScope(b), itemReport(publicId, { now: new Date(NOW.getTime() - 2 * HOUR) }));
    const item = await raw('items').findOne({ public_id: publicId });
    const itemId = item?._id as UUID; // seeded
    expect(await countRecentReporters(sys(), systemScope(), itemId, new Date(NOW.getTime() - HOUR))).toBe(1);
    expect(await countRecentReporters(sys(), systemScope(), itemId, new Date(NOW.getTime() - 3 * HOUR))).toBe(2);
  });

  it('auto-hides a published post exactly once: hidden, version bumped, gone from the public view, audited', async () => {
    const publicId = seedPublicId('alpha', 3);
    const item = await raw('items').findOne({ public_id: publicId });
    const itemId = item?._id as UUID; // seeded
    const before = await version(ALPHA);
    expect(await autoHideItem(sys(), systemScope(), { itemId, reporters: 10, now: NOW })).toMatchObject({
      result: 'hidden',
      hiddenAt: NOW,
    });
    expect(await raw('items').findOne({ _id: itemId })).toMatchObject({ status: 'hidden', hidden_at: NOW });
    expect(await version(ALPHA)).toBe(before + 1);
    expect(await getPublicItem(pub(), publicId, ['everyone', 'brothers', 'sisters'])).toBeNull();
    // Unchanged — still with its target and the time of this hide, so a repeat run purges the CDN again under the
    // same job ids (security review M4, re-review N-L2).
    const later = new Date(NOW.getTime() + 60_000);
    expect(await autoHideItem(sys(), systemScope(), { itemId, reporters: 12, now: later })).toEqual({
      result: 'unchanged',
      status: 'hidden',
      target: { publicId, masjidId: ALPHA },
      hiddenAt: NOW,
    });
    expect(await version(ALPHA)).toBe(before + 1);
    const audits = await raw('audit_log').find({ action: 'item.autohide' }).toArray();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_type: 'system', meta: { reporters: 10 } });
    // A hidden post cannot be reported again (not public).
    expect(await code(createReport(pub(), deviceScope(await newDevice()), itemReport(publicId)))).toBe(
      'TARGET_NOT_FOUND',
    );
  });

  it('reads the threshold from settings (the validator keeps it set — default 10)', async () => {
    expect(await readAutohideThreshold(sys(), systemScope(), 99)).toBe(10);
    await raw('app_settings').updateOne({ _id: 'global' }, { $set: { report_autohide_threshold: 4 } });
    expect(await readAutohideThreshold(sys(), systemScope(), 99)).toBe(4);
    await raw('app_settings').updateOne({ _id: 'global' }, { $set: { report_autohide_threshold: 10 } });
    expect(await code(readAutohideThreshold(pub(), publicScope(), 10))).toBe('FORBIDDEN');
  });
});
