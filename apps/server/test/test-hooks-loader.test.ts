import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createLogger, createPublicApp, startHttpServer } from '@mc/api';
import { createDbHandle } from '@mc/db';
import { ShiftableClock } from '@mc/shared/clock';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { loadTestHooks, type TestHookEnv, testHooksRequested } from '../src/test-hooks-loader.ts';

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

  it('api-admin with its admin context also gets the seed hooks; without it only the clock', async () => {
    const db = createDbHandle({ uri: 'mongodb://hooks.invalid', database: 'x', process: 'script', local: true });
    const admin = { db, pepper: Buffer.alloc(32), adminOrigin: 'https://admin.test' };
    const withAdmin = await loadTestHooks(TEST, 'api-admin', logger(), SOURCE_MODULE, admin);
    expect(withAdmin?.routes.map((r) => r.path)).toEqual(['/test/super-admin-invite', '/test/clock', '/test/clock']);
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
