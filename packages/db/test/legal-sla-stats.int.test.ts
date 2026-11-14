// PHASE_08 T8.3 / T8.4 / T8.5 / T8.10 in the data layer, as the real process users: grievances (public filing with a
// yearly sequential reference, Super Admin acknowledge / resolve / ★ contact read), the legal orders register (target
// resolution, status flow, action log, ★ document), the SLA timers the `sla-alerts` job reads (legal orders first,
// pending-only skip, upward-only marks) and the hourly stats snapshot (counts, deadline tallies, ameens, snapshots).
import { createHash, randomBytes } from 'node:crypto';

import type { UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { adminScope, deviceScope, publicScope, superScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, SEED_FOLLOW_CODES, seedId, seedPublicId, writeDevSeed } from '../src/seed/index.ts';
import {
  acknowledgeGrievance,
  computeStatsCounts,
  createGrievance,
  createLegalOrder,
  createReport,
  latestSnapshotForSystem,
  LEGAL_ORDER_LOG_MAX,
  listGrievances,
  listLegalOrders,
  listSlaTimers,
  listStatsSnapshots,
  markSlaAlerted,
  readGrievanceContact,
  readLegalOrderDocument,
  refreshAmeens7d,
  registerDevice,
  resolveGrievance,
  resolveLegalTarget,
  setLegalOrderDocument,
  snapshotHour,
  updateLegalOrder,
  writeStatsSnapshot,
} from '../src/state/index.ts';
import { linkRemovalToLegalOrder } from '../src/state/legal-orders.ts'; // used inside removeItem's transaction
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId } from '../src/values.ts';

const NOW = new Date('2026-11-13T06:30:00Z');
const HOUR = 3_600_000;
const ALPHA = seedId('masjid-alpha');
const SUPER = newId();
const stepped = () => superScope(SUPER, NOW);
const plain = () => superScope(SUPER);
const admin = () => adminScope({ adminId: newId(), masjids: [{ id: ALPHA, role: 'owner' }] });
/** A value of the sealed-contact shape (02 §2 grievances.contact_enc) — not real ciphertext; the data layer only stores it. */
const sealed = (ref: string) => `s1:test-key:${'A'.repeat(120)}:${'B'.repeat(16)}:${'C'.repeat(22)}${ref.slice(-1)}`;

let test: TestDatabase | undefined;
const handles: Partial<Record<'mc_admin' | 'mc_system' | 'mc_public', Awaited<ReturnType<typeof processUserHandle>>>> =
  {};
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const as = (user: 'mc_admin' | 'mc_system' | 'mc_public'): DbHandle => {
  const found = handles[user];
  if (!found) throw new Error(`no ${user} handle`);
  return found.handle;
};
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    throw error;
  }
};
const grievance = (now: Date, seal?: (ref: string) => string) =>
  createGrievance(as('mc_public'), publicScope(), {
    category: 'privacy',
    description: 'Placeholder grievance text',
    seal,
    ackDueAt: new Date(now.getTime() + 24 * HOUR),
    resolveDueAt: new Date(now.getTime() + 72 * HOUR),
    now,
  });
const grievanceId = async (publicRef: string): Promise<UUID> => {
  const doc = await t().db.collection<{ _id: UUID }>('grievances').findOne({ public_ref: publicRef });
  if (!doc) throw new Error(`no ${publicRef}`);
  return doc._id;
};
const order = (receivedAt: Date, target = { type: 'other' as const, id: 'Placeholder target' }) =>
  createLegalOrder(as('mc_admin'), stepped(), {
    authority: 'Placeholder authority',
    referenceNo: `REF-${randomBytes(3).toString('hex')}`,
    receivedAt,
    dueAt: new Date(receivedAt.getTime() + 3 * HOUR),
    target,
    summary: 'Placeholder summary',
    now: NOW,
  });
const device = () =>
  registerDevice(as('mc_public'), publicScope(), {
    secretHash: createHash('sha256').update(randomBytes(32)).digest(),
    locale: 'en',
    audiencePref: 'brothers',
    platform: 'android',
    privacyVersion: 'draft-1',
    now: NOW,
  });
const report = async (index: number, urgent: boolean, slaDueAt: Date) =>
  createReport(as('mc_public'), deviceScope(await device()), {
    target: { kind: 'item', publicId: seedPublicId('alpha', index) },
    reason: 'other',
    urgent,
    slaDueAt,
    now: NOW,
  });

