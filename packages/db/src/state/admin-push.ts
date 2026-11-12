// Admin push subscriptions (02 admin_push_subscriptions, 03 §4 `PUT` / `DELETE /auth/push`, PHASE_04 T4.6): an admin
// (or the Super Admin) saves the admin app's subscription on each phone they use; the worker's `alert-send` reads the
// subscriptions of an alert's recipients, prunes the ones the push service calls gone and notes successful deliveries.
// Each subscription belongs to the session that saved it (F65, DECISIONS #159): alerts reach a phone only while that
// session is alive — signed out, revoked or expired, and the phone hears nothing more until someone signs in on it again.
import type { Db, UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { StateError } from '../effects.ts';
import { oneOf, text } from '../repos/read.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { newId } from '../values.ts';

/** Phones per admin that receive alerts; the oldest subscription goes when a new phone subscribes. */
export const MAX_ADMIN_PUSH_SUBSCRIPTIONS = 5;
const LOCALES = ['en', 'hi', 'ur', 'te'] as const;
const ROLES = ['super_admin', 'masjid_admin'] as const;
type AdminRole = (typeof ROLES)[number];
const DAY_MS = 86_400_000;
/**
 * How long a Super Admin's phone keeps receiving alerts after its session was last used (DECISIONS #159). The Super
 * Admin's session itself is short (30 minutes idle, 04 §4), but takedown and legal-order alerts have deadlines of
 * hours (05 §3) and must reach the owner who is not in the app. Signing out or a revoke still stops them at once.
 */
export const SUPER_ALERT_WINDOW_MS = 30 * DAY_MS;

export interface AdminPushSubscription {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  /** The signed-in session that saves it (from the session cookie — never from request input). */
  readonly sessionId: UUID;
}

interface SessionRow {
  _id: UUID;
  admin_id: UUID;
  last_seen_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  revoked_at?: Date;
}

/**
 * Is the session a subscription hangs on still good for alerts? Never when revoked. A masjid admin's: until it
 * expires (idle or absolute). A Super Admin's: until {@link SUPER_ALERT_WINDOW_MS} after it was last used.
 *
 * @returns whether alerts may still go to the phone that saved its subscription in this session.
 */
export function sessionCarriesAlerts(
  session: Pick<SessionRow, 'last_seen_at' | 'idle_expires_at' | 'absolute_expires_at' | 'revoked_at'>,
  role: AdminRole,
  now: Date,
): boolean {
  if (session.revoked_at) return false;
  if (role === 'super_admin') return now.getTime() - session.last_seen_at.getTime() < SUPER_ALERT_WINDOW_MS;
  return session.idle_expires_at > now && session.absolute_expires_at > now;
}

const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

function requireAdmin(scope: Scope): UUID {
  if (scope.kind !== 'admin' && scope.kind !== 'super') throw new StateError('FORBIDDEN');
  return scope.adminId;
}

/**
 * Saves the signed-in admin's subscription (the same endpoint again replaces its keys) and keeps at most
 * {@link MAX_ADMIN_PUSH_SUBSCRIPTIONS} per admin, newest first. The endpoint was checked against the push-service
 * allow-list by the API (04 §6). The subscription is tied to `subscription.sessionId` (F65): saving it again from a
 * new session moves it there.
 *
 * @throws StateError FORBIDDEN (not an admin, or not a session of this admin that is still open), PUSH_ENDPOINT_IN_USE (another admin's subscription on this browser —
 *   the app makes a fresh subscription and retries).
 */
export async function saveAdminPushSubscription(
  handle: DbHandle,
  scope: Scope,
  subscription: AdminPushSubscription,
  now: Date,
): Promise<void> {
  const adminId = requireAdmin(scope);
  try {
    await withTransaction(handle, scope, async (ctx) => {
      const session = await ctx.db
        .collection<SessionRow>('admin_sessions')
        .findOne(
          { _id: subscription.sessionId, admin_id: adminId, revoked_at: { $exists: false } },
          { session: ctx.session, projection: { _id: 1 } },
        );
      if (!session) throw new StateError('FORBIDDEN');
      const subscriptions = scoped(ctx, 'admin_push_subscriptions');
      await subscriptions.deleteOne({ admin_id: adminId, endpoint: subscription.endpoint });
      await subscriptions.insertOne({
        _id: newId(),
        admin_id: adminId,
        session_id: subscription.sessionId,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        created_at: now,
      });
      const own = await subscriptions.find({ admin_id: adminId }, { sort: { created_at: -1 } });
      for (const extra of own.slice(MAX_ADMIN_PUSH_SUBSCRIPTIONS))
        await subscriptions.deleteOne({ _id: extra['_id'] as UUID });
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw new StateError('PUSH_ENDPOINT_IN_USE');
    throw error;
  }
}

/**
 * Removes the signed-in admin's subscription for `endpoint` (sign-out, alerts turned off). Idempotent.
 *
 * @throws StateError FORBIDDEN (not an admin).
 */
export async function removeAdminPushSubscription(handle: DbHandle, scope: Scope, endpoint: string): Promise<void> {
  const adminId = requireAdmin(scope);
  await scoped({ scope, db: await handle.db() }, 'admin_push_subscriptions').deleteOne({ admin_id: adminId, endpoint });
}

/** One phone an alert goes to, with the language the admin uses the app in. */
export interface AlertTarget {
  readonly id: UUID;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly locale: (typeof LOCALES)[number];
}

type Row = Record<string, unknown>;
const hex = (id: unknown) => (id as UUID).toHexString();
const rolesOf = (admins: readonly Row[]): Map<string, AdminRole> =>
  new Map(admins.map((admin) => [hex(admin['_id']), oneOf(admin, 'role', ROLES)] as const));

/** The ids of the sessions, among these subscriptions', that still carry alerts. */
async function liveSessionIds(
  db: Db,
  rows: readonly Row[],
  roleOf: ReadonlyMap<string, AdminRole>,
  now: Date,
): Promise<Set<string>> {
  const ids = rows.flatMap((row) => (row['session_id'] ? [row['session_id'] as UUID] : []));
  if (ids.length === 0) return new Set();
  const sessions = await db
    .collection<SessionRow>('admin_sessions')
    .find({ _id: { $in: ids }, revoked_at: { $exists: false } }, { projection: { token_hash: 0 } })
    .toArray();
  return new Set(
    sessions
      .filter((session) => {
        const role = roleOf.get(hex(session.admin_id));
        return role !== undefined && sessionCarriesAlerts(session, role, now);
      })
      .map((session) => hex(session._id)),
  );
}

/**
 * The subscriptions of an alert's recipients: every active Super Admin, or the named admins (active ones only) —
 * and of those, only the phones whose session still carries alerts (see {@link sessionCarriesAlerts}). A subscription
 * saved before F65, without a session, is never a target — the app saves it again on its next open.
 *
 * @throws StateError FORBIDDEN (not the system scope).
 */
export async function getAlertTargets(
  handle: DbHandle,
  scope: Scope,
  to: { readonly kind: 'super' } | { readonly kind: 'admins'; readonly adminIds: readonly UUID[] },
  now: Date,
): Promise<AlertTarget[]> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const db = await handle.db();
  const admins = await scoped({ scope, db }, 'admin_users').find(
    to.kind === 'super'
      ? { role: 'super_admin', status: 'active' }
      : { _id: { $in: [...to.adminIds] }, status: 'active' },
  );
  if (admins.length === 0) return [];
  const localeOf = new Map(
    admins.map((admin) => [(admin['_id'] as UUID).toHexString(), oneOf(admin, 'ui_locale', LOCALES)] as const),
  );
  const rows = await scoped({ scope, db }, 'admin_push_subscriptions').find({
    admin_id: { $in: admins.map((admin) => admin['_id'] as UUID) },
  });
  const live = await liveSessionIds(db, rows, rolesOf(admins), now);
  return rows.flatMap((row) => {
    const endpoint = text(row, 'endpoint');
    const p256dh = text(row, 'p256dh');
    const auth = text(row, 'auth');
    if (!endpoint || !p256dh || !auth || !row['session_id'] || !live.has(hex(row['session_id']))) return [];
    const locale = localeOf.get((row['admin_id'] as UUID).toHexString()) ?? 'en';
    return [{ id: row['_id'] as UUID, endpoint, p256dh, auth, locale }];
  });
}

/**
 * After an alert send: deletes the subscriptions the push service called gone, notes delivery on the others.
 *
 * @throws StateError FORBIDDEN (not the system scope).
 */
export async function recordAlertDelivery(
  handle: DbHandle,
  scope: Scope,
  result: { readonly delivered: readonly UUID[]; readonly gone: readonly UUID[] },
  now: Date,
): Promise<void> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const subscriptions = scoped({ scope, db: await handle.db() }, 'admin_push_subscriptions');
  for (const id of result.gone) await subscriptions.deleteOne({ _id: id });
  if (result.delivered.length > 0)
    await subscriptions.updateMany({ _id: { $in: [...result.delivered] } }, { $set: { last_ok_at: now } });
}

/**
 * Housekeeping (the worker's daily `retention` job): deletes the subscriptions whose session no longer carries alerts
 * — revoked, expired, deleted, of an admin who is not active any more, or saved before sessions were linked (F65).
 * `getAlertTargets` already skips them; this removes the stored endpoint and keys (data minimisation, 05 §1).
 *
 * @returns how many subscriptions were deleted.
 * @throws StateError FORBIDDEN (not the system scope).
 */
export async function pruneAdminPushSubscriptions(handle: DbHandle, scope: Scope, now: Date): Promise<number> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const db = await handle.db();
  const subscriptions = scoped({ scope, db }, 'admin_push_subscriptions');
  const rows = await subscriptions.find({});
  if (rows.length === 0) return 0;
  const admins = await scoped({ scope, db }, 'admin_users').find({
    _id: { $in: rows.map((row) => row['admin_id'] as UUID) },
    status: 'active',
  });
  const live = await liveSessionIds(db, rows, rolesOf(admins), now);
  let deleted = 0;
  for (const row of rows) {
    if (row['session_id'] && live.has(hex(row['session_id']))) continue;
    await subscriptions.deleteOne({ _id: row['_id'] as UUID });
    deleted += 1;
  }
  return deleted;
}
