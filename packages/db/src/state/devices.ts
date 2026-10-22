// Musalli device state functions (02 §2 devices / device_follows, §3, §5; PHASE_02 T2.2): registration, device
// authentication, preferences with the follow mirror, mute, Clear-all-data deletion and Ameen. A device record holds
// only what 05 §1 allows — no IP, no user agent, no location.
import { Binary, type ClientSession, type Db, type UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { StateError } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { newId } from '../values.ts';

export type DeviceLocale = 'en' | 'hi' | 'ur' | 'te';
export type AudiencePref = 'brothers' | 'sisters';
export type DevicePlatform = 'android' | 'ios' | 'desktop' | 'other';

/** `last_seen_at` is written at most once a day (02 §2) — it drives the 180-day retention, nothing finer. */
export const DEVICE_SEEN_THROTTLE_MS = 24 * 60 * 60 * 1000;

function requireDevice(scope: Scope): UUID {
  if (scope.kind !== 'device') throw new StateError('FORBIDDEN');
  return scope.deviceId;
}

function requirePublic(scope: Scope): void {
  if (scope.kind !== 'public') throw new StateError('FORBIDDEN');
}

/**
 * Registers a new device (03 §3 `POST /devices`, after the API verified Turnstile).
 *
 * @param input.secretHash - SHA-256 of the device secret (32 bytes; the secret itself is never stored).
 * @returns the new device id.
 * @throws StateError FORBIDDEN (not the public scope).
 */
export async function registerDevice(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly secretHash: Buffer;
    readonly locale: DeviceLocale;
    readonly audiencePref: AudiencePref;
    readonly platform: DevicePlatform;
    readonly privacyVersion: string;
    readonly now: Date;
  },
): Promise<UUID> {
  requirePublic(scope);
  if (input.secretHash.length !== 32) throw new StateError('INVALID_SECRET', 'secret hash must be 32 bytes');
  const id = newId();
  await scoped({ scope, db: await handle.db() }, 'devices').insertOne({
    _id: id,
    secret_hash: new Binary(input.secretHash),
    locale: input.locale,
    audience_pref: input.audiencePref,
    platform: input.platform,
    push_status: 'none',
    privacy_version: input.privacyVersion,
    follow_count: 0,
    created_at: input.now,
    last_seen_at: input.now,
  });
  return id;
}

export interface DeviceCredential {
  readonly deviceId: UUID;
  readonly secretHash: Buffer;
  readonly lastSeenAt: Date;
}

/**
 * Loads what device authentication compares (03 §1 `Authorization: Device <id>.<secret>`): the API compares hashes in
 * constant time. Public scope only — the request is not authenticated yet (like `resolveSession` for admins).
 *
 * @returns the credential, or `null` for an unknown (or deleted) device.
 * @throws StateError FORBIDDEN (not the public scope).
 */
export async function findDeviceCredential(
  handle: DbHandle,
  scope: Scope,
  deviceId: UUID,
): Promise<DeviceCredential | null> {
  requirePublic(scope);
  const found = await (
    await handle.db()
  )
    .collection<{ _id: UUID; secret_hash: Binary; last_seen_at: Date }>('devices')
    .findOne({ _id: deviceId }, { projection: { secret_hash: 1, last_seen_at: 1 } });
  if (!found) return null;
  return { deviceId: found._id, secretHash: Buffer.from(found.secret_hash.buffer), lastSeenAt: found.last_seen_at };
}

/**
 * Marks the device as seen — at most once per {@link DEVICE_SEEN_THROTTLE_MS} (the caller passes the last value it read).
 *
 * @returns whether a write happened.
 * @throws StateError FORBIDDEN (not a device scope).
 */
export async function touchDevice(handle: DbHandle, scope: Scope, lastSeenAt: Date, now: Date): Promise<boolean> {
  requireDevice(scope);
  if (now.getTime() - lastSeenAt.getTime() < DEVICE_SEEN_THROTTLE_MS) return false;
  await scoped({ scope, db: await handle.db() }, 'devices').updateOne({}, { $set: { last_seen_at: now } });
  return true;
}

