// Typed read repositories for the Super Admin screens (C1, C2, C10, C11 — PHASE_01 T1.11; T1.4 "repositories per
// aggregate"). Every read goes through the policy gateway with the caller's scope, so hidden fields (`phone_enc`,
// token hashes) never come back, and callers pass typed values only — never a raw filter from a request.
import { ObjectId, type UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { StateError } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { isId } from '../values.ts';

const MAX_PAGE = 100;

function requireSuperScope(scope: Scope): void {
  if (scope.kind !== 'super') throw new StateError('FORBIDDEN');
}

/** Opaque page cursors: base64url JSON, validated on the way back in (a forged cursor is just "no such page"). */
const encodeCursor = (value: readonly [string, string]) => Buffer.from(JSON.stringify(value)).toString('base64url');
function decodeCursor(cursor: string | undefined): [Date, string] | undefined {
  if (!cursor) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    ) {
      const at = new Date(parsed[0]);
      if (!Number.isNaN(at.getTime())) return [at, parsed[1]];
    }
  } catch {
    // fall through
  }
  throw new StateError('INVALID_CURSOR');
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface MasjidRow {
  readonly id: UUID;
  readonly name: string;
  readonly area: string;
  readonly city: string;
  readonly status: 'pending' | 'active' | 'suspended' | 'deleted';
  readonly followCode: string;
  readonly adminCount: number;
  readonly createdAt: Date;
}

/**
 * C2 list: newest first, optional status filter and name/city/follow-code search (case-insensitive, literal text).
 *
 * @throws StateError FORBIDDEN (not super), INVALID_CURSOR.
 */
export async function listMasjids(
  handle: DbHandle,
  scope: Scope,
  input: { q?: string; status?: MasjidRow['status']; cursor?: string; limit?: number },
): Promise<{ rows: readonly MasjidRow[]; next: string | undefined }> {
  requireSuperScope(scope);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), MAX_PAGE);
  const after = decodeCursor(input.cursor);
  const q = input.q?.trim();
  const search = q ? new RegExp(escapeRegex(q.slice(0, 80)), 'i') : undefined;
  const parts: Record<string, unknown>[] = [
    ...(input.status ? [{ status: input.status }] : []),
    ...(search
      ? [{ $or: [{ name: search }, { city: search }, { area: search }, { follow_code: q?.toUpperCase() }] }]
      : []),
    ...(after ? [{ $or: [{ created_at: { $lt: after[0] } }, { created_at: after[0], _id: { $lt: after[1] } }] }] : []),
  ];
  const db = await handle.db();
  const docs = await scoped({ scope, db }, 'masjids').find(parts.length > 0 ? { $and: parts } : {}, {
    sort: { created_at: -1, _id: -1 },
    limit: limit + 1,
  });
  const rows = docs.slice(0, limit).flatMap((doc): MasjidRow[] => {
    const id: unknown = doc['_id'];
    if (!isId(id)) return [];
    return [
      {
        id,
        name: String(doc['name']),
        area: String(doc['area']),
        city: String(doc['city']),
        status: doc['status'] as MasjidRow['status'], // validator-enforced enum
        followCode: String(doc['follow_code']),
        adminCount: Number(doc['admin_count']),
        createdAt: doc['created_at'] as Date, // validator-enforced date
      },
    ];
  });
  const last = rows.at(-1);
  return {
    rows,
    next: docs.length > limit && last ? encodeCursor([last.createdAt.toISOString(), last.id.toHexString()]) : undefined,
  };
}

export interface AdminOfMasjid {
  readonly id: UUID;
  readonly displayName: string;
  readonly role: 'owner' | 'editor';
  readonly status: 'invited' | 'active' | 'disabled';
  readonly uiLocale: 'en' | 'hi' | 'ur' | 'te';
  readonly hasPhone: boolean;
  readonly undertakingVersion: string | undefined;
  readonly lastLoginAt: Date | undefined;
}