beforeAll(async () => {
  test = await createTestDatabase('legal-sla-stats');
  await runMigrations(t().db, MIGRATIONS);
  for (const user of ['mc_admin', 'mc_system', 'mc_public'] as const) {
    handles[user] = await processUserHandle(t(), user);
  }
  await writeDevSeed(as('mc_system'), systemScope(), buildDevSeed({ now: NOW, today: '2026-11-13' }));
});

afterAll(async () => {
  for (const found of Object.values(handles)) await found.dispose();
  await test?.dispose();
});

describe('grievances', () => {
  it('only the public scope files one; references run per year in India (IST)', async () => {
    expect(
      await code(
        createGrievance(as('mc_admin'), plain(), {
          category: 'other',
          description: 'x',
          ackDueAt: NOW,
          resolveDueAt: NOW,
          now: NOW,
        }),
      ),
    ).toBe('FORBIDDEN');
    const first = await grievance(NOW);
    const second = await grievance(NOW, sealed);
    expect(first.publicRef).toBe('GR-2026-000001');
    expect(second.publicRef).toBe('GR-2026-000002');
    // 31 Dec 19:00 UTC is already 1 Jan in India → the new year's counter starts at 1.
    const newYear = await grievance(new Date('2026-12-31T19:00:00Z'));
    expect(newYear.publicRef).toBe('GR-2027-000001');
  });

  it('the tracker: Super Admin only, never the contact, unfinished first by due time', async () => {
    expect(await code(listGrievances(as('mc_admin'), admin()))).toBe('FORBIDDEN');
    const rows = await listGrievances(as('mc_admin'), plain());
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) expect(row).not.toHaveProperty('contact_enc');
    expect(rows.find((row) => row.publicRef === 'GR-2026-000002')?.hasContact).toBe(true);
    expect(rows.find((row) => row.publicRef === 'GR-2026-000001')?.hasContact).toBe(false);
    const dues = rows.map((row) => row.ackDueAt);
    expect(dues).toEqual([...dues].sort());
  });

  it('acknowledge → resolve / reject; finished ones sort last; repeats are refused', async () => {
    const one = await grievanceId('GR-2026-000001');
    expect(await code(acknowledgeGrievance(as('mc_admin'), admin(), { id: one, now: NOW }))).toBe('FORBIDDEN');
    await acknowledgeGrievance(as('mc_admin'), plain(), { id: one, now: NOW, requestId: 'req-ack' });
    expect(await code(acknowledgeGrievance(as('mc_admin'), plain(), { id: one, now: NOW }))).toBe(
      'GRIEVANCE_NOT_FOUND',
    );
    await resolveGrievance(as('mc_admin'), plain(), {
      id: one,
      status: 'resolved',
      resolution: 'Placeholder resolution',
      now: NOW,
      requestId: 'req-resolve',
    });
    expect(
      await code(resolveGrievance(as('mc_admin'), plain(), { id: one, status: 'rejected', resolution: 'x', now: NOW })),
    ).toBe('GRIEVANCE_NOT_FOUND');
    const rows = await listGrievances(as('mc_admin'), plain());
    const last = rows.at(-1);
    expect(last).toMatchObject({
      publicRef: 'GR-2026-000001',
      status: 'resolved',
      resolution: 'Placeholder resolution',
    });
    expect(last?.acknowledgedAt).toBe(NOW.toISOString());
    expect(last?.resolvedAt).toBe(NOW.toISOString());
    const audit = await t()
      .db.collection<{ action: string; target_id: string }>('audit_log')
      .find({ target_id: idText(one) })
      .toArray();
    expect(audit.map((entry) => entry.action).sort()).toEqual(['grievance.ack', 'grievance.resolve']);
  });

  it('★ contact: step-up, audited only when there is one', async () => {
    const withContact = await grievanceId('GR-2026-000002');
    const without = await grievanceId('GR-2027-000001');
    expect(await code(readGrievanceContact(as('mc_admin'), plain(), { id: withContact, now: NOW }))).toBe(
      'STEP_UP_REQUIRED',
    );
    expect(await code(readGrievanceContact(as('mc_admin'), stepped(), { id: newId(), now: NOW }))).toBe(
      'GRIEVANCE_NOT_FOUND',
    );
    expect(await readGrievanceContact(as('mc_admin'), stepped(), { id: without, now: NOW })).toBeNull();
    const read = await readGrievanceContact(as('mc_admin'), stepped(), { id: withContact, now: NOW, requestId: 'r' });
    expect(read).toEqual({ publicRef: 'GR-2026-000002', sealed: sealed('GR-2026-000002') });
    const audit = await t()
      .db.collection<{ action: string; target_id: string }>('audit_log')
      .find({ action: 'grievance.contact' })
      .toArray();
    expect(audit.map((entry) => entry.target_id)).toEqual([idText(withContact)]);
  });
});