export interface DeviceRecordView {
  readonly deviceId: UUID;
  readonly locale: DeviceLocale;
  readonly audiencePref: AudiencePref;
  readonly platform: DevicePlatform;
  readonly privacyVersion: string;
  readonly pushEnabled: boolean;
  readonly followCount: number;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
}

/**
 * The device's own record, without its secret hash (05 §4 "what we store").
 *
 * @throws StateError FORBIDDEN (not a device scope), DEVICE_NOT_FOUND.
 */
export async function getDeviceRecord(handle: DbHandle, scope: Scope): Promise<DeviceRecordView> {
  requireDevice(scope);
  const doc = await scoped({ scope, db: await handle.db() }, 'devices').findOne({});
  if (!doc) throw new StateError('DEVICE_NOT_FOUND');
  const value = doc as unknown as {
    _id: UUID;
    locale: DeviceLocale;
    audience_pref: AudiencePref;
    platform: DevicePlatform;
    privacy_version: string;
    push_status: string;
    follow_count: number;
    created_at: Date;
    last_seen_at: Date;
  }; // a document of the validated `devices` collection
  return {
    deviceId: value._id,
    locale: value.locale,
    audiencePref: value.audience_pref,
    platform: value.platform,
    privacyVersion: value.privacy_version,
    pushEnabled: value.push_status === 'active',
    followCount: value.follow_count,
    createdAt: value.created_at,
    lastSeenAt: value.last_seen_at,
  };
}

/**
 * Changes the device's language / brother-sister choice / accepted privacy version and mirrors language and audience
 * onto its follows in the same transaction (02 §5 "Device mirror" — push fan-out reads them from the follows).
 *
 * @throws StateError FORBIDDEN (not a device scope), NOTHING_TO_UPDATE, DEVICE_NOT_FOUND.
 */
export async function setDevicePrefs(
  handle: DbHandle,
  scope: Scope,
  input: { readonly locale?: DeviceLocale; readonly audiencePref?: AudiencePref; readonly privacyVersion?: string },
): Promise<void> {
  requireDevice(scope);
  const device: Record<string, string> = {};
  const mirror: Record<string, string> = {};
  if (input.locale) device['locale'] = mirror['locale'] = input.locale;
  if (input.audiencePref) device['audience_pref'] = mirror['audience_pref'] = input.audiencePref;
  if (input.privacyVersion) device['privacy_version'] = input.privacyVersion;
  if (Object.keys(device).length === 0) throw new StateError('NOTHING_TO_UPDATE');
  await withTransaction(handle, scope, async (ctx) => {
    const policy = { scope, db: ctx.db, session: ctx.session };
    if ((await scoped(policy, 'devices').updateOne({}, { $set: device })) !== 1)
      throw new StateError('DEVICE_NOT_FOUND');
    if (Object.keys(mirror).length > 0) await scoped(policy, 'device_follows').updateMany({}, { $set: mirror });
  });
}

/**
 * Mutes or unmutes push for one followed masjid (00 §4.1; content stays visible).
 *
 * @returns false when the device does not follow that masjid.
 * @throws StateError FORBIDDEN (not a device scope).
 */
export async function setFollowMuted(handle: DbHandle, scope: Scope, masjidId: UUID, muted: boolean): Promise<boolean> {
  requireDevice(scope);
  const matched = await scoped({ scope, db: await handle.db() }, 'device_follows').updateOne(
    { masjid_id: masjidId },
    { $set: { muted } },
  );
  return matched === 1;
}

export interface FollowView {
  readonly masjidId: UUID;
  readonly muted: boolean;
  readonly followedAt: Date;
}

/**
 * The device's follows, oldest first (the server copy the app reconciles with — 03 §3).
 *
 * @throws StateError FORBIDDEN (not a device scope).
 */
export async function listFollows(handle: DbHandle, scope: Scope): Promise<FollowView[]> {
  requireDevice(scope);
  const docs = await scoped({ scope, db: await handle.db() }, 'device_follows').find({}, { sort: { created_at: 1 } });
  return docs.map((doc) => {
    const value = doc as unknown as { masjid_id: UUID; muted: boolean; created_at: Date }; // validated collection
    return { masjidId: value.masjid_id, muted: value.muted, followedAt: value.created_at };
  });
}

