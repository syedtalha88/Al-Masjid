import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { adminAlertPayloadSchema, isAllowedPushEndpoint, pushPayloadSchema, pushSubscriptionSchema } from './push.ts';

// 04 §6: the push endpoint allow-list (no SSRF through the worker's POST), 01 §5.3 payload shape.

const P256DH = `B${'A'.repeat(86)}`; // 87 base64url characters = 65 bytes
const AUTH = 'A'.repeat(22); // 16 bytes

describe('push endpoint allow-list', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://web.push.apple.com/QGx2',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=AwYAAAB',
    'https://FCM.googleapis.com/fcm/send/x',
  ])('accepts %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/x', // not https
    'https://fcm.googleapis.com:8443/fcm/send/x', // another port
    'https://user:pw@fcm.googleapis.com/fcm/send/x', // credentials
    'https://fcm.googleapis.com.evil.example/x', // suffix trick
    'https://evilpush.apple.com/x', // not a whole label
    'https://push.apple.com/x', // the parent itself is not a push host
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/x',
    'https://notify.windows.com.attacker.test/x',
    'javascript:alert(1)',
    'not a url',
    `https://fcm.googleapis.com/${'a'.repeat(1000)}`, // over 1000 characters
  ])('refuses %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it('never accepts a host outside the allow-list (property)', () => {
    fc.assert(
      fc.property(fc.domain(), (domain) => {
        const allowed =
          ['fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(domain) ||
          domain.endsWith('.push.apple.com') ||
          domain.endsWith('.notify.windows.com');
        expect(isAllowedPushEndpoint(`https://${domain}/x`)).toBe(allowed);
      }),
    );
  });
});

describe('push subscription body', () => {
  const body = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: P256DH, auth: AUTH } };

  it('accepts the browser subscription shape (padding tolerated)', () => {
    expect(pushSubscriptionSchema.safeParse(body).success).toBe(true);
    expect(
      pushSubscriptionSchema.safeParse({ ...body, keys: { p256dh: `${P256DH}=`, auth: `${AUTH}==` } }).success,
    ).toBe(true);
  });

  it('refuses a disallowed host, malformed keys and unknown fields', () => {
    expect(pushSubscriptionSchema.safeParse({ ...body, endpoint: 'https://example.com/push' }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...body, keys: { p256dh: 'short', auth: AUTH } }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...body, keys: { p256dh: P256DH, auth: 'a+b/' } }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...body, expirationTime: null }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...body, keys: { ...body.keys, extra: 'x' } }).success).toBe(false);
  });
});

describe('push payload', () => {
  const payload = {
    v: 1,
    t: 'Masjid-e-Noor',
    b: 'Notice',
    u: '/items/seedA0000001',
    m: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    cv: 42,
    tag: 'seedA0000001',
    l: 'ur',
  };

  it('accepts the worker payload', () => {
    expect(pushPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('opens only same-origin item paths', () => {
    for (const u of ['https://evil.example/items/seedA0000001', '//evil.example/x', '/settings', '/items/x']) {
      expect(pushPayloadSchema.safeParse({ ...payload, u }).success).toBe(false);
    }
  });

  it('refuses another version, an empty title and an unknown locale', () => {
    expect(pushPayloadSchema.safeParse({ ...payload, v: 2 }).success).toBe(false);
    expect(pushPayloadSchema.safeParse({ ...payload, t: '' }).success).toBe(false);
    expect(pushPayloadSchema.safeParse({ ...payload, l: 'fr' }).success).toBe(false);
  });
});

describe('admin alert payload', () => {
  const alert = {
    v: 1,
    kind: 'alert',
    type: 'test',
    t: 'Test alert',
    b: 'Alerts reach this phone.',
    u: '/super',
    tag: 'test.1',
    l: 'en',
  };

  it('accepts an alert that opens an admin path', () => {
    expect(adminAlertPayloadSchema.safeParse(alert).success).toBe(true);
    expect(adminAlertPayloadSchema.safeParse({ ...alert, u: '/' }).success).toBe(true);
  });

  it('refuses another origin, a protocol-relative path and unknown types', () => {
    for (const u of ['https://evil.example/', '//evil.example', 'super', '/a?next=//x']) {
      expect(adminAlertPayloadSchema.safeParse({ ...alert, u }).success).toBe(false);
    }
    expect(adminAlertPayloadSchema.safeParse({ ...alert, type: 'free_text' }).success).toBe(false);
  });
});