describe('legal orders', () => {
  it('resolves a target: a post by link / public id / id, a masjid by follow code (any case, with a dash) / id', async () => {
    const publicId = seedPublicId('alpha', 1);
    const item = await t().db.collection<{ _id: UUID }>('items').findOne({ public_id: publicId });
    if (!item) throw new Error('no seed item');
    const resolve = (type: 'items' | 'masjids' | 'other', ref: string) =>
      resolveLegalTarget(as('mc_admin'), plain(), { type, ref });
    expect(await code(resolveLegalTarget(as('mc_admin'), admin(), { type: 'other', ref: 'x' }))).toBe('FORBIDDEN');
    const asItem = { type: 'items', id: idText(item._id) };
    expect(await resolve('items', `https://example.test/p/${publicId}?utm=x`)).toEqual(asItem);
    expect(await resolve('items', publicId)).toEqual(asItem);
    expect(await resolve('items', idText(item._id))).toEqual(asItem);
    expect(await code(resolve('items', 'not a post'))).toBe('LEGAL_TARGET_NOT_FOUND');
    expect(await code(resolve('items', 'zzzzzzzzzzzz'))).toBe('LEGAL_TARGET_NOT_FOUND');
    const asMasjid = { type: 'masjids', id: idText(ALPHA) };
    const followCode = SEED_FOLLOW_CODES.alpha;
    expect(await resolve('masjids', `${followCode.slice(0, 4).toLowerCase()}-${followCode.slice(4)}`)).toEqual(
      asMasjid,
    );
    expect(await resolve('masjids', idText(ALPHA))).toEqual(asMasjid);
    expect(await code(resolve('masjids', '??'))).toBe('LEGAL_TARGET_NOT_FOUND');
    expect(await code(resolve('masjids', idText(newId())))).toBe('LEGAL_TARGET_NOT_FOUND');
    expect(await resolve('other', `  ${'x'.repeat(80)}  `)).toEqual({ type: 'other', id: 'x'.repeat(64) });
  });

  it('create: stepped-up Super Admin only; the register lists open by due time, closed last; no document key', async () => {
    const input = {
      authority: 'a',
      referenceNo: 'r',
      receivedAt: NOW,
      dueAt: NOW,
      target: { type: 'other' as const, id: 'x' },
      summary: 's',
      now: NOW,
    };
    expect(await code(createLegalOrder(as('mc_admin'), admin(), input))).toBe('FORBIDDEN');
    expect(await code(createLegalOrder(as('mc_admin'), plain(), input))).toBe('STEP_UP_REQUIRED');
    const later = await order(new Date(NOW.getTime() - HOUR));
    const earlier = await order(new Date(NOW.getTime() - 2 * HOUR));
    const closedOne = await order(new Date(NOW.getTime() - 5 * HOUR));
    await updateLegalOrder(as('mc_admin'), stepped(), { id: closedOne.id, status: 'closed', now: NOW });
    expect(await code(listLegalOrders(as('mc_admin'), admin()))).toBe('FORBIDDEN');
    const rows = await listLegalOrders(as('mc_admin'), plain());
    const ids = rows.map((row) => row.id);
    expect(ids.indexOf(idText(earlier.id))).toBeLessThan(ids.indexOf(idText(later.id)));
    expect(rows.at(-1)?.id).toBe(idText(closedOne.id));
    const row = rows.find((entry) => entry.id === idText(later.id));
    expect(row).toMatchObject({ status: 'received', hasDocument: false, targetType: 'other' });
    expect(row?.actionLog.map((entry) => entry.note)).toEqual(['Order recorded']);
    expect(JSON.stringify(rows)).not.toContain('document_key');
  });

  it('update: the status flow, action taken and notes are logged; closed is final', async () => {
    const { id } = await order(NOW);
    const update = (input: Omit<Parameters<typeof updateLegalOrder>[2], 'id' | 'now'>) =>
      updateLegalOrder(as('mc_admin'), stepped(), { id, now: NOW, ...input });
    expect(await code(updateLegalOrder(as('mc_admin'), plain(), { id, status: 'actioned', now: NOW }))).toBe(
      'STEP_UP_REQUIRED',
    );
    expect(await code(update({}))).toBe('NOTHING_TO_UPDATE');
    expect(await code(updateLegalOrder(as('mc_admin'), stepped(), { id: newId(), note: 'x', now: NOW }))).toBe(
      'LEGAL_ORDER_NOT_FOUND',
    );
    expect(await update({ status: 'contested', note: 'Placeholder note', requestId: 'req' })).toEqual({
      status: 'contested',
    });
    expect(await code(update({ status: 'received' }))).toBe('INVALID_TRANSITION');
    expect(await update({ actionTaken: 'Placeholder action' })).toEqual({ status: 'contested' });
    expect(await update({ status: 'closed' })).toEqual({ status: 'closed' });
    expect(await code(update({ note: 'after close' }))).toBe('INVALID_TRANSITION');
    const row = (await listLegalOrders(as('mc_admin'), plain())).find((entry) => entry.id === idText(id));
    expect(row?.actionTaken).toBe('Placeholder action');
    expect(row?.actionLog.map((entry) => entry.note)).toEqual([
      'Order recorded',
      'Status: received → contested',
      'Placeholder note',
      'Action taken updated',
      'Status: contested → closed',
    ]);
  });

  it('the action log is bounded (200)', async () => {
    const { id } = await order(NOW);
    const log = Array.from({ length: LEGAL_ORDER_LOG_MAX }, () => ({ at: NOW, by: SUPER, note: 'x' }));
    await t()
      .db.collection<{ _id: UUID }>('legal_orders')
      .updateOne({ _id: id }, { $set: { action_log: log } });
    expect(await code(updateLegalOrder(as('mc_admin'), stepped(), { id, note: 'one more', now: NOW }))).toBe(
      'LEGAL_ORDER_LOG_FULL',
    );
  });

  it('a takedown linked to an order logs the post and stops a received order’s clock', async () => {
    const received = await order(NOW);
    const contested = await order(NOW);
    await updateLegalOrder(as('mc_admin'), stepped(), { id: contested.id, status: 'contested', now: NOW });
    const db = await as('mc_admin').db();
    const link = (orderId: UUID) =>
      linkRemovalToLegalOrder(
        { scope: stepped(), db },
        { orderId, adminId: SUPER, publicId: 'seedA0000009', now: NOW },
      );
    await link(received.id);
    await link(contested.id);
    const rows = await listLegalOrders(as('mc_admin'), plain());
    expect(rows.find((row) => row.id === idText(received.id))?.status).toBe('actioned');
    expect(rows.find((row) => row.id === idText(contested.id))?.status).toBe('contested');
    expect(rows.find((row) => row.id === idText(received.id))?.actionLog.at(-1)?.note).toBe(
      'Post seedA0000009 removed',
    );
    await updateLegalOrder(as('mc_admin'), stepped(), { id: received.id, status: 'closed', now: NOW });
    expect(await code(link(received.id))).toBe('LEGAL_ORDER_NOT_FOUND');
  });

  it('★ document: set returns the replaced key; read is audited; a closed order keeps its document', async () => {
    const { id } = await order(NOW);
    const set = (key: string) => setLegalOrderDocument(as('mc_admin'), stepped(), { id, key, now: NOW });
    const read = () => readLegalOrderDocument(as('mc_admin'), stepped(), { id, now: NOW, requestId: 'req' });
    expect(await code(setLegalOrderDocument(as('mc_admin'), plain(), { id, key: 'k', now: NOW }))).toBe(
      'STEP_UP_REQUIRED',
    );
    expect(await code(read())).toBe('LEGAL_ORDER_NOT_FOUND');
    expect(await set('legal/one.bin')).toEqual({});
    expect(
      await setLegalOrderDocument(as('mc_admin'), stepped(), { id, key: 'legal/two.bin', now: NOW, requestId: 'r' }),
    ).toEqual({ replaced: 'legal/one.bin' });
    expect(await read()).toMatchObject({ key: 'legal/two.bin' });
    expect(await code(readLegalOrderDocument(as('mc_admin'), plain(), { id, now: NOW }))).toBe('STEP_UP_REQUIRED');
    const row = (await listLegalOrders(as('mc_admin'), plain())).find((entry) => entry.id === idText(id));
    expect(row?.hasDocument).toBe(true);
    await updateLegalOrder(as('mc_admin'), stepped(), { id, status: 'closed', now: NOW });
    expect(await code(set('legal/three.bin'))).toBe('LEGAL_ORDER_NOT_FOUND');
    expect(await read()).toMatchObject({ key: 'legal/two.bin' });
    const audit = await t()
      .db.collection<{ action: string; target_id: string }>('audit_log')
      .find({ target_id: idText(id) })
      .toArray();
    const actions = audit.map((entry) => entry.action);
    expect(actions.filter((action) => action === 'legal_order.document')).toHaveLength(2);
    expect(actions.filter((action) => action === 'legal_order.document_read')).toHaveLength(2);
  });
});

