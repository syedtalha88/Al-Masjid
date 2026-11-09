// PHASE_04 T4.6 — the admin service worker's alert pushes with its globals mocked: a valid alert shows its words in
// the admin's language and opens its admin path; an invalid push still shows the generic notification; a tap focuses
// the admin app and navigates there, never to another origin.
import { describe, expect, it } from 'vitest';

import {
  ALERT_BADGE,
  ALERT_ICON,
  type AlertWindow,
  type AlertWorker,
  handleAlertClick,
  handleAlertPush,
} from '../alerts.ts';

const ALERT = {
  v: 1,
  kind: 'alert',
  type: 'credential_counter_regression',
  t: 'سیکیورٹی جانچ ضروری',
  b: 'Test body',
  u: '/account',
  tag: 'credential_counter_regression.abc',
  l: 'ur',
};

function worker(windows: AlertWindow[] = []) {
  const shown: { title: string; options: unknown }[] = [];
  const opened: string[] = [];
  const mock: AlertWorker = {
    origin: 'https://admin.test',
    showNotification: (title, options) => {
      shown.push({ title, options });
      return Promise.resolve();
    },
    windows: () => Promise.resolve(windows),
    openWindow: (url) => {
      opened.push(url);
      return Promise.resolve(null);
    },
  };
  return { mock, shown, opened };
}
const data = (value: unknown) => ({ json: () => value });

function adminWindow(url = 'https://admin.test/') {
  const state = { focused: false, navigated: [] as string[] };
  const client: AlertWindow = {
    url,
    focus: () => {
      state.focused = true;
      return Promise.resolve();
    },
    navigate: (to) => {
      state.navigated.push(to);
      return Promise.resolve();
    },
  };
  return { client, state };
}

describe('alert push', () => {
  it('a valid alert: its words, RTL for Urdu, its tag, stays until tapped (not the test alert)', async () => {
    const { mock, shown } = worker();
    await handleAlertPush(mock, data(ALERT));
    expect(shown).toEqual([
      {
        title: 'سیکیورٹی جانچ ضروری',
        options: {
          body: 'Test body',
          icon: ALERT_ICON,
          badge: ALERT_BADGE,
          tag: 'credential_counter_regression.abc',
          lang: 'ur',
          dir: 'rtl',
          requireInteraction: true,
          data: { url: '/account' },
        },
      },
    ]);
  });

  it.each([null, data({ ...ALERT, u: 'https://evil.example/' }), data({ ...ALERT, type: 'free_text' }), data('x')])(
    'an invalid push still shows the generic notification (%#)',
    async (push) => {
      const { mock, shown } = worker();
      await handleAlertPush(mock, push);
      expect(shown).toHaveLength(1);
      expect(shown[0]).toMatchObject({ title: 'Masjid update', options: { tag: 'mc-alert', data: { url: '/' } } });
    },
  );
});

describe('alert click', () => {
  it('focuses the open admin app and navigates to the alert path', async () => {
    const { client, state } = adminWindow();
    const { mock, opened } = worker([client]);
    await handleAlertClick(mock, { url: '/account' });
    expect(state).toEqual({ focused: true, navigated: ['https://admin.test/account'] });
    expect(opened).toEqual([]);
  });

  it.each(['https://evil.example/x', '//evil.example', 'javascript:alert(1)', undefined])(
    'never leaves the app for %s — opens Home',
    async (url) => {
      const { mock, opened } = worker([]);
      await handleAlertClick(mock, { url });
      expect(opened).toEqual(['/']);
    },
  );
});
