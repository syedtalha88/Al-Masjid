// Push in the musalli service worker (PHASE_04 T4.3, 01 §5.3 step 6, 04 §11, 07 A17). Every push shows a notification
// — browsers require it, and an invalid payload gets the generic words instead of being dropped. The payload is
// validated with its Zod schema; the notification opens only a same-origin item path; one per item (`tag`), an edit
// replaces it silently. The app badge shows how many notifications are waiting. A tap focuses an open app (which
// navigates and refreshes that masjid) or opens one. A replaced subscription is sent to the server from here.
// The worker's globals are passed in, so the handlers are unit-tested without a service worker.
import { pushText } from '@mc/i18n/push-text';
import { type PushPayload, pushPayloadSchema } from '@mc/shared/contracts/push';

import {
  deviceAuthorization,
  deviceLocale,
  isNotificationPath,
  PUSH_OPEN,
  PUSH_RECEIVED,
  type PushMessage,
} from '../lib/sw-protocol.ts';

type Locale = PushPayload['l'];

/** What `showNotification` gets (the fields we set). */
export interface NotificationSpec {
  readonly title: string;
  readonly options: {
    readonly body: string;
    readonly icon: string;
    readonly badge: string;
    readonly tag: string;
    readonly renotify: false;
    readonly lang: Locale;
    readonly dir: 'ltr' | 'rtl';
    readonly data: { readonly url: string; readonly masjidId?: string; readonly cv?: number };
  };
}

export const NOTIFICATION_ICON = '/icons/icon-192.png';
export const NOTIFICATION_BADGE = '/icons/badge-96.png';
/** The tag of the generic notification (an unreadable push): one at a time, opening Updates. */
export const FALLBACK_TAG = 'mc-update';

/** Parses a push's data — JSON validated against the payload schema; anything else is `null`. */
export function parsePushPayload(data: { json(): unknown } | null | undefined): PushPayload | null {
  if (!data) return null;
  let value: unknown;
  try {
    value = data.json();
  } catch {
    return null;
  }
  const result = pushPayloadSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** The notification for a push (the generic one when the payload is unreadable), in `fallbackLocale` then. */
export function notificationFor(payload: PushPayload | null, fallbackLocale: Locale): NotificationSpec {
  const locale = payload?.l ?? fallbackLocale;
  const common = {
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    renotify: false,
    lang: locale,
    dir: locale === 'ur' ? 'rtl' : 'ltr',
  } as const;
  if (!payload) {
    return {
      title: pushText('fallbackTitle', locale),
      options: { ...common, body: pushText('fallbackBody', locale), tag: FALLBACK_TAG, data: { url: '/updates' } },
    };
  }
  return {
    title: payload.t,
    options: {
      ...common,
      body: payload.b,
      tag: payload.tag,
      data: { url: payload.u, masjidId: payload.m, cv: payload.cv },
    },
  };
}

/** The window clients, as much of them as used here. */
export interface WindowClientLike {
  readonly url: string;
  focus(): Promise<unknown>;
  postMessage(message: PushMessage): void;
}

export interface PushWorker {
  readonly origin: string;
  showNotification(title: string, options: NotificationSpec['options']): Promise<void>;
  /** How many of our notifications are showing (for the badge). */
  notificationCount(): Promise<number>;
  /** `navigator.setAppBadge` where the platform has it. */
  setBadge?(count: number): Promise<void>;
  windows(): Promise<readonly WindowClientLike[]>;
  openWindow(url: string): Promise<unknown>;
  /** The stored device document (IndexedDB — the page validates it fully; the worker reads two fields). */
  readDevice(): Promise<unknown>;
}

/** `push`: show the notification, update the badge, let open apps refresh that masjid. */
export async function handlePush(worker: PushWorker, data: { json(): unknown } | null | undefined): Promise<void> {
  const payload = parsePushPayload(data);
  const fallbackLocale = payload ? payload.l : deviceLocale(await worker.readDevice().catch(() => null));
  const spec = notificationFor(payload, fallbackLocale);
  await worker.showNotification(spec.title, spec.options);
  await worker.setBadge?.(await worker.notificationCount()).catch(() => undefined);
  if (payload) {
    for (const client of await worker.windows()) client.postMessage({ type: PUSH_RECEIVED, masjidId: payload.m });
  }
}

/**
 * `notificationclick`: the URL must be a same-origin item path (or Updates) — anything else opens Home. An open app
 * window is focused and told where to go; otherwise a new one opens there.
 */
export async function handleNotificationClick(
  worker: Pick<PushWorker, 'origin' | 'windows' | 'openWindow'>,
  data: unknown,
): Promise<void> {
  const url: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'url') : undefined;
  const masjidId: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'masjidId') : undefined;
  const path = isNotificationPath(url) ? url : '/';
  const open = (await worker.windows()).find((client) => new URL(client.url).origin === worker.origin);
  if (open) {
    await open.focus();
    open.postMessage(
      typeof masjidId === 'string' ? { type: PUSH_OPEN, url: path, masjidId } : { type: PUSH_OPEN, url: path },
    );
    return;
  }
  await worker.openWindow(path);
}

/** The parts of a `pushsubscriptionchange` used here. */
export interface SubscriptionChange {
  readonly newSubscription: { toJSON(): { endpoint?: string; keys?: Record<string, string> } } | null;
  resubscribe(): Promise<{ toJSON(): { endpoint?: string; keys?: Record<string, string> } } | null>;
}

/**
 * `pushsubscriptionchange` (T4.2): the push service replaced or expired the subscription — send the new one (making it
 * when the browser did not) with the device's credentials. Failures are left to the app's check on its next open.
 *
 * @returns whether the server accepted it.
 */
export async function handleSubscriptionChange(
  worker: Pick<PushWorker, 'readDevice'> & { fetch: typeof fetch; readonly apiBase: string },
  change: SubscriptionChange,
): Promise<boolean> {
  const authorization = deviceAuthorization(await worker.readDevice().catch(() => null));
  if (!authorization) return false;
  const subscription = change.newSubscription ?? (await change.resubscribe().catch(() => null));
  const json = subscription?.toJSON();
  const p256dh = json?.keys?.['p256dh'];
  const auth = json?.keys?.['auth'];
  if (!json?.endpoint || !p256dh || !auth) return false;
  try {
    const response = await worker.fetch(`${worker.apiBase}/devices/me/push`, {
      method: 'PUT',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh, auth } }),
      credentials: 'omit',
    });
    return response.status === 204;
  } catch {
    return false;
  }
}
