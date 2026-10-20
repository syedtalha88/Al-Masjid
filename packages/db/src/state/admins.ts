// Admin state functions (02 §3/§5, PHASE_01 T1.3/T1.11): create an admin, add to / remove from a masjid (≤ 5 admins
// per masjid via the conditional `admin_count` increment — 02 §5 "Admin limit"), invites (one open per admin and
// purpose) and invite consumption (single use, uniform failure — 04 R3).
import { randomBytes } from 'node:crypto';

import { Binary, type UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { StateError, writeAudit } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { newId } from '../values.ts';
import { requireSuper } from './guards.ts';

type IdDoc = { _id: UUID } & Record<string, unknown>;

export const MAX_ADMINS_PER_MASJID = 5;
/** 02 §2 admin_invites: invites expire after 72 hours. */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

/**
 * Creates an admin user in status `invited` with a random WebAuthn user handle (Super Admin).
 *
 * @param phoneEnc - already encrypted with `encryptField(…, 'admin_users.phone_enc')` (T1.7) — never plain text here.
 */
export async function createAdmin(
  handle: DbHandle,
  scope: Scope,
  input: { displayName: string; uiLocale: 'en' | 'hi' | 'ur' | 'te'; phoneEnc?: string; requestId?: string },
): Promise<UUID> {
  requireSuper(scope);
  return withTransaction(handle, scope, async (ctx) => {
    const id = newId();
    const now = new Date();
    await ctx.db.collection<IdDoc>('admin_users').insertOne(
      {
        _id: id,
        display_name: input.displayName,
        role: 'masjid_admin',
        status: 'invited',
        ...(input.phoneEnc ? { phone_enc: input.phoneEnc } : {}),
        ui_locale: input.uiLocale,
        user_handle: new Binary(randomBytes(32)),
        undertaking_history: [],
        created_at: now,
        updated_at: now,
      },
      { session: ctx.session },
    );
    await writeAudit(ctx, {
      action: 'admin.create',
      targetType: 'admin',
      targetId: id.toHexString(),
      meta: { role: 'masjid_admin' },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return id;
  });
}

/**
 * Adds an admin to a masjid (Super Admin). The masjid's `admin_count` is incremented only while it is below 5, in the
 * same transaction as the membership insert, so concurrent requests can never exceed the limit.
 *
 * @throws StateError FORBIDDEN, MASJID_NOT_FOUND, ADMIN_LIMIT_REACHED, ALREADY_MEMBER.
 */
export async function addAdminToMasjid(
  handle: DbHandle,
  scope: Scope,
  input: { masjidId: UUID; adminId: UUID; role: 'owner' | 'editor'; requestId?: string },
): Promise<void> {
  const actor = requireSuper(scope);
  try {
    await withTransaction(handle, scope, async (ctx) => {
      const session = { session: ctx.session };
      const masjids = ctx.db.collection<{ _id: UUID; admin_count: number; deleted_at?: Date }>('masjids');
      const counted = await masjids.updateOne(
        { _id: input.masjidId, admin_count: { $lt: MAX_ADMINS_PER_MASJID }, deleted_at: { $exists: false } },
        { $inc: { admin_count: 1 }, $set: { updated_at: new Date() } },
        session,
      );
      if (counted.matchedCount !== 1) {
        const exists = await masjids.countDocuments({ _id: input.masjidId, deleted_at: { $exists: false } }, session);
        throw new StateError(exists ? 'ADMIN_LIMIT_REACHED' : 'MASJID_NOT_FOUND');
      }
      await ctx.db.collection<IdDoc>('masjid_admins').insertOne(
        {
          _id: newId(),
          masjid_id: input.masjidId,
          admin_id: input.adminId,
          role: input.role,
          added_by: actor.adminId,
          created_at: new Date(),
        },
        session,
      );
      await writeAudit(ctx, {
        action: 'admin.add_to_masjid',
        masjidId: input.masjidId,
        targetType: 'admin',
        targetId: input.adminId.toHexString(),
        meta: { role: input.role },
        ...(input.requestId ? { requestId: input.requestId } : {}),
      });
    });
  } catch (error) {
    // A duplicate membership aborts the transaction (its count increment with it).
    if (isDuplicateKey(error)) throw new StateError('ALREADY_MEMBER');
    throw error;
  }
}

/**
 * Removes an admin from a masjid (Super Admin, ★ step-up): deletes the membership and decrements `admin_count`.
 *
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED, NOT_MEMBER.
 */
export async function removeAdminFromMasjid(
  handle: DbHandle,
  scope: Scope,
  input: { masjidId: UUID; adminId: UUID; requestId?: string; now?: Date },
): Promise<void> {
  requireSuper(scope, { stepUp: true, ...(input.now ? { now: input.now } : {}) });
  await withTransaction(handle, scope, async (ctx) => {
    const session = { session: ctx.session };
    const removed = await ctx.db
      .collection<{ masjid_id: UUID; admin_id: UUID }>('masjid_admins')
      .deleteOne({ masjid_id: input.masjidId, admin_id: input.adminId }, session);
    if (removed.deletedCount !== 1) throw new StateError('NOT_MEMBER');
    await ctx.db
      .collection<{ _id: UUID; admin_count: number }>('masjids')
      .updateOne({ _id: input.masjidId }, { $inc: { admin_count: -1 }, $set: { updated_at: new Date() } }, session);
    await writeAudit(ctx, {
      action: 'admin.remove_from_masjid',
      masjidId: input.masjidId,
      targetType: 'admin',
      targetId: input.adminId.toHexString(),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}

export type InvitePurpose = 'register' | 'add_device' | 'recovery';

/**
 * Creates an invite (Super Admin) and closes the admin's previous open invite for the same purpose in the same
 * transaction (02 §2: one open invite per admin and purpose; the partial unique index backs it).
 *
 * A ★ action (03 §5 `POST /admins/:id/invites`): the step-up is checked here too, not only by the route (02 §3
 * defence in depth — security review L4).
 *
 * @param tokenHash - `hashToken(token, pepper)` (T1.7); the token itself never reaches the database.
 * @returns when the invite expires.
 * @throws StateError FORBIDDEN / STEP_UP_REQUIRED, INVALID_TOKEN_HASH, ADMIN_NOT_FOUND.
 */
export async function createInvite(
  handle: DbHandle,
  scope: Scope,
  input: { adminId: UUID; purpose: InvitePurpose; tokenHash: Buffer; requestId?: string; now?: Date },
): Promise<Date> {
  const actor = requireSuper(scope, { stepUp: true, ...(input.now ? { now: input.now } : {}) });
  if (input.tokenHash.length !== 32) throw new StateError('INVALID_TOKEN_HASH');
  return withTransaction(handle, scope, async (ctx) => {
    const session = { session: ctx.session };
    const now = input.now ?? new Date();
    const exists = await ctx.db.collection<IdDoc>('admin_users').countDocuments({ _id: input.adminId }, session);
    if (exists === 0) throw new StateError('ADMIN_NOT_FOUND');
    const invites = ctx.db.collection<IdDoc>('admin_invites');
    await invites.updateMany(
      { admin_id: input.adminId, purpose: input.purpose, open: true },
      { $set: { open: false } },
      session,
    );
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    await invites.insertOne(
      {
        _id: newId(),
        admin_id: input.adminId,
        purpose: input.purpose,
        token_hash: new Binary(input.tokenHash),
        expires_at: expiresAt,
        open: true,
        created_by: actor.adminId,
        created_at: now,
      },
      session,
    );
    await writeAudit(ctx, {
      action: 'admin.invite',
      targetType: 'admin',
      targetId: input.adminId.toHexString(),
      meta: { purpose: input.purpose },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return expiresAt;
  });
}

/**
 * Consumes an invite exactly once (02 §3 `consumeInvite`): open, unused and unexpired, matched by its token hash.
 * Called while registering a passkey, before the invitee has a session (public scope) — the audit names the invitee.
 *
 * @returns the invited admin and the invite's purpose.
 * @throws StateError INVITE_INVALID for every failure (unknown, used, superseded, expired — 04 R3 uniform answers).
 */
export async function consumeInvite(
  handle: DbHandle,
  scope: Scope,
  input: { tokenHash: Buffer; requestId?: string; now?: Date },
): Promise<{ adminId: UUID; purpose: InvitePurpose }> {
  if (scope.kind !== 'public' && scope.kind !== 'system') throw new StateError('FORBIDDEN');
  return withTransaction(handle, scope, async (ctx) => {
    const now = input.now ?? new Date();
    const invite = await ctx.db
      .collection<{ _id: UUID; admin_id: UUID; purpose: InvitePurpose; token_hash: Binary; open: boolean }>(
        'admin_invites',
      )
      .findOneAndUpdate(
        { token_hash: new Binary(input.tokenHash), open: true, used_at: { $exists: false }, expires_at: { $gt: now } },
        { $set: { used_at: now, open: false } },
        { session: ctx.session, returnDocument: 'after' },
      );
    if (!invite) throw new StateError('INVITE_INVALID');
    await writeAudit(
      ctx,
      {
        action: 'invite.consume',
        targetType: 'admin',
        targetId: invite.admin_id.toHexString(),
        meta: { purpose: invite.purpose },
        ...(input.requestId ? { requestId: input.requestId } : {}),
      },
      { type: 'admin', id: invite.admin_id },
    );
    return { adminId: invite.admin_id, purpose: invite.purpose };
  });
}

/**
 * Creates a masjid admin, adds them to the masjid and opens their `register` invite — ONE transaction, so a refused
 * addition (limit, unknown masjid) leaves no orphan admin behind (C2 "create admin" → `POST /api/super/admins`).
 *
 * @param phoneEnc - already encrypted (`encryptField`, T1.7).
 * @param inviteTokenHash - `hashToken(token, pepper)`; the token is returned to the Super Admin inside the link.
 * @throws StateError FORBIDDEN, MASJID_NOT_FOUND, ADMIN_LIMIT_REACHED, INVALID_TOKEN_HASH.
 */
export async function createAdminForMasjid(
  handle: DbHandle,
  scope: Scope,
  input: {
    displayName: string;
    uiLocale: 'en' | 'hi' | 'ur' | 'te';
    phoneEnc?: string;
    masjidId: UUID;
    role: 'owner' | 'editor';
    inviteTokenHash: Buffer;
    requestId?: string;
    now?: Date;
  },
): Promise<{ adminId: UUID; expiresAt: Date }> {
  const actor = requireSuper(scope);
  if (input.inviteTokenHash.length !== 32) throw new StateError('INVALID_TOKEN_HASH');
  return withTransaction(handle, scope, async (ctx) => {
    const session = { session: ctx.session };
    const now = input.now ?? new Date();
    const masjids = ctx.db.collection<{ _id: UUID; admin_count: number; deleted_at?: Date }>('masjids');
    const counted = await masjids.updateOne(
      { _id: input.masjidId, admin_count: { $lt: MAX_ADMINS_PER_MASJID }, deleted_at: { $exists: false } },
      { $inc: { admin_count: 1 }, $set: { updated_at: now } },
      session,
    );
    if (counted.matchedCount !== 1) {
      const exists = await masjids.countDocuments({ _id: input.masjidId, deleted_at: { $exists: false } }, session);
      throw new StateError(exists ? 'ADMIN_LIMIT_REACHED' : 'MASJID_NOT_FOUND');
    }
    const adminId = newId();
    await ctx.db.collection<IdDoc>('admin_users').insertOne(
      {
        _id: adminId,
        display_name: input.displayName,
        role: 'masjid_admin',
        status: 'invited',
        ...(input.phoneEnc ? { phone_enc: input.phoneEnc } : {}),
        ui_locale: input.uiLocale,
        user_handle: new Binary(randomBytes(32)),
        undertaking_history: [],
        created_at: now,
        updated_at: now,
      },
      session,
    );
    await ctx.db.collection<IdDoc>('masjid_admins').insertOne(
      {
        _id: newId(),
        masjid_id: input.masjidId,
        admin_id: adminId,
        role: input.role,
        added_by: actor.adminId,
        created_at: now,
      },
      session,
    );
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    await ctx.db.collection<IdDoc>('admin_invites').insertOne(
      {
        _id: newId(),
        admin_id: adminId,
        purpose: 'register',
        token_hash: new Binary(input.inviteTokenHash),
        expires_at: expiresAt,
        open: true,
        created_by: actor.adminId,
        created_at: now,
      },
      session,
    );
    const requestId = input.requestId ? { requestId: input.requestId } : {};
    const target = { targetType: 'admin', targetId: adminId.toHexString(), ...requestId };
    await writeAudit(ctx, { action: 'admin.create', ...target, meta: { role: 'masjid_admin' } });
    await writeAudit(ctx, {
      action: 'admin.add_to_masjid',
      masjidId: input.masjidId,
      ...target,
      meta: { role: input.role },
    });
    await writeAudit(ctx, { action: 'admin.invite', ...target, meta: { purpose: 'register' } });
    return { adminId, expiresAt };
  });
}
