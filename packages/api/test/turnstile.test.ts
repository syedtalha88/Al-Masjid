import { describe, expect, it } from 'vitest';

import { SITEVERIFY_URL, turnstileVerifier } from '../src/auth/turnstile.ts';

// 04 §9: the server verifies Turnstile tokens without sending the client IP; anything odd is a refusal.

const answer =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('turnstileVerifier', () => {
  it('posts secret + response only (no remoteip) to the fixed siteverify URL', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const verify = turnstileVerifier({
      secret: 's3cret',
      hostnames: ['app.example.com'],
      fetch: (url, init) => {
        calls.push({ url, init });
        return answer({ success: true, hostname: 'app.example.com' })();
      },
    });
    expect(await verify('token-1')).toBe(true);
    expect(calls[0]?.url).toBe(SITEVERIFY_URL);
    const body = calls[0]?.init.body;
    const sent = new URLSearchParams(typeof body === 'string' ? body : '');
    expect(Object.fromEntries(sent)).toEqual({ secret: 's3cret', response: 'token-1' });
    expect(calls[0]?.init.redirect).toBe('error');
  });

  it('refuses failures, foreign hostnames, HTTP errors, junk and network errors', async () => {
    const make = (fetch: Parameters<typeof turnstileVerifier>[0]['fetch']) =>
      turnstileVerifier({ secret: 's', hostnames: ['app.example.com'], ...(fetch ? { fetch } : {}) });
    expect(await make(answer({ success: false, 'error-codes': ['timeout-or-duplicate'] }))('t')).toBe(false);
    expect(await make(answer({ success: true, hostname: 'evil.example' }))('t')).toBe(false);
    expect(await make(answer({ success: true }))('t')).toBe(false);
    expect(await make(answer({ success: true, hostname: 'app.example.com' }, 500))('t')).toBe(false);
    expect(await make(answer(null))('t')).toBe(false);
    expect(await make(() => Promise.resolve(new Response('not json')))('t')).toBe(false);
    expect(await make(() => Promise.reject(new Error('offline')))('t')).toBe(false);
  });

  it('skips the hostname check for test secrets (hostnames: null)', async () => {
    const verify = turnstileVerifier({
      secret: '1x0000000000000000000000000000000AA',
      hostnames: null,
      fetch: answer({ success: true, hostname: 'example.com' }),
    });
    expect(await verify('XXXX.DUMMY.TOKEN.XXXX')).toBe(true);
  });
});
