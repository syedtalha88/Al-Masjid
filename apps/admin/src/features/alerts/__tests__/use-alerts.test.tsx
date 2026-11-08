// @vitest-environment jsdom
import { ProblemError } from '@mc/shared/http';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authApi } from '../../auth/api/auth-api.ts';
import { refreshAlertSubscription, stopAlertsOnSignOut, useAlerts } from '../use-alerts.ts';

// PHASE_04 T4.6 (verifier gap, DECISIONS #143): "Alerts on this phone" — status per platform and permission, turning on
// (prompt only from a tap, subscribe, send; another admin's endpoint → a fresh subscription), turning off, the re-send
// on app open and the clean-up before sign-out.

vi.mock('../../auth/api/auth-api.ts', () => ({ authApi: { savePush: vi.fn(), removePush: vi.fn() } }));
const savePush = vi.mocked(authApi.savePush);
const removePush = vi.mocked(authApi.removePush);

interface FakeSubscription {
  readonly endpoint: string;
  toJSON(): { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
}
const subscriptionFor = (endpoint: string): FakeSubscription => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: 'P256DH', auth: 'AUTH' } }),
  unsubscribe: vi.fn(() => {
    current = null;
    return Promise.resolve(true);
  }),
});

let current: FakeSubscription | null = null;
let permission: NotificationPermission = 'default';
let next = 0;
const pushManager = {
  getSubscription: vi.fn(() => Promise.resolve(current)),
  subscribe: vi.fn(() => {
    next += 1;
    current = subscriptionFor(`https://fcm.googleapis.com/fcm/send/admin-${String(next)}`);
    return Promise.resolve(current);
  }),
};
const requestPermission = vi.fn((): Promise<NotificationPermission> => {
  permission = 'granted';
  return Promise.resolve(permission);
});

function installBrowser({ standalone = true, userAgent = 'Mozilla/5.0 (Linux; Android 14)' } = {}) {
  vi.stubGlobal('PushManager', function PushManager() {});
  const NotificationStub = Object.defineProperties(function Notification() {}, {
    permission: { get: () => permission }, // live: the browser's answer changes it
    requestPermission: { value: requestPermission },
  });
  vi.stubGlobal('Notification', NotificationStub);
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  });
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: standalone && query.includes('standalone') }));
}

beforeEach(() => {
  current = null;
  permission = 'default';
  next = 0;
  vi.clearAllMocks();
  savePush.mockResolvedValue(undefined);
  removePush.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('useAlerts', () => {
  it('turning on asks the browser once, subscribes and sends the subscription; turning off removes it', async () => {
    installBrowser();
    const { result } = renderHook(() => useAlerts());
    await waitFor(() => {
      expect(result.current.status).toBe('off');
    });
    await act(() => result.current.enable());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(savePush).toHaveBeenCalledWith({
      endpoint: 'https://fcm.googleapis.com/fcm/send/admin-1',
      keys: { p256dh: 'P256DH', auth: 'AUTH' },
    });
    expect(result.current.status).toBe('on');

    await act(() => result.current.disable());
    expect(removePush).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/admin-1');
    expect(result.current.status).toBe('off');
  });

  it('another admin’s endpoint on this browser (409) → a fresh subscription is sent once', async () => {
    installBrowser();
    permission = 'granted';
    current = subscriptionFor('https://fcm.googleapis.com/fcm/send/someone-else');
    savePush.mockRejectedValueOnce(
      new ProblemError({ type: 'about:blank', title: 'x', status: 409, code: 'PUSH_ENDPOINT_IN_USE' }, undefined),
    );
    const { result } = renderHook(() => useAlerts());
    await act(() => result.current.enable());
    expect(requestPermission).not.toHaveBeenCalled(); // already granted
    expect(savePush).toHaveBeenCalledTimes(2);
    expect(savePush).toHaveBeenLastCalledWith(
      expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/admin-1' }),
    );
    expect(result.current).toMatchObject({ status: 'on', failed: false });
  });

  it('a refused prompt or a server error ends in the right state; blocked, install-first and unsupported phones', async () => {
    installBrowser();
    requestPermission.mockImplementationOnce(() => {
      permission = 'denied';
      return Promise.resolve(permission);
    });
    const { result, unmount } = renderHook(() => useAlerts());
    await act(() => result.current.enable());
    expect(savePush).not.toHaveBeenCalled();
    expect(result.current.status).toBe('blocked');
    unmount();

    permission = 'granted';
    savePush.mockRejectedValueOnce(new Error('offline'));
    const again = renderHook(() => useAlerts());
    await act(() => again.result.current.enable());
    expect(again.result.current.failed).toBe(true);
    again.unmount();

    installBrowser({ standalone: false, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    const iphone = renderHook(() => useAlerts());
    await waitFor(() => {
      expect(iphone.result.current.status).toBe('install-first');
    });
    iphone.unmount();

    vi.unstubAllGlobals();
    const old = renderHook(() => useAlerts());
    await waitFor(() => {
      expect(old.result.current.status).toBe('unsupported');
    });
  });
});

describe('refreshAlertSubscription / stopAlertsOnSignOut', () => {
  it('re-sends an existing subscription without prompting; removes it before sign-out (best effort)', async () => {
    installBrowser();
    await refreshAlertSubscription(); // permission not granted: nothing
    expect(savePush).not.toHaveBeenCalled();

    permission = 'granted';
    current = subscriptionFor('https://fcm.googleapis.com/fcm/send/kept');
    await refreshAlertSubscription();
    expect(savePush).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/kept' }),
    );
    expect(requestPermission).not.toHaveBeenCalled();

    const subscription = current;
    removePush.mockRejectedValueOnce(new Error('session already gone'));
    await stopAlertsOnSignOut();
    expect(removePush).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/kept');
    expect(subscription.unsubscribe).toHaveBeenCalled();
    await stopAlertsOnSignOut(); // nothing left: no call
    expect(removePush).toHaveBeenCalledTimes(1);
  });
});