describe('SLA timers', () => {
  it('system or Super Admin only; legal orders first, then grievances and reports by due time', async () => {
    expect(await code(listSlaTimers(as('mc_admin'), admin()))).toBe('FORBIDDEN');
    await report(2, true, new Date(NOW.getTime() + 2 * HOUR));
    await report(3, false, new Date(NOW.getTime() + 36 * HOUR));
    // An acknowledged grievance runs on its resolve clock, from the acknowledgement.
    const two = await grievanceId('GR-2026-000002');
    await acknowledgeGrievance(as('mc_admin'), plain(), { id: two, now: NOW });
    const timers = await listSlaTimers(as('mc_system'), systemScope());
    const kinds = timers.map((timer) => timer.kind);
    const firstOther = kinds.findIndex((kind) => kind !== 'legal_order');
    expect(kinds.slice(0, firstOther).every((kind) => kind === 'legal_order')).toBe(true);
    expect(kinds.slice(firstOther)).not.toContain('legal_order');
    expect(new Set(kinds)).toEqual(
      new Set(['legal_order', 'grievance_ack', 'grievance_resolve', 'urgent_report', 'report']),
    );
    const rest = timers.slice(firstOther).map((timer) => timer.dueAt.getTime());
    expect(rest).toEqual([...rest].sort((a, b) => a - b));
    const reportTimer = timers.find((timer) => timer.kind === 'urgent_report');
    expect(reportTimer?.masjidId && idText(reportTimer.masjidId)).toBe(idText(ALPHA));
    expect(timers.every((timer) => timer.alerted === 0)).toBe(true);
    const resolveTimer = (await listSlaTimers(as('mc_admin'), plain())).find(
      (timer) => idText(timer.id) === idText(two),
    );
    expect(resolveTimer).toMatchObject({ kind: 'grievance_resolve', startAt: NOW });
  });

  it('marks only go up; fully alerted timers are skipped by the job, never by the dashboard', async () => {
    const timers = await listSlaTimers(as('mc_system'), systemScope());
    const pick = (kind: string) => {
      const found = timers.find((timer) => timer.kind === kind);
      if (!found) throw new Error(`no ${kind} timer`);
      return found;
    };
    const picked = [pick('legal_order'), pick('grievance_ack'), pick('grievance_resolve'), pick('report')];
    expect(await code(markSlaAlerted(as('mc_admin'), plain(), picked[0] ?? pick('report'), 50))).toBe('FORBIDDEN');
    for (const timer of picked) {
      await markSlaAlerted(as('mc_system'), systemScope(), timer, 100);
      await markSlaAlerted(as('mc_system'), systemScope(), timer, 50); // never lowers it
    }
    const all = await listSlaTimers(as('mc_admin'), plain());
    for (const timer of picked) {
      expect(all.find((entry) => idText(entry.id) === idText(timer.id))?.alerted).toBe(100);
    }
    const pending = await listSlaTimers(as('mc_system'), systemScope(), { pendingAlertsOnly: true });
    const pendingIds = new Set(pending.map((timer) => idText(timer.id)));
    for (const timer of picked) expect(pendingIds.has(idText(timer.id))).toBe(false);
    expect(pending.length).toBe(all.length - picked.length);
  });
});

