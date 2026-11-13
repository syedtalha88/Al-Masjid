// Side effects done by the data layer (02 §5, PHASE_01 T1.3): the content-version bump, the audit write and follow
// codes. They run inside the caller's transaction, so the effect and the write that causes it commit together.
import { randomBytes } from 'node:crypto';

import { FOLLOW_CODE_ALPHABET, FOLLOW_CODE_RANDOM_BYTES, followCodeFromBytes } from '@mc/domain/follow-code';
import { Long, ObjectId, type UUID } from 'mongodb';

import type { TxContext } from './client.ts';
import type { PolicyContext } from './policy.ts';
import type { Scope } from './scope.ts';
import { scoped } from './scoped.ts';

export class StateError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}

export class NotImplementedError extends Error {
  constructor(name: string, phase: string) {
    super(`${name} arrives in ${phase}`);
  }
}

// --- content version (02 §5 "Version bump") ----------------------------------------------------------------------------

/** A transaction context that is allowed to write content of exactly one masjid. */
export interface ContentContext extends TxContext {
  readonly contentMasjidId: UUID;
}

/**
 * `$inc masjids.content_version` (int64) + `updated_at` — clients refetch versioned bundles (DECISIONS #8).
 *
 * @throws StateError MASJID_NOT_FOUND when the masjid does not exist (the whole transaction aborts).
 */
export async function bumpMasjidVersion(ctx: TxContext, masjidId: UUID): Promise<void> {
  const result = await ctx.db
    .collection<{ _id: UUID }>('masjids')
    .updateOne(
      { _id: masjidId },
      { $inc: { content_version: Long.fromNumber(1) }, $set: { updated_at: new Date() } },
      { session: ctx.session },
    );
  if (result.matchedCount !== 1) throw new StateError('MASJID_NOT_FOUND');
}

/**
 * Runs content writes for one masjid, then bumps its version — in the caller's transaction. The policy gateway
 * refuses writes to {@link CONTENT_COLLECTIONS} outside this wrapper, and confines them to `masjidId`.
 */
export async function contentWrite<T>(
  ctx: TxContext,
  masjidId: UUID,
  fn: (content: ContentContext) => Promise<T>,
): Promise<T> {
  const result = await fn({ ...ctx, contentMasjidId: masjidId });
  await bumpMasjidVersion(ctx, masjidId);
  return result;
}

/** 02 §5 / §6: deleted and removed items are kept this long (IT Rules preservation), then purged by `retention`. */
export const ITEM_PURGE_DAYS = 180;

/**
 * Purge marker (02 §5): `purge_after = now + 180 days` on an item of `masjidId` that has just become `deleted` (or
 * `removed`), in the caller's transaction. A data-layer effect, not a policy write — the gateway refuses `purge_after`
 * to every generic write (moderation evidence, 04 §5).
 *
 * @throws StateError ITEM_NOT_FOUND when no deleted / removed item of the masjid has that id (the transaction aborts).
 */
export async function markItemForPurge(ctx: TxContext, masjidId: UUID, itemId: UUID, now: Date): Promise<void> {
  const result = await ctx.db
    .collection<{ _id: UUID }>('items')
    .updateOne(
      { _id: itemId, masjid_id: masjidId, status: { $in: ['deleted', 'removed'] } },
      { $set: { purge_after: new Date(now.getTime() + ITEM_PURGE_DAYS * 24 * 60 * 60 * 1000) } },
      { session: ctx.session },
    );
  if (result.matchedCount !== 1) throw new StateError('ITEM_NOT_FOUND');
}

// --- audit (02 §2 audit_log, 05) ---------------------------------------------------------------------------------------

/**
 * Allowed audit actions and, per action, the only meta keys they may carry (no secrets, no PII — 02 §2). A new action
 * must be added here, which keeps the audit vocabulary reviewable.
 */
