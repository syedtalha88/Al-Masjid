// PHASE_08 T8.3 — the `sla-alerts` job as mc_system with a controlled clock (05 §3 timers): an urgent report (2 h)
// alerts once at 1 h (50 %), once at 1 h 36 (80 %), once at 2 h (100 %) and never again; a normal report (36 h) only
// at its own thresholds; a timer that jumped thresholds while the worker was down alerts once, at the highest; a
// closed report stops alerting; a flood of reports never pushes a legal order or a grievance out of the job (#180 M3).
import { createHash, randomBytes } from 'node:crypto';

import { deviceScope, idText, newId, publicScope } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { seedPublicId } from '@mc/db/seed';
import { createGrievance, createReport, registerDevice, type ReportReasonValue, SLA_TIMERS_MAX } from '@mc/db/state';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { ManualClock } from '@mc/shared/clock';
import { reportSla } from '@mc/shared/compliance';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { processSlaAlerts } from '../src/jobs/reports/sla-alerts.ts';
import { runDevSeed } from '../src/jobs/seed.ts';
import type { JobQueues } from '../src/queue/queues.ts';
import { silentLogger } from './helpers.ts';

const START = new Date('2026-11-13T06:00:00Z');
const MINUTE = 60_000;
const clock = new ManualClock(START);

let test: TestDatabase | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const handle = (found: typeof asPublic) => {
  if (!found) throw new Error('no handle');
  return found.handle;
};

let sent: { jobId: string; type: string }[] = [];
const queues = {
  enqueue: (_name: string, data: { alert: { type: string } }, options: { jobId: string }) => {
    if (!sent.some((entry) => entry.jobId === options.jobId))
      sent.push({ jobId: options.jobId, type: data.alert.type });
    return Promise.resolve();
  },
} as unknown as JobQueues; // only `enqueue` is called
let reported: unknown[] = [];
const run = () =>
  processSlaAlerts({
    db: handle(asSystem),
    queues,
    clock,
    logger: silentLogger(),
    report: (error) => reported.push(error),
  });
const at = (minutes: number) => {
  clock.set(new Date(START.getTime() + minutes * MINUTE));
};

const report = async (reason: ReportReasonValue, publicId: string) => {
  const device = await registerDevice(handle(asPublic), publicScope(), {
    secretHash: createHash('sha256').update(randomBytes(32)).digest(),
    locale: 'en',
    audiencePref: 'brothers',
    platform: 'android',
    privacyVersion: 'draft-1',
    now: clock.now(),
  });
  return createReport(handle(asPublic), deviceScope(device), {
    target: { kind: 'item', publicId },
    reason,
    ...reportSla(reason, clock.now()),
    now: clock.now(),
  });
};

beforeAll(async () => {
  test = await createTestDatabase('sla-alerts');
  await runMigrations(t().db, MIGRATIONS);
  asPublic = await processUserHandle(t(), 'mc_public');
  asSystem = await processUserHandle(t(), 'mc_system');
  await runDevSeed(asSystem.handle, 'local', START);
});

afterAll(async () => {
  await asPublic?.dispose();
  await asSystem?.dispose();
  await test?.dispose();
});

beforeEach(async () => {
  sent = [];
  reported = [];
  at(0);
  await t().db.collection('reports').deleteMany({});
  await t().db.collection('grievances').deleteMany({});
  await t().db.collection('legal_orders').deleteMany({});
});

