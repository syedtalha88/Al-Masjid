import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { createLogger, JobQueues, PushTransport, RouteDefinition } from '@mc/api';
import type { DbHandle } from '@mc/db';
import { ShiftableClock } from '@mc/shared/clock';

/** The one logger method the loader needs (pino-compatible). */
export interface WarnLogger {
  warn(context: object, message: string): void;
}

/** What an entrypoint passes to createPublicApp / createAdminApp in test-hook mode. */
export interface TestHooks {
  readonly clock: ShiftableClock;
  readonly routes: readonly RouteDefinition[];
}

/** The env fields that gate test hooks (10 §3: APP_ENV=local AND NODE_ENV=test, nothing else). */
export interface TestHookEnv {
  readonly APP_ENV: 'local' | 'staging' | 'production';
  readonly NODE_ENV: 'development' | 'test' | 'production';
}

/** True only for the local test stack. Staging/production also force NODE_ENV=production (env.ts). */
export const testHooksRequested = (env: TestHookEnv): boolean => env.APP_ENV === 'local' && env.NODE_ENV === 'test';

/** Shape of the separately built module (dist-test/test-hooks.mjs → runtime-test image only). */
interface TestHookModule {
  readonly testHookRoutes: (context: {
    service: 'api-public' | 'api-admin';
    clock: ShiftableClock;
    admin?: AdminHookContext;
    resetRateLimits?: () => Promise<number>;
    redis?: CapturedPushReader;
  }) => unknown;
}

/** The worker's side of the module: the push service that only records (PHASE_04 T4.9). */
interface WorkerTestHookModule {
  readonly capturePushTransport: (redis: CapturedPushWriter) => unknown;
}

/** api-admin's read access to the captured pushes (its own Redis connection). */
export interface CapturedPushReader {
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}
/** The worker's write access to the captured pushes (its own Redis connection). */
export interface CapturedPushWriter {
  lpush(key: string, value: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
}

/** What an entrypoint can hand its hooks besides the clock. */
export interface TestHookExtras {
  readonly admin?: AdminHookContext;
  readonly resetRateLimits?: () => Promise<number>;
  /** api-admin: reads the pushes the runtime-test worker captured. */
  readonly redis?: CapturedPushReader;
}

/**
 * api-admin's seed hooks get its own DB handle and pepper, and its queues + logger for the `payment-activate` hook (same
 * shape as @mc/api's AdminHookContext).
 */
export interface AdminHookContext {
  readonly db: DbHandle;
  readonly pepper: Buffer;
  readonly adminOrigin: string;
  readonly queues?: JobQueues;
  readonly logger?: ReturnType<typeof createLogger>;
}

const isTestHookModule = (value: unknown): value is TestHookModule =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Partial<TestHookModule>).testHookRoutes === 'function';

const isWorkerTestHookModule = (value: unknown): value is WorkerTestHookModule =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Partial<WorkerTestHookModule>).capturePushTransport === 'function';

/** The built module when test-hook mode is requested and this build has it; logs and returns undefined otherwise. */
async function importTestHookModule(
  env: TestHookEnv,
  service: 'api-public' | 'api-admin' | 'worker',
  logger: WarnLogger,
  moduleUrl: URL,
): Promise<unknown> {
  if (!testHooksRequested(env)) return undefined;
  if (!existsSync(fileURLToPath(moduleUrl))) {
    logger.warn(
      { service },
      'test-hook mode requested, but this build has no test hooks (runtime image) — none mounted',
    );
    return undefined;
  }
  // Computed specifier: the bundler must not follow it (the module is never part of the shipped bundle).
  // eslint-disable-next-line no-restricted-syntax -- a fixed file URL next to this bundle, not a module name (review L4)
  return (await import(moduleUrl.href)) as unknown;
}

/**
 * Loads the e2e test hooks for an API process when — and only when — test-hook mode is requested AND this
 * build contains the module. The shipped `runtime` image has no module, so even a misconfigured env cannot
 * expose hooks there; it only logs a warning.
 *
 * @param moduleUrl - location of the built module (default: next to the running entrypoint).
 * @param extras - api-admin's seed-hook context, the process's rate-limit reset, api-admin's captured-push reader.
 * @returns the hook routes and the adjustable clock to give the app, or undefined (no hooks).
 * @throws Error when the module exists but does not have the expected shape (a broken build).
 */
export async function loadTestHooks(
  env: TestHookEnv,
  service: 'api-public' | 'api-admin',
  logger: WarnLogger,
  moduleUrl: URL = new URL('./test-hooks.mjs', import.meta.url),
  extras: TestHookExtras = {},
): Promise<TestHooks | undefined> {
  const loaded = await importTestHookModule(env, service, logger, moduleUrl);
  if (loaded === undefined) return undefined;
  if (!isTestHookModule(loaded)) throw new Error('test hooks: module has no testHookRoutes()');
  const clock = new ShiftableClock();
  const routes = loaded.testHookRoutes({ service, clock, ...extras });
  if (!Array.isArray(routes)) throw new Error('test hooks: testHookRoutes() did not return a list');
  return { clock, routes: routes as RouteDefinition[] }; // built from @mc/api's defineRoute (same chunk)
}

/**
 * The worker's e2e push service (PHASE_04 T4.9): in the runtime-test stack only — same gate and same separately built
 * module as the API hooks — every push is recorded in Redis instead of sent. The shipped image has no module.
 *
 * @param redis - the worker's own connection.
 * @returns the capturing transport, or undefined (send for real).
 * @throws Error when the module exists but does not have the expected shape (a broken build).
 */
export async function loadWorkerPushTransport(
  env: TestHookEnv,
  logger: WarnLogger,
  redis: CapturedPushWriter,
  moduleUrl: URL = new URL('./test-hooks.mjs', import.meta.url),
): Promise<PushTransport | undefined> {
  const loaded = await importTestHookModule(env, 'worker', logger, moduleUrl);
  if (loaded === undefined) return undefined;
  if (!isWorkerTestHookModule(loaded)) throw new Error('test hooks: module has no capturePushTransport()');
  logger.warn({ service: 'worker' }, 'test-hook mode: pushes are captured in Redis, not sent');
  return loaded.capturePushTransport(redis) as PushTransport; // built from @mc/api's PushTransport (same chunk)
}
