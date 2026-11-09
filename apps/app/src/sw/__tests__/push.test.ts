// PHASE_04 T4.3 — the service worker's push handling with its globals mocked: a valid payload becomes the notification
// it describes (tag, lang/dir, same-origin data, badge, open apps told to refresh), an invalid one still shows the
// generic notification in the device's language; a tap focuses an open window (which navigates) or opens one, never
// another origin; a replaced subscription is sent with the device's credentials.
import { describe, expect, it, vi } from 'vitest';

import { pushMessageOf } from '../../lib/sw-protocol.ts';
import {
  FALLBACK_TAG,
  handleNotificationClick,
  handlePush,
  handleSubscriptionChange,
  NOTIFICATION_BADGE,
  NOTIFICATION_ICON,
  type PushWorker,
  type WindowClientLike,
} from '../push.ts';

const MASJID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const PAYLOAD = {
  v: 1,
  t: 'ٹیسٹ مسجد',
  b: 'Test notice',
  u: '/items/seedA0000001',
  m: MASJID,
  cv: 9,
  tag: 'seedA0000001',
  l: 'ur',
};
const DEVICE = {
  locale: 'te',
  credentials: { deviceId: MASJID, secret: 'S'.repeat(43) },
};

function windowClient(url = 'https://app.test/'): WindowClientLike & { messages: unknown[]; focused: boolean } {
  const client = {
    url,
    messages: [] as unknown[],
    focused: false,
    focus: () => {
      client.focused = true;
      return Promise.resolve(client);
    },
    postMessage: (message: unknown) => {
      client.messages.push(message);
    },
  };
  return client;
}

function worker(windows: WindowClientLike[] = []) {
  const shown: { title: string; options: unknown }[] = [];
  const opened: string[] = [];
  const badges: number[] = [];
  const mock: PushWorker = {
    origin: 'https://app.test',
    showNotification: (title, options) => {
      shown.push({ title, options });
      return Promise.resolve();
    },
    notificationCount: () => Promise.resolve(shown.length),
    setBadge: (count) => {
      badges.push(count);
      return Promise.resolve();
    },
    windows: () => Promise.resolve(windows),
    openWindow: (url) => {
      opened.push(url);
      return Promise.resolve(null);
    },
    readDevice: () => Promise.resolve(DEVICE),
  };
  return { mock, shown, opened, badges };
}
const data = (value: unknown) => ({ json: () => value });

describe('push event', () => {
  it('a valid payload: its title, body, item tag, RTL for Urdu, same-origin data; badge; open apps refresh', async () => {
    const open = windowClient();
    const { mock, shown, badges } = worker([open]);
    await handlePush(mock, data(PAYLOAD));
    expect(shown).toEqual([
      {
        title: 'ٹیسٹ مسجد',
        options: {
          body: 'Test notice',
          icon: NOTIFICATION_ICON,
          badge: NOTIFICATION_BADGE,
          tag: 'seedA0000001',
          renotify: false,
          lang: 'ur',
          dir: 'rtl',
          data: { url: '/items/seedA0000001', masjidId: MASJID, cv: 9 },
        },
      },
    ]);
    expect(badges).toEqual([1]);
    expect(open.messages).toEqual([{ type: 'PUSH_RECEIVED', masjidId: MASJID }]);
  });

  it.each([
    ['no data', null],
    ['not JSON', { json: () => JSON.parse('{oops') as unknown }],
    ['another version', data({ ...PAYLOAD, v: 2 })],
    ['a foreign URL', data({ ...PAYLOAD, u: 'https://evil.example/items/seedA0000001' })],
    ['a protocol-relative URL', data({ ...PAYLOAD, u: '//evil.example/x' })],
    ['missing fields', data({ t: 'only a title' })],
  ])('%s: the generic notification is still shown, in the device language, opening Updates', async (_label, push) => {
    const open = windowClient();
    const { mock, shown } = worker([open]);
    await handlePush(mock, push);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      title: 'మసీదు సమాచారం',
      options: { tag: FALLBACK_TAG, lang: 'te', dir: 'ltr', data: { url: '/updates' } },
    });
    expect(open.messages).toEqual([]);
  });
});

describe('notificationclick', () => {
  it('an open app window is focused and told to open the item', async () => {
    const open = windowClient('https://app.test/masjids');
    const { mock, opened } = worker([windowClient('https://other.example/'), open]);
    await handleNotificationClick(mock, { url: '/items/seedA0000001', masjidId: MASJID });
    expect(open.focused).toBe(true);
    expect(open.messages).toEqual([{ type: 'PUSH_OPEN', url: '/items/seedA0000001', masjidId: MASJID }]);
    expect(opened).toEqual([]);
    expect(pushMessageOf(open.messages[0])).toEqual(open.messages[0]); // the page accepts it
  });

  it('no window: one opens at the item', async () => {
    const { mock, opened } = worker([]);
    await handleNotificationClick(mock, { url: '/items/seedA0000001' });
    expect(opened).toEqual(['/items/seedA0000001']);
  });

  it.each([
    'https://evil.example/items/seedA0000001',
    '//evil.example/items/seedA0000001',
    '/settings/data',
    'javascript:alert(1)',
    undefined,
  ])('never opens %s — Home instead', async (url) => {
    const { mock, opened } = worker([]);
    await handleNotificationClick(mock, { url });
    expect(opened).toEqual(['/']);
  });
});

describe('pushsubscriptionchange', () => {
  const subscription = {
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'P', auth: 'A' } }),
  };

  it('sends the new subscription with the device credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));
    const sent = await handleSubscriptionChange(
      { readDevice: () => Promise.resolve(DEVICE), fetch: fetcher, apiBase: '/api/v1' },
      { newSubscription: subscription, resubscribe: () => Promise.resolve(null) },
    );
    expect(sent).toBe(true);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/devices/me/push');
    expect(init).toMatchObject({
      method: 'PUT',
      headers: { Authorization: `Device ${MASJID}.${'S'.repeat(43)}` },
      credentials: 'omit',
    });
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/new',
      keys: { p256dh: 'P', auth: 'A' },
    });
  });

  it('without a new one the worker subscribes itself; without credentials nothing is sent', async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));
    const resubscribe = vi.fn(() => Promise.resolve(subscription));
    expect(
      await handleSubscriptionChange(
        { readDevice: () => Promise.resolve(DEVICE), fetch: fetcher, apiBase: '/api/v1' },
        { newSubscription: null, resubscribe },
      ),
    ).toBe(true);
    expect(resubscribe).toHaveBeenCalledTimes(1);
    expect(
      await handleSubscriptionChange(
        { readDevice: () => Promise.resolve({}), fetch: fetcher, apiBase: '/api/v1' },
        { newSubscription: subscription, resubscribe },
      ),
    ).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('pushMessageOf (the page side)', () => {
  it('accepts only well-formed worker messages', () => {
    expect(pushMessageOf({ type: 'PUSH_RECEIVED', masjidId: MASJID })).toEqual({
      type: 'PUSH_RECEIVED',
      masjidId: MASJID,
    });
    expect(pushMessageOf({ type: 'PUSH_OPEN', url: 'https://evil.example/' })).toBeNull();
    expect(pushMessageOf({ type: 'PUSH_RECEIVED', masjidId: 'x' })).toBeNull();
    expect(pushMessageOf('PUSH_OPEN')).toBeNull();
  });
});
