// Admin authentication state (02 §4.1 "only via auth service functions", 04 §3/§4, PHASE_01 T1.8): invites, WebAuthn
// credentials and sessions. The API verifies WebAuthn responses; these functions own every read and write of
// `webauthn_credentials`, `admin_invites` and `admin_sessions`, each in one transaction with its audit entry. Tokens
// arrive here only as hashes (`hashToken`, T1.7) — a raw session or invite token never reaches the database.
import { createHash } from 'node:crypto';

import { Binary, Long, type UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { StateError, writeAudit } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { newId } from '../values.ts';
import type { InvitePurpose } from './admins.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 04 §4 session lifetimes per role. */
export const SESSION_LIFETIMES = {
  masjid_admin: { idleMs: 7 * DAY, absoluteMs: 30 * DAY },
  super_admin: { idleMs: 30 * MINUTE, absoluteMs: 12 * HOUR },
} as const;
/** 04 §4: `last_seen_at` (and the idle expiry with it) is written at most this often. */
export const LAST_SEEN_THROTTLE_MS = 5 * MINUTE;

export type AdminRole = keyof typeof SESSION_LIFETIMES;

type IdDoc = { _id: UUID } & Record<string, unknown>;

interface AdminDoc {
  _id: UUID;
  display_name: string;
  role: AdminRole;
  status: 'invited' | 'active' | 'disabled';
  ui_locale: 'en' | 'hi' | 'ur' | 'te';
  user_handle: Binary;
  undertaking_version?: string;
}

interface CredentialDoc {
  _id: UUID;
  admin_id: UUID;
  credential_id: Binary;
  public_key: Binary;
  sign_count: Long;
  transports: string[];
  revoked_at?: Date;
}

interface SessionDoc {
  _id: UUID;
  admin_id: UUID;
  token_hash: Binary;
  created_at: Date;
  last_seen_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  step_up_at?: Date;
  ua_summary?: string;
  revoked_at?: Date;
  revoked_reason?: string;
}

/** A short, non-reversible label for a credential id in audit entries and logs (never the id itself). */
export const credentialLabel = (credentialId: Uint8Array): string =>
  createHash('sha256').update(credentialId).digest('base64url').slice(0, 16);

const binary = (bytes: Uint8Array) => new Binary(Buffer.from(bytes));
const bytesOf = (value: Binary) => new Uint8Array(value.buffer);

function requirePublicOrSystem(scope: Scope): void {
  if (scope.kind !== 'public' && scope.kind !== 'system') throw new StateError('FORBIDDEN');
}

// --- invites ---------------------------------------------------------------------------------------------------------

export interface InviteView {
  readonly adminId: UUID;
  readonly purpose: InvitePurpose;
  readonly adminDisplayName: string;
  readonly uiLocale: AdminDoc['ui_locale'];
  readonly masjidNames: readonly string[];
  /** WebAuthn user handle (32 random bytes, 02 §2). */
  readonly userHandle: Uint8Array;
  /** The admin's existing, unrevoked credentials (registration `excludeCredentials`). */
  readonly existingCredentials: readonly { readonly id: Uint8Array; readonly transports: readonly string[] }[];
}

async function openInvite(ctx: TxContext, tokenHash: Buffer, now: Date) {
  return ctx.db
    .collection<{ _id: UUID; admin_id: UUID; purpose: InvitePurpose }>('admin_invites')
    .findOne(
      { token_hash: binary(tokenHash), open: true, used_at: { $exists: false }, expires_at: { $gt: now } },
      { session: ctx.session },
    );
}

/**
 * Reads an invite without consuming it (`GET /auth/invite/:token`, registration options).
 *
 * @returns the invite view, or `null` for every kind of invalid invite (unknown, used, superseded, expired, disabled
 *   admin) — callers answer all of them the same way (04 R3).
 */
export async function readInvite(
  handle: DbHandle,
  scope: Scope,
  input: { tokenHash: Buffer; now?: Date },
): Promise<InviteView | null> {
  requirePublicOrSystem(scope);
  return withTransaction(handle, scope, async (ctx) => {
    const session = { session: ctx.session };
    const invite = await openInvite(ctx, input.tokenHash, input.now ?? new Date());
    if (!invite) return null;
    const admin = await ctx.db.collection<AdminDoc>('admin_users').findOne({ _id: invite.admin_id }, session);
    if (!admin || admin.status === 'disabled') return null;
    const memberships = await ctx.db
      .collection<{ masjid_id: UUID; admin_id: UUID }>('masjid_admins')
      .find({ admin_id: admin._id }, session)
      .toArray();
    const masjids = await ctx.db
      .collection<{ _id: UUID; name: string }>('masjids')
      .find({ _id: { $in: memberships.map((m) => m.masjid_id) }, deleted_at: { $exists: false } }, session)
      .project<{ name: string }>({ name: 1 })
      .toArray();
    const credentials = await ctx.db
      .collection<CredentialDoc>('webauthn_credentials')
      .find({ admin_id: admin._id, revoked_at: { $exists: false } }, session)
      .toArray();
    return {
      adminId: admin._id,
      purpose: invite.purpose,
      adminDisplayName: admin.display_name,
      uiLocale: admin.ui_locale,
      masjidNames: masjids.map((m) => m.name).sort(),
      userHandle: bytesOf(admin.user_handle),
      existingCredentials: credentials.map((c) => ({ id: bytesOf(c.credential_id), transports: c.transports })),
    };
  });
}

// --- sessions --------------------------------------------------------------------------------------------------------

async function insertSession(
  ctx: TxContext,
  admin: { _id: UUID; role: AdminRole },
  tokenHash: Buffer,
  uaSummary: string | undefined,
  now: Date,
): Promise<UUID> {
  const life = SESSION_LIFETIMES[admin.role];
  const id = newId();
  await ctx.db.collection<IdDoc>('admin_sessions').insertOne(
    {
      _id: id,
      admin_id: admin._id,
      token_hash: binary(tokenHash),
      created_at: now,
      last_seen_at: now,
      idle_expires_at: new Date(now.getTime() + life.idleMs),
      absolute_expires_at: new Date(now.getTime() + life.absoluteMs),
      ...(uaSummary ? { ua_summary: uaSummary.slice(0, 120) } : {}),
    },
    { session: ctx.session },
  );
  return id;
}

async function revokeAllSessions(ctx: TxContext, adminId: UUID, reason: string, now: Date): Promise<number> {
  const result = await ctx.db
    .collection<SessionDoc>('admin_sessions')
    .updateMany(
      { admin_id: adminId, revoked_at: { $exists: false } },
      { $set: { revoked_at: now, revoked_reason: reason } },
      { session: ctx.session },
    );
  return result.modifiedCount;
}

export interface NewCredential {
  /** Raw credential id bytes (the API decodes the base64url id). */
  readonly id: Uint8Array;
  /** COSE public key bytes. */
  readonly publicKey: Uint8Array;
  readonly counter: number;
  readonly transports: readonly string[];
  readonly aaguid?: UUID;
  readonly backedUp: boolean;
  readonly deviceType: string;
  readonly label: string;
}

/**
 * Completes a registration (`POST /auth/register/verify`) in ONE transaction: consumes the invite, stores the
 * credential, activates an invited admin, creates the session, audits. A `recovery` invite also revokes the admin's
 * existing sessions (the lost device may still hold one).
 *
 * @throws StateError INVITE_INVALID (uniform — 04 R3), CREDENTIAL_EXISTS (credential id already registered).
 */
export async function registerCredential(
  handle: DbHandle,
  scope: Scope,
  input: {
    inviteTokenHash: Buffer;
    credential: NewCredential;
    sessionTokenHash: Buffer;
    uaSummary?: string;
    requestId?: string;
    now?: Date;
  },
): Promise<{ adminId: UUID; sessionId: UUID; role: AdminRole }> {
  requirePublicOrSystem(scope);
  try {
    return await withTransaction(handle, scope, async (ctx) => {
      const session = { session: ctx.session };
      const now = input.now ?? new Date();
      const invite = await ctx.db
        .collection<{ _id: UUID; admin_id: UUID; purpose: InvitePurpose }>('admin_invites')
        .findOneAndUpdate(
          {
            token_hash: binary(input.inviteTokenHash),
            open: true,
            used_at: { $exists: false },
            expires_at: { $gt: now },
          },
          { $set: { used_at: now, open: false } },
          { ...session, returnDocument: 'after' },
        );
      if (!invite) throw new StateError('INVITE_INVALID');
      const admins = ctx.db.collection<AdminDoc>('admin_users');
      const admin = await admins.findOne({ _id: invite.admin_id, status: { $ne: 'disabled' } }, session);
      if (!admin) throw new StateError('INVITE_INVALID');
      const c = input.credential;
      await ctx.db.collection<IdDoc>('webauthn_credentials').insertOne(
        {
          _id: newId(),
          admin_id: admin._id,
          credential_id: binary(c.id),
          public_key: binary(c.publicKey),
          sign_count: Long.fromNumber(c.counter),
          transports: [...c.transports].slice(0, 10),
          ...(c.aaguid ? { aaguid: c.aaguid } : {}),
          backed_up: c.backedUp,
          device_type: c.deviceType.slice(0, 32),
          label: c.label.slice(0, 60),
          created_at: now,
          last_used_at: now,
        },
        session,
      );
      if (invite.purpose === 'recovery') await revokeAllSessions(ctx, admin._id, 'recovery', now);
      await admins.updateOne(
        { _id: admin._id },
        { $set: { status: 'active', last_login_at: now, updated_at: now } },
        session,
      );
      const sessionId = await insertSession(ctx, admin, input.sessionTokenHash, input.uaSummary, now);
      const actor = { type: 'admin' as const, id: admin._id };
      const requestId = input.requestId ? { requestId: input.requestId } : {};
      await writeAudit(
        ctx,
        {
          action: 'invite.consume',
          targetType: 'admin',
          targetId: admin._id.toHexString(),
          meta: { purpose: invite.purpose },
          ...requestId,
        },
        actor,
      );
      await writeAudit(
        ctx,
        {
          action: 'auth.register',
          targetType: 'admin',
          targetId: admin._id.toHexString(),
          meta: { credential: credentialLabel(c.id) },
          ...requestId,
        },
        actor,
      );
      return { adminId: admin._id, sessionId, role: admin.role };
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      throw new StateError('CREDENTIAL_EXISTS');
    }
    throw error;
  }
}

export interface LoginCredential {
  readonly credentialDocId: UUID;
  readonly adminId: UUID;
  readonly id: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly counter: number;
  readonly transports: readonly string[];
}

/**
 * Finds an unrevoked credential of an ACTIVE admin by its raw id (login and step-up).
 *
 * @returns the credential, or `null` (unknown, revoked, or admin not active — callers answer uniformly).
 */
export async function findLoginCredential(
  handle: DbHandle,
  scope: Scope,
  credentialId: Uint8Array,
): Promise<LoginCredential | null> {
  requirePublicOrSystem(scope);
  return withTransaction(handle, scope, async (ctx) => {
    const session = { session: ctx.session };
    const credential = await ctx.db
      .collection<CredentialDoc>('webauthn_credentials')
      .findOne({ credential_id: binary(credentialId), revoked_at: { $exists: false } }, session);
    if (!credential) return null;
    const active = await ctx.db
      .collection<AdminDoc>('admin_users')
      .countDocuments({ _id: credential.admin_id, status: 'active' }, session);
    if (active === 0) return null;
    return {
      credentialDocId: credential._id,
      adminId: credential.admin_id,
      id: bytesOf(credential.credential_id),
      publicKey: bytesOf(credential.public_key),
      counter: Long.fromValue(credential.sign_count).toNumber(),
      transports: credential.transports,
    };
  });
}

/**
 * 04 §3 sign counter rule: a stored counter > 0 must strictly increase; 0 (synced passkeys) is always accepted.
 *
 * @returns `true` when `received` is acceptable after `stored`.
 */
export const counterAdvances = (stored: number, received: number): boolean => stored === 0 || received > stored;

/**
 * Records a verified assertion: checks the sign counter, updates it, and either creates a new session (login) or
 * rotates the given session and sets `step_up_at` (step-up). A counter regression revokes the credential and every
 * session of its admin, audits it, and refuses (possible cloned authenticator — 04 §3).
 *
 * @throws StateError COUNTER_REGRESSION, CREDENTIAL_REVOKED (revoked meanwhile), SESSION_INVALID (step-up on a dead
 *   session or someone else's credential).
 */
export async function completeAssertion(
  handle: DbHandle,
  scope: Scope,
  input: {
    credentialDocId: UUID;
    newCounter: number;
    sessionTokenHash: Buffer;
    /** Step-up: the current session to rotate (must belong to the credential's admin). Login: omitted. */
    stepUpSessionId?: UUID;
    uaSummary?: string;
    requestId?: string;
    now?: Date;
  },
): Promise<{ adminId: UUID; sessionId: UUID; role: AdminRole }> {
  requirePublicOrSystem(scope);
  const outcome = await withTransaction(handle, scope, async (ctx) => {
    const session = { session: ctx.session };
    const now = input.now ?? new Date();
    const credentials = ctx.db.collection<CredentialDoc>('webauthn_credentials');
    const credential = await credentials.findOne(
      { _id: input.credentialDocId, revoked_at: { $exists: false } },
      session,
    );
    if (!credential) throw new StateError('CREDENTIAL_REVOKED');
    const admin = await ctx.db
      .collection<AdminDoc>('admin_users')
      .findOne({ _id: credential.admin_id, status: 'active' }, session);
    if (!admin) throw new StateError('CREDENTIAL_REVOKED');
    const label = credentialLabel(bytesOf(credential.credential_id));
    const requestId = input.requestId ? { requestId: input.requestId } : {};
    const actor = { type: 'admin' as const, id: admin._id };

    if (!counterAdvances(Long.fromValue(credential.sign_count).toNumber(), input.newCounter)) {
      await credentials.updateOne({ _id: credential._id }, { $set: { revoked_at: now } }, session);
      const count = await revokeAllSessions(ctx, admin._id, 'credential_revoked', now);
      await writeAudit(
        ctx,
        {
          action: 'credential.revoke',
          targetType: 'admin',
          targetId: admin._id.toHexString(),
          meta: { reason: 'counter_regression', credential: label },
          ...requestId,
        },
        { type: 'system' },
      );
      await writeAudit(
        ctx,
        {
          action: 'session.revoke',
          targetType: 'admin',
          targetId: admin._id.toHexString(),
          meta: { reason: 'credential_revoked', count },
          ...requestId,
        },
        { type: 'system' },
      );
      return { regression: true as const };
    }

    await credentials.updateOne(
      { _id: credential._id },
      { $set: { sign_count: Long.fromNumber(input.newCounter), last_used_at: now } },
      session,
    );
    let sessionId: UUID;
    if (input.stepUpSessionId) {
      const life = SESSION_LIFETIMES[admin.role];
      const rotated = await ctx.db.collection<SessionDoc>('admin_sessions').findOneAndUpdate(
        {
          _id: input.stepUpSessionId,
          admin_id: admin._id,
          revoked_at: { $exists: false },
          idle_expires_at: { $gt: now },
          absolute_expires_at: { $gt: now },
        },
        {
          $set: {
            token_hash: binary(input.sessionTokenHash),
            step_up_at: now,
            last_seen_at: now,
            idle_expires_at: new Date(now.getTime() + life.idleMs),
          },
        },
        { ...session, returnDocument: 'after' },
      );
      if (!rotated) throw new StateError('SESSION_INVALID');
      sessionId = rotated._id;
      await writeAudit(
        ctx,
        { action: 'auth.step_up', targetType: 'admin', targetId: admin._id.toHexString(), ...requestId },
        actor,
      );
    } else {
      sessionId = await insertSession(ctx, admin, input.sessionTokenHash, input.uaSummary, now);
      await ctx.db
        .collection<AdminDoc>('admin_users')
        .updateOne({ _id: admin._id }, { $set: { last_login_at: now } }, session);
      await writeAudit(
        ctx,
        {
          action: 'auth.login',
          targetType: 'admin',
          targetId: admin._id.toHexString(),
          meta: { credential: label },
          ...requestId,
        },
        actor,
      );
    }
    return { regression: false as const, adminId: admin._id, sessionId, role: admin.role };
  });
  // The revocation must commit, so the refusal is raised after the transaction.
  if (outcome.regression) throw new StateError('COUNTER_REGRESSION');
  return outcome;
}

/**
 * Audits a failed login/step-up attempt (`auth.login_failed`), identified only by a hash of the credential id it
 * claimed — never an admin id, IP or user agent (PHASE_01 T1.8).
 */
export async function recordLoginFailure(
  handle: DbHandle,
  scope: Scope,
  input: { credentialId?: Uint8Array; requestId?: string },
): Promise<void> {
  requirePublicOrSystem(scope);
  await withTransaction(handle, scope, (ctx) =>
    writeAudit(
      ctx,
      {
        action: 'auth.login_failed',
        ...(input.credentialId ? { meta: { credential_hash: credentialLabel(input.credentialId) } } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
      },
      { type: 'system' },
    ),
  );
}

export interface ResolvedSession {
  readonly sessionId: UUID;
  readonly adminId: UUID;
  readonly role: AdminRole;
  readonly displayName: string;
  readonly uiLocale: AdminDoc['ui_locale'];
  readonly undertakingVersion: string | undefined;
  readonly stepUpAt: Date | undefined;
  readonly masjids: readonly { readonly id: UUID; readonly role: 'owner' | 'editor' }[];
}

/**
 * Resolves a session cookie's token hash (every authenticated admin request). Dead sessions — revoked, idle- or
 * absolute-expired, or of an admin who is no longer active — resolve to `null`. `last_seen_at` and the idle expiry are
 * refreshed at most every 5 minutes (04 §4); the idle expiry never passes the absolute one.
 */
export async function resolveSession(
  handle: DbHandle,
  scope: Scope,
  input: { tokenHash: Buffer; now?: Date },
): Promise<ResolvedSession | null> {
  requirePublicOrSystem(scope);
  const now = input.now ?? new Date();
  const db = await handle.db();
  const sessions = db.collection<SessionDoc>('admin_sessions');
  const found = await sessions.findOne({
    token_hash: binary(input.tokenHash),
    revoked_at: { $exists: false },
    idle_expires_at: { $gt: now },
    absolute_expires_at: { $gt: now },
  });
  if (!found) return null;
  const admin = await db.collection<AdminDoc>('admin_users').findOne({ _id: found.admin_id, status: 'active' });
  if (!admin) return null;
  if (now.getTime() - found.last_seen_at.getTime() >= LAST_SEEN_THROTTLE_MS) {
    const idle = Math.min(now.getTime() + SESSION_LIFETIMES[admin.role].idleMs, found.absolute_expires_at.getTime());
    await sessions.updateOne(
      { _id: found._id, revoked_at: { $exists: false } },
      { $set: { last_seen_at: now, idle_expires_at: new Date(idle) } },
    );
  }
  const memberships = await db
    .collection<{ masjid_id: UUID; admin_id: UUID; role: 'owner' | 'editor' }>('masjid_admins')
    .find({ admin_id: admin._id })
    .toArray();
  return {
    sessionId: found._id,
    adminId: admin._id,
    role: admin.role,
    displayName: admin.display_name,
    uiLocale: admin.ui_locale,
    undertakingVersion: admin.undertaking_version,
    stepUpAt: found.step_up_at,
    masjids: memberships.map((m) => ({ id: m.masjid_id, role: m.role })),
  };
}

/**
 * Revokes sessions of the scope's admin: one (`sessionId`, logout or "sign out that device") or all of them.
 *
 * @returns how many sessions were revoked (0 for an unknown or someone else's session — never an error, so session
 *   ids of other admins cannot be probed).
 * @throws StateError FORBIDDEN (not an admin/super scope).
 */
export async function revokeSessions(
  handle: DbHandle,
  scope: Scope,
  input: { sessionId?: UUID; reason: 'logout' | 'revoked_by_admin'; requestId?: string; now?: Date },
): Promise<number> {
  if (scope.kind !== 'admin' && scope.kind !== 'super') throw new StateError('FORBIDDEN');
  const adminId = scope.adminId;
  return withTransaction(handle, scope, async (ctx) => {
    const now = input.now ?? new Date();
    const result = await ctx.db
      .collection<SessionDoc>('admin_sessions')
      .updateMany(
        { admin_id: adminId, revoked_at: { $exists: false }, ...(input.sessionId ? { _id: input.sessionId } : {}) },
        { $set: { revoked_at: now, revoked_reason: input.reason } },
        { session: ctx.session },
      );
    const requestId = input.requestId ? { requestId: input.requestId } : {};
    if (result.modifiedCount > 0) {
      await writeAudit(
        ctx,
        input.reason === 'logout'
          ? { action: 'auth.logout', targetType: 'admin', targetId: adminId.toHexString(), ...requestId }
          : {
              action: 'session.revoke',
              targetType: 'admin',
              targetId: adminId.toHexString(),
              meta: { reason: input.reason, count: result.modifiedCount },
              ...requestId,
            },
      );
    }
    return result.modifiedCount;
  });
}

/**
 * Lists the scope admin's live sessions (`GET /auth/sessions`) — never token hashes.
 *
 * @throws StateError FORBIDDEN (not an admin/super scope).
 */
export async function listSessions(
  handle: DbHandle,
  scope: Scope,
  now: Date = new Date(),
): Promise<
  readonly { id: UUID; createdAt: Date; lastSeenAt: Date; uaSummary: string | undefined; stepUpAt: Date | undefined }[]
> {
  if (scope.kind !== 'admin' && scope.kind !== 'super') throw new StateError('FORBIDDEN');
  const db = await handle.db();
  const sessions = await db
    .collection<SessionDoc>('admin_sessions')
    .find(
      {
        admin_id: scope.adminId,
        revoked_at: { $exists: false },
        idle_expires_at: { $gt: now },
        absolute_expires_at: { $gt: now },
      },
      { projection: { token_hash: 0 }, sort: { last_seen_at: -1 } },
    )
    .toArray();
  return sessions.map((s) => ({
    id: s._id,
    createdAt: s.created_at,
    lastSeenAt: s.last_seen_at,
    uaSummary: s.ua_summary,
    stepUpAt: s.step_up_at,
  }));
}
