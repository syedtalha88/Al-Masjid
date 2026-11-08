// Notifications on this phone (PHASE_04 T4.2, 00 §4.4, 07 A1 step 7 / A15 §3): the status Settings shows, turning
// them on (the browser prompt only ever follows a tap), off, and the check on every app open — permission granted but
// no or another subscription → subscribe again and tell the server; permission withdrawn → tell the server. iOS offers
// push only inside the installed Home Screen app. Lazy module: nothing here is on the first paint.
import { isProblem } from './api/client.ts';
import type { DeviceStore } from './device/store.ts';
import type { PlatformKind } from './platform.ts';

/** What Settings → Notifications shows (07 A15 §3). */
export type PushStatus = 'on' | 'off' | 'blocked' | 'install-first' | 'unsupported';

/** The parts of `PushSubscription` used here. */
export interface SubscriptionLike {
  readonly endpoint: string;
  readonly options?: { readonly applicationServerKey?: ArrayBuffer | null };
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}

/** The parts of `PushManager` used here. */
export interface PushManagerLike {
  getSubscription(): Promise<SubscriptionLike | null>;
  subscribe(options: { userVisibleOnly: true; applicationServerKey: Uint8Array }): Promise<SubscriptionLike>;
}

/** The browser, injectable for tests. */
export interface PushPlatform {
  readonly platform: PlatformKind;
  readonly standalone: boolean;
  /** `'unsupported'` without Notification / PushManager / a service worker. */
  permission(): NotificationPermission | 'unsupported';
  requestPermission(): Promise<NotificationPermission>;
  pushManager(): Promise<PushManagerLike | null>;
  /** `VITE_PUBLIC_VAPID_PUBLIC_KEY` (base64url, 65 bytes). */
  readonly vapidKey: string;
}

