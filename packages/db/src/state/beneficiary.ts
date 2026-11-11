// Needy people (00 §4.14, 02 beneficiaries, 04 R13, DECISIONS #104, PHASE_05 T5.8): people the masjid has verified as
// in need, listed with their own UPI details and their agreement. Every write is one transaction with the version bump
// (followers' lists refresh; it also serializes concurrent writes, so the 100-person limit and "fulfilled at the cap"
// hold under parallel requests) and an audit entry. `setBeneficiaryReceived` keeps `funded_permille`, the status and
// the append-only history row together. We never touch money (CLAUDE.md §2.2): "received" is what the masjid reports.
// There is no change-lock on a person's UPI details (owner, #104) — every create / change is audited old → new (R13).
import { isValidVpa, normalizeVpa } from '@mc/domain/upi';
import type { UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import { numberOf, text } from '../repos/read.ts';
import {
  BENEFICIARIES_ACTIVE_MAX,
  BENEFICIARY_CAP_MAX_PAISE,
  BENEFICIARY_CAP_MIN_PAISE,
  BENEFICIARY_PURGE_DAYS,
} from '../schema/beneficiaries.ts';
import { MAX_PAISE } from '../schema/dsl.ts';
import { BENEFICIARY_CATEGORY, LOCALE } from '../schema/enums.ts';
import { ENCRYPTED_PATTERN } from '../schema/masjids.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText, newId, newPublicId, toInt64 } from '../values.ts';

export type BeneficiaryCategory = (typeof BENEFICIARY_CATEGORY)[number];
export type BeneficiaryStatus = 'active' | 'fulfilled' | 'closed' | 'deleted';

/** A person as the admin saves them (B19). */
export interface BeneficiaryInput {
  /** First name or initials only (≤ 40). */
  readonly displayName: string;
  readonly category: BeneficiaryCategory;
  /** Why the masjid lists them (≤ 300), in `reasonLocale`. */
  readonly reason: string;
  readonly reasonLocale: (typeof LOCALE)[number];
  /** The person's own UPI ID and the name their UPI app shows. */
  readonly vpa: string;
  readonly payeeName: string;
  /** What they need, in paise (₹1 … ₹1 crore). */
  readonly capPaise: number;
  readonly zakatEligible: boolean;
  /** "The person — or a guardian for a child — agreed to be listed": must be true on every save. */
  readonly consentConfirmed: boolean;
}

interface WriteOptions {
  readonly masjidId: UUID;
  readonly requestId?: string | undefined;
  readonly now?: Date | undefined;
}

type Doc = { _id: UUID } & Record<string, unknown>;

const ENCRYPTED = new RegExp(ENCRYPTED_PATTERN);
const DAY_MS = 24 * 60 * 60 * 1000;
const audit = (requestId: string | undefined) => (requestId ? { requestId } : {});
const purgeAt = (now: Date) => new Date(now.getTime() + BENEFICIARY_PURGE_DAYS * DAY_MS);

/**
 * `min(1000, received × 1000 ÷ cap)`, rounded down — the public order ("least-funded first") and the progress bar.
 *
 * @throws RangeError when `capPaise` is not positive.
 */
export function fundedPermille(receivedPaise: number, capPaise: number): number {
  if (capPaise <= 0) throw new RangeError('fundedPermille(): the cap must be positive');
  return Math.min(1000, Math.floor((receivedPaise * 1000) / capPaise));
}

function adminOf(scope: Scope, masjidId: UUID): UUID {
  requireOwnMasjid(scope, masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  return scope.adminId;
}

/** The stored public fields of a person, checked (`BENEFICIARY_INVALID`). */
function fieldsOf(input: BeneficiaryInput) {
  const displayName = input.displayName.trim();
  const reason = input.reason.trim();
  const payeeName = input.payeeName.trim();
  const vpa = normalizeVpa(input.vpa);
  const ok =
    input.consentConfirmed &&
    displayName.length >= 1 &&
    displayName.length <= 40 &&
    reason.length >= 1 &&
    reason.length <= 300 &&
    payeeName.length >= 1 &&
    payeeName.length <= 100 &&
    BENEFICIARY_CATEGORY.includes(input.category) &&
    LOCALE.includes(input.reasonLocale) &&
    isValidVpa(vpa) &&
    Number.isSafeInteger(input.capPaise) &&
    input.capPaise >= BENEFICIARY_CAP_MIN_PAISE &&
    input.capPaise <= BENEFICIARY_CAP_MAX_PAISE;
  if (!ok) throw new StateError('BENEFICIARY_INVALID');
  return {
    display_name: displayName,
    category: input.category,
    reason,
    reason_locale: input.reasonLocale,
    vpa,
    payee_name: payeeName,
    cap_paise: toInt64(input.capPaise),
    zakat_eligible: input.zakatEligible,
    consent_confirmed: true,
  };
}

function checkPrivate(privateEnc: string | null | undefined): void {
  if (typeof privateEnc === 'string' && !ENCRYPTED.test(privateEnc)) throw new StateError('BENEFICIARY_INVALID');
}

/** The masjid inside the transaction (`MASJID_NOT_FOUND` outside the scope). */
async function ownMasjid(ctx: TxContext, masjidId: UUID): Promise<Doc> {
  const masjid = await scoped(ctx, 'masjids').findOne({ _id: masjidId });
  if (!masjid) throw new StateError('MASJID_NOT_FOUND');
  return masjid as Doc; // `_id` is the UUID just matched
}

/** The masjid's own person in one of `statuses` (`BENEFICIARY_NOT_FOUND` otherwise). */
async function ownPerson(
  ctx: TxContext,
  masjidId: UUID,
  id: UUID,
  statuses: readonly BeneficiaryStatus[],
): Promise<Doc> {
  const person = await scoped(ctx, 'beneficiaries').findOne({
    _id: id,
    masjid_id: masjidId,
    status: { $in: [...statuses] },
  });
  if (!person) throw new StateError('BENEFICIARY_NOT_FOUND');
  return person as Doc; // `_id` is the UUID just matched
}

/**
 * Adds a person to the masjid's "Help the needy" list (B19 → Save).
 *
 * @param input.privateEnc - phone / note already encrypted by the API (`encryptField`, context
 *   `beneficiaries.private_enc`) — never plain text here.
 * @returns the new person's id and public id.
 * @throws StateError MASJID_NOT_FOUND (outside the scope), BENEFICIARY_INVALID (no consent, a name / reason / payee
 *   outside its length, an invalid UPI ID, a cap outside ₹1 … ₹1 crore, a malformed ciphertext),
 *   BENEFICIARY_LIMIT_REACHED (100 active — also when adds race).
 */
export async function createBeneficiary(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly person: BeneficiaryInput; readonly privateEnc?: string | undefined },
): Promise<{ id: string; publicId: string }> {
  const adminId = adminOf(scope, input.masjidId);
  const fields = fieldsOf(input.person);
  checkPrivate(input.privateEnc);
  const now = input.now ?? new Date();
  return withTransaction(handle, scope, async (ctx) => {
    const masjid = await ownMasjid(ctx, input.masjidId);
    const id = newId();
    const publicId = newPublicId();
    await contentWrite(ctx, input.masjidId, async (content) => {
      const store = scoped(content, 'beneficiaries');
      const active = await store.count({ masjid_id: input.masjidId, status: 'active' });
      if (active >= BENEFICIARIES_ACTIVE_MAX) throw new StateError('BENEFICIARY_LIMIT_REACHED');
      await store.insertOne({
        _id: id,
        public_id: publicId,
        masjid_id: input.masjidId,
        ...fields,
        received_paise: toInt64(0),
        funded_permille: 0,
        ...(input.privateEnc === undefined ? {} : { private_enc: input.privateEnc }),
        status: 'active',
        masjid_visible: masjid['status'] === 'active',
        created_by: adminId,
        created_at: now,
        updated_at: now,
      });
    });
    await writeAudit(ctx, {
      action: 'beneficiary.create',
      masjidId: input.masjidId,
      targetType: 'beneficiaries',
      targetId: idText(id),
      meta: {
        category: fields.category,
        zakat_eligible: fields.zakat_eligible,
        consent_confirmed: true,
        vpa_new: fields.vpa,
        payee_new: fields.payee_name,
      },
      ...audit(input.requestId),
    });
    return { id: idText(id), publicId };
  });
}

/**
 * Replaces a listed person's details (the consent is confirmed again with every save). A new cap re-computes the
 * funded share; a cap at or below what was received fulfils the person. A changed UPI ID or payee name is audited
 * old → new (04 R13).
 *
 * @param input.privateEnc - a new ciphertext, `null` to remove the private phone / note, `undefined` to keep it.
 * @returns the person's status afterwards.
 * @throws StateError MASJID_NOT_FOUND, BENEFICIARY_NOT_FOUND (unknown, or no longer listed), BENEFICIARY_INVALID.
 */
export async function updateBeneficiary(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & {
    readonly id: UUID;
    readonly person: BeneficiaryInput;
    readonly privateEnc?: string | null | undefined;
  },
): Promise<{ status: BeneficiaryStatus }> {
  adminOf(scope, input.masjidId);
  const fields = fieldsOf(input.person);
  checkPrivate(input.privateEnc);
  const now = input.now ?? new Date();
  return withTransaction(handle, scope, async (ctx) => {
    await ownMasjid(ctx, input.masjidId);
    const before = await ownPerson(ctx, input.masjidId, input.id, ['active']);
    const received = numberOf(before, 'received_paise') ?? 0;
    const permille = fundedPermille(received, input.person.capPaise);
    const fulfilled = received >= input.person.capPaise;
    const fieldNames: string[] = [
      ...(
        ['display_name', 'category', 'reason', 'reason_locale', 'vpa', 'payee_name', 'zakat_eligible'] as const
      ).filter((name) => before[name] !== fields[name]),
      ...(numberOf(before, 'cap_paise') === input.person.capPaise ? [] : ['cap_paise']),
      ...(input.privateEnc === undefined ? [] : ['private']),
    ];
    await contentWrite(ctx, input.masjidId, async (content) => {
      const matched = await scoped(content, 'beneficiaries').updateOne(
        { _id: input.id, masjid_id: input.masjidId, status: 'active' },
        {
          $set: {
            ...fields,
            funded_permille: permille,
            ...(typeof input.privateEnc === 'string' ? { private_enc: input.privateEnc } : {}),
            ...(fulfilled ? { status: 'fulfilled', fulfilled_at: now, purge_after: purgeAt(now) } : {}),
            updated_at: now,
          },
          ...(input.privateEnc === null ? { $unset: { private_enc: '' } } : {}),
        },
      );
      if (matched !== 1) throw new StateError('BENEFICIARY_NOT_FOUND');
    });
    const upiChanged = before['vpa'] !== fields.vpa || before['payee_name'] !== fields.payee_name;
    await writeAudit(ctx, {
      action: 'beneficiary.update',
      masjidId: input.masjidId,
      targetType: 'beneficiaries',
      targetId: idText(input.id),
      meta: {
        fields: fieldNames,
        ...(upiChanged
          ? {
              vpa_old: text(before, 'vpa') ?? '',
              vpa_new: fields.vpa,
              payee_old: text(before, 'payee_name') ?? '',
              payee_new: fields.payee_name,
            }
          : {}),
        ...(fulfilled ? { fulfilled: true } : {}),
      },
      ...audit(input.requestId),
    });
    return { status: fulfilled ? 'fulfilled' : 'active' };
  });
}

/**
 * "Update received" (B19): what the person has received so far, as the masjid reports it, with an append-only history
 * row (who, when). Reaching the cap sets `fulfilled` in the same transaction (hidden from the app, the 90-day purge
 * clock starts); a correction below the cap lists a fulfilled person again.
 *
 * @returns the status and funded share (‰) afterwards.
 * @throws StateError MASJID_NOT_FOUND, BENEFICIARY_NOT_FOUND (unknown, closed or deleted), BENEFICIARY_INVALID (not
 *   whole paise in 0 … 10^12), BENEFICIARY_LIMIT_REACHED (a correction would list a 101st active person).
 */
export async function setBeneficiaryReceived(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly id: UUID; readonly receivedPaise: number },
): Promise<{ status: BeneficiaryStatus; fundedPermille: number }> {
  const adminId = adminOf(scope, input.masjidId);
  if (!Number.isSafeInteger(input.receivedPaise) || input.receivedPaise < 0 || input.receivedPaise > MAX_PAISE) {
    throw new StateError('BENEFICIARY_INVALID');
  }
  const now = input.now ?? new Date();
  return withTransaction(handle, scope, async (ctx) => {
    await ownMasjid(ctx, input.masjidId);
    const before = await ownPerson(ctx, input.masjidId, input.id, ['active', 'fulfilled']);
    const cap = numberOf(before, 'cap_paise') ?? 0;
    const permille = fundedPermille(input.receivedPaise, cap);
    const fulfilled = input.receivedPaise >= cap;
    const wasFulfilled = before['status'] === 'fulfilled';
    await contentWrite(ctx, input.masjidId, async (content) => {
      const store = scoped(content, 'beneficiaries');
      if (wasFulfilled && !fulfilled) {
        const active = await store.count({ masjid_id: input.masjidId, status: 'active' });
        if (active >= BENEFICIARIES_ACTIVE_MAX) throw new StateError('BENEFICIARY_LIMIT_REACHED');
      }
      const amounts = {
        received_paise: toInt64(input.receivedPaise),
        received_updated_at: now,
        funded_permille: permille,
        updated_at: now,
      };
      const matched = await store.updateOne(
        { _id: input.id, masjid_id: input.masjidId, status: { $in: ['active', 'fulfilled'] } },
        fulfilled
          ? {
              $set: {
                ...amounts,
                status: 'fulfilled',
                // The clock keeps running from the first time the cap was reached.
                ...(wasFulfilled ? {} : { fulfilled_at: now, purge_after: purgeAt(now) }),
              },
            }
          : { $set: { ...amounts, status: 'active' }, $unset: { fulfilled_at: '', purge_after: '' } },
      );
      if (matched !== 1) throw new StateError('BENEFICIARY_NOT_FOUND');
      await scoped(content, 'beneficiary_amount_history').insertOne({
        _id: newId(),
        beneficiary_id: input.id,
        masjid_id: input.masjidId,
        received_paise: toInt64(input.receivedPaise),
        updated_by: adminId,
        created_at: now,
      });
    });
    await writeAudit(ctx, {
      action: 'beneficiary.received',
      masjidId: input.masjidId,
      targetType: 'beneficiaries',
      targetId: idText(input.id),
      meta: { fulfilled },
      ...audit(input.requestId),
    });
    return { status: fulfilled ? 'fulfilled' : 'active', fundedPermille: permille };
  });
}

