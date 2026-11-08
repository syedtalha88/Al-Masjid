// Admin push subscriptions (02 admin_push_subscriptions, 03 §4 `PUT` / `DELETE /auth/push`, PHASE_04 T4.6): an admin
// (or the Super Admin) saves the admin app's subscription on each phone they use; the worker's `alert-send` reads the
// subscriptions of an alert's recipients, prunes the ones the push service calls gone and notes successful deliveries.
import type { UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { StateError } from '../effects.ts';
import { oneOf, text } from '../repos/read.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { newId } from '../values.ts';

/** Phones per admin that receive alerts; the oldest subscription goes when a new phone subscribes. */
export const MAX_ADMIN_PUSH_SUBSCRIPTIONS = 5;
const LOCALES = ['en', 'hi', 'ur', 'te'] as const;

export interface AdminPushSubscription {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
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
 * allow-list by the API (04 §6).
 *
 * @throws StateError FORBIDDEN (not an admin), PUSH_ENDPOINT_IN_USE (another admin's subscription on this browser —
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
      const subscriptions = scoped(ctx, 'admin_push_subscriptions');
      await subscriptions.deleteOne({ admin_id: adminId, endpoint: subscription.endpoint });
      await subscriptions.insertOne({
        _id: newId(),
        admin_id: adminId,
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

/** Whether the signed-in admin has a subscription for `endpoint` (the admin app's alert switch). */
export async function hasAdminPushSubscription(handle: DbHandle, scope: Scope, endpoint: string): Promise<boolean> {
  const adminId = requireAdmin(scope);
  const found = await scoped({ scope, db: await handle.db() }, 'admin_push_subscriptions').findOne({
    admin_id: adminId,
    endpoint,
  });
  return found !== null;
}

/** One phone an alert goes to, with the language the admin uses the app in. */
export interface AlertTarget {
  readonly id: UUID;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly locale: (typeof LOCALES)[number];
}

/**
 * The subscriptions of an alert's recipients: every active Super Admin, or the named admins (active ones only).
 *
 * @throws StateError FORBIDDEN (not the system scope).
 */
export async function getAlertTargets(
  handle: DbHandle,
  scope: Scope,
  to: { readonly kind: 'super' } | { readonly kind: 'admins'; readonly adminIds: readonly UUID[] },
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
  return rows.flatMap((row) => {
    const endpoint = text(row, 'endpoint');
    const p256dh = text(row, 'p256dh');
    const auth = text(row, 'auth');
    if (!endpoint || !p256dh || !auth) return [];
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