export const AUDIT_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  'masjid.create': ['name', 'city'],
  'masjid.update': ['fields'],
  'masjid.profile': ['fields'],
  'masjid.change_request': ['note'],
  'masjid.activate': [],
  'masjid.suspend': ['reason'],
  'masjid.unsuspend': ['reason'],
  'masjid.delete': ['reason'],
  'admin.create': ['role'],
  'admin.add_to_masjid': ['role'],
  'admin.remove_from_masjid': [],
  'admin.invite': ['purpose'],
  'admin.phone_view': [],
  'audit.export': ['filters', 'rows', 'truncated'],
  'admin.undertaking_accept': ['version'],
  'invite.consume': ['purpose'],
  'device.follow': [],
  'device.unfollow': [],
  'auth.register': ['credential'],
  'auth.login': ['credential'],
  'auth.login_failed': ['credential_hash', 'capped'],
  'auth.step_up': [],
  'auth.logout': [],
  'credential.revoke': ['reason', 'credential'],
  'session.revoke': ['reason', 'count'],
  'settings.update': ['fields'],
  // The push kill switch (C10 ★, PHASE_04 T4.7).
  'push.pause': [],
  'push.resume': [],
  'library.import': ['batch', 'entries'],
  'library.update': ['fields', 'back_to_draft'],
  'library.verify': [],
  'library.retire': ['from'],
  'template.create': [],
  'template.update': ['fields', 'status'],
  'template.add_starters': ['added'],
  'timings.update': ['rev', 'notify'],
  'special.create': ['type', 'notify'],
  'special.update': ['type', 'notify'],
  'special.delete': [],
  'ramadan.update': ['on'],
  'image.upload': ['purpose', 'rights_confirmed'],
  'audio.upload': ['duration_s', 'rights_confirmed'],
  'adhkar.update': ['enabled', 'count'],
  'ruqyah.create': ['source', 'category', 'rights_confirmed'],
  'ruqyah.update': ['source', 'category', 'rights_confirmed'],
  'ruqyah.delete': [],
  'ruqyah.order': ['count'],
  // Never the name or number (personal data of the volunteer — 04 §1).
  'contact.create': ['audience', 'consent_confirmed'],
  'contact.update': ['audience', 'consent_confirmed'],
  'contact.delete': [],
  // The UPI change-lock (04 R1, T5.2): never the VPA or payee name in meta — the profile documents are the history.
  'payment.request': [],
  'payment.approve': ['hold_minutes'],
  'payment.reject': ['from', 'code'],
  'payment.activate': [],
  // Donation campaigns (T5.3): amounts are in the item and its history, not in the audit meta.
  'campaign.create': ['purpose', 'notify'],
  'video.publish': ['audience', 'notify'],
  'campaign.update': ['fields', 'target_raised'],
  'campaign.received': ['notify'],
  // PHASE_05 T5.5: never the amount (the week and whether followers were told).
  'chanda.save': ['week_start', 'notify'],
  'chanda.settings': ['show', 'week_start'],
  'campaign.complete': [],
  // Needy people (T5.8, 04 R13): a person's UPI details have no change-lock, so every create / change records them
  // old → new for the Super Admin's review. Never the phone or note (`private_enc`), the name or the reason.
  'beneficiary.create': ['category', 'zakat_eligible', 'consent_confirmed'],
  'beneficiary.update': ['fields', 'upi_changed', 'fulfilled'],
  'beneficiary.received': ['fulfilled'],
  'beneficiary.close': [],
  'beneficiary.delete': [],
  'beneficiary.private_view': [],
  'item.publish': ['type', 'template', 'notify', 'image'],
  'item.edit': ['type'],
  'item.delete': ['type'],
  // PHASE_08 T8.1: `report-triage` hid a post many devices reported within an hour (system actor).
  'item.autohide': ['type', 'reporters'],
  // PHASE_08 T8.2 (C5): takedown and restore by the Super Admin — the category and counts, never the private note.
  'item.remove': ['type', 'category', 'reports', 'was', 'legal_order'],
  'item.restore': ['type', 'was', 'reports'],
  'report.dismiss': [],
  // PHASE_08 T8.4 (C6): grievances — never the description or the contact in meta.
  'grievance.ack': [],
  'grievance.resolve': ['status'],
  'grievance.contact': [],
  // PHASE_08 T8.5 (C7): legal orders — never the authority, reference, summary or notes in meta.
  'legal_order.create': ['target_type'],
  'legal_order.update': ['from', 'to', 'action'],
  'legal_order.document': ['replaced'],
  'legal_order.document_read': [],
};
const META_LIMIT_BYTES = 4096;