/**
 * Takes a person off the list: `closed` (B19 "Close" — help is no longer needed) or `deleted` (entered by mistake, or
 * the person asked to be removed — 05 §1). Final; the person's data is purged 90 days later.
 *
 * @throws StateError MASJID_NOT_FOUND, BENEFICIARY_NOT_FOUND (unknown, or already closed / deleted).
 */
export async function endBeneficiary(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly id: UUID; readonly as: 'closed' | 'deleted' },
): Promise<void> {
  adminOf(scope, input.masjidId);
  const now = input.now ?? new Date();
  await withTransaction(handle, scope, async (ctx) => {
    await ownMasjid(ctx, input.masjidId);
    const before = await ownPerson(ctx, input.masjidId, input.id, ['active', 'fulfilled']);
    await contentWrite(ctx, input.masjidId, async (content) => {
      const matched = await scoped(content, 'beneficiaries').updateOne(
        { _id: input.id, masjid_id: input.masjidId, status: { $in: ['active', 'fulfilled'] } },
        {
          $set: {
            status: input.as,
            closed_at: now,
            // A fulfilled person's clock is already running: closing never extends it.
            ...(before['purge_after'] instanceof Date ? {} : { purge_after: purgeAt(now) }),
            updated_at: now,
          },
        },
      );
      if (matched !== 1) throw new StateError('BENEFICIARY_NOT_FOUND');
    });
    await writeAudit(ctx, {
      action: input.as === 'closed' ? 'beneficiary.close' : 'beneficiary.delete',
      masjidId: input.masjidId,
      targetType: 'beneficiaries',
      targetId: idText(input.id),
      ...audit(input.requestId),
    });
  });
}

