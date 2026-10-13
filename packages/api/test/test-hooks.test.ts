import { readFileSync } from 'node:fs';

import { ShiftableClock } from '@mc/shared/clock';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createAdminApp, createPublicApp } from '../src/app.ts';
import { TEST_HOOKS_MARKER, testHookRoutes } from '../src/test-hooks/index.ts';
import { captureLogger, silentLogger } from './helpers.ts';

// 10 §3: e2e test hooks work when an entrypoint mounts them, and are absent from the route table and the
// OpenAPI document otherwise. (Which builds/images contain them is checked by apps/server and CI.)

const base = { release: 'test-sha', trustedProxyMode: 'none' } as const;

function withHooks(start = Date.parse('2026-10-13T10:00:00Z')) {
  let real = start;
  const clock = new ShiftableClock(() => real);
  const created = createPublicApp({
    ...base,
    logger: silentLogger(),
    clock,
    testRoutes: testHookRoutes({ service: 'api-public', clock }),
  });
  return {
    ...created,
    clock,
    tick: (ms: number) => {
      real += ms;
    },
  };
}

describe('test hooks mounted (test-hook mode)', () => {
  it('GET /test/clock reports the process clock and the module marker', async () => {
    const { app } = withHooks();
    const response = await request(app).get('/api/v1/test/clock');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ now: '2026-10-13T10:00:00.000Z', marker: TEST_HOOKS_MARKER });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('PUT sets, advances and resets the clock; time keeps flowing after a jump', async () => {
    const { app, tick } = withHooks();
    const put = async (body: object) => {
      const response = await request(app).put('/api/v1/test/clock').send(body);
      return (response.body as { now: string }).now; // shape checked by the route's response schema
    };
    expect(await put({ set: '2026-11-01T00:00:00Z' })).toBe('2026-11-01T00:00:00.000Z');
    tick(1_500);
    expect(await put({ advanceMs: 24 * 60 * 60_000 })).toBe('2026-11-02T00:00:01.500Z');
    expect(await put({ reset: true })).toBe('2026-10-13T10:00:01.500Z');
  });

  it('rejects malformed changes with VALIDATION_FAILED (strict bodies)', async () => {
    const { app } = withHooks();
    for (const body of [{ set: 'tomorrow' }, { set: '2026-11-01T00:00:00Z', extra: 1 }, { advanceMs: 1.5 }, {}]) {
      const response = await request(app).put('/api/v1/test/clock').send(body);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('the admin app mounts them under /api/admin and logs a loud warning', async () => {
    const clock = new ShiftableClock();
    const { logger, lines } = captureLogger();
    const { app } = createAdminApp({ ...base, logger, testRoutes: testHookRoutes({ service: 'api-admin', clock }) });
    expect((await request(app).get('/api/admin/test/clock')).status).toBe(200);
    expect(lines().some((line) => line['msg'] === 'TEST HOOKS ENABLED (APP_ENV=local, NODE_ENV=test)')).toBe(true);
  });

  it('are never registered in the OpenAPI registry', () => {
    const { registry } = withHooks();
    const paths = registry.definitions.flatMap((definition) =>
      definition.type === 'route' ? [definition.route.path] : [],
    );
    expect(paths).toContain('/api/v1/health');
    expect(paths.filter((path) => path.includes('/test/'))).toEqual([]);
  });
});

describe('test hooks absent (every shipped configuration)', () => {
  it('/test/clock is a plain 404 on both apps', async () => {
    const publicApp = createPublicApp({ ...base, logger: silentLogger() }).app;
    const adminApp = createAdminApp({ ...base, logger: silentLogger() }).app;
    for (const [app, path] of [
      [publicApp, '/api/v1/test/clock'],
      [adminApp, '/api/admin/test/clock'],
    ] as const) {
      const response = await request(app).put(path).send({ reset: true });
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('the committed openapi.json has no test paths', () => {
    const document = readFileSync(new URL('../openapi.json', import.meta.url), 'utf8');
    expect(document).not.toContain('/test/');
    expect(document).not.toContain(TEST_HOOKS_MARKER);
  });
});
