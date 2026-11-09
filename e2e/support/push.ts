// Push in e2e (PHASE_04 T4.9). Headless browsers cannot subscribe at a real push service, so a test registers a fake
// FCM subscription (a real P-256 key pair: the worker encrypts for it) — through the API, or through the app with
// `stubPushManager`. The runtime-test worker never sends: it captures each push (test hooks), `capturedPushes` reads
// them, and `deliverPush` hands one to the musalli app's service worker through CDP, as a push service would.
import { createECDH, randomBytes } from 'node:crypto';

import { expect } from '@mc/config/playwright';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';
import { storedDevice } from './device.ts';

export interface FakeSubscription {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

/** A subscription on an allow-listed push host with real keys; nothing is ever sent to it (captured instead). */
export function fakeSubscription(): FakeSubscription {
  const browser = createECDH('prime256v1');
  browser.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${randomBytes(12).toString('hex')}`,
    keys: { p256dh: browser.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

/** Stores `subscription` for this page's registered device (`PUT /devices/me/push`) — push on for it. */
export async function subscribeDevice(page: Page, subscription: FakeSubscription): Promise<void> {
  const credentials = (await storedDevice(page))?.['credentials'] as { deviceId: string; secret: string } | undefined;
  if (!credentials) throw new Error('subscribeDevice: the device is not registered');
  const response = await page.request.put(`${APP_URL}/api/v1/devices/me/push`, {
    headers: { Authorization: `Device ${credentials.deviceId}.${credentials.secret}` },
    data: subscription,
  });
  expect(response.status()).toBe(204);
}

/**
 * The app's `PushManager` answers with `subscription` (the browser itself cannot subscribe headless); the app then
 * stores it at the server as it would a real one. Survives reloads (the stub remembers it in localStorage).
 */
export async function stubPushManager(context: BrowserContext, subscription: FakeSubscription): Promise<void> {
  await context.addInitScript((sub: FakeSubscription) => {
    const KEY = 'e2e-push-subscription';
    const make = () => ({
      endpoint: sub.endpoint,
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint: sub.endpoint, keys: sub.keys }),
      unsubscribe: () => {
        localStorage.removeItem(KEY);
        return Promise.resolve(true);
      },
    });
    // The parts of PushSubscription the app uses (apps/app/src/lib/push.ts SubscriptionLike).
    PushManager.prototype.subscribe = function subscribe() {
      localStorage.setItem(KEY, '1');
      return Promise.resolve(make() as unknown as PushSubscription);
    };
    PushManager.prototype.getSubscription = function getSubscription() {
      return Promise.resolve((localStorage.getItem(KEY) ? make() : null) as unknown as PushSubscription | null);
    };
  }, subscription);
}

export interface CapturedPush {
  readonly endpoint: string;
  /** The JSON payload the service worker would decrypt (pushPayloadSchema). */
  readonly payload: string;
  readonly ttl?: string;
  readonly urgency?: string;
  readonly topic?: string;
}

/** The pushes the runtime-test worker captured for `endpoint`, oldest first. */
export async function capturedPushes(request: APIRequestContext, endpoint: string): Promise<CapturedPush[]> {
  const response = await request.get(
    `${ADMIN_URL}/api/admin/test/push-captured?endpoint=${encodeURIComponent(endpoint)}`,
  );
  expect(response.status()).toBe(200);
  return ((await response.json()) as { pushes: CapturedPush[] }).pushes;
}

/** Waits (up to `timeout` ms) until `count` pushes were captured for `endpoint`; returns them (oldest first). */
export async function awaitPushes(
  request: APIRequestContext,
  endpoint: string,
  count: number,
  timeout = 30_000,
): Promise<CapturedPush[]> {
  await expect
    .poll(async () => (await capturedPushes(request, endpoint)).length, { timeout })
    .toBeGreaterThanOrEqual(count);
  return capturedPushes(request, endpoint);
}

export interface NotificationJob {
  readonly id: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed';
  readonly audience: 'everyone' | 'brothers' | 'sisters';
  readonly targeted: number;
  readonly sent: number;
  readonly failed: number;
}

/** The masjid's notification history, newest first (B3 → Notifications), with the admin's session. */
export async function notificationJobs(request: APIRequestContext, masjidId: string): Promise<NotificationJob[]> {
  const response = await request.get(`${ADMIN_URL}/api/admin/masjids/${masjidId}/notifications/jobs`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { jobs: NotificationJob[] }).jobs;
}

/** Waits until the newest of the masjid's notifications has `status`; returns it. */
export async function awaitNewestJob(
  request: APIRequestContext,
  masjidId: string,
  status: NotificationJob['status'] = 'completed',
): Promise<NotificationJob> {
  await expect
    .poll(async () => (await notificationJobs(request, masjidId))[0]?.status, { timeout: 30_000 })
    .toBe(status);
  const [newest] = await notificationJobs(request, masjidId);
  if (!newest) throw new Error('no notification job');
  return newest;
}

/** Delivers `data` to the musalli app's service worker as a push message (CDP — Chromium only). */
export async function deliverPush(page: Page, data: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const registrationId = new Promise<string>((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      const own = registrations.find((entry) => entry.scopeURL === `${APP_URL}/` && !entry.isDeleted);
      if (own) resolve(own.registrationId);
    });
  });
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: new URL(APP_URL).origin,
    registrationId: await registrationId,
    data,
  });
  await cdp.detach();
}

export interface ShownNotification {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly lang: string;
  readonly dir: string;
  readonly data: unknown;
}

/** The notifications the service worker shows now. */
export async function shownNotifications(page: Page): Promise<ShownNotification[]> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.getNotifications()).map((entry) => ({
      title: entry.title,
      body: entry.body,
      tag: entry.tag,
      lang: entry.lang,
      dir: entry.dir,
      data: entry.data as unknown,
    }));
  });
}
