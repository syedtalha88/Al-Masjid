// PHASE_04 T4.6 — the `alert-send` processor on the Docker MongoDB with the mock push service: who receives an alert
// (active Super Admins, or the named active admins), in each admin's app language with the fixed path of its type;
// gone subscriptions deleted, delivered ones noted; a retryable answer retries the job until its last attempt.
import { createECDH, randomBytes } from 'node:crypto';

import { type DbHandle, idText, newId } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { adminAlertPayloadSchema } from '@mc/shared/contracts/push';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import webpush from 'web-push';

import { processAlertSend } from '../src/jobs/alerts/send.ts';
import { PushRetryError } from '../src/jobs/push/send-batch.ts';
import { createPushSender } from '../src/push/sender.ts';
import { createMockPushService } from '../src/testing/mock-push.ts';
import { silentLogger } from './helpers.ts';

const NOW = new Date('2026-11-08T06:30:00Z');
const service = createMockPushService();
const VAPID = { subject: 'mailto:alerts@example.test', ...webpush.generateVAPIDKeys() };
const browser = createECDH('prime256v1');
browser.generateKeys();
const KEYS = { p256dh: browser.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };

let test: TestDatabase | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;

const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const sys = (): DbHandle => {
  if (!asSystem) throw new Error('no mc_system handle');
  return asSystem.handle;
};
type Id = ReturnType<typeof newId>;
const raw = (name: string) => t().db.collection<{ _id: Id } & Record<string, unknown>>(name);
const deps = () => ({
  db: sys(),
  sender: createPushSender({ vapid: VAPID, transport: service.transport }),
  clock: { now: () => NOW },
  logger: silentLogger(),
});

async function admin(
  role: 'super_admin' | 'masjid_admin',
  locale: 'en' | 'hi' | 'ur' | 'te',
  status: 'active' | 'disabled' = 'active',
): Promise<Id> {
  const id = newId();
  await raw('admin_users').insertOne({
    _id: id,
    display_name: 'Test Admin',
    role,
    status,
    ui_locale: locale,
    user_handle: randomBytes(32), // stored as BSON binary by the driver
    undertaking_history: [],
    created_at: NOW,
    updated_at: NOW,
  });
  return id;
}

/** A subscription of `adminId`; returns its endpoint. */
async function phone(adminId: Id): Promise<string> {
  const endpoint = `https://fcm.googleapis.com/fcm/send/alert-${randomBytes(8).toString('hex')}`;
  await raw('admin_push_subscriptions').insertOne({
    _id: newId(),
    admin_id: adminId,
    endpoint,
    ...KEYS,
    created_at: NOW,
  });
  return endpoint;
}

const subscription = (endpoint: string) => raw('admin_push_subscriptions').findOne({ endpoint });
const messageTo = (endpoint: string) => {
  const [entry] = service.delivered(endpoint);
  if (!entry) throw new Error(`nothing delivered to ${endpoint}`);
  return { message: adminAlertPayloadSchema.parse(JSON.parse(entry.payload)), headers: entry.headers };
};
const alert = (
  alertId: string,
  type: 'push_job_stuck' | 'test' | 'super_passkey_added',
  to: { kind: 'super' } | { kind: 'admins'; adminIds: string[] },
) => ({ alertId, to, alert: { type, params: {} } });

beforeAll(async () => {
  test = await createTestDatabase('alert-send');
  await runMigrations(t().db, MIGRATIONS);
  asSystem = await processUserHandle(t(), 'mc_system');
}, 60_000);

afterAll(async () => {
  await asSystem?.dispose();
  await test?.dispose();
});

beforeEach(async () => {
  service.reset();
  await raw('admin_push_subscriptions').deleteMany({});
  await raw('admin_users').deleteMany({});
});

describe('alert-send', () => {
  it('Super Admin alerts: every active Super Admin phone in its language; gone phones deleted, delivered ones noted', async () => {
    const urdu = await admin('super_admin', 'ur');
    const disabled = await admin('super_admin', 'en', 'disabled');
    const masjidAdmin = await admin('masjid_admin', 'hi');
    const kept = await phone(urdu);
    const gone = await phone(urdu);
    const notDisabled = await phone(disabled);
    const notAdmin = await phone(masjidAdmin);
    service.answer(gone, 410);

    const result = await processAlertSend(deps(), alert('push_job_stuck.1', 'push_job_stuck', { kind: 'super' }), {
      final: false,
    });

    expect(result).toEqual({ delivered: 1, pruned: 1 });
    const { message, headers } = messageTo(kept);
    expect(message).toMatchObject({
      kind: 'alert',
      type: 'push_job_stuck',
      u: '/super',
      tag: 'push_job_stuck.1',
      l: 'ur',
    });
    expect(headers).toMatchObject({ Urgency: 'high', TTL: String(4 * 60 * 60) });
    expect(await subscription(gone)).toBeNull();
    expect(await subscription(kept)).toMatchObject({ last_ok_at: NOW });
    const asked = service.requests.map((entry) => entry.endpoint);
    expect(asked).not.toContain(notDisabled);
    expect(asked).not.toContain(notAdmin);
  });

  it('named admins: only the active ones (an id that does not parse is skipped), each in its language', async () => {
    const hindi = await admin('masjid_admin', 'hi');
    const telugu = await admin('masjid_admin', 'te');
    const removed = await admin('masjid_admin', 'en', 'disabled');
    const [hi, te, off] = [await phone(hindi), await phone(telugu), await phone(removed)];

    const result = await processAlertSend(
      deps(),
      alert('test.2', 'test', { kind: 'admins', adminIds: [idText(hindi), idText(telugu), idText(removed), 'nope'] }),
      { final: false },
    );

    expect(result).toEqual({ delivered: 2, pruned: 0 });
    expect(messageTo(hi).message).toMatchObject({ type: 'test', u: '/', l: 'hi' });
    expect(messageTo(te).message).toMatchObject({ l: 'te' });
    expect(service.requests.some((entry) => entry.endpoint === off)).toBe(false);
  });

  it('a retryable answer retries the job until its last attempt; nobody subscribed is a quiet no-op', async () => {
    const owner = await admin('super_admin', 'en');
    const flaky = await phone(owner);
    service.answer(flaky, 503, 503);
    const payload = alert('super_passkey_added.3', 'super_passkey_added', { kind: 'super' });

    await expect(processAlertSend(deps(), payload, { final: false })).rejects.toBeInstanceOf(PushRetryError);
    expect(await processAlertSend(deps(), payload, { final: true })).toEqual({ delivered: 0, pruned: 0 });
    expect(await subscription(flaky)).not.toBeNull(); // a retryable answer never deletes the phone

    await raw('admin_push_subscriptions').deleteMany({});
    expect(await processAlertSend(deps(), payload, { final: false })).toEqual({ delivered: 0, pruned: 0 });
  });

  it('named admins of whom none is active: nothing is read or sent', async () => {
    const removed = await admin('masjid_admin', 'en', 'disabled');
    await phone(removed);
    expect(
      await processAlertSend(deps(), alert('test.4', 'test', { kind: 'admins', adminIds: [idText(removed)] }), {
        final: false,
      }),
    ).toEqual({ delivered: 0, pruned: 0 });
    expect(service.requests).toHaveLength(0);
  });
});
