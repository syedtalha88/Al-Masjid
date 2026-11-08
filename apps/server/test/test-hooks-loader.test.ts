import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createLogger, createPublicApp, startHttpServer } from '@mc/api';
import { createDbHandle } from '@mc/db';
import { ShiftableClock } from '@mc/shared/clock';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  loadTestHooks,
  loadWorkerPushTransport,
  type TestHookEnv,
  testHooksRequested,
} from '../src/test-hooks-loader.ts';

// 10 §3 / DECISIONS #31: hooks load only for APP_ENV=local + NODE_ENV=test AND when the build has the module.

const SOURCE_MODULE = new URL('../src/test-hooks.ts', import.meta.url); // what dist-test/test-hooks.mjs is built from
const scratch = mkdtempSync(join(tmpdir(), 'mc-hooks-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const logger = () => ({ warn: vi.fn<(context: object, message: string) => void>() });
const TEST: TestHookEnv = { APP_ENV: 'local', NODE_ENV: 'test' };

describe('testHooksRequested', () => {
  it('only APP_ENV=local with NODE_ENV=test', () => {
    expect(testHooksRequested(TEST)).toBe(true);
    for (const env of [
      { APP_ENV: 'local', NODE_ENV: 'development' },
      { APP_ENV: 'local', NODE_ENV: 'production' },
      { APP_ENV: 'staging', NODE_ENV: 'test' },
      { APP_ENV: 'staging', NODE_ENV: 'production' },
      { APP_ENV: 'production', NODE_ENV: 'test' },
      { APP_ENV: 'production', NODE_ENV: 'production' },
    ] as const) {
      expect(testHooksRequested(env)).toBe(false);
    }
  });
});

describe('loadTestHooks', () => {
  it('not requested → nothing, and the module is never touched', async () => {
    const log = logger();
    const missing = pathToFileURL(join(scratch, 'does-not-exist.mjs'));
    await expect(
      loadTestHooks({ APP_ENV: 'production', NODE_ENV: 'production' }, 'api-public', log, missing),
    ).resolves.toBeUndefined();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('requested but the build has no module (runtime image) → nothing, with a warning', async () => {
    const log = logger();
    const missing = pathToFileURL(join(scratch, 'test-hooks.mjs'));
    await expect(loadTestHooks(TEST, 'api-public', log, missing)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('api-admin with its extras also gets the seed and rate-limit hooks; without them only the clock', async () => {
    const db = createDbHandle({ uri: 'mongodb://hooks.invalid', database: 'x', process: 'script', local: true });
    const admin = { db, pepper: Buffer.alloc(32), adminOrigin: 'https://admin.test' };
    const resetRateLimits = () => Promise.resolve(3);
    const redis = { lrange: () => Promise.resolve([]) };
    const withAdmin = await loadTestHooks(TEST, 'api-admin', logger(), SOURCE_MODULE, {
      admin,
      resetRateLimits,
      redis,
    });
    expect(withAdmin?.routes.map((r) => r.path)).toEqual([
      '/test/super-admin-invite',
      '/test/rate-limits',
      '/test/push-captured',
      '/test/clock',
      '/test/clock',
    ]);
    const without = await loadTestHooks(TEST, 'api-admin', logger(), SOURCE_MODULE);
    expect(without?.routes.map((r) => r.path)).toEqual(['/test/clock', '/test/clock']);
    await db.close();
  });

  it('requested and present → routes + a shiftable clock that the app serves', async () => {
    const hooks = await loadTestHooks(TEST, 'api-public', logger(), SOURCE_MODULE);
    expect(hooks?.clock).toBeInstanceOf(ShiftableClock);
    expect(hooks?.routes).toHaveLength(2);
    if (!hooks) throw new Error('no hooks');
    const silent = createLogger({ process: 'api-public', level: 'silent', release: 'test' });
    const { app } = createPublicApp({
      logger: silent,
      release: 'test',
      trustedProxyMode: 'none',
      clock: hooks.clock,
      testRoutes: hooks.routes,
    });
    const server = await startHttpServer(app, 0, '127.0.0.1', silent);
    try {
      const response = await fetch(`http://127.0.0.1:${String(server.port)}/api/v1/test/clock`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ set: '2027-01-01T00:00:00Z' }),
      });
      expect(response.status).toBe(200);
      expect(hooks.clock.now().getUTCFullYear()).toBe(2027);
    } finally {
      await server.shutdown();
    }
  });

  it('a module without testHookRoutes(), or one returning garbage, is a broken build → throws', async () => {
    const empty = join(scratch, 'empty.mjs');
    writeFileSync(empty, 'export const nothing = 1;\n');
    await expect(loadTestHooks(TEST, 'api-admin', logger(), pathToFileURL(empty))).rejects.toThrow('no testHookRoutes');
    const garbage = join(scratch, 'garbage.mjs');
    writeFileSync(garbage, 'export const testHookRoutes = () => 42;\n');
    await expect(loadTestHooks(TEST, 'api-admin', logger(), pathToFileURL(garbage))).rejects.toThrow(
      'did not return a list',
    );
  });
});

describe('loadWorkerPushTransport (PHASE_04 T4.9)', () => {
  const list = () => {
    const rows: string[] = [];
    return {
      rows,
      lpush: (_key: string, value: string) => Promise.resolve(rows.unshift(value)),
      ltrim: () => Promise.resolve('OK'),
    };
  };

  it('not requested, or no module in the build → undefined: the worker sends for real', async () => {
    const missing = pathToFileURL(join(scratch, 'test-hooks.mjs'));
    const production = { APP_ENV: 'production', NODE_ENV: 'production' } as const;
    await expect(loadWorkerPushTransport(production, logger(), list(), SOURCE_MODULE)).resolves.toBeUndefined();
    await expect(loadWorkerPushTransport(TEST, logger(), list(), missing)).resolves.toBeUndefined();
  });

  it('runtime-test: records endpoint, plaintext payload and headers; answers 201; never sends', async () => {
    const redis = list();
    const log = logger();
    const transport = await loadWorkerPushTransport(TEST, log, redis, SOURCE_MODULE);
    if (!transport) throw new Error('no transport');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const answer = await transport({
      endpoint: 'https://fcm.googleapis.com/fcm/send/e2e',
      headers: { TTL: '86400', Urgency: 'normal', Topic: 'abc' },
      body: new Uint8Array(4),
      plaintext: '{"v":1}',
    });
    expect(answer).toEqual({ status: 201, retryAfter: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(redis.rows.map((row) => JSON.parse(row) as unknown)).toEqual([
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/e2e',
        payload: '{"v":1}',
        ttl: '86400',
        urgency: 'normal',
        topic: 'abc',
      },
    ]);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('a module without capturePushTransport() is a broken build → throws', async () => {
    const empty = join(scratch, 'empty-worker.mjs');
    writeFileSync(empty, 'export const nothing = 1;\n');
    await expect(loadWorkerPushTransport(TEST, logger(), list(), pathToFileURL(empty))).rejects.toThrow(
      'no capturePushTransport',
    );
  });
});
