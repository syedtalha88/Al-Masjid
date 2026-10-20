import type { DbHandle } from '@mc/db';
import type { AdjustableClock } from '@mc/shared/clock';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { bootstrapSuperAdminInvite } from '../jobs/bootstrap-super-admin.ts';

// `@mc/api/test-hooks` — e2e-only routes (10 §3). NEVER imported by the shipped server: tsdown builds this into
// apps/server/dist-test/test-hooks.mjs, which only the `runtime-test` image contains (DECISIONS #31), and the
// entrypoints load it only when APP_ENV=local AND NODE_ENV=test (apps/server/src/test-hooks-loader.ts). Routes
// are mounted under each API's prefix (`/api/v1/test/*`, `/api/admin/test/*`) without OpenAPI registration.
// Seed hooks: api-admin's Super Admin invite (PHASE_01 T1.8 e2e). Later phases add more seed / run-job hooks here.

/** Present in every bundle that contains this module; the build/image checks search for it. */
export const TEST_HOOKS_MARKER = 'mc-test-hooks-module' as const;

/** What api-admin's seed hooks need: its own database handle and pepper (never another process's credentials). */
export interface AdminHookContext {
  readonly db: DbHandle;
  /** `SESSION_PEPPER` bytes. */
  readonly pepper: Buffer;
  readonly adminOrigin: string;
}

export interface TestHookContext {
  readonly service: 'api-public' | 'api-admin';
  /** The clock the process's services read. */
  readonly clock: AdjustableClock;
  /** api-admin only. */
  readonly admin?: AdminHookContext;
  /** Clears this process's rate-limit counters (several auth e2e specs share one client IP). */
  readonly resetRateLimits?: () => Promise<number>;
}

const InviteRequest = z.strictObject({ displayName: z.string().trim().min(1).max(60) });
const InviteCreated = z.object({ inviteUrl: z.url() });

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
export function testHookRoutes({ service, clock, admin, resetRateLimits }: TestHookContext): RouteDefinition[] {
  const state = () => ({ now: clock.now().toISOString(), marker: TEST_HOOKS_MARKER });
  const adminHooks = admin
    ? [
        defineRoute({
          method: 'post',
          path: '/test/super-admin-invite',
          summary: 'Test hook (api-admin): a new Super Admin with a register invite (e2e of the passkey flows)',
          auth: 'none',
          request: { body: InviteRequest },
          responses: { 201: InviteCreated },
          handler: async ({ body, reply }) => {
            const { inviteUrl } = await bootstrapSuperAdminInvite(admin.db, {
              displayName: body.displayName,
              uiLocale: 'en',
              force: true, // every e2e run adds its own Super Admin
              adminOrigin: admin.adminOrigin,
              pepper: admin.pepper,
              now: clock.now(),
            });
            return reply(201, { inviteUrl });
          },
        }),
      ]
    : [];
  const rateLimitHooks = resetRateLimits
    ? [
        defineRoute({
          method: 'delete',
          path: '/test/rate-limits',
          summary: `Test hook (${service}): clear the rate-limit counters`,
          auth: 'none',
          responses: { 200: z.object({ deleted: z.int().min(0) }) },
          handler: async ({ reply }) => reply(200, { deleted: await resetRateLimits() }),
        }),
      ]
    : [];
  return [
    ...adminHooks,
    ...rateLimitHooks,
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
