// The UPI change-lock (04 R1, 02 payment_profiles, PHASE_05 T5.2) — the ONLY code that writes `payment_profiles`
// (the policy layer has no write cell for it). State machine: an admin requests (`pending`, one open request per
// masjid — partial unique index) → the Super Admin approves with a fresh step-up (`approved_on_hold` until
// `effective_at` = now + hold) or rejects (from `pending`, or during the hold — DECISIONS #146) → the system job
// activates at `effective_at` (previous `active` → `superseded`), bumps the version and publishes the locked
// "Payment details updated" notice with a push that bypasses the daily quota. The first profile takes the same path.
import { cleanUpiText, isValidVpa, normalizeVpa } from '@mc/domain/upi';
import { MongoServerError, type UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import { numberOf } from '../repos/read.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText, newId } from '../values.ts';
import { requireSuper } from './guards.ts';
import { insertPublishedItem } from './publish.ts';

/** The system notice published when new payment details go live (02 notice_templates `system`). */
export const PAYMENT_NOTICE_TEMPLATE = 'payment_details_updated';

/** 04 R1: the hold is never shorter than 24 h in production (env `PAYMENT_HOLD_MINUTES`, checked at boot). */
export const PAYMENT_HOLD_MIN_PRODUCTION = 1440;

/** Profiles one activation run handles (the job runs every 10 minutes; more wait for the next run). */
const ACTIVATION_BATCH = 50;

type ProfileDoc = { _id: UUID } & Record<string, unknown>;

const profiles = (ctx: TxContext) => ctx.db.collection<ProfileDoc>('payment_profiles');
const session = (ctx: TxContext) => ({ session: ctx.session });
const isDuplicateKey = (error: unknown) => error instanceof MongoServerError && error.code === 11000;
const audit = (requestId: string | undefined) => (requestId ? { requestId } : {});

/** The masjid as a change request needs it: exists, not suspended or deleted. */
async function requestableMasjid(ctx: TxContext, masjidId: UUID): Promise<{ visible: boolean }> {
  const masjid = await ctx.db.collection<ProfileDoc>('masjids').findOne({ _id: masjidId }, session(ctx));
  const status = masjid?.['status'];
  if (status !== 'active' && status !== 'pending') throw new StateError('MASJID_NOT_FOUND');
  return { visible: status === 'active' };
}

/**
 * An admin asks to set or change the masjid's UPI details (07 B8). Nothing becomes public: the request waits for the
 * Super Admin. The VPA is normalized (handle lowercased), the payee name cleaned like the link builder cleans it.
 *
 * @returns the request's id.
 * @throws StateError MASJID_NOT_FOUND (not this admin's masjid, not an admin scope, a suspended or deleted masjid),
 *   PAYMENT_INVALID (VPA, payee name 1–100 or note ≤ 300), PAYMENT_UNCHANGED (same as the active details),
 *   PAYMENT_REQUEST_OPEN (a request is already pending or on hold — also when requests race).
 */
export async function requestPaymentChange(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly masjidId: UUID;
    readonly vpa: string;
    readonly payeeName: string;
    readonly note?: string | undefined;
    readonly requestId?: string | undefined;
    readonly now?: Date | undefined;
  },
): Promise<{ id: string }> {
  requireOwnMasjid(scope, input.masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  const vpa = normalizeVpa(input.vpa);
  const payeeName = cleanUpiText(input.payeeName);
  const note = input.note?.trim() ?? '';
  if (!isValidVpa(vpa) || payeeName.length < 1 || payeeName.length > 100 || note.length > 300) {
    throw new StateError('PAYMENT_INVALID');
  }
  const now = input.now ?? new Date();
  const id = newId();

  await withTransaction(handle, scope, async (ctx) => {
    const { visible } = await requestableMasjid(ctx, input.masjidId);
    if (await profiles(ctx).findOne({ masjid_id: input.masjidId, open: true }, session(ctx))) {
      throw new StateError('PAYMENT_REQUEST_OPEN');
    }
    const active = await profiles(ctx).findOne({ masjid_id: input.masjidId, status: 'active' }, session(ctx));
    if (active?.['vpa'] === vpa && active['payee_name'] === payeeName) throw new StateError('PAYMENT_UNCHANGED');
    try {
      await profiles(ctx).insertOne(
        {
          _id: id,
          masjid_id: input.masjidId,
          vpa,
          payee_name: payeeName,
          status: 'pending',
          open: true,
          requested_by: scope.adminId,
          ...(note === '' ? {} : { request_note: note }),
          masjid_visible: visible,
          created_at: now,
          updated_at: now,
        },
        session(ctx),
      );
    } catch (error) {
      // The partial unique index {masjid_id, open} — a request that raced past the check above.
      if (isDuplicateKey(error)) throw new StateError('PAYMENT_REQUEST_OPEN');
      throw error;
    }
    await writeAudit(ctx, {
      action: 'payment.request',
      masjidId: input.masjidId,
      targetType: 'payment_profiles',
      targetId: idText(id),
      ...audit(input.requestId),
    });
  });
  return { id: idText(id) };
}

/**
 * Is the "Payment details updated" system template active (DECISIONS #160, review M1)? Without it the followers'
 * notice would show no text — the change would be silent, against 04 R1.
 */
async function noticeTemplateActive(ctx: TxContext): Promise<boolean> {
  const template = await ctx.db
    .collection<{ _id: string }>('notice_templates')
    .findOne({ _id: PAYMENT_NOTICE_TEMPLATE, status: 'active' }, { ...session(ctx), projection: { _id: 1 } });
  return template !== null;
}

/** Why an open-state update matched nothing: the profile is unknown, or in another state. */
async function missOf(ctx: TxContext, profileId: UUID, wrongState: string): Promise<never> {
  const exists = await profiles(ctx).findOne({ _id: profileId }, session(ctx));
  throw new StateError(exists ? wrongState : 'PAYMENT_NOT_FOUND');
}

/**
 * ★ The Super Admin approves a pending request (C4): it goes live `holdMinutes` later, by the activation job.
 *
 * @param input.holdMinutes - env `PAYMENT_HOLD_MINUTES` (≥ 1440 in production, checked at boot).
 * @returns the masjid, the requesting admin (for the alert) and when the details go live.
 * @throws StateError FORBIDDEN (not the Super Admin), STEP_UP_REQUIRED, PAYMENT_NOT_FOUND, PAYMENT_NOT_PENDING,
 *   PAYMENT_NOTICE_UNAVAILABLE (the "Payment details updated" template is not active — followers would not be told);
 *   RangeError for a hold that is not a positive whole number of minutes.
 */
export async function approvePaymentChange(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly profileId: UUID;
    readonly holdMinutes: number;
    readonly requestId?: string | undefined;
    readonly now?: Date | undefined;
  },
): Promise<{ masjidId: UUID; requestedBy: UUID; effectiveAt: Date }> {
  const now = input.now ?? new Date();
  const reviewer = requireSuper(scope, { stepUp: true, now });
  if (!Number.isSafeInteger(input.holdMinutes) || input.holdMinutes < 1) {
    throw new RangeError('approvePaymentChange(): holdMinutes must be a positive integer');
  }
  const effectiveAt = new Date(now.getTime() + input.holdMinutes * 60_000);
  return withTransaction(handle, scope, async (ctx) => {
    if (!(await noticeTemplateActive(ctx))) throw new StateError('PAYMENT_NOTICE_UNAVAILABLE');
    const doc = await profiles(ctx).findOneAndUpdate(
      { _id: input.profileId, status: 'pending' },
      {
        $set: {
          status: 'approved_on_hold',
          reviewed_by: reviewer.adminId,
          reviewed_at: now,
          effective_at: effectiveAt,
          updated_at: now,
        },
      },
      { ...session(ctx), returnDocument: 'after' },
    );
    if (!doc) return missOf(ctx, input.profileId, 'PAYMENT_NOT_PENDING');
    const masjidId = doc['masjid_id'] as UUID; // a UUID by schema
    await writeAudit(ctx, {
      action: 'payment.approve',
      masjidId,
      targetType: 'payment_profiles',
      targetId: idText(input.profileId),
      meta: { hold_minutes: input.holdMinutes },
      ...audit(input.requestId),
    });
    return { masjidId, requestedBy: doc['requested_by'] as UUID, effectiveAt }; // a UUID by schema
  });
}

