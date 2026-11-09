// PHASE_04 T4.2 — notifications on this phone with a mocked PushManager: status per platform and permission, the
// prompt only on a tap and never again after "Block", subscribe + send, the 409 re-subscribe, off, and the check on
// every app open (no subscription / another one / another VAPID key → subscribe again; permission withdrawn → off).
import { ProblemError } from '@mc/shared/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeviceStore, type DeviceStore, memoryBackend } from '../device/store.ts';
import {
  base64UrlBytes,
  canOfferPush,
  declinePush,
  disablePush,
  enablePush,
  type PushApi,
  type PushManagerLike,
  type PushPlatform,
  pushStatus,
  reconcilePush,
  type SubscriptionLike,
} from '../push.ts';

const VAPID = `B${'A'.repeat(86)}`; // 65 bytes of base64url
const OTHER_VAPID = `B${'Q'.repeat(86)}`;
const CREDENTIALS = { deviceId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', secret: 'S'.repeat(43) };

let counter = 0;
function fakeSubscription(key = VAPID): SubscriptionLike & { unsubscribed: boolean } {
  counter += 1;
  const sub = {
    endpoint: `https://fcm.googleapis.com/fcm/send/test-${String(counter)}`,
    options: { applicationServerKey: base64UrlBytes(key).buffer as ArrayBuffer },
    unsubscribed: false,
    toJSON: () => ({ endpoint: sub.endpoint, keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) } }),
    unsubscribe: () => {
      sub.unsubscribed = true;
      manager.current = null;
      return Promise.resolve(true);
    },
  };
  return sub;
}

const manager: PushManagerLike & { current: SubscriptionLike | null; subscribes: number } = {
  current: null,
  subscribes: 0,
  getSubscription() {
    return Promise.resolve(this.current);
  },
  subscribe() {
    this.subscribes += 1;
    this.current = fakeSubscription();
    return Promise.resolve(this.current);
  },
};

let permission: NotificationPermission | 'unsupported' = 'default';
let answer: NotificationPermission = 'granted';
const requestPermission = vi.fn(() => {
  permission = answer;
  return Promise.resolve(answer);
});
const env = (overrides: Partial<PushPlatform> = {}): PushPlatform => ({
  platform: 'android',
  standalone: false,
  permission: () => permission,
  requestPermission,
  pushManager: () => Promise.resolve(manager),
  vapidKey: VAPID,
  ...overrides,
});
const api = { subscribePush: vi.fn<PushApi['subscribePush']>(), unsubscribePush: vi.fn<PushApi['unsubscribePush']>() };
let store: DeviceStore;

beforeEach(async () => {
  permission = 'default';
  answer = 'granted';
  manager.current = null;
  manager.subscribes = 0;
  requestPermission.mockClear();
  api.subscribePush.mockReset().mockResolvedValue(undefined);
  api.unsubscribePush.mockReset().mockResolvedValue(undefined);
  store = createDeviceStore(memoryBackend(), 'en');
  await store.update((state) => ({ ...state, credentials: CREDENTIALS }));
});

describe('status and where push may be offered', () => {
  it('iOS outside the installed app: install first, never offered', () => {
    const ios = env({ platform: 'ios', standalone: false });
    expect(pushStatus(ios, false)).toBe('install-first');
    expect(canOfferPush(ios)).toBe(false);
    expect(canOfferPush(env({ platform: 'ios', standalone: true }))).toBe(true);
  });

  it('Android in the browser is offered; blocked / off / on follow the permission and the choice', () => {
    expect(canOfferPush(env())).toBe(true);
    permission = 'denied';
    expect(pushStatus(env(), true)).toBe('blocked');
    permission = 'granted';
    expect(pushStatus(env(), false)).toBe('off');
    expect(pushStatus(env(), true)).toBe('on');
    permission = 'unsupported';
    expect(pushStatus(env(), true)).toBe('unsupported');
  });
});

