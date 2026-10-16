import { ManualClock } from '@mc/shared/clock';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { CHALLENGE_TTL_SEC, memoryChallengeStore } from '../src/auth/challenges.ts';
import { clearCookie, readCookie, SESSION_COOKIE, setCookie } from '../src/auth/cookies.ts';
import { uaSummary } from '../src/auth/user-agent.ts';

// PHASE_01 T1.8 building blocks: cookie parsing/flags (04 §4), single-use challenges (04 §3), coarse UA labels (02 §2).
const TOKEN = 'A'.repeat(43);

/** Echoes what readCookie sees, and sets/clears a cookie on demand. */
const echo = () => {
  const app = express();
  app.use((req, res) => {
    if (req.path === '/read') {
      res.json({ value: readCookie(req, SESSION_COOKIE) ?? null });
      return;
    }
    if (req.path === '/set') setCookie(res, SESSION_COOKIE, TOKEN, 2_592_000.9);
    else clearCookie(res, SESSION_COOKIE);
    res.end();
  });
  return app;
};

describe('cookies', () => {
  it('reads exactly one token-shaped value; duplicates, odd values and look-alike names are ignored', async () => {
    const read = async (cookie?: string) =>
      (
        (await (cookie ? request(echo()).get('/read').set('Cookie', cookie) : request(echo()).get('/read'))).body as {
          value: string | null;
        }
      ).value;
    expect(await read()).toBeNull();
    expect(await read(`a=1; ${SESSION_COOKIE}=${TOKEN}; b=2`)).toBe(TOKEN);
    expect(await read(`${SESSION_COOKIE}=${TOKEN}; ${SESSION_COOKIE}=${TOKEN}`)).toBeNull();
    expect(await read(`${SESSION_COOKIE}=short`)).toBeNull();
    expect(await read(`${SESSION_COOKIE}=${TOKEN}%00`)).toBeNull();
    expect(await read(`x${SESSION_COOKIE}=${TOKEN}`)).toBeNull();
    expect(await read(`mc_sess=${TOKEN}`)).toBeNull(); // without the __Host- prefix
  });

  it('sets __Host- cookies with Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain', async () => {
    const set = await request(echo()).get('/set');
    expect(set.headers['set-cookie']).toEqual([
      `${SESSION_COOKIE}=${TOKEN}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=Strict`,
    ]);
    const cleared = await request(echo()).get('/clear');
    expect(cleared.headers['set-cookie']).toEqual([
      `${SESSION_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict`,
    ]);
  });
});

describe('challenge store (memory)', () => {
  it('single use, bound to purpose + binding, expires after 5 minutes, re-issue replaces', async () => {
    const clock = new ManualClock(new Date('2026-10-16T00:00:00Z'));
    const store = memoryChallengeStore(clock);
    const first = await store.issue('register', 'invite-1');
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await store.take('login', 'invite-1')).toBeUndefined(); // other purpose
    expect(await store.take('register', 'invite-2')).toBeUndefined(); // other binding
    expect(await store.take('register', 'invite-1')).toBe(first);
    expect(await store.take('register', 'invite-1')).toBeUndefined(); // replay

    const a = await store.issue('login', 'c');
    const b = await store.issue('login', 'c');
    expect(b).not.toBe(a);
    expect(await store.take('login', 'c')).toBe(b);

    await store.issue('step_up', 's');
    clock.advance(CHALLENGE_TTL_SEC * 1000);
    expect(await store.take('step_up', 's')).toBeUndefined();
  });
});

describe('uaSummary', () => {
  it('browser + OS only', () => {
    expect(
      uaSummary(
        'Mozilla/5.0 (Linux; Android 14; 23021RAA2Y) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome on Android');
    expect(
      uaSummary(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iOS');
    expect(uaSummary('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36 Edg/141.0')).toBe(
      'Edge on Windows',
    );
    expect(uaSummary('Mozilla/5.0 (Linux; Android 14) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36')).toBe(
      'Samsung Internet on Android',
    );
    expect(uaSummary('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe(
      'Firefox on Linux',
    );
    expect(uaSummary(undefined)).toBe('Browser on Unknown');
    expect(uaSummary('Mozilla/5.0 (Linux; Android 14; SM-A145F Build/UP1A)')).not.toContain('SM-A145F');
  });
});
