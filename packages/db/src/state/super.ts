// Super Admin state functions (02 §3, 03 §5, PHASE_01 T1.11) and the admin's undertaking acceptance (T1.10). Each
// asserts its scope (★ = fresh step-up), runs in one transaction and writes its audit entry there.
import type { UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { requireSuper } from './guards.ts';

/** Masjid fields the Super Admin edits through `PATCH /masjids/:id` (status/code/counters never — 04 §5). */
export interface MasjidPatch {
  readonly name?: string;
  readonly nameI18n?: { readonly hi?: string; readonly ur?: string; readonly te?: string };
  readonly area?: string;
  readonly city?: string;
  readonly state?: string;
  readonly address?: string;
  readonly lat?: number;
  readonly lng?: number;
  readonly calcMethod?: 'karachi' | 'mwl' | 'isna' | 'egypt' | 'umm_al_qura' | 'other_custom';
  readonly asrMadhab?: 'hanafi' | 'shafi';
  readonly hijriOffset?: -2 | -1 | 0 | 1 | 2 | null;
  readonly pushDailyQuota?: number;
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * Edits a masjid (Super Admin) through the policy gateway inside `contentWrite()`, so the content version is bumped in
 * the same transaction (02 §5). `hijriOffset: null` removes the masjid's own offset (global offset applies).
 *
 * @returns the database field names that changed (for the audit entry).
 * @throws StateError FORBIDDEN, MASJID_NOT_FOUND (unknown or deleted), NOTHING_TO_UPDATE.
 */
export async function updateMasjid(
  handle: DbHandle,
  scope: Scope,
  input: { masjidId: UUID; patch: MasjidPatch; requestId?: string; now?: Date },
): Promise<readonly string[]> {
  requireSuper(scope);
  const p = input.patch;
  const set: Record<string, unknown> = {
    ...(p.name === undefined ? {} : { name: p.name }),
    ...(p.nameI18n === undefined ? {} : { name_i18n: { ...p.nameI18n } }),
    ...(p.area === undefined ? {} : { area: p.area }),
    ...(p.city === undefined ? {} : { city: p.city }),
    ...(p.state === undefined ? {} : { state: p.state }),
    ...(p.address === undefined ? {} : { address: p.address }),
    ...(p.lat === undefined ? {} : { lat: round6(p.lat) }),
    ...(p.lng === undefined ? {} : { lng: round6(p.lng) }),
    ...(p.calcMethod === undefined ? {} : { calc_method: p.calcMethod }),
    ...(p.asrMadhab === undefined ? {} : { asr_madhab: p.asrMadhab }),
    ...(p.hijriOffset === undefined || p.hijriOffset === null ? {} : { hijri_offset: p.hijriOffset }),
    ...(p.pushDailyQuota === undefined ? {} : { push_daily_quota: p.pushDailyQuota }),
  };
  const unset = p.hijriOffset === null ? { hijri_offset: '' } : {};
  const fields = [...Object.keys(set), ...Object.keys(unset)];
  if (fields.length === 0) throw new StateError('NOTHING_TO_UPDATE');
  await withTransaction(handle, scope, async (ctx) => {
    const exists = await ctx.db
      .collection<{ _id: UUID; deleted_at?: Date }>('masjids')
      .countDocuments({ _id: input.masjidId, deleted_at: { $exists: false } }, { session: ctx.session });
    if (exists === 0) throw new StateError('MASJID_NOT_FOUND');
    await contentWrite(ctx, input.masjidId, (content) =>
      scoped(content, 'masjids').updateOne(
        { _id: input.masjidId },
        {
          $set: { ...set, updated_at: input.now ?? new Date() },
          ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
        },
      ),
    );
    await writeAudit(ctx, {
      action: 'masjid.update',
      masjidId: input.masjidId,
      targetType: 'masjid',
      targetId: input.masjidId.toHexString(),
      meta: { fields },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
  return fields;
}

async function requireAdminExists(ctx: TxContext, adminId: UUID): Promise<void> {
  const count = await ctx.db
    .collection<{ _id: UUID }>('admin_users')
    .countDocuments({ _id: adminId }, { session: ctx.session });
  if (count === 0) throw new StateError('ADMIN_NOT_FOUND');
}

/**
 * ★ Revokes every live session of an admin (Super Admin) — they are logged out on their next request.
 *
 * @returns how many sessions were revoked.
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED, ADMIN_NOT_FOUND.
 */
export async function revokeAdminSessions(
  handle: DbHandle,
  scope: Scope,
  input: { adminId: UUID; requestId?: string; now?: Date },
): Promise<number> {
  requireSuper(scope, { stepUp: true, ...(input.now ? { now: input.now } : {}) });
  return withTransaction(handle, scope, async (ctx) => {
    await requireAdminExists(ctx, input.adminId);
    const now = input.now ?? new Date();
    const { modifiedCount } = await ctx.db
      .collection<{ admin_id: UUID; revoked_at?: Date; revoked_reason?: string }>('admin_sessions')
      .updateMany(
        { admin_id: input.adminId, revoked_at: { $exists: false } },
        { $set: { revoked_at: now, revoked_reason: 'revoked_by_super_admin' } },
        { session: ctx.session },
      );
    await writeAudit(ctx, {
      action: 'session.revoke',
      targetType: 'admin',
      targetId: input.adminId.toHexString(),
      meta: { reason: 'revoked_by_super_admin', count: modifiedCount },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return modifiedCount;
  });
}

/**
 * ★ Revokes every passkey of an admin AND their sessions (lost or compromised phone — 04 §3 recovery). The admin
 * needs a new `recovery` invite to sign in again.
 *
 * @returns how many passkeys were revoked.
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED, ADMIN_NOT_FOUND.
 */
export async function revokeAdminPasskeys(
  handle: DbHandle,
  scope: Scope,
  input: { adminId: UUID; requestId?: string; now?: Date },
): Promise<number> {
  requireSuper(scope, { stepUp: true, ...(input.now ? { now: input.now } : {}) });
  return withTransaction(handle, scope, async (ctx) => {
    await requireAdminExists(ctx, input.adminId);
    const session = { session: ctx.session };
    const now = input.now ?? new Date();
    const { modifiedCount } = await ctx.db
      .collection<{ admin_id: UUID; revoked_at?: Date }>('webauthn_credentials')
      .updateMany({ admin_id: input.adminId, revoked_at: { $exists: false } }, { $set: { revoked_at: now } }, session);
    await ctx.db
      .collection<{ admin_id: UUID; revoked_at?: Date; revoked_reason?: string }>('admin_sessions')
      .updateMany(
        { admin_id: input.adminId, revoked_at: { $exists: false } },
        { $set: { revoked_at: now, revoked_reason: 'credential_revoked' } },
        session,
      );
    const requestId = input.requestId ? { requestId: input.requestId } : {};
    await writeAudit(ctx, {
      action: 'credential.revoke',
      targetType: 'admin',
      targetId: input.adminId.toHexString(),
      meta: { reason: 'revoked_by_super_admin' },
      ...requestId,
    });
    return modifiedCount;
  });
}

/**
 * ★ Returns an admin's encrypted phone for decryption by the API, and audits the view (02 §2: phone only via this).
 *
 * @returns the `v1:…` ciphertext, or `null` when the admin has no phone stored.
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED, ADMIN_NOT_FOUND.
 */
export async function readAdminPhone(
  handle: DbHandle,
  scope: Scope,
  input: { adminId: UUID; requestId?: string; now?: Date },
): Promise<string | null> {
  requireSuper(scope, { stepUp: true, ...(input.now ? { now: input.now } : {}) });
  return withTransaction(handle, scope, async (ctx) => {
    const admin = await ctx.db
      .collection<{ _id: UUID; phone_enc?: string }>('admin_users')
      .findOne({ _id: input.adminId }, { session: ctx.session, projection: { phone_enc: 1 } });
    if (!admin) throw new StateError('ADMIN_NOT_FOUND');
    await writeAudit(ctx, {
      action: 'admin.phone_view',
      targetType: 'admin',
      targetId: input.adminId.toHexString(),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return admin.phone_enc ?? null;
  });
}

/**
 * ★ Records an audit-log export (04 R4 "audit everything" — security review L9): which filters, how many rows.
 *
 * @param input.filters - the export's filters as short text (ids as text, dates ISO), never the rows themselves.
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED.
 */
export async function recordAuditExport(
  handle: DbHandle,
  scope: Scope,
  input: { filters: Readonly<Record<string, string>>; rows: number; requestId?: string; now?: Date },
): Promise<void> {
  requireSuper(scope, { stepUp: true, ...(input.now ? { now: input.now } : {}) });
  await withTransaction(handle, scope, (ctx) =>
    writeAudit(ctx, {
      action: 'audit.export',
      meta: { filters: { ...input.filters }, rows: input.rows },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    }),
  );
}

/**
 * Records the signed-in admin's acceptance of the CURRENT undertaking version (B2, T1.10). Accepting an older version
 * is refused, so a client that loaded the text before a new version was published must reload it.
 *
 * @throws StateError FORBIDDEN (not an admin/super scope), UNDERTAKING_VERSION_MISMATCH.
 */
export async function acceptUndertaking(
  handle: DbHandle,
  scope: Scope,
  input: { version: string; requestId?: string; now?: Date },
): Promise<void> {
  if (scope.kind !== 'admin' && scope.kind !== 'super') throw new StateError('FORBIDDEN');
  const adminId = scope.adminId;
  await withTransaction(handle, scope, async (ctx) => {
    const session = { session: ctx.session };
    const now = input.now ?? new Date();
    const settings = await ctx.db
      .collection<{ _id: string; undertaking_version: string }>('app_settings')
      .findOne({ _id: 'global' }, session);
    if (!settings || settings.undertaking_version !== input.version) {
      throw new StateError('UNDERTAKING_VERSION_MISMATCH');
    }
    await ctx.db
      .collection<{ _id: UUID; undertaking_history: { version: string; accepted_at: Date }[] }>('admin_users')
      .updateOne(
        { _id: adminId },
        {
          $set: { undertaking_version: input.version, undertaking_accepted_at: now, updated_at: now },
          $push: { undertaking_history: { $each: [{ version: input.version, accepted_at: now }], $slice: -50 } },
        },
        session,
      );
    await writeAudit(ctx, {
      action: 'admin.undertaking_accept',
      targetType: 'admin',
      targetId: adminId.toHexString(),
      meta: { version: input.version },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}

/** Global settings the Super Admin edits in C10 (kill switches arrive in Phase 8). */
export interface SettingsPatch {
  readonly globalHijriOffset?: -2 | -1 | 0 | 1 | 2;
  readonly defaultPushQuota?: number;
  readonly supportWhatsapp?: string | null;
  readonly grievanceOfficer?: { name: string; email: string; address: string; city: string };
  readonly undertakingVersion?: string;
  readonly privacyVersion?: string;
  readonly termsVersion?: string;
}

/**
 * Updates global settings (Super Admin) through the policy gateway (writable allow-list).
 *
 * @returns the database field names that changed.
 * @throws StateError FORBIDDEN, NOTHING_TO_UPDATE.
 */
export async function updateSettings(
  handle: DbHandle,
  scope: Scope,
  input: { patch: SettingsPatch; requestId?: string; now?: Date },
): Promise<readonly string[]> {
  const actor = requireSuper(scope);
  const p = input.patch;
  const set: Record<string, unknown> = {
    ...(p.globalHijriOffset === undefined ? {} : { global_hijri_offset: p.globalHijriOffset }),
    ...(p.defaultPushQuota === undefined ? {} : { default_push_quota: p.defaultPushQuota }),
    ...(p.supportWhatsapp === undefined || p.supportWhatsapp === null ? {} : { support_whatsapp: p.supportWhatsapp }),
    ...(p.grievanceOfficer === undefined ? {} : { grievance_officer: { ...p.grievanceOfficer } }),
    ...(p.undertakingVersion === undefined ? {} : { undertaking_version: p.undertakingVersion }),
    ...(p.privacyVersion === undefined ? {} : { privacy_version: p.privacyVersion }),
    ...(p.termsVersion === undefined ? {} : { terms_version: p.termsVersion }),
  };
  const unset = p.supportWhatsapp === null ? { support_whatsapp: '' } : {};
  const fields = [...Object.keys(set), ...Object.keys(unset)];
  if (fields.length === 0) throw new StateError('NOTHING_TO_UPDATE');
  await withTransaction(handle, scope, async (ctx) => {
    await scoped(ctx, 'app_settings').updateOne(
      { _id: 'global' },
      {
        $set: { ...set, updated_by: actor.adminId, updated_at: input.now ?? new Date() },
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
    );
    await writeAudit(ctx, {
      action: 'settings.update',
      meta: { fields },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
  return fields;
}