export interface AuditEntry {
  readonly action: keyof typeof AUDIT_ACTIONS;
  readonly masjidId?: UUID;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly requestId?: string;
}

const actorOf = (scope: Scope) => {
  switch (scope.kind) {
    case 'admin':
      return { actor_type: 'admin', actor_id: scope.adminId };
    case 'super':
      return { actor_type: 'super_admin', actor_id: scope.adminId };
    case 'device':
      return { actor_type: 'device', actor_id: scope.deviceId };
    case 'system':
      return { actor_type: 'system' };
    case 'public':
    case 'hook':
      throw new StateError('AUDIT_ACTOR', `scope ${scope.kind} cannot write the audit log`);
  }
};

/**
 * Appends one audit entry in the caller's transaction (append-only: no user but mc_system can update/remove — 02 §4.3).
 *
 * @param actor - set only by state functions acting for someone not authenticated yet (an invitee consuming an
 *   invite, an admin logging in) or recording what the system decided (a revoked credential, a failed login); otherwise the actor is the scope's and the policy gateway writes the entry.
 * @throws StateError AUDIT_ACTION (unknown action), AUDIT_META (key not allowed for the action, or meta > 4 KB),
 *   AUDIT_ACTOR (public/hook scope without an explicit actor).
 */
export async function writeAudit(
  ctx: TxContext,
  entry: AuditEntry,
  actor?: { readonly type: 'admin'; readonly id: UUID } | { readonly type: 'system' },
): Promise<void> {
  const allowed = AUDIT_ACTIONS[entry.action];
  if (!allowed) throw new StateError('AUDIT_ACTION', `unknown audit action ${entry.action}`);
  const meta = entry.meta ?? {};
  const extra = Object.keys(meta).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new StateError('AUDIT_META', `meta keys not allowed: ${extra.join(', ')}`);
  if (Buffer.byteLength(JSON.stringify(meta)) > META_LIMIT_BYTES) throw new StateError('AUDIT_META', 'meta over 4 KB');
  const doc = {
    _id: new ObjectId(),
    at: new Date(),
    ...(actor ? { actor_type: actor.type, ...('id' in actor ? { actor_id: actor.id } : {}) } : actorOf(ctx.scope)),
    action: entry.action,
    ...(entry.masjidId ? { masjid_id: entry.masjidId } : {}),
    ...(entry.targetType ? { target_type: entry.targetType } : {}),
    ...(entry.targetId ? { target_id: entry.targetId } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
    ...(entry.requestId ? { request_id: entry.requestId } : {}),
  };
  if (actor) {
    await ctx.db.collection('audit_log').insertOne(doc, { session: ctx.session });
    return;
  }
  const policy: PolicyContext = { scope: ctx.scope, db: ctx.db, session: ctx.session };
  await scoped(policy, 'audit_log').insertOne(doc);
}

// --- follow codes (02 §3 genFollowCode) -----------------------------------------------------------------------------

/** Crockford Base32 alphabet (no I, L, O, U) — one definition in `@mc/domain/follow-code`. */
export const CROCKFORD = FOLLOW_CODE_ALPHABET;

/**
 * A random 40-bit follow code, 8 Crockford characters (encoding: `followCodeFromBytes` in `@mc/domain`).
 *
 * @param random - injectable source of 5 random bytes (tests force collisions).
 */
export function genFollowCode(random: (bytes: number) => Buffer = randomBytes): string {
  return followCodeFromBytes(random(FOLLOW_CODE_RANDOM_BYTES));
}

const isDuplicateOn = (error: unknown, field: string) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 11000 &&
  'keyPattern' in error &&
  typeof error.keyPattern === 'object' &&
  error.keyPattern !== null &&
  field in error.keyPattern;

/**
 * Runs `insert(code)` with fresh follow codes until it does not collide (max 5 attempts — 02 §3).
 *
 * @throws StateError FOLLOW_CODE_EXHAUSTED after 5 collisions; any other error unchanged.
 */
export async function withFollowCode<T>(
  insert: (code: string) => Promise<T>,
  random?: (bytes: number) => Buffer,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await insert(genFollowCode(random));
    } catch (error) {
      if (!isDuplicateOn(error, 'follow_code')) throw error;
    }
  }
  throw new StateError('FOLLOW_CODE_EXHAUSTED');
}
