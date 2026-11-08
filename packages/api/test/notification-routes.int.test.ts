// PHASE_04 T4.5 / T4.6 / T4.7 — the admin API around push: today's quota with the audience reach (counts match the
// database), the reset at IST midnight (clock-controlled), the kill switch flag; the notification history after a
// notifying publish, whose outbox job is handed to the worker after commit; the Super Admin's ★ kill switch, push
// stats and the dev-only test alert; admin push subscriptions (allow-listed endpoints only).
import { parseId } from '@mc/db';
import { notificationJobListSchema, pushQuotaSchema, superDashboardSchema } from '@mc/shared/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AlertService } from '../src/queue/alerts.ts';
import type { PushNotifier } from '../src/queue/queues.ts';
import { CSRF, superHarness } from './super-harness.ts';

const raised: Parameters<AlertService['raise']>[0][] = [];
const handedOver: (string | null)[] = [];
const extra: { alerts: AlertService; testAlerts: boolean; notifier: PushNotifier } = {
  alerts: {
    raise: (input) => {
      raised.push(input);
      return Promise.resolve(true);
    },
  },
  testAlerts: true,
  notifier: {
    afterCommit: (jobId) => {
      handedOver.push(jobId);
      return Promise.resolve();
    },
  },
};
// 13:30 IST on 8 Nov 2026
const harness = superHarness('notification_routes', new Date('2026-11-08T08:00:00Z'), extra);
const { app, asSuper, asSuperOnAdmin, stepUp, register, db, clock } = harness;

const KEYS = { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) };
let masjidId = '';
let adminCookie = '';

const idOf = (text: string) => {
  const id = parseId(text);
  if (!id) throw new Error(`not an id: ${text}`);
  return id;
};
const asAdmin = (method: 'get' | 'post' | 'put' | 'delete', path: string) => {
  const call = request(app())[method](`/api/admin${path}`).set('Cookie', adminCookie);
  return method === 'get' ? call : call.set(CSRF);
};
const quota = async () => {
  const response = await asAdmin('get', `/masjids/${masjidId}/notifications/quota`);
  expect(response.status).toBe(200);
  return pushQuotaSchema.parse(response.body);
};

beforeAll(async () => {
  const created = await asSuper('post', '/masjids').send({
    name: 'Test Masjid Notify',
    area: 'Test Area',
    city: 'Hyderabad',
    state: 'Telangana',
    address: 'Test address',
    lat: 17.385,
    lng: 78.4867,
  });
  masjidId = (created.body as { id: string }).id;
  const admin = await asSuper('post', '/admins').send({
    displayName: 'Test Admin',
    uiLocale: 'en',
    masjidId,
    role: 'owner',
  });
  adminCookie = await register((admin.body as { inviteUrl: string }).inviteUrl);
  const settings = await asSuper('get', '/settings');
  await asAdmin('post', '/auth/undertaking').send({
    version: (settings.body as { undertakingVersion: string }).undertakingVersion,
  });

  // Followers as the device mirror stores them (02 §5): two brothers, three sisters, one muted, one with push off.
  const follow = (pref: string, muted = false, push = true) => ({
    _id: idOf(crypto.randomUUID()),
    device_id: idOf(crypto.randomUUID()),
    masjid_id: idOf(masjidId),
    muted,
    audience_pref: pref,
    locale: 'en',
    push_active: push,
    created_at: clock.now(),
  });
  await db()
    .collection<{ _id: unknown }>('device_follows')
    .insertMany([
      follow('brothers'),
      follow('brothers'),
      follow('sisters'),
      follow('sisters'),
      follow('sisters'),
      follow('brothers', true),
      follow('sisters', false, false),
    ]);
});

describe('quota, reach and the kill switch flag (T4.5, T4.7)', () => {
  it('reach per audience equals the notifying follows in the database', async () => {
    const status = await quota();
    const count = (prefs: string[]) =>
      db()
        .collection('device_follows')
        .countDocuments({ masjid_id: idOf(masjidId), muted: false, push_active: true, audience_pref: { $in: prefs } });
    expect(status.reach).toEqual({
      everyone: await count(['brothers', 'sisters']),
      brothers: await count(['brothers']),
      sisters: await count(['sisters']),
    });
    expect(status.reach).toEqual({ everyone: 5, brothers: 2, sisters: 3 });
    expect(status.paused).toBe(false);
  });

  it('the count resets at midnight in India (clock-controlled)', async () => {
    await db()
      .collection<{ _id: string } & Record<string, unknown>>('push_quota_usage')
      .insertOne({ _id: `${masjidId}:2026-11-08`, masjid_id: idOf(masjidId), day: '2026-11-08', count: 3 });
    clock.set(new Date('2026-11-08T18:29:30Z')); // 23:59:30 IST
    expect(await quota()).toMatchObject({ used: 3, resetsAt: '2026-11-08T18:30:00.000Z' });
    clock.set(new Date('2026-11-08T18:30:30Z')); // 00:00:30 IST, 9 Nov
    expect(await quota()).toMatchObject({ used: 0, resetsAt: '2026-11-09T18:30:00.000Z' });
    clock.set(new Date('2026-11-08T08:00:00Z'));
  });

  it('admins see when the Super Admin paused notifications', async () => {
    await db()
      .collection<{ _id: string }>('app_settings')
      .updateOne({ _id: 'global' }, { $set: { push_paused: true } });
    expect((await quota()).paused).toBe(true);
    await db()
      .collection<{ _id: string }>('app_settings')
      .updateOne({ _id: 'global' }, { $set: { push_paused: false } });
  });
});

