// Super Admin bootstrap (04 §3, PHASE_01 T1.9): the one way the first Super Admin comes into existence — a one-off
// CLI run by the owner, never an HTTP route. Creates the admin (status `invited`) and a `register` invite whose
// one-time link the CLI prints; the owner registers a passkey through the normal invite flow.
import { randomBytes } from 'node:crypto';

import { Binary, type UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { StateError, writeAudit } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { newId } from '../values.ts';
import { INVITE_TTL_MS } from './admins.ts';

type IdDoc = { _id: UUID } & Record<string, unknown>;

/**
 * Creates a Super Admin with an open `register` invite (system scope only — the bootstrap CLI).
 *
 * @param inviteTokenHash - `hashToken(token, SESSION_PEPPER)`; the CLI prints the token once, inside the invite link.
 * @param force - `--force-additional`: create another Super Admin although one exists.
 * @returns the new admin id and when the invite expires.
 * @throws StateError FORBIDDEN (not system scope), SUPER_ADMIN_EXISTS (a non-disabled Super Admin exists and
 *   `force` is false), INVALID_TOKEN_HASH.
 */
export async function bootstrapSuperAdmin(
  handle: DbHandle,
  scope: Scope,
  input: {
    displayName: string;
    uiLocale: 'en' | 'hi' | 'ur' | 'te';
    inviteTokenHash: Buffer;
    force: boolean;
    now?: Date;
  },
): Promise<{ adminId: UUID; expiresAt: Date }> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  if (input.inviteTokenHash.length !== 32) throw new StateError('INVALID_TOKEN_HASH');
  return withTransaction(handle, scope, async (ctx) => {
    const session = { session: ctx.session };
    const now = input.now ?? new Date();
    const admins = ctx.db.collection<IdDoc>('admin_users');
    const existing = await admins.countDocuments({ role: 'super_admin', status: { $ne: 'disabled' } }, session);
    if (existing > 0 && !input.force) throw new StateError('SUPER_ADMIN_EXISTS');
    const adminId = newId();
    await admins.insertOne(
      {
        _id: adminId,
        display_name: input.displayName,
        role: 'super_admin',
        status: 'invited',
        ui_locale: input.uiLocale,
        user_handle: new Binary(randomBytes(32)),
        undertaking_history: [],
        created_at: now,
        updated_at: now,
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
        created_by: adminId, // no creator exists yet; the bootstrap is attributed to the system actor in the audit log
        created_at: now,
      },
      session,
    );
    await writeAudit(ctx, {
      action: 'admin.create',
      targetType: 'admin',
      targetId: adminId.toHexString(),
      meta: { role: 'super_admin' },
    });
    await writeAudit(ctx, {
      action: 'admin.invite',
      targetType: 'admin',
      targetId: adminId.toHexString(),
      meta: { purpose: 'register' },
    });
    return { adminId, expiresAt };
  });
}
