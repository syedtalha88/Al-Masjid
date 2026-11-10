import type { DbHandle } from '@mc/db';
import type { AdjustableClock } from '@mc/shared/clock';
import { safeText } from '@mc/shared/contracts';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { bootstrapSuperAdminInvite } from '../jobs/bootstrap-super-admin.ts';
import { processPaymentActivate } from '../jobs/payments/activate.ts';
import type { createLogger } from '../logger.ts';
import type { PushTransport } from '../push/sender.ts';
import type { JobQueues } from '../queue/queues.ts';

// `@mc/api/test-hooks` — e2e-only routes (10 §3). NEVER imported by the shipped server: tsdown builds this into
// apps/server/dist-test/test-hooks.mjs, which only the `runtime-test` image contains (DECISIONS #31), and the
// entrypoints load it only when APP_ENV=local AND NODE_ENV=test (apps/server/src/test-hooks-loader.ts). Routes
// are mounted under each API's prefix (`/api/v1/test/*`, `/api/admin/test/*`) without OpenAPI registration.
// Seed hooks: api-admin's Super Admin invite (PHASE_01 T1.8 e2e). Later phases add more seed / run-job hooks here.
// Push (PHASE_04 T4.9): the runtime-test worker sends through `capturePushTransport` — nothing leaves the machine —
// and api-admin's `GET /test/push-captured` hands the captured payloads to the e2e, which delivers them to the
// browser's service worker (CDP). Only the local Redis ACL lets the worker write and api-admin read `e2e:*`.

/** Present in every bundle that contains this module; the build/image checks search for it. */
export const TEST_HOOKS_MARKER = 'mc-test-hooks-module' as const;

/** What api-admin's seed hooks need: its own database handle and pepper (never another process's credentials). */
export interface AdminHookContext {
  readonly db: DbHandle;
  /** `SESSION_PEPPER` bytes. */
  readonly pepper: Buffer;
  readonly adminOrigin: string;
  /**
   * api-admin's queues and logger: `POST /test/payment-activate` runs one `payment-activate` job here, as of this
   * process's settable clock (e2e journey 9 — the 24 h hold of 04 R1 without waiting a day).
   */
  readonly queues?: JobQueues;
  readonly logger?: ReturnType<typeof createLogger>;
}

export interface TestHookContext {
  readonly service: 'api-public' | 'api-admin';
  /** The clock the process's services read. */
  readonly clock: AdjustableClock;
  /** api-admin only. */
  readonly admin?: AdminHookContext;
  /** Clears this process's rate-limit counters (several auth e2e specs share one client IP). */
  readonly resetRateLimits?: () => Promise<number>;
  /** api-admin only: reads the pushes the runtime-test worker captured. */
  readonly redis?: { lrange(key: string, start: number, stop: number): Promise<string[]> };
}

/** The runtime-test worker's captured pushes, newest first (a list key the local Redis ACL opens to e2e only). */
export const CAPTURED_PUSH_KEY = 'e2e:push:captured';
const CAPTURED_PUSH_MAX = 500;

const CapturedPush = z.object({
  endpoint: z.string(),
  /** The payload before encryption — what the service worker decrypts. */
  payload: z.string(),
  ttl: z.string().optional(),
  urgency: z.string().optional(),
  topic: z.string().optional(),
});

/**
 * The runtime-test worker's push service: records each request (endpoint, plaintext payload, TTL / Urgency / Topic
 * headers) in Redis and answers 201 — no request leaves the machine, whatever endpoint a test registered.
 *
 * @param redis - the worker's connection (no key prefix).
 * @returns a transport for `createPushSender`.
 */
export function capturePushTransport(redis: {
  lpush(key: string, value: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
}): PushTransport {
  return async (request) => {
    const header = (name: string) => request.headers[name] ?? request.headers[name.toLowerCase()];
    const ttl = header('TTL');
    const urgency = header('Urgency');
    const topic = header('Topic');
    const record: z.infer<typeof CapturedPush> = {
      endpoint: request.endpoint,
      payload: request.plaintext,
      ...(ttl === undefined ? {} : { ttl }),
      ...(urgency === undefined ? {} : { urgency }),
      ...(topic === undefined ? {} : { topic }),
    };
    await redis.lpush(CAPTURED_PUSH_KEY, JSON.stringify(record));
    await redis.ltrim(CAPTURED_PUSH_KEY, 0, CAPTURED_PUSH_MAX - 1);
    return { status: 201, retryAfter: null };
  };
}

const InviteRequest = z.strictObject({
  displayName: safeText(60, { min: 1 }),
  uiLocale: z.enum(['en', 'hi', 'ur', 'te']).default('en'),
});
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
export function testHookRoutes({ service, clock, admin, resetRateLimits, redis }: TestHookContext): RouteDefinition[] {
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
              uiLocale: body.uiLocale,
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
  const { queues, logger } = admin ?? {};
  const paymentHooks =
    admin && queues && logger
      ? [
          defineRoute({
            method: 'post',
            path: '/test/payment-activate',
            summary:
              'Test hook (api-admin): one run of the payment-activate job as of this process clock (e2e journey 9)',
            auth: 'none',
            responses: { 200: z.object({ activated: z.int().min(0) }) },
            handler: async ({ reply }) =>
              reply(200, await processPaymentActivate({ db: admin.db, queues, clock, logger })),
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
  const pushHooks = redis
    ? [
        defineRoute({
          method: 'get',
          path: '/test/push-captured',
          summary: `Test hook (${service}): the pushes the runtime-test worker captured for one endpoint, oldest first`,
          auth: 'none',
          request: { query: z.strictObject({ endpoint: z.url() }) },
          responses: { 200: z.object({ pushes: z.array(CapturedPush) }) },
          handler: async ({ query, reply }) => {
            const rows = await redis.lrange(CAPTURED_PUSH_KEY, 0, -1);
            const pushes = rows
              .map((row) => CapturedPush.parse(JSON.parse(row)))
              .filter((push) => push.endpoint === query.endpoint)
              .reverse();
            return reply(200, { pushes });
          },
        }),
      ]
    : [];
  return [
    ...adminHooks,
    ...paymentHooks,
    ...rateLimitHooks,
    ...pushHooks,
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
