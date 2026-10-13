import type { AdjustableClock } from '@mc/shared/clock';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';

// `@mc/api/test-hooks` — e2e-only routes (10 §3). NEVER imported by the shipped server: tsdown builds this into
// apps/server/dist-test/test-hooks.mjs, which only the `runtime-test` image contains (DECISIONS #31), and the
// entrypoints load it only when APP_ENV=local AND NODE_ENV=test (apps/server/src/test-hooks-loader.ts). Routes
// are mounted under each API's prefix (`/api/v1/test/*`, `/api/admin/test/*`) without OpenAPI registration.
// Phase 1+ adds seed / run-job / session-injection hooks here.

/** Present in every bundle that contains this module; the build/image checks search for it. */
export const TEST_HOOKS_MARKER = 'mc-test-hooks-module' as const;

export interface TestHookContext {
  readonly service: 'api-public' | 'api-admin';
  /** The clock the process's services read. */
  readonly clock: AdjustableClock;
}

const ClockState = z.object({ now: z.iso.datetime(), marker: z.literal(TEST_HOOKS_MARKER) });

const ClockChange = z.union([
  z.strictObject({ set: z.iso.datetime() }),
  z.strictObject({
    advanceMs: z
      .int()
      .min(-366 * 24 * 60 * 60_000)
      .max(366 * 24 * 60 * 60_000),
  }),
  z.strictObject({ reset: z.literal(true) }),
]);

/**
 * The test-hook routes for one API process.
 *
 * @returns route definitions for `AppDependencies.testRoutes`.
 */
export function testHookRoutes({ service, clock }: TestHookContext): RouteDefinition[] {
  const state = () => ({ now: clock.now().toISOString(), marker: TEST_HOOKS_MARKER });
  return [
    defineRoute({
      method: 'get',
      path: '/test/clock',
      summary: `Test hook (${service}): current server time`,
      auth: 'none',
      responses: { 200: ClockState },
      handler: ({ reply }) => reply(200, state()),
    }),
    defineRoute({
      method: 'put',
      path: '/test/clock',
      summary: `Test hook (${service}): set, advance or reset the server time`,
      auth: 'none',
      request: { body: ClockChange },
      responses: { 200: ClockState },
      handler: ({ body, reply }) => {
        if ('set' in body) clock.set(new Date(body.set));
        else if ('advanceMs' in body) clock.advance(body.advanceMs);
        else clock.reset();
        return reply(200, state());
      },
    }),
  ];
}
