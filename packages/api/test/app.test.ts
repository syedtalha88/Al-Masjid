import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createAdminApp, createPublicApp } from '../src/app.ts';
import { defineRoute, type RouteDefinition } from '../src/http/define-route.ts';
import { ApiProblem } from '../src/http/problem.ts';
import { captureLogger, silentLogger } from './helpers.ts';

const publicApp = (routes: RouteDefinition[] = [], logger = silentLogger()) =>
  createPublicApp({ logger, release: 'test-sha', trustedProxyMode: 'none', routes }).app;
const adminApp = () => createAdminApp({ logger: silentLogger(), release: 'test-sha', trustedProxyMode: 'none' }).app;

const expectProblem = (response: request.Response, status: number, code: string) => {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
  expect(response.headers['cache-control']).toBe('no-store');
  const body = JSON.parse(response.text) as Record<string, unknown>; // problem+json body
  expect(body).toMatchObject({ status, code, type: expect.stringMatching(/^urn:masjid-connect:problem:/) as unknown });
  expect(body).not.toHaveProperty('stack');
  return body;
};

describe('health', () => {
  it('GET /api/v1/health returns version info only', async () => {
    const response = await request(publicApp()).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, service: 'api-public', version: 'test-sha' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('GET /api/admin/health returns version info only', async () => {
    const response = await request(adminApp()).get('/api/admin/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, service: 'api-admin', version: 'test-sha' });
  });
});

describe('security headers (04 §7 — API JSON responses)', () => {
  it('sets the exact API header set and nothing that reveals the stack', async () => {
    const response = await request(publicApp()).get('/api/v1/health');
    expect(response.headers).toMatchObject({
      'content-security-policy': "default-src 'none';frame-ancestors 'none'",
      'strict-transport-security': 'max-age=63072000; includeSubDomains',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-site',
      'x-frame-options': 'DENY',
      'permissions-policy': expect.stringContaining('microphone=()') as unknown,
    });
    expect(response.headers).not.toHaveProperty('x-powered-by');
    expect(response.headers).not.toHaveProperty('x-robots-tag');
    expect(response.headers).not.toHaveProperty('etag');
    expect(Object.keys(response.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
  });

  it('admin responses are noindex', async () => {
    const response = await request(adminApp()).get('/api/admin/health');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('error responses carry the same headers', async () => {
    const response = await request(adminApp()).get('/api/admin/nope');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
});

describe('routing', () => {
  it('unknown API route → problem+json 404', async () => {
    expectProblem(await request(publicApp()).get('/api/v1/does-not-exist'), 404, 'NOT_FOUND');
    expectProblem(await request(adminApp()).post('/api/admin/does-not-exist'), 404, 'NOT_FOUND');
  });

  it('routes are case-sensitive and strict about trailing slashes', async () => {
    expectProblem(await request(publicApp()).get('/api/v1/HEALTH'), 404, 'NOT_FOUND');
    expectProblem(await request(publicApp()).get('/api/v1/health/'), 404, 'NOT_FOUND');
  });

  it('the public app does not serve admin routes and vice versa', async () => {
    expectProblem(await request(publicApp()).get('/api/admin/health'), 404, 'NOT_FOUND');
    expectProblem(await request(adminApp()).get('/api/v1/health'), 404, 'NOT_FOUND');
  });

  it('CORS preflight → 403, no CORS headers', async () => {
    const response = await request(publicApp())
      .options('/api/v1/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expectProblem(response, 403, 'CORS_NOT_ALLOWED');
    expect(response.headers).not.toHaveProperty('access-control-allow-origin');
  });
});

describe('request id', () => {
  it('generates one when absent and echoes a well-formed incoming one', async () => {
    const generated = await request(publicApp()).get('/api/v1/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await request(publicApp()).get('/api/v1/health').set('X-Request-Id', 'abc12345-from-caddy');
    expect(echoed.headers['x-request-id']).toBe('abc12345-from-caddy');
  });

  it('replaces a malformed incoming id (log-injection guard)', async () => {
    const response = await request(publicApp()).get('/api/v1/health').set('X-Request-Id', 'bad id\twith spaces');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is included in problem bodies', async () => {
    const response = await request(publicApp()).get('/api/v1/nope').set('X-Request-Id', 'req-12345678');
    expect(expectProblem(response, 404, 'NOT_FOUND')['requestId']).toBe('req-12345678');
  });
});

describe('error mapper', () => {
  const throwing = defineRoute({
    method: 'get',
    path: '/boom',
    summary: 'test',
    auth: 'none',
    responses: { 200: z.object({}) },
    handler: () => {
      throw new Error('MongoServerError: connection to 10.0.0.5 failed for user mc_admin at /srv/db.ts:42');
    },
  });

  it('never returns stack traces or internal messages, and logs the error with the request id', async () => {
    const { logger, lines } = captureLogger();
    const response = await request(publicApp([throwing], logger))
      .get('/api/v1/boom')
      .set('X-Request-Id', 'req-boom-0001');
    const body = expectProblem(response, 500, 'INTERNAL_ERROR');
    expect(response.text).not.toMatch(/MongoServerError|10\.0\.0\.5|mc_admin|db\.ts|at /);
    expect(body).toEqual({
      type: 'urn:masjid-connect:problem:internal-error',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
      requestId: 'req-boom-0001',
    });
    const logged = lines().find((line) => line['msg'] === 'unhandled error');
    expect(logged).toMatchObject({ requestId: 'req-boom-0001', level: 50 });
  });

  it('a ZodError from server-side parsing is a 500, not a client error', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/bad-document',
      summary: 'test',
      auth: 'none',
      responses: { 200: z.object({}) },
      handler: ({ reply }) => {
        z.object({ status: z.literal('active') }).parse({ status: 'corrupt' });
        return reply(200, {});
      },
    });
    const body = expectProblem(await request(publicApp([route])).get('/api/v1/bad-document'), 500, 'INTERNAL_ERROR');
    expect(body).not.toHaveProperty('errors');
  });

  it('renders ApiProblem with its status, code and safe detail', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/teapot',
      summary: 'test',
      auth: 'none',
      responses: { 200: z.object({}) },
      handler: () => {
        throw new ApiProblem(404, 'NOT_FOUND', 'No such masjid.');
      },
    });
    const body = expectProblem(await request(publicApp([route])).get('/api/v1/teapot'), 404, 'NOT_FOUND');
    expect(body['detail']).toBe('No such masjid.');
  });
});

describe('query parsing (R11)', () => {
  const echo = defineRoute({
    method: 'get',
    path: '/echo',
    summary: 'test',
    auth: 'none',
    request: { query: z.object({ 'a[$ne]': z.string().optional(), a: z.string().optional() }) },
    responses: { 200: z.object({ literalKeyType: z.string(), aType: z.string() }) },
    handler: ({ query, reply }) => reply(200, { literalKeyType: typeof query['a[$ne]'], aType: typeof query.a }),
  });

  it('`?a[$ne]=1` arrives as a plain string under a literal key, never as an operator object', async () => {
    const response = await request(publicApp([echo])).get('/api/v1/echo?a[$ne]=1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ literalKeyType: 'string', aType: 'undefined' });
  });

  it('unknown query keys and repeated keys are rejected', async () => {
    const strictRoute = defineRoute({
      method: 'get',
      path: '/strict',
      summary: 'test',
      auth: 'none',
      request: { query: z.object({ a: z.string().optional() }) },
      responses: { 200: z.object({}) },
      handler: ({ reply }) => reply(200, {}),
    });
    const app = publicApp([strictRoute]);
    const injected = expectProblem(await request(app).get('/api/v1/strict?a[$ne]=1'), 400, 'VALIDATION_FAILED');
    expect(injected['errors']).toEqual([{ path: 'query', code: 'unrecognized_keys' }]);
    const repeated = expectProblem(await request(app).get('/api/v1/strict?a=1&a=2'), 400, 'VALIDATION_FAILED');
    expect(repeated['errors']).toEqual([{ path: 'query.a', code: 'invalid_type' }]);
  });
});

describe('JSON bodies', () => {
  const create = defineRoute({
    method: 'post',
    path: '/things',
    summary: 'test',
    auth: 'none',
    request: {
      body: z.object({ name: z.string().max(20), tags: z.array(z.object({ label: z.string() })).optional() }),
    },
    responses: { 201: z.object({ name: z.string() }) },
    handler: ({ body, reply }) => reply(201, { name: body.name }),
  });
  const app = () => publicApp([create]);

  it('accepts valid JSON', async () => {
    const response = await request(app()).post('/api/v1/things').send({ name: 'ok' });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ name: 'ok' });
  });

  it('rejects non-JSON bodies with 415', async () => {
    expectProblem(
      await request(app())
        .post('/api/v1/things')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('name=ok'),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  });

  it('rejects malformed JSON with 400 and oversized bodies with 413', async () => {
    expectProblem(
      await request(app()).post('/api/v1/things').set('Content-Type', 'application/json').send('{"name":'),
      400,
      'INVALID_JSON',
    );
    const big = JSON.stringify({ name: 'x'.repeat(40 * 1024) });
    expectProblem(
      await request(app()).post('/api/v1/things').set('Content-Type', 'application/json').send(big),
      413,
      'PAYLOAD_TOO_LARGE',
    );
  });

  it('rejects unsupported charsets with 415', async () => {
    expectProblem(
      await request(app())
        .post('/api/v1/things')
        .set('Content-Type', 'application/json; charset=latin1')
        .send('{"name":"x"}'),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  });

  it('rejects $-prefixed and dotted keys anywhere (NoSQL operator injection)', async () => {
    const top = expectProblem(
      await request(app()).post('/api/v1/things').send({ name: 'x', $where: 'sleep(1)' }),
      400,
      'UNSAFE_INPUT',
    );
    expect(top['errors']).toEqual([{ path: 'body.$where', code: 'unsafe_key' }]);
    const nested = expectProblem(
      await request(app())
        .post('/api/v1/things')
        .send({ name: 'x', tags: [{ label: { $ne: 1 } }] }),
      400,
      'UNSAFE_INPUT',
    );
    expect(nested['errors']).toEqual([{ path: 'body.tags[0].label.$ne', code: 'unsafe_key' }]);
    expectProblem(await request(app()).post('/api/v1/things').send({ 'profile.name': 'x' }), 400, 'UNSAFE_INPUT');
  });

  it('rejects unknown body fields (mass assignment) with field paths', async () => {
    const body = expectProblem(
      await request(app()).post('/api/v1/things').send({ name: 'x', role: 'owner' }),
      400,
      'VALIDATION_FAILED',
    );
    expect(body['errors']).toEqual([{ path: 'body', code: 'unrecognized_keys' }]);
  });

  it('rejects a body on a route that declares none', async () => {
    const ping = defineRoute({
      method: 'post',
      path: '/ping',
      summary: 'test',
      auth: 'none',
      responses: { 200: z.object({}) },
      handler: ({ reply }) => reply(200, {}),
    });
    const body = expectProblem(
      await request(publicApp([ping]))
        .post('/api/v1/ping')
        .send({ a: 1 }),
      400,
      'VALIDATION_FAILED',
    );
    expect(body['errors']).toEqual([{ path: 'body', code: 'invalid_type' }]);
    expect((await request(publicApp([ping])).post('/api/v1/ping')).status).toBe(200);
  });
});

describe('response contracts', () => {
  it('strips undeclared fields so internal data cannot leak', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/leaky',
      summary: 'test',
      auth: 'none',
      responses: { 200: z.object({ name: z.string() }) },
      handler: ({ reply }) => {
        const document = { name: 'Test Masjid Alpha', secretHash: 'abc' };
        return reply(200, document);
      },
    });
    const response = await request(publicApp([route])).get('/api/v1/leaky');
    expect(response.body).toEqual({ name: 'Test Masjid Alpha' });
  });

  it('a response that breaks its schema is a 500, not a malformed success', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/broken',
      summary: 'test',
      auth: 'none',
      responses: { 200: z.object({ count: z.number() }) },
      handler: ({ reply }) => reply(200, { count: 'many' as unknown as number }),
    });
    expectProblem(await request(publicApp([route])).get('/api/v1/broken'), 500, 'INTERNAL_ERROR');
  });

  it('honours the declared Cache-Control and 204', async () => {
    const route = defineRoute({
      method: 'delete',
      path: '/thing',
      summary: 'test',
      auth: 'none',
      cacheControl: 'private, max-age=0',
      responses: { 204: z.undefined() },
      handler: ({ reply }) => reply(204, undefined),
    });
    const response = await request(publicApp([route])).delete('/api/v1/thing');
    expect(response.status).toBe(204);
    expect(response.headers['cache-control']).toBe('private, max-age=0');
  });

  it('an undeclared status is a 500', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/odd',
      summary: 'test',
      auth: 'none',
      responses: { 200: z.object({}) },
      handler: ({ reply }) => reply(202 as 200, {}),
    });
    expectProblem(await request(publicApp([route])).get('/api/v1/odd'), 500, 'INTERNAL_ERROR');
  });
});

describe('access log', () => {
  it('logs method, path without query string, status and request id — never headers or IPs', async () => {
    const { logger, lines } = captureLogger();
    await request(publicApp([], logger))
      .get('/api/v1/health?token=SECRET-QUERY')
      .set('Authorization', 'Device SECRET-AUTH')
      .set('Cookie', 'a=SECRET-COOKIE')
      .set('X-Request-Id', 'req-log-0001');
    const raw = JSON.stringify(lines());
    expect(raw).not.toMatch(/SECRET-QUERY|SECRET-AUTH|SECRET-COOKIE|remoteAddress|127\.0\.0\.1|::1|::ffff/);
    // The unknown `token` query key is rejected (400) — the point here is what gets logged.
    const entry = lines().find((line) => line['msg'] === 'request completed');
    expect(entry).toMatchObject({
      req: { requestId: 'req-log-0001', method: 'GET', path: '/api/v1/health' },
      res: { status: 400 },
      level: 40,
    });
    expect(entry).toHaveProperty('durationMs');
  });
});
