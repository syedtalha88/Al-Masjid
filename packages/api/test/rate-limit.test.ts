import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPublicApp } from '../src/app.ts';
import { defineRoute } from '../src/http/define-route.ts';
import { memoryRateLimiter, RATE_LIMITS, type RateLimiter } from '../src/http/rate-limit.ts';
import { silentLogger } from './helpers.ts';

// PHASE_01 T1.6: 03 §2 buckets, 429 + Retry-After, keys per client, fail-closed wiring, validation without echo.
const ping = defineRoute({
  method: 'post',
  path: '/ping',
  summary: 'test route',
  auth: 'none',
  rateLimit: [
    { bucket: 'follow', key: (req) => req.get('x-test-device') },
    { bucket: 'codeResolve', key: 'ip' },
  ],
  request: { body: z.object({ name: z.string().max(5) }) },
  responses: { 200: z.object({ ok: z.literal(true) }) },
  handler: ({ reply }) => reply(200, { ok: true }),
});

const appWith = (rateLimiter?: RateLimiter) =>
  createPublicApp({
    logger: silentLogger(),
    release: 't',
    trustedProxyMode: 'none',
    routes: [ping],
    ...(rateLimiter ? { rateLimiter } : {}),
  }).app;

const send = (app: ReturnType<typeof appWith>, device?: string, body: unknown = { name: 'a' }) => {
  const call = request(app).post('/api/v1/ping').set('Content-Type', 'application/json');
  return (device ? call.set('X-Test-Device', device) : call).send(JSON.stringify(body));
};

describe('rate limits (03 §2)', () => {
  it('the bucket table matches 03 §2', () => {
    expect(RATE_LIMITS).toMatchObject({
      deviceRegister: { points: 5, durationSec: 3600 },
      deviceRegisterIp: { points: 300, durationSec: 3600 },
      codeResolve: { points: 30, durationSec: 60 },
      follow: { points: 60, durationSec: 3600 },
      ameen: { points: 120, durationSec: 3600 },
      reports: { points: 10, durationSec: 86_400 },
      grievancesIp: { points: 5, durationSec: 86_400 },
      adminLoginIp: { points: 10, durationSec: 600 },
      adminLoginCredential: { points: 20, durationSec: 3600 },
      adminWrites: { points: 120, durationSec: 3600 },
      adminUploads: { points: 30, durationSec: 3600 },
      superWrites: { points: 600, durationSec: 3600 },
    });
  });

  it('over the limit → 429 RATE_LIMITED with Retry-After; other clients are unaffected', async () => {
    const app = appWith(memoryRateLimiter({ follow: { points: 2, durationSec: 3600 } }));
    expect((await send(app, 'device-a')).status).toBe(200);
    expect((await send(app, 'device-a')).status).toBe(200);
    const limited = await send(app, 'device-a');
    expect(limited.status).toBe(429);
    expect(limited.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(JSON.parse(limited.text)).toMatchObject({ status: 429, code: 'RATE_LIMITED', title: 'Too Many Requests' });
    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(3500);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect((await send(app, 'device-b')).status).toBe(200);
  });

  it('the IP rule still counts requests that carry no device id', async () => {
    const app = appWith(memoryRateLimiter({ codeResolve: { points: 1, durationSec: 60 } }));
    expect((await send(app)).status).toBe(200);
    const limited = await send(app);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('limits run before validation: invalid requests count too', async () => {
    const app = appWith(memoryRateLimiter({ follow: { points: 1, durationSec: 3600 } }));
    expect((await send(app, 'device-c', { name: 'too-long-name' })).status).toBe(400);
    expect((await send(app, 'device-c')).status).toBe(429);
  });

  it('a route with limits on an app without a limiter fails closed (500), never unlimited', async () => {
    const response = await send(appWith());
    expect(response.status).toBe(500);
    expect(JSON.parse(response.text)).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});

describe('validation errors (T1.6)', () => {
  it('map to VALIDATION_FAILED with field paths and never echo the input', async () => {
    const secret = 'zz-input-zz';
    const response = await send(appWith(memoryRateLimiter()), 'device-d', { name: secret, extra: secret });
    expect(response.status).toBe(400);
    const body = JSON.parse(response.text) as { code: string; detail?: string; errors: { path: string }[] };
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.detail).toBeUndefined();
    expect(body.errors.map((error) => error.path)).toEqual(expect.arrayContaining(['body.name']));
    expect(response.text).not.toContain(secret);
  });
});