/**
 * C2 masjid page: the masjid document (minus nothing secret — masjids hold none), follower count and its admins.
 *
 * @returns `null` for an unknown id.
 * @throws StateError FORBIDDEN (not super).
 */
export async function getMasjidDetail(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
): Promise<{ masjid: Record<string, unknown>; followers: number; admins: readonly AdminOfMasjid[] } | null> {
  requireSuperScope(scope);
  const db = await handle.db();
  const ctx = { scope, db };
  const masjid = await scoped(ctx, 'masjids').findOne({ _id: masjidId });
  if (!masjid) return null;
  const stats = await scoped(ctx, 'masjid_stats').findOne({ _id: masjidId });
  const memberships = await scoped(ctx, 'masjid_admins').find({ masjid_id: masjidId });
  const adminIds = memberships.map((m): unknown => m['admin_id']).filter(isId);
  const admins = adminIds.length > 0 ? await scoped(ctx, 'admin_users').find({ _id: { $in: adminIds } }) : [];
  // `phone_enc` is hidden from the Super Admin's reads (02 §4.1) — presence is checked separately, never the value.
  const withPhone = new Set(
    (
      await db
        .collection<{ _id: UUID; phone_enc?: string }>('admin_users')
        .find({ _id: { $in: adminIds }, phone_enc: { $exists: true } }, { projection: { _id: 1 } })
        .toArray()
    ).map((a) => a._id.toHexString()),
  );
  const byId = new Map(
    admins.flatMap((a) => {
      const id: unknown = a['_id'];
      return isId(id) ? [[id.toHexString(), a] as const] : [];
    }),
  );
  return {
    masjid,
    followers: typeof stats?.['followers'] === 'number' ? stats['followers'] : 0,
    admins: memberships.flatMap((m): AdminOfMasjid[] => {
      const id: unknown = m['admin_id'];
      const admin = isId(id) ? byId.get(id.toHexString()) : undefined;
      if (!isId(id) || !admin) return [];
      return [
        {
          id,
          displayName: String(admin['display_name']),
          role: m['role'] as AdminOfMasjid['role'], // validator-enforced enum
          status: admin['status'] as AdminOfMasjid['status'], // validator-enforced enum
          uiLocale: admin['ui_locale'] as AdminOfMasjid['uiLocale'], // validator-enforced enum
          hasPhone: withPhone.has(id.toHexString()),
          undertakingVersion:
            typeof admin['undertaking_version'] === 'string' ? admin['undertaking_version'] : undefined,
          lastLoginAt: admin['last_login_at'] instanceof Date ? admin['last_login_at'] : undefined,
        },
      ];
    }),
  };
}

export interface AuditRow {
  readonly id: string;
  readonly at: Date;
  readonly actorType: string;
  readonly actorId: UUID | undefined;
  readonly action: string;
  readonly masjidId: UUID | undefined;
  readonly targetType: string | undefined;
  readonly targetId: string | undefined;
  readonly meta: Readonly<Record<string, unknown>> | undefined;
  readonly requestId: string | undefined;
}

/**
 * C11 audit log: newest first, filters by actor, masjid, action and time range; cursor pagination.
 *
 * @throws StateError FORBIDDEN (not super), INVALID_CURSOR.
 */