/**
 * Returns a person's encrypted private phone / note for decryption by the API, and audits the view (02 §4.1: only the
 * masjid's own admins, only through this function — `private_enc` is hidden from every generic read).
 *
 * @returns the `v1:…` ciphertext, or `null` when nothing private is stored.
 * @throws StateError MASJID_NOT_FOUND (outside the scope — also for the Super Admin), BENEFICIARY_NOT_FOUND.
 */
export async function readBeneficiaryPrivate(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly id: UUID },
): Promise<string | null> {
  adminOf(scope, input.masjidId);
  return withTransaction(handle, scope, async (ctx) => {
    await ownMasjid(ctx, input.masjidId);
    // Raw read of the one hidden field, confined to the caller's own masjid (checked above and in the filter).
    const person = await ctx.db
      .collection<{ _id: UUID; private_enc?: string }>('beneficiaries')
      .findOne({ _id: input.id, masjid_id: input.masjidId }, { session: ctx.session, projection: { private_enc: 1 } });
    if (!person) throw new StateError('BENEFICIARY_NOT_FOUND');
    await writeAudit(ctx, {
      action: 'beneficiary.private_view',
      masjidId: input.masjidId,
      targetType: 'beneficiaries',
      targetId: idText(input.id),
      ...audit(input.requestId),
    });
    return person.private_enc ?? null;
  });
}

/**
 * The `retention` job's part for needy people (02 §6, `mc_system`): people whose `purge_after` has passed are deleted
 * for good, with their amount history. Idempotent; no version bump (they left the public list 90 days earlier).
 *
 * @returns how many people were purged.
 * @throws StateError FORBIDDEN outside the system scope.
 */
export async function purgeBeneficiaries(
  handle: DbHandle,
  scope: Scope,
  input: { readonly now?: Date | undefined } = {},
): Promise<number> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const now = input.now ?? new Date();
  const db = await handle.db();
  const due = await db
    .collection<Doc>('beneficiaries')
    .find({ purge_after: { $lte: now } }, { projection: { _id: 1 }, limit: 1000 })
    .toArray();
  let purged = 0;
  for (const { _id } of due) {
    purged += await withTransaction(handle, scope, async (ctx) => {
      await ctx.db
        .collection<Doc>('beneficiary_amount_history')
        .deleteMany({ beneficiary_id: _id }, { session: ctx.session });
      const result = await ctx.db
        .collection<Doc>('beneficiaries')
        .deleteOne({ _id, purge_after: { $lte: now } }, { session: ctx.session });
      return result.deletedCount;
    });
  }
  return purged;
}