describe('notification history (T4.5) and the after-commit hand-over (T4.4)', () => {
  it('a notifying publish hands its outbox job over and shows in the history', async () => {
    handedOver.length = 0;
    const published = await asAdmin('post', `/masjids/${masjidId}/items/announcement`).send({
      content: { kind: 'text', title: 'Test notice title', body: 'Test notice body.', locale: 'en' },
      category: 'general',
      isImportant: false,
      notify: true,
    });
    expect(published.status).toBe(201);
    expect(published.body).toMatchObject({ notification: { queued: true, targeted: 5 } });
    expect(JSON.stringify(published.body)).not.toContain('notificationJobId');

    const history = await asAdmin('get', `/masjids/${masjidId}/notifications/jobs`);
    expect(history.status).toBe(200);
    const { jobs, next } = notificationJobListSchema.parse(history.body);
    expect(next).toBeNull();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      status: 'pending',
      audience: 'everyone',
      sent: 0,
      item: { type: 'announcement', title: 'Test notice title', status: 'published' },
    });
    expect(handedOver).toEqual([jobs[0]?.id]);
  });

  it('a publish without notifying hands nothing over', async () => {
    handedOver.length = 0;
    await asAdmin('post', `/masjids/${masjidId}/items/announcement`).send({
      content: { kind: 'text', title: 'Test quiet notice', body: 'Test body.', locale: 'en' },
      category: 'general',
      isImportant: false,
      notify: false,
    });
    expect(handedOver).toEqual([null]);
  });

  it('another masjid’s history is not reachable', async () => {
    const response = await asAdmin('get', `/masjids/${crypto.randomUUID()}/notifications/jobs`);
    expect(response.status).toBe(404);
  });
});

describe('Super Admin: kill switch ★, stats, test alert (T4.5–T4.7)', () => {
  it('pausing needs a step-up; settings and the dashboard show it; resume', async () => {
    await stepUp(false);
    const refused = await asSuper('post', '/settings/push-pause').send({ paused: true });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'STEP_UP_REQUIRED' });

    await stepUp(true);
    expect((await asSuper('post', '/settings/push-pause').send({ paused: true })).body).toEqual({
      paused: true,
      changed: true,
    });
    expect((await asSuper('post', '/settings/push-pause').send({ paused: true })).body).toEqual({
      paused: true,
      changed: false,
    });
    expect((await asSuper('get', '/settings')).body).toMatchObject({ pushPaused: true });
    const dashboard = superDashboardSchema.parse((await asSuper('get', '/dashboard')).body);
    expect(dashboard.push).toMatchObject({ paused: true, jobs: 1, running: 1 });
    const audit = await db().collection('audit_log').findOne({ action: 'push.pause' });
    expect(audit).not.toBeNull();

    await asSuper('post', '/settings/push-pause').send({ paused: false });
    expect((await asSuper('get', '/settings')).body).toMatchObject({ pushPaused: false });
  });

  it('the test alert goes to the signed-in Super Admin only, and only where enabled', async () => {
    raised.length = 0;
    const sent = await asSuper('post', '/alerts/test');
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({ queued: true });
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ type: 'test', to: { kind: 'admins' } });

    extra.testAlerts = false; // production
    expect((await asSuper('post', '/alerts/test')).status).toBe(404);
    extra.testAlerts = true;
  });

  it('a masjid admin cannot pause push or send test alerts', async () => {
    expect(
      (
        await request(app())
          .post('/api/super/settings/push-pause')
          .set('Cookie', adminCookie)
          .set(CSRF)
          .send({ paused: true })
      ).status,
    ).toBe(403);
    expect((await request(app()).post('/api/super/alerts/test').set('Cookie', adminCookie).set(CSRF)).status).toBe(403);
  });
});

describe('admin push subscriptions (T4.6)', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/test-admin-1';

  it('saves an allow-listed subscription, replaces it on re-subscribe, removes it', async () => {
    expect((await asSuperOnAdmin('put', '/auth/push').send({ endpoint, keys: KEYS })).status).toBe(204);
    expect((await asSuperOnAdmin('put', '/auth/push').send({ endpoint, keys: KEYS })).status).toBe(204);
    expect(await db().collection('admin_push_subscriptions').countDocuments({ endpoint })).toBe(1);
    expect((await asSuperOnAdmin('delete', '/auth/push').send({ endpoint })).status).toBe(204);
    expect(await db().collection('admin_push_subscriptions').countDocuments({ endpoint })).toBe(0);
  });

  it('refuses a host outside the push-service allow-list', async () => {
    const response = await asSuperOnAdmin('put', '/auth/push').send({
      endpoint: 'https://attacker.example/push',
      keys: KEYS,
    });
    expect(response.status).toBe(400);
  });

  it("another admin's browser endpoint is PUSH_ENDPOINT_IN_USE", async () => {
    const shared = 'https://fcm.googleapis.com/fcm/send/test-shared-browser';
    expect((await asAdmin('put', '/auth/push').send({ endpoint: shared, keys: KEYS })).status).toBe(204);
    const taken = await asSuperOnAdmin('put', '/auth/push').send({ endpoint: shared, keys: KEYS });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: 'PUSH_ENDPOINT_IN_USE' });
  });
});