export async function listAudit(
  handle: DbHandle,
  scope: Scope,
  input: { actorId?: UUID; masjidId?: UUID; action?: string; from?: Date; to?: Date; cursor?: string; limit?: number },
): Promise<{ rows: readonly AuditRow[]; next: string | undefined }> {
  requireSuperScope(scope);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), MAX_PAGE);
  const after = decodeCursor(input.cursor);
  if (after && !ObjectId.isValid(after[1])) throw new StateError('INVALID_CURSOR');
  const at = {
    ...(input.from ? { $gte: input.from } : {}),
    ...(input.to ? { $lt: input.to } : {}),
  };
  const parts: Record<string, unknown>[] = [
    ...(input.actorId ? [{ actor_id: input.actorId }] : []),
    ...(input.masjidId ? [{ masjid_id: input.masjidId }] : []),
    ...(input.action ? [{ action: input.action }] : []),
    ...(Object.keys(at).length > 0 ? [{ at }] : []),
    ...(after ? [{ $or: [{ at: { $lt: after[0] } }, { at: after[0], _id: { $lt: new ObjectId(after[1]) } }] }] : []),
  ];
  const db = await handle.db();
  const docs = await scoped({ scope, db }, 'audit_log').find(parts.length > 0 ? { $and: parts } : {}, {
    sort: { at: -1, _id: -1 },
    limit: limit + 1,
  });
  const rows = docs.slice(0, limit).map((doc): AuditRow => ({
    id: String(doc['_id']),
    at: doc['at'] as Date, // validator-enforced date
    actorType: String(doc['actor_type']),
    actorId: isId(doc['actor_id']) ? doc['actor_id'] : undefined,
    action: String(doc['action']),
    masjidId: isId(doc['masjid_id']) ? doc['masjid_id'] : undefined,
    targetType: typeof doc['target_type'] === 'string' ? doc['target_type'] : undefined,
    targetId: typeof doc['target_id'] === 'string' ? doc['target_id'] : undefined,
    meta:
      typeof doc['meta'] === 'object' && doc['meta'] !== null ? (doc['meta'] as Record<string, unknown>) : undefined, // object-typed field
    requestId: typeof doc['request_id'] === 'string' ? doc['request_id'] : undefined,
  }));
  const last = rows.at(-1);
  return { rows, next: docs.length > limit && last ? encodeCursor([last.at.toISOString(), last.id]) : undefined };
}

/**
 * C10 settings document.
 *
 * @throws StateError FORBIDDEN (not super), SETTINGS_MISSING (migrations not run).
 */
export async function getSettings(handle: DbHandle, scope: Scope): Promise<Record<string, unknown>> {
  requireSuperScope(scope);
  const db = await handle.db();
  const settings = await scoped({ scope, db }, 'app_settings').findOne({ _id: 'global' });
  if (!settings) throw new StateError('SETTINGS_MISSING');
  return settings;
}

/** How far back the dashboard looks for passkeys revoked as possible clones. */
export const PASSKEY_ALERT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * C1 dashboard (Phase 1 part): pending activations, counts per masjid status, and how many passkeys were revoked in
 * the last 30 days because their sign counter went backwards (possible clone, 04 §3 — the push alert is Phase 4).
 *
 * @throws StateError FORBIDDEN (not super).
 */
export async function getDashboard(
  handle: DbHandle,
  scope: Scope,
  input: { now?: Date } = {},
): Promise<{
  pending: readonly MasjidRow[];
  counts: Readonly<Record<MasjidRow['status'], number>>;
  passkeyAlerts: number;
}> {
  requireSuperScope(scope);
  const db = await handle.db();
  const since = new Date((input.now ?? new Date()).getTime() - PASSKEY_ALERT_WINDOW_MS);
  const passkeyAlerts = await scoped({ scope, db }, 'audit_log').count({
    action: 'credential.revoke',
    'meta.reason': 'counter_regression',
    at: { $gte: since },
  });
  const masjids = scoped({ scope, db }, 'masjids');
  const [pending, active, suspended, deleted] = await Promise.all(
    (['pending', 'active', 'suspended', 'deleted'] as const).map((status) => masjids.count({ status })),
  );
  const { rows } = await listMasjids(handle, scope, { status: 'pending', limit: 20 });
  return {
    pending: rows,
    counts: { pending: pending ?? 0, active: active ?? 0, suspended: suspended ?? 0, deleted: deleted ?? 0 },
    passkeyAlerts,
  };
}
