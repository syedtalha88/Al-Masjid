import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { SCRUBBED, scrubEvent, scrubString } from './scrub.ts';

// PHASE_00 T0.13 acceptance: the scrubber removes tokens, emails and phone-like strings (and more) from
// everything an error report could carry. All values below are synthetic.

describe('scrubString', () => {
  it.each([
    ['contact admin.test@example.org now', `contact ${SCRUBBED.email} now`],
    ['call +91 98765 43210 today', `call ${SCRUBBED.phone} today`],
    ['call 9876543210', `call ${SCRUBBED.phone}`],
    ['call 098765-43210', `call ${SCRUBBED.phone}`],
    ['from 203.0.113.7 via proxy', `from ${SCRUBBED.ip} via proxy`],
    ['v6 2001:db8:85a3::8a2e:370:7334 here', `v6 ${SCRUBBED.ip} here`],
    ['v6 2001:db8:0:0:1:0:0:1 full', `v6 ${SCRUBBED.ip} full`],
    ['loopback ::1 seen', `loopback ${SCRUBBED.ip} seen`],
    ['at 12:30:45 IST', 'at 12:30:45 IST'],
    ['device 6f1c2b3a-9d8e-4f7a-b6c5-0123456789ab failed', `device ${SCRUBBED.id} failed`],
    ['Authorization: Bearer abc.def-ghi_jkl', `Authorization: Bearer ${SCRUBBED.token}`],
    ['header Device 6f1c2b3a.SuperSecretValue_123', `header Device ${SCRUBBED.token}`],
    ['jwt eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMeK', `jwt ${SCRUBBED.token}`],
    ['invite Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0X2dhcnBseQ', `invite ${SCRUBBED.token}`],
    ['redis://worker:s3cret@redis:6379', `redis://${SCRUBBED.token}@redis:6379`],
  ])('%s', (input, expected) => {
    expect(scrubString(input)).toBe(expected);
  });

  it('keeps scheme, host and path of URLs but drops query strings and fragments', () => {
    expect(scrubString('GET https://app.example.test/m/AB12CD34?code=xyz&t=1#frag failed')).toBe(
      'GET https://app.example.test/m/AB12CD34 failed',
    );
  });

  it('leaves ordinary diagnostic text alone', () => {
    const text = 'TypeError: Cannot read properties of undefined (reading "map") at index-CKHhz0RM.js:12:345';
    expect(scrubString(text)).toBe(text);
    expect(scrubString('Fajr 5:15 AM, ₹1,00,000 target, 72%')).toBe('Fajr 5:15 AM, ₹1,00,000 target, 72%');
  });

  it('property: an email or a 10-digit mobile number never survives, wherever it is embedded', () => {
    const safe = fc.string({ maxLength: 20 }).map((text) => text.replace(/[\w@.+-]/g, ' '));
    const email = fc
      .tuple(fc.stringMatching(/^[a-z]{1,10}$/), fc.stringMatching(/^[a-z]{1,10}$/), fc.constantFrom('in', 'com'))
      .map(([user, host, tld]) => `${user}@${host}.${tld}`);
    const mobile = fc.stringMatching(/^[6-9]\d{9}$/);
    fc.assert(
      fc.property(safe, fc.oneof(email, mobile), safe, (before, secret, after) => {
        expect(scrubString(`${before} ${secret} ${after}`)).not.toContain(secret);
      }),
    );
  });
});

describe('scrubEvent', () => {
  const event = {
    event_id: 'a'.repeat(32),
    release: '9fc12f7a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    environment: 'staging',
    message: 'failed for user@example.org from 198.51.100.4',
    user: { id: 'device-1', ip_address: '198.51.100.4', email: 'user@example.org' },
    request: {
      url: 'https://admin.example.test/api/admin/invites/accept?token=abcdef',
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token-value', 'X-MC-CSRF': '1' },
      cookies: { '__Host-mc_sess': 'opaque' },
      data: { phone: '+91 98765 43210' },
      query_string: 'token=abcdef',
      env: { REMOTE_ADDR: '198.51.100.4' },
    },
    extra: {
      note: 'reach me at +91 98765 43210',
      Password: 'hunter2',
      session_id: 'xyz',
      push_subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } },
      nested: { deeper: ['ok', 'ping 203.0.113.9'] },
    },
    breadcrumbs: [
      { category: 'fetch', data: { url: 'https://app.example.test/api/v1/masjids/resolve?code=AB12CD34' } },
    ],
    exception: { values: [{ type: 'Error', value: 'Device 6f1c2b3a.SuperSecretValue_123 rejected' }] },
  };

  it('drops user and request cookies/headers/body/query/env; scrubs the rest', () => {
    const scrubbed = scrubEvent(event);
    expect(scrubbed).not.toHaveProperty('user');
    expect(scrubbed.request).toEqual({ url: 'https://admin.example.test/api/admin/invites/accept', method: 'POST' });
    expect(scrubbed.message).toBe(`failed for ${SCRUBBED.email} from ${SCRUBBED.ip}`);
    expect(scrubbed.extra.note).toBe(`reach me at ${SCRUBBED.phone}`);
    expect(scrubbed.extra.Password).toBe(SCRUBBED.redacted);
    expect(scrubbed.extra.session_id).toBe(SCRUBBED.redacted);
    expect(scrubbed.extra.push_subscription).toBe(SCRUBBED.redacted);
    expect(scrubbed.extra.nested.deeper).toEqual(['ok', `ping ${SCRUBBED.ip}`]);
    expect(scrubbed.breadcrumbs[0]?.data.url).toBe('https://app.example.test/api/v1/masjids/resolve');
    expect(scrubbed.exception.values[0]?.value).toBe(`Device ${SCRUBBED.token} rejected`);
  });

  it('keeps Sentry structural fields (ids, release) unchanged and does not modify the input', () => {
    const scrubbed = scrubEvent(event);
    expect(scrubbed.event_id).toBe(event.event_id);
    expect(scrubbed.release).toBe(event.release);
    expect(scrubbed.environment).toBe('staging');
    expect(event.user.email).toBe('user@example.org');
    expect(event.request.headers.Authorization).toBe('Bearer secret-token-value');
  });

  it('nothing sensitive survives anywhere in the serialized event', () => {
    const json = JSON.stringify(scrubEvent(event));
    for (const secret of ['user@example.org', '98765', '198.51.100.4', 'abcdef', 'hunter2', 'SuperSecret', 'opaque']) {
      expect(json).not.toContain(secret);
    }
  });

  it('survives cycles and very deep values', () => {
    const cyclic: Record<string, unknown> = { message: 'x' };
    cyclic['self'] = cyclic;
    expect(scrubEvent(cyclic)['self']).toBe(SCRUBBED.redacted);
    let deep: Record<string, unknown> = { leaf: 'a@b.co' };
    for (let level = 0; level < 20; level += 1) deep = { next: deep };
    expect(JSON.stringify(scrubEvent(deep))).not.toContain('a@b.co');
  });
});