describe('enablePush / disablePush', () => {
  it('asks once, subscribes with the VAPID key and sends the subscription', async () => {
    expect(await enablePush(env(), api, store)).toBe('on');
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(manager.subscribes).toBe(1);
    expect(api.subscribePush).toHaveBeenCalledWith({
      endpoint: manager.current?.endpoint,
      keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) },
    });
    expect(store.current().push).toEqual({ wanted: true, endpoint: manager.current?.endpoint });
    expect(store.current().pushAskedAt).toBeDefined();
  });

  it('"Block": no subscription, status blocked, and the prompt is never shown again', async () => {
    answer = 'denied';
    expect(await enablePush(env(), api, store)).toBe('blocked');
    expect(await enablePush(env(), api, store)).toBe('blocked');
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(api.subscribePush).not.toHaveBeenCalled();
  });

  it('409 PUSH_ENDPOINT_IN_USE: a fresh subscription is made and sent once', async () => {
    api.subscribePush.mockRejectedValueOnce(
      new ProblemError({ type: 'x', title: 'Conflict', status: 409, code: 'PUSH_ENDPOINT_IN_USE' }, undefined),
    );
    expect(await enablePush(env(), api, store)).toBe('on');
    expect(manager.subscribes).toBe(2);
    expect(api.subscribePush).toHaveBeenCalledTimes(2);
    expect(store.current().push?.endpoint).toBe(manager.current?.endpoint);
  });

  it('off: the server is told, the browser subscription dropped, and the app stops re-subscribing', async () => {
    await enablePush(env(), api, store);
    const subscription = manager.current;
    expect(await disablePush(env(), api, store)).toBe('off');
    expect(api.unsubscribePush).toHaveBeenCalledTimes(1);
    expect(manager.current).toBeNull();
    expect(subscription).toMatchObject({ unsubscribed: true });
    expect(await reconcilePush(env(), api, store)).toBe('unchanged');
    expect(manager.subscribes).toBe(1);
  });

  it('"Not now" records the answer without a prompt', async () => {
    await declinePush(store);
    expect(store.current().pushAskedAt).toBeDefined();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('reconcilePush (every app open)', () => {
  beforeEach(async () => {
    permission = 'granted';
    await enablePush(env(), api, store);
    api.subscribePush.mockClear();
  });

  it('nothing to do while the subscription is the one the server has', async () => {
    expect(await reconcilePush(env(), api, store)).toBe('unchanged');
    expect(api.subscribePush).not.toHaveBeenCalled();
  });

  it('the browser lost the subscription: subscribe again without a prompt and send it', async () => {
    manager.current = null;
    expect(await reconcilePush(env(), api, store)).toBe('resubscribed');
    expect(requestPermission).not.toHaveBeenCalled(); // never prompts by itself
    expect(api.subscribePush).toHaveBeenCalledTimes(1);
    expect(store.current().push?.endpoint).toBe((await manager.getSubscription())?.endpoint);
  });

  it('the push service replaced it (another endpoint): the new one is sent', async () => {
    manager.current = fakeSubscription();
    expect(await reconcilePush(env(), api, store)).toBe('resubscribed');
    expect(api.subscribePush).toHaveBeenCalledWith(expect.objectContaining({ endpoint: manager.current.endpoint }));
  });

  it('a subscription made with another VAPID key is replaced', async () => {
    const old = fakeSubscription(OTHER_VAPID);
    manager.current = old;
    expect(await reconcilePush(env(), api, store)).toBe('resubscribed');
    expect(old.unsubscribed).toBe(true);
    expect(manager.current.endpoint).not.toBe(old.endpoint);
  });

  it('permission withdrawn in the phone settings: the server is told; allowed again → back on', async () => {
    permission = 'denied';
    expect(await reconcilePush(env(), api, store)).toBe('turned-off');
    expect(api.unsubscribePush).toHaveBeenCalledTimes(1);
    expect(await reconcilePush(env(), api, store)).toBe('unchanged'); // told once
    permission = 'granted';
    expect(await reconcilePush(env(), api, store)).toBe('resubscribed');
  });

  it('a device not registered yet waits', async () => {
    await store.update((state) => {
      const { credentials: _dropped, ...rest } = state;
      return rest;
    });
    manager.current = null;
    expect(await reconcilePush(env(), api, store)).toBe('unchanged');
  });
});
