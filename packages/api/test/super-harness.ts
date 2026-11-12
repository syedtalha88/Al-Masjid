// Shared set-up for Super Admin route tests against a migrated MongoDB as api-admin's own database user (02 §4.3): the
// admin app with every route, a bootstrapped Super Admin session, a step-up switch, and invite registration.
import { randomBytes } from 'node:crypto';

import { type DbHandle, publicScope } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { buildDevSeed } from '@mc/db/seed';
import { registerCredential } from '@mc/db/state';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { ManualClock } from '@mc/shared/clock';
import request from 'supertest';
import { afterAll, beforeAll } from 'vitest';

import { createAdminApp } from '../src/app.ts';
import { sessionAuthenticator } from '../src/auth/session.ts';
import { type FieldKeyRing, hashToken, newToken } from '../src/crypto/field.ts';
import { memoryRateLimiter, type RateLimiter } from '../src/http/rate-limit.ts';
import { bootstrapSuperAdminInvite } from '../src/jobs/bootstrap-super-admin.ts';
import { type AdminRouteDeps, adminRoutes } from '../src/routes/index.ts';
import { passkeyDeps, silentLogger } from './helpers.ts';

export const ORIGIN = 'https://admin.test';
export const CSRF = { Origin: ORIGIN, 'X-MC-CSRF': '1' };

/**
 * Registers `beforeAll` / `afterAll` for a fresh test database named `name` and returns the helpers.
 *
 * @param name - test database name prefix (one per test file).
 */
export function superHarness(
  name: string,
  now = new Date('2026-10-28T08:00:00Z'),
  /** Extra route dependencies (alerts, the test-alert switch — T4.6); read on every request, so tests may change them. */
  extra: Partial<
    Pick<AdminRouteDeps, 'alerts' | 'testAlerts' | 'notifier' | 'paymentHoldMinutes' | 'media' | 'video'>
  > = {},
  /** A rate limiter kept across requests (a test of a limit); a fresh, empty one per request otherwise. */
  options: { readonly rateLimiter?: RateLimiter } = {},
) {
  const pepper = randomBytes(32);
  const keyRing: FieldKeyRing = { currentId: 'k1', keys: new Map([['k1', randomBytes(32)]]) };
  const clock = new ManualClock(now);
  let test: TestDatabase | undefined;
  let handle: DbHandle | undefined;
  let asAdmin: Awaited<ReturnType<typeof processUserHandle>> | undefined;
  let superCookie = '';

  const h = () => {
    if (!handle) throw new Error('no handle');
    return handle;
  };
  const t = () => {
    if (!test) throw new Error('no test database');
    return test;
  };
  const app = () => {
    const built = adminRoutes({
      db: h(),
      pepper,
      adminOrigin: ORIGIN,
      keyRing,
      ...passkeyDeps(ORIGIN, clock),
      ...extra,
    });
    return createAdminApp({
      logger: silentLogger(),
      release: 't',
      trustedProxyMode: 'none',
      adminOrigin: ORIGIN,
      clock,
      rateLimiter: options.rateLimiter ?? memoryRateLimiter(),
      authenticate: sessionAuthenticator({ db: h(), pepper, clock }),
      routes: built.routes,
      superRoutes: built.superRoutes,
    }).app;
  };

  /** Registers a passkey for an invite link (data layer) and returns the session cookie. */
  async function register(inviteUrlText: string): Promise<string> {
    const token = new URL(inviteUrlText).hash.slice(1);
    const sessionToken = newToken();
    await registerCredential(h(), publicScope(), {
      inviteTokenHash: hashToken(token, pepper),
      credential: {
        id: randomBytes(32),
        publicKey: randomBytes(77),
        counter: 0,
        transports: ['internal'],
        backedUp: true,
        deviceType: 'multiDevice',
        label: 'Test phone',
      },
      sessionTokenHash: hashToken(sessionToken, pepper),
      now: clock.now(),
    });
    return `__Host-mc_sess=${sessionToken}`;
  }

  /** Sets or clears the Super Admin session's step-up (★ routes need one within 5 minutes). */
  const stepUp = (on: boolean) =>
    t()
      .db.collection<{ token_hash: Buffer; step_up_at?: Date }>('admin_sessions')
      .updateOne(
        { token_hash: hashToken(superCookie.split('=')[1] ?? '', pepper) },
        on ? { $set: { step_up_at: clock.now() } } : { $unset: { step_up_at: '' } },
      );

  /** A request to `/api/super<path>` as the Super Admin (unsafe methods with Origin + CSRF). */
  const asSuper = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) => {
    const call = request(app())[method](`/api/super${path}`).set('Cookie', superCookie);
    return method === 'get' ? call : call.set(CSRF);
  };

  beforeAll(async () => {
    test = await createTestDatabase(name);
    await runMigrations(test.db, MIGRATIONS);
    asAdmin = await processUserHandle(test, 'mc_admin');
    handle = asAdmin.handle;
    const { inviteUrl } = await bootstrapSuperAdminInvite(h(), {
      displayName: 'Test Owner',
      uiLocale: 'en',
      force: false,
      adminOrigin: ORIGIN,
      pepper,
      now: clock.now(),
    });
    superCookie = await register(inviteUrl);
  });
  afterAll(async () => {
    await asAdmin?.dispose();
    await test?.dispose();
  });

  /** A request to `/api/admin<path>` with the Super Admin's session (unsafe methods with Origin + CSRF). */
  const asSuperOnAdmin = (method: 'get' | 'post' | 'put' | 'delete', path: string) => {
    const call = request(app())[method](`/api/admin${path}`).set('Cookie', superCookie);
    return method === 'get' ? call : call.set(CSRF);
  };

  /**
   * Puts the "Payment details updated" system template in the database, active (as the dev / staging seed has it):
   * a UPI change can be approved only while followers can be told (DECISIONS #160).
   */
  const activatePaymentNotice = async () => {
    const notice = buildDevSeed({ now: clock.now(), today: '2026-10-28' }).templates.find(
      (template) => template['_id'] === 'payment_details_updated',
    );
    if (!notice) throw new Error('no payment notice template in the seed');
    await t()
      .db.collection<{ _id: string }>('notice_templates')
      .replaceOne({ _id: 'payment_details_updated' }, { ...notice, status: 'active' }, { upsert: true });
  };

  return {
    app,
    asSuper,
    asSuperOnAdmin,
    stepUp,
    register,
    db: () => t().db,
    testDatabase: t,
    clock,
    activatePaymentNotice,
  };
}