describe('sla-alerts', () => {
  it('an urgent report: once at 50 %, 80 % and 100 % — never twice', async () => {
    const id = idText(await report('private_info', seedPublicId('alpha', 0)));
    await run();
    expect(sent).toEqual([]);
    at(59);
    await run();
    expect(sent).toEqual([]);
    at(60);
    await run();
    at(75);
    await run();
    at(96);
    await run();
    at(120);
    await run();
    at(600);
    await run();
    expect(sent).toEqual([
      { jobId: `alert.sla.urgent_report.${id}.50`, type: 'sla_50' },
      { jobId: `alert.sla.urgent_report.${id}.80`, type: 'sla_80' },
      { jobId: `alert.sla.urgent_report.${id}.100`, type: 'sla_100' },
    ]);
    // The passed deadline also reaches Sentry once (its e-mail is the fallback for a missed push).
    expect(reported).toHaveLength(1);
    expect(String(reported[0])).toContain('SLA deadline passed: urgent_report');
  });

  it('thresholds jumped while the worker was down: one alert, at the highest', async () => {
    const id = idText(await report('misleading', seedPublicId('alpha', 1)));
    at(36 * 60 + 5); // past due
    await run();
    expect(sent).toEqual([{ jobId: `alert.sla.report.${id}.100`, type: 'sla_100' }]);
  });

  it('a closed report stops alerting', async () => {
    const id = await report('fraud', seedPublicId('alpha', 2));
    await t()
      .db.collection<{ _id: typeof id }>('reports')
      .updateOne({ _id: id }, { $set: { status: 'dismissed' } });
    at(36 * 60);
    expect(await run()).toEqual({ alerts: 0 });
  });

  it('a grievance: the 24 h acknowledgement clock, then — once acknowledged — the resolve clock from 50 % again', async () => {
    await createGrievance(handle(asPublic), publicScope(), {
      category: 'privacy',
      description: 'Test grievance',
      ackDueAt: new Date(START.getTime() + 24 * 60 * MINUTE),
      resolveDueAt: new Date(START.getTime() + 72 * 60 * MINUTE),
      now: START,
    });
    at(12 * 60);
    await run();
    expect(sent.map((entry) => entry.jobId)).toEqual([expect.stringMatching(/^alert\.sla\.grievance_ack\..+\.50$/u)]);
    // Acknowledged at 12 h: the resolve clock runs from there (12 h → 72 h), its alerts start at zero.
    await t()
      .db.collection('grievances')
      .updateMany({}, { $set: { status: 'acknowledged', acknowledged_at: clock.now(), sla_alerted: 0 } });
    at(12 * 60 + 30 * 60); // half of the 60 h left
    await run();
    expect(sent.map((entry) => entry.type)).toEqual(['sla_50', 'sla_50']);
    expect(sent[1]?.jobId).toMatch(/grievance_resolve/u);
  });

  it('a report flood (more than the cap, all already alerted) never hides a legal order, a grievance or a new report', async () => {
    const first = await report('misleading', seedPublicId('alpha', 3));
    const reports = t().db.collection<{ _id: typeof first } & Record<string, unknown>>('reports');
    const template = await reports.findOne({ _id: first });
    if (!template) throw new Error('no report');
    // Older and due earlier than everything below, every alert already sent.
    await reports.insertMany(
      Array.from({ length: SLA_TIMERS_MAX + 1 }, () => ({
        ...template,
        _id: newId(),
        sla_due_at: new Date(START.getTime() + MINUTE),
        sla_alerted: 100,
      })),
    );
    await reports.deleteOne({ _id: first });
    await t()
      .db.collection<{ _id: typeof first } & Record<string, unknown>>('legal_orders')
      .insertOne({
        _id: newId(),
        authority: 'Test authority',
        reference_no: 'TEST-1',
        received_at: START,
        due_at: new Date(START.getTime() + 180 * MINUTE),
        target_type: 'other',
        target_id: 'test',
        summary: 'Test order',
        action_log: [],
        status: 'received',
        created_at: START,
        updated_at: START,
      });
    await createGrievance(handle(asPublic), publicScope(), {
      category: 'privacy',
      description: 'Test grievance',
      ackDueAt: new Date(START.getTime() + 24 * 60 * MINUTE),
      resolveDueAt: new Date(START.getTime() + 72 * 60 * MINUTE),
      now: START,
    });
    const fresh = idText(await report('private_info', seedPublicId('alpha', 4)));
    at(12 * 60);
    await run();
    // Legal order 3 h → past due; grievance 24 h → half; the new urgent report 2 h → past due. No flood report again.
    expect(sent.map((entry) => entry.jobId).sort()).toEqual([
      expect.stringMatching(/^alert\.sla\.grievance_ack\..+\.50$/u),
      expect.stringMatching(/^alert\.sla\.legal_order\..+\.100$/u),
      `alert.sla.urgent_report.${fresh}.100`,
    ]);
  });
});