/**
 * The Super Admin turns a request down (C4) — while pending, or during the hold to stop a change that turned out to
 * be wrong (DECISIONS #146). The masjid may then request again.
 *
 * @returns the masjid and the requesting admin (for the alert).
 * @throws StateError FORBIDDEN, PAYMENT_INVALID (reason empty or over 300), PAYMENT_NOT_FOUND, PAYMENT_NOT_OPEN
 *   (already active, rejected or superseded).
 */
export async function rejectPaymentChange(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly profileId: UUID;
    readonly reason: string;
    readonly requestId?: string | undefined;
    readonly now?: Date | undefined;
  },
): Promise<{ masjidId: UUID; requestedBy: UUID }> {
  const reviewer = requireSuper(scope);
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 300) throw new StateError('PAYMENT_INVALID');
  const now = input.now ?? new Date();
  return withTransaction(handle, scope, async (ctx) => {
    const doc = await profiles(ctx).findOneAndUpdate(
      { _id: input.profileId, open: true },
      {
        $set: {
          status: 'rejected',
          open: false,
          reject_reason: reason,
          reviewed_by: reviewer.adminId,
          reviewed_at: now,
          updated_at: now,
        },
      },
      { ...session(ctx), returnDocument: 'before' },
    );
    if (!doc) return missOf(ctx, input.profileId, 'PAYMENT_NOT_OPEN');
    const masjidId = doc['masjid_id'] as UUID; // a UUID by schema
    await writeAudit(ctx, {
      action: 'payment.reject',
      masjidId,
      targetType: 'payment_profiles',
      targetId: idText(input.profileId),
      meta: { from: doc['status'] },
      ...audit(input.requestId),
    });
    return { masjidId, requestedBy: doc['requested_by'] as UUID }; // a UUID by schema
  });
}

