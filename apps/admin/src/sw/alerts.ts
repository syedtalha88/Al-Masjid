// Alert pushes in the admin service worker (PHASE_04 T4.6, 01 §5.8 `alert-send`, 04 §11): every push shows a
// notification — the alert's fixed words in the admin's language, or generic words when the payload does not validate.
// A tap focuses the admin app and opens the alert's path (same origin only), or opens the app there. The worker's
// globals are passed in so the handlers are unit-tested without a service worker.
import { pushText } from '@mc/i18n/push-text';
import { type AdminAlertPayload, adminAlertPayloadSchema } from '@mc/shared/contracts/push';

export const ALERT_ICON = '/icons/icon-192.png';
export const ALERT_BADGE = '/icons/badge-96.png';

export interface AlertWindow {
  readonly url: string;
  focus(): Promise<unknown>;
  navigate(url: string): Promise<unknown>;
}

export interface AlertWorker {
  readonly origin: string;
  showNotification(
    title: string,
    options: NotificationOptions & { readonly data: { readonly url: string } },
  ): Promise<void>;
  windows(): Promise<readonly AlertWindow[]>;
  openWindow(url: string): Promise<unknown>;
}

/** The payload, validated; `null` when it is not a well-formed alert. */
export function parseAlert(data: { json(): unknown } | null | undefined): AdminAlertPayload | null {
  if (!data) return null;
  try {
    const result = adminAlertPayloadSchema.safeParse(data.json());
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** `push`: always a notification (browsers require one per push). */
export async function handleAlertPush(
  worker: AlertWorker,
  data: { json(): unknown } | null | undefined,
): Promise<void> {
  const alert = parseAlert(data);
  const locale = alert?.l ?? 'en';
  await worker.showNotification(alert?.t ?? pushText('fallbackTitle', locale), {
    body: alert?.b ?? pushText('fallbackBody', locale),
    icon: ALERT_ICON,
    badge: ALERT_BADGE,
    tag: alert?.tag ?? 'mc-alert',
    lang: locale,
    dir: locale === 'ur' ? 'rtl' : 'ltr',
    requireInteraction: alert !== null && alert.type !== 'test',
    data: { url: alert?.u ?? '/' },
  });
}

/** A path inside the admin app (never another origin, never a protocol-relative URL). */
const safePath = (value: unknown): string =>
  typeof value === 'string' && /^\/(?!\/)[A-Za-z0-9/_-]{0,120}$/.test(value) ? value : '/';

/** `notificationclick`: focus the open admin app at the alert's path, or open it there. */
export async function handleAlertClick(worker: AlertWorker, data: unknown): Promise<void> {
  const raw: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'url') : undefined;
  const path = safePath(raw);
  const open = (await worker.windows()).find((client) => new URL(client.url).origin === worker.origin);
  if (open) {
    await open.focus();
    await open.navigate(new URL(path, worker.origin).href);
    return;
  }
  await worker.openWindow(path);
}
