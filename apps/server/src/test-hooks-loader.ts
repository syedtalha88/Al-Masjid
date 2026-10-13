import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RouteDefinition } from '@mc/api';
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
  readonly testHookRoutes: (context: { service: 'api-public' | 'api-admin'; clock: ShiftableClock }) => unknown;
}

const isTestHookModule = (value: unknown): value is TestHookModule =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Partial<TestHookModule>).testHookRoutes === 'function';

/**
 * Loads the e2e test hooks for an API process when — and only when — test-hook mode is requested AND this
 * build contains the module. The shipped `runtime` image has no module, so even a misconfigured env cannot
 * expose hooks there; it only logs a warning.
 *
 * @param moduleUrl - location of the built module (default: next to the running entrypoint).
 * @returns the hook routes and the adjustable clock to give the app, or undefined (no hooks).
 * @throws Error when the module exists but does not have the expected shape (a broken build).
 */
export async function loadTestHooks(
  env: TestHookEnv,
  service: 'api-public' | 'api-admin',
  logger: WarnLogger,
  moduleUrl: URL = new URL('./test-hooks.mjs', import.meta.url),
): Promise<TestHooks | undefined> {
  if (!testHooksRequested(env)) return undefined;
  if (!existsSync(fileURLToPath(moduleUrl))) {
    logger.warn(
      { service },
      'test-hook mode requested, but this build has no test hooks (runtime image) — none mounted',
    );
    return undefined;
  }
  // Computed specifier: the bundler must not follow it (the module is never part of the shipped bundle).
  const loaded: unknown = await import(moduleUrl.href);
  if (!isTestHookModule(loaded)) throw new Error('test hooks: module has no testHookRoutes()');
  const clock = new ShiftableClock();
  const routes = loaded.testHookRoutes({ service, clock });
  if (!Array.isArray(routes)) throw new Error('test hooks: testHookRoutes() did not return a list');
  return { clock, routes: routes as RouteDefinition[] }; // built from @mc/api's defineRoute (same chunk)
}