const followersDown = async (db: Db, session: ClientSession, masjidId: UUID) => {
  await db
    .collection<{ _id: UUID; followers: number; updated_at: Date }>('masjid_stats')
    .updateOne(
      { _id: masjidId, followers: { $gt: 0 } },
      { $inc: { followers: -1 }, $set: { updated_at: new Date() } },
      { session },
    );
};

/**
 * "Clear all data" (05 §4, 02 §5 reference rules): deletes the device's follows (decrementing each masjid's follower
 * count), its Ameens (the counters keep their totals) and the device itself — one transaction. Idempotent.
 *
 * @returns `deleted`, or `not_found` when the device was already gone.
 * @throws StateError FORBIDDEN (not a device scope).
 */
export async function deleteDevice(handle: DbHandle, scope: Scope): Promise<'deleted' | 'not_found'> {
  const deviceId = requireDevice(scope);
  return withTransaction(handle, scope, async (ctx) => {
    const session = { session: ctx.session };
    const follows = ctx.db.collection<{ device_id: UUID; masjid_id: UUID }>('device_follows');
    const followed = await follows
      .find({ device_id: deviceId }, { ...session, projection: { masjid_id: 1 } })
      .toArray();
    for (const follow of followed) await followersDown(ctx.db, ctx.session, follow.masjid_id);
    await follows.deleteMany({ device_id: deviceId }, session);
    await ctx.db.collection<{ device_id: UUID }>('ameens').deleteMany({ device_id: deviceId }, session);
    const removed = await ctx.db.collection<{ _id: UUID }>('devices').deleteOne({ _id: deviceId }, session);
    return removed.deletedCount === 1 ? 'deleted' : 'not_found';
  });
}

const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

/**
 * Records this device's Ameen on a published dua request (02 §5 "Ameen count"): the first one inserts into `ameens`
 * and increments the counter in the same transaction; any later one changes nothing (once per device — 00 §4.3).
 *
 * @param duaItemId - the item's internal id (the API resolves the public id through the public view).
 * @returns the current count.
 * @throws StateError FORBIDDEN (not a device scope), ITEM_NOT_FOUND (not a visible, published dua request).
 */
export async function recordAmeen(handle: DbHandle, scope: Scope, duaItemId: UUID): Promise<number> {
  const deviceId = requireDevice(scope);
  const counters = async (db: Db, session?: ClientSession) =>
    (
      await db
        .collection<{ _id: UUID; count: number }>('ameen_counters')
        .findOne({ _id: duaItemId }, session ? { session } : {})
    )?.count ?? 0;
  try {
    return await withTransaction(handle, scope, async (ctx) => {
      const session = { session: ctx.session };
      const item = await ctx.db
        .collection<{ _id: UUID; masjid_id: UUID; type: string }>('v_pub_items')
        .findOne({ _id: duaItemId, type: 'dua_request' }, { ...session, projection: { masjid_id: 1 } });
      if (!item) throw new StateError('ITEM_NOT_FOUND');
      const ameens = ctx.db.collection<{
        _id: UUID;
        dua_item_id: UUID;
        masjid_id: UUID;
        device_id: UUID;
        created_at: Date;
      }>('ameens');
      const now = new Date();
      await ameens.insertOne(
        { _id: newId(), dua_item_id: duaItemId, masjid_id: item.masjid_id, device_id: deviceId, created_at: now },
        session,
      );
      const updated = await ctx.db
        .collection<{ _id: UUID; count: number; updated_at: Date }>('ameen_counters')
        .findOneAndUpdate(
          { _id: duaItemId },
          { $inc: { count: 1 }, $set: { updated_at: now } },
          { ...session, upsert: true, returnDocument: 'after' },
        );
      return updated?.count ?? 1;
    });
  } catch (error) {
    // mc_public may insert into `ameens` but never read it (02 §4.3), so "already said Ameen" is the unique index
    // refusing the insert: the transaction rolls back (no double count) and the current count is returned.
    if (isDuplicateKey(error)) return counters(await handle.db());
    throw error;
  }
}