describe('stats snapshots', () => {
  it('system only for the job’s reads and writes; Super Admin only for the screen', async () => {
    expect(await code(computeStatsCounts(as('mc_admin'), plain(), NOW))).toBe('FORBIDDEN');
    expect(await code(refreshAmeens7d(as('mc_admin'), plain(), NOW))).toBe('FORBIDDEN');
    expect(await code(latestSnapshotForSystem(as('mc_admin'), plain()))).toBe('FORBIDDEN');
    expect(await code(listStatsSnapshots(as('mc_system'), systemScope(), { since: NOW }))).toBe('FORBIDDEN');
    expect(
      await code(
        writeStatsSnapshot(as('mc_admin'), plain(), {
          now: NOW,
          counts: await computeStatsCounts(as('mc_system'), systemScope(), NOW),
        }),
      ),
    ).toBe('FORBIDDEN');
  });

  it('counts masjids, devices, follows, push and the deadlines met (late = done after due or open past it)', async () => {
    const late = await report(4, false, new Date(NOW.getTime() - HOUR)); // still open, past due
    expect(late).toBeDefined();
    const counts = await computeStatsCounts(as('mc_system'), systemScope(), NOW);
    const masjids = await t().db.collection('masjids').countDocuments();
    expect(Object.values(counts.masjids).reduce((sum, n) => sum + n, 0)).toBe(masjids);
    const devices = await t().db.collection('devices').countDocuments();
    expect(counts.devices.total).toBe(devices);
    expect(Object.values(counts.devices.platform).reduce((sum, n) => sum + n, 0)).toBe(devices);
    expect(counts.devices.platform.android).toBeGreaterThanOrEqual(1);
    expect(Object.values(counts.devices.locale).reduce((sum, n) => sum + n, 0)).toBe(devices);
    expect(counts.follows).toBe(await t().db.collection('device_follows').countDocuments());
    expect(counts.push24h.jobs).toBeGreaterThanOrEqual(0);
    expect(counts.sla.reports.late).toBeGreaterThanOrEqual(1);
    // GR-2026-000001 was acknowledged and resolved at NOW, before both due times; the 2027 one is not due yet.
    expect(counts.sla.grievanceAck.onTime).toBeGreaterThanOrEqual(2);
    expect(counts.sla.grievanceResolve.onTime).toBeGreaterThanOrEqual(1);
    // A day after every resolve deadline, the unanswered ones are late.
    const later = await computeStatsCounts(as('mc_system'), systemScope(), new Date(NOW.getTime() + 96 * HOUR));
    expect(later.sla.grievanceResolve.late).toBeGreaterThanOrEqual(1);
  });

  it('ameens of the last 7 days: only changed masjids are written', async () => {
    const first = await refreshAmeens7d(as('mc_system'), systemScope(), NOW);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(await refreshAmeens7d(as('mc_system'), systemScope(), NOW)).toBe(0);
    const stats = await t().db.collection<{ _id: UUID; ameens_7d: number }>('masjid_stats').findOne({ _id: ALPHA });
    expect(stats?.ameens_7d).toBe(
      await t()
        .db.collection('ameens')
        .countDocuments({
          masjid_id: ALPHA,
          created_at: { $gte: new Date(NOW.getTime() - 7 * 24 * HOUR) },
        }),
    );
  });

  it('one snapshot per hour (a re-run replaces it); the screen reads the newest first since a time', async () => {
    const counts = await computeStatsCounts(as('mc_system'), systemScope(), NOW);
    expect(await latestSnapshotForSystem(as('mc_system'), systemScope())).toBeNull();
    const earlier = new Date(NOW.getTime() - 2 * HOUR);
    expect(await writeStatsSnapshot(as('mc_system'), systemScope(), { now: earlier, counts })).toBe(
      snapshotHour(earlier),
    );
    const hour = await writeStatsSnapshot(as('mc_system'), systemScope(), { now: NOW, counts });
    await writeStatsSnapshot(as('mc_system'), systemScope(), {
      now: new Date(NOW.getTime() + 60_000),
      counts: { ...counts, follows: counts.follows + 1 },
    });
    expect(hour).toBe('2026-11-13T06');
    expect(await t().db.collection('stats_snapshots').countDocuments()).toBe(2);
    const latest = await latestSnapshotForSystem(as('mc_system'), systemScope());
    expect(latest).toMatchObject({ hour, counts: { follows: counts.follows + 1 } });
    const all = await listStatsSnapshots(as('mc_admin'), plain(), { since: new Date(NOW.getTime() - 24 * HOUR) });
    expect(all.map((snap) => snap.hour)).toEqual([hour, snapshotHour(earlier)]);
    const recent = await listStatsSnapshots(as('mc_admin'), plain(), { since: new Date(NOW.getTime() - HOUR) });
    expect(recent.map((snap) => snap.hour)).toEqual([hour]);
  });
});