/** The two API calls (03 §3). */
export interface PushApi {
  subscribePush(body: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<unknown>;
  unsubscribePush(): Promise<unknown>;
}

/** base64url → bytes (the VAPID key for `applicationServerKey`). */
export function base64UrlBytes(text: string): Uint8Array {
  const base64 = text
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

const sameKey = (key: ArrayBuffer | null | undefined, expected: Uint8Array): boolean => {
  if (!key) return true; // not reported (older browsers): assume ours
  const actual = new Uint8Array(key);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
};

/** Whether this phone may be offered notifications at all: Android any mode, iOS only installed (00 §4.4). */
export function canOfferPush(env: Pick<PushPlatform, 'platform' | 'standalone' | 'permission'>): boolean {
  if (env.platform === 'ios' && !env.standalone) return false;
  return env.permission() !== 'unsupported';
}

/**
 * The status for Settings.
 *
 * @param wanted - the person turned notifications on here (device store `push.wanted`).
 */
export function pushStatus(
  env: Pick<PushPlatform, 'platform' | 'standalone' | 'permission'>,
  wanted: boolean,
): PushStatus {
  if (env.platform === 'ios' && !env.standalone) return 'install-first';
  const permission = env.permission();
  if (permission === 'unsupported') return 'unsupported';
  if (permission === 'denied') return 'blocked';
  return permission === 'granted' && wanted ? 'on' : 'off';
}

const keysOf = (subscription: SubscriptionLike): { endpoint: string; keys: { p256dh: string; auth: string } } => {
  const json = subscription.toJSON();
  const p256dh = json.keys?.['p256dh'];
  const auth = json.keys?.['auth'];
  if (!p256dh || !auth) throw new Error('push subscription without keys');
  return { endpoint: subscription.endpoint, keys: { p256dh, auth } };
};

/** A subscription made with our VAPID key (an old one made with another key is replaced). */
async function ownSubscription(manager: PushManagerLike, key: Uint8Array): Promise<SubscriptionLike> {
  const existing = await manager.getSubscription();
  if (existing && sameKey(existing.options?.applicationServerKey, key)) return existing;
  await existing?.unsubscribe();
  return manager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

/**
 * Sends `subscription` to the server; when another app id on this browser holds its endpoint (409
 * PUSH_ENDPOINT_IN_USE — e.g. after "Clear all data" offline), subscribes afresh once and sends that.
 *
 * @returns the endpoint the server accepted.
 */
async function sendSubscription(
  api: PushApi,
  manager: PushManagerLike,
  key: Uint8Array,
  subscription: SubscriptionLike,
) {
  try {
    await api.subscribePush(keysOf(subscription));
    return subscription.endpoint;
  } catch (error) {
    if (!isProblem(error, 'PUSH_ENDPOINT_IN_USE')) throw error;
    await subscription.unsubscribe();
    const fresh = await manager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api.subscribePush(keysOf(fresh));
    return fresh.endpoint;
  }
}

/**
 * Turns notifications on — call it from a tap only (the browser prompt needs the gesture; it is never shown again once
 * answered "Block").
 *
 * @returns the status afterwards (`blocked` when the person said no — the screen then shows how to allow it).
 * @throws on network / server errors (the caller shows "Try again").
 */
export async function enablePush(env: PushPlatform, api: PushApi, store: DeviceStore): Promise<PushStatus> {
  if (!canOfferPush(env)) return pushStatus(env, false);
  let permission = env.permission();
  if (permission === 'default') permission = await env.requestPermission();
  await store.update((state) => ({ ...state, pushAskedAt: state.pushAskedAt ?? new Date().toISOString() }));
  if (permission !== 'granted') return pushStatus(env, false);
  const manager = await env.pushManager();
  if (!manager) return 'unsupported';
  const key = base64UrlBytes(env.vapidKey);
  const endpoint = await sendSubscription(api, manager, key, await ownSubscription(manager, key));
  await store.update((state) => ({ ...state, push: { wanted: true, endpoint } }));
  return 'on';
}

/**
 * Turns notifications off: the browser subscription is dropped and the server told.
 *
 * @throws on network / server errors (nothing is changed then — the switch stays on).
 */
export async function disablePush(env: PushPlatform, api: PushApi, store: DeviceStore): Promise<PushStatus> {
  await api.unsubscribePush();
  const manager = await env.pushManager();
  await (await manager?.getSubscription())?.unsubscribe();
  await store.update((state) => ({ ...state, push: { wanted: false } }));
  return pushStatus(env, false);
}

/** "Not now" on the soft-ask: never asked again by itself (Settings still offers it). */
export async function declinePush(store: DeviceStore): Promise<void> {
  await store.update((state) => ({ ...state, pushAskedAt: state.pushAskedAt ?? new Date().toISOString() }));
}

/**
 * The check on every app open (T4.2): when the person wants notifications and the permission is granted, make sure a
 * subscription with our key exists and the server has it (the browser or the push service may have replaced it —
 * `pushsubscriptionchange` is not delivered everywhere); when the permission was withdrawn in the phone's settings,
 * tell the server. Never prompts. Device not registered yet → nothing (the next open tries again).
 *
 * @returns what changed: `resubscribed`, `turned-off` or `unchanged`.
 */
export async function reconcilePush(
  env: PushPlatform,
  api: PushApi,
  store: DeviceStore,
): Promise<'resubscribed' | 'turned-off' | 'unchanged'> {
  const state = store.current();
  if (!state.credentials || !state.push?.wanted) return 'unchanged';
  const permission = env.permission();
  if (permission === 'unsupported') return 'unchanged';
  if (permission !== 'granted') {
    if (state.push.endpoint === undefined) return 'unchanged';
    await api.unsubscribePush();
    await store.update((current) => ({ ...current, push: { wanted: true } })); // re-enabled when allowed again
    return 'turned-off';
  }
  const manager = await env.pushManager();
  if (!manager) return 'unchanged';
  const key = base64UrlBytes(env.vapidKey);
  const subscription = await ownSubscription(manager, key);
  if (subscription.endpoint === state.push.endpoint) return 'unchanged';
  const endpoint = await sendSubscription(api, manager, key, subscription);
  await store.update((current) => ({ ...current, push: { wanted: true, endpoint } }));
  return 'resubscribed';
}

/** The real browser. */
export function browserPushPlatform(platform: PlatformKind, standalone: boolean): PushPlatform {
  const configured: unknown = import.meta.env['VITE_PUBLIC_VAPID_PUBLIC_KEY'];
  const supported =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'PushManager' in window &&
    'serviceWorker' in navigator;
  return {
    platform,
    standalone,
    permission: () => (supported ? Notification.permission : 'unsupported'),
    requestPermission: () => Notification.requestPermission(),
    pushManager: async () => {
      if (!supported) return null;
      const registration = await navigator.serviceWorker.ready;
      return registration.pushManager as unknown as PushManagerLike; // DOM PushManager ⊇ PushManagerLike
    },
    vapidKey: typeof configured === 'string' ? configured : '',
  };
}
