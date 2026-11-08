// "Alerts on this phone" (PHASE_04 T4.6, 03 §4 `PUT` / `DELETE /auth/push`): an admin or the Super Admin lets this
// phone receive their alerts (a possible cloned passkey, a stuck notification job; payment and moderation alerts in
// later phases). The browser prompt follows a tap only; the subscription is sent again on every app open (the server
// keeps ≤ 5 phones per admin, and another admin signed in on this browser gets a fresh subscription — 409).
import { ProblemError } from '@mc/shared/http';
import { useEffect, useState } from 'react';

import { authApi } from '../auth/api/auth-api.ts';

export type AlertStatus = 'on' | 'off' | 'blocked' | 'install-first' | 'unsupported';

const vapidKey = (): string => {
  const value: unknown = import.meta.env['VITE_PUBLIC_VAPID_PUBLIC_KEY'];
  return typeof value === 'string' ? value : '';
};

const supported = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;

const iosBrowserTab = (): boolean =>
  /iP(hone|od|ad)/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;

const manager = async () => (await navigator.serviceWorker.ready).pushManager;

const bodyOf = (subscription: PushSubscription) => {
  const json = subscription.toJSON();
  const p256dh = json.keys?.['p256dh'];
  const auth = json.keys?.['auth'];
  if (!json.endpoint || !p256dh || !auth) throw new Error('push subscription without keys');
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
};

/** Sends the subscription; another admin's endpoint on this browser → a fresh subscription, sent once. */
async function send(subscription: PushSubscription): Promise<void> {
  try {
    await authApi.savePush(bodyOf(subscription));
  } catch (error) {
    if (!(error instanceof ProblemError && error.problem.code === 'PUSH_ENDPOINT_IN_USE')) throw error;
    await subscription.unsubscribe();
    const fresh = await (await manager()).subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() });
    await authApi.savePush(bodyOf(fresh));
  }
}

async function statusNow(): Promise<AlertStatus> {
  if (!supported()) return 'unsupported';
  if (iosBrowserTab()) return 'install-first';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  return (await (await manager()).getSubscription()) ? 'on' : 'off';
}

/** Re-sends an existing subscription after sign-in / on app open (never prompts). */
export async function refreshAlertSubscription(): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  const subscription = await (await manager()).getSubscription();
  if (subscription) await send(subscription);
}

/** Stops alerts on this phone before signing out (best effort: the session is about to end). */
export async function stopAlertsOnSignOut(): Promise<void> {
  if (!supported()) return;
  const subscription = await (await manager()).getSubscription().catch(() => null);
  if (!subscription) return;
  await authApi.removePush(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}

export function useAlerts() {
  const [status, setStatus] = useState<AlertStatus>('off');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const read = () => {
      void statusNow().then((next) => {
        if (active) setStatus(next);
      });
    };
    read();
    document.addEventListener('visibilitychange', read);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', read);
    };
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    } finally {
      setStatus(await statusNow());
      setBusy(false);
    }
  };

  return {
    status,
    busy,
    failed,
    /** From a tap only: asks the browser, subscribes, sends the subscription. */
    enable: () =>
      run(async () => {
        const permission =
          Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
        if (permission !== 'granted') return;
        const pushManager = await manager();
        const subscription =
          (await pushManager.getSubscription()) ??
          (await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() }));
        await send(subscription);
      }),
    disable: () =>
      run(async () => {
        const subscription = await (await manager()).getSubscription();
        if (!subscription) return;
        await authApi.removePush(subscription.endpoint);
        await subscription.unsubscribe();
      }),
  };
}
