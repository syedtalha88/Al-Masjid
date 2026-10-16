// Follow state functions (02 §3/§5 "Follow limits & counts", PHASE_01 T1.3): a device follows an active masjid —
// `devices.follow_count` is incremented only while below 20 in the same transaction as the follow insert and the
// `masjid_stats.followers` increment; unfollow reverses all three. Concurrent requests on one device conflict and are
// retried by the driver, so the limit holds.
import type { UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { StateError, writeAudit } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { newId } from '../values.ts';

export const MAX_FOLLOWS_PER_DEVICE = 20;

type IdDoc = { _id: UUID } & Record<string, unknown>;

const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

/**
 * Follows a masjid for the scope's device.
 *
 * @returns `followed`, or `already` when the device follows it already (idempotent — nothing changes).
 * @throws StateError FORBIDDEN (not a device scope), MASJID_NOT_FOUND (not active), DEVICE_NOT_FOUND,
 *   FOLLOW_LIMIT_REACHED.
 */
export async function followMasjid(handle: DbHandle, scope: Scope, masjidId: UUID): Promise<'followed' | 'already'> {
  if (scope.kind !== 'device') throw new StateError('FORBIDDEN');
  const deviceId = scope.deviceId;
  try {
    return await withTransaction(handle, scope, async (ctx) => {
      const session = { session: ctx.session };
      const masjid = await ctx.db
        .collection<{ _id: UUID; status: string; deleted_at?: Date }>('v_pub_masjid_status')
        .findOne({ _id: masjidId, status: 'active' }, session);
      if (!masjid) throw new StateError('MASJID_NOT_FOUND');
      const follows = ctx.db.collection<IdDoc>('device_follows');
      if ((await follows.countDocuments({ device_id: deviceId, masjid_id: masjidId }, session)) > 0) return 'already';
      const devices = ctx.db.collection<{
        _id: UUID;
        follow_count: number;
        audience_pref: string;
        locale: string;
        push_status: string;
      }>('devices');
      const device = await devices.findOneAndUpdate(
        { _id: deviceId, follow_count: { $lt: MAX_FOLLOWS_PER_DEVICE } },
        { $inc: { follow_count: 1 } },
        { ...session, returnDocument: 'after' },
      );
      if (!device) {
        const exists = await devices.countDocuments({ _id: deviceId }, session);
        throw new StateError(exists ? 'FOLLOW_LIMIT_REACHED' : 'DEVICE_NOT_FOUND');
      }
      await follows.insertOne(
        {
          _id: newId(),
          device_id: deviceId,
          masjid_id: masjidId,
          muted: false,
          audience_pref: device.audience_pref,
          locale: device.locale,
          push_active: device.push_status === 'active',
          created_at: new Date(),
        },
        session,
      );
      await ctx.db
        .collection<{ _id: UUID; followers: number; ameens_7d: number; updated_at: Date }>('masjid_stats')
        .updateOne(
          { _id: masjidId },
          { $inc: { followers: 1 }, $set: { updated_at: new Date() }, $setOnInsert: { ameens_7d: 0 } },
          { ...session, upsert: true },
        );
      await writeAudit(ctx, {
        action: 'device.follow',
        masjidId,
        targetType: 'masjid',
        targetId: masjidId.toHexString(),
      });
      return 'followed';
    });
  } catch (error) {
    // Two concurrent follows of the same masjid: the loser's insert hits the unique index — it is already followed.
    if (isDuplicateKey(error)) return 'already';
    throw error;
  }
}

/**
 * Unfollows a masjid for the scope's device.
 *
 * @returns `unfollowed`, or `not_following` (idempotent).
 * @throws StateError FORBIDDEN (not a device scope).
 */
export async function unfollowMasjid(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
): Promise<'unfollowed' | 'not_following'> {
  if (scope.kind !== 'device') throw new StateError('FORBIDDEN');
  const deviceId = scope.deviceId;
  return withTransaction(handle, scope, async (ctx) => {
    const session = { session: ctx.session };
    const removed = await ctx.db
      .collection<{ device_id: UUID; masjid_id: UUID }>('device_follows')
      .deleteOne({ device_id: deviceId, masjid_id: masjidId }, session);
    if (removed.deletedCount !== 1) return 'not_following';
    await ctx.db
      .collection<{ _id: UUID; follow_count: number }>('devices')
      .updateOne({ _id: deviceId, follow_count: { $gt: 0 } }, { $inc: { follow_count: -1 } }, session);
    await ctx.db
      .collection<{ _id: UUID; followers: number; updated_at: Date }>('masjid_stats')
      .updateOne(
        { _id: masjidId, followers: { $gt: 0 } },
        { $inc: { followers: -1 }, $set: { updated_at: new Date() } },
        session,
      );
    await writeAudit(ctx, {
      action: 'device.unfollow',
      masjidId,
      targetType: 'masjid',
      targetId: masjidId.toHexString(),
    });
    return 'unfollowed';
  });
}