export interface PaymentActivation {
  readonly masjidId: UUID;
  readonly profileId: UUID;
  readonly requestedBy: UUID;
  /** The notice's outbox job (`null` when the masjid is not public, so nobody is told). */
  readonly noticeJobId: string | null;
}

/** Thrown inside an activation transaction when another run got there first: abort, skip. */
class AlreadyActivated extends Error {}
/** Thrown inside an activation transaction when the profile must wait: abort, leave it on hold, try next run. */
class HeldBack extends Error {}

export interface PaymentActivationRun {
  readonly activated: PaymentActivation[];
  /**
   * Due but kept on hold (DECISIONS #160): the masjid is suspended (followers could not be told now), or the notice
   * template is not active. They go live, with the notice, on a later run.
   */
  readonly heldBack: UUID[];
}

/**
 * The `payment-activate` job (every 10 minutes, `mc_system`): every profile on hold whose `effective_at` has come goes
 * live, one transaction each — previous active → superseded, this one active, version bump, and (when the masjid is
 * public) the important "Payment details updated" notice to everyone with a quota-free outbox job.
 *
 * @returns what was activated (the worker raises the admin alerts and enqueues the fan-outs) and what was held back.
 *   Idempotent.
 * @throws StateError FORBIDDEN outside the system scope.
 */
export async function activateDuePaymentProfiles(
  handle: DbHandle,
  scope: Scope,
  input: { readonly now?: Date | undefined } = {},
): Promise<PaymentActivationRun> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const now = input.now ?? new Date();
  const due = await (
    await handle.db()
  )
    .collection<ProfileDoc>('payment_profiles')
    .find(
      { status: 'approved_on_hold', effective_at: { $lte: now } },
      { sort: { effective_at: 1 }, limit: ACTIVATION_BATCH },
    )
    .toArray();
  const done: PaymentActivation[] = [];
  const heldBack: UUID[] = [];
  for (const profile of due) {
    try {
      done.push(await withTransaction(handle, scope, (ctx) => activateOne(ctx, profile, now)));
    } catch (error) {
      if (error instanceof HeldBack) heldBack.push(profile._id);
      else if (!(error instanceof AlreadyActivated)) throw error;
    }
  }
  return { activated: done, heldBack };
}

async function activateOne(ctx: TxContext, profile: ProfileDoc, now: Date): Promise<PaymentActivation> {
  const masjidId = profile['masjid_id'] as UUID; // a UUID by schema
  const masjid = await ctx.db.collection<ProfileDoc>('masjids').findOne({ _id: masjidId }, session(ctx));
  // Review L1: a suspended masjid's followers cannot be told now — and would see the new UPI ID without a notice once
  // it is restored. Wait. (A pending masjid has no followers yet: it goes live quietly, as before.)
  if (masjid?.['status'] === 'suspended') throw new HeldBack();
  const visible = masjid?.['status'] === 'active';
  if (visible && !(await noticeTemplateActive(ctx))) throw new HeldBack(); // review M1: never a silent change
  await profiles(ctx).updateMany(
    { masjid_id: masjidId, status: 'active' },
    { $set: { status: 'superseded', updated_at: now } },
    session(ctx),
  );
  const result = await profiles(ctx).updateOne(
    { _id: profile._id, status: 'approved_on_hold', effective_at: { $lte: now } },
    { $set: { status: 'active', open: false, masjid_visible: visible, updated_at: now } },
    session(ctx),
  );
  if (result.matchedCount !== 1) throw new AlreadyActivated();

  const version = (numberOf(masjid ?? {}, 'content_version') ?? 0) + 1;
  const jobId = await contentWrite(ctx, masjidId, async (content) => {
    if (!visible) return null;
    const item = await insertPublishedItem(
      content,
      {
        type: 'announcement',
        audience: 'everyone',
        isImportant: true,
        notify: true,
        templateKey: PAYMENT_NOTICE_TEMPLATE,
        templateParams: {},
        detail: { announcement: { category: 'general' } },
        createdBy: profile['requested_by'] as UUID, // a UUID by schema
        masjidVisible: true,
        version,
      },
      now,
    );
    const id = newId();
    // 04 R1: every follower hears about it — no daily quota (`bypass_quota`).
    await scoped(content, 'notification_jobs').insertOne({
      _id: id,
      item_id: item.itemId,
      masjid_id: masjidId,
      status: 'pending',
      audience: 'everyone',
      audience_targets: ['brothers', 'sisters'],
      targeted: 0,
      sent: 0,
      failed: 0,
      pruned: 0,
      pending_batches: 0,
      bypass_quota: true,
      created_at: now,
    });
    return idText(id);
  });
  await writeAudit(ctx, {
    action: 'payment.activate',
    masjidId,
    targetType: 'payment_profiles',
    targetId: idText(profile._id),
  });
  return {
    masjidId,
    profileId: profile._id,
    requestedBy: profile['requested_by'] as UUID, // a UUID by schema
    noticeJobId: jobId,
  };
}
