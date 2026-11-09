// Donation campaigns (00 §4.3, 02 items.campaign + campaign_amount_history, PHASE_05 T5.3): create (needs the masjid's
// active UPI details — snapshot of their id — and fewer than 3 active campaigns), edit (title, description, cover,
// end date; the target only upward), "Update amount" (an append-only history row each time; notify optional), mark
// completed, and the daily close of ended campaigns. One transaction each, version bump, audited. We never touch money
// (CLAUDE.md §2.2): "received" is what the masjid reports.
import { isCalendarDate } from '@mc/domain/time';
import type { UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import { numberOf } from '../repos/read.ts';
import { MAX_PAISE } from '../schema/dsl.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText, newId, toInt64 } from '../values.ts';
import { enqueueNotification, insertPublishedItem } from './publish.ts';

/** 00 §4.3: at most 3 active campaigns per masjid. */
export const CAMPAIGNS_ACTIVE_MAX = 3;
/** 00 §4.3: a target of at least ₹1,000. */
export const CAMPAIGN_TARGET_MIN_PAISE = 100_000;
export const CAMPAIGN_PURPOSES = ['renovation', 'repair', 'utilities', 'welfare', 'other'] as const;
export type CampaignPurpose = (typeof CAMPAIGN_PURPOSES)[number];

export interface CampaignCover {
  readonly key: string;
  readonly thumbhash: string;
  /** The B8 ownership tick (05 §9). */
  readonly rightsConfirmed: true;
}

export interface CampaignInput {
  readonly title: string;
  readonly description: string;
  readonly purpose: CampaignPurpose;
  readonly targetPaise: number;
  /** "YYYY-MM-DD". */
  readonly startsOn: string;
  readonly endsOn?: string | undefined;
  readonly cover?: CampaignCover | undefined;
}

interface WriteOptions {
  readonly masjidId: UUID;
  readonly requestId?: string | undefined;
  readonly now?: Date | undefined;
}

type Doc = { _id: UUID } & Record<string, unknown>;

const audit = (requestId: string | undefined) => (requestId ? { requestId } : {});
const validPaise = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_PAISE;

function adminOf(scope: Scope, masjidId: UUID): UUID {
  requireOwnMasjid(scope, masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  return scope.adminId;
}

function checkCover(masjidId: UUID, cover: CampaignCover | undefined): void {
  // `rightsConfirmed: true` is required by the type and the API contract; the key must be this masjid's upload.
  if (cover && !cover.key.startsWith(`m/${idText(masjidId)}/`)) {
    throw new StateError('CAMPAIGN_INVALID');
  }
}

function checkInput(masjidId: UUID, input: CampaignInput): void {
  const title = input.title.trim();
  const ok =
    title.length >= 1 &&
    title.length <= 120 &&
    input.description.length <= 1500 &&
    CAMPAIGN_PURPOSES.includes(input.purpose) &&
    validPaise(input.targetPaise) &&
    input.targetPaise >= CAMPAIGN_TARGET_MIN_PAISE &&
    isCalendarDate(input.startsOn) &&
    (input.endsOn === undefined || (isCalendarDate(input.endsOn) && input.endsOn >= input.startsOn));
  if (!ok) throw new StateError('CAMPAIGN_INVALID');
  checkCover(masjidId, input.cover);
}

/** The masjid as a campaign write needs it (`MASJID_NOT_FOUND` outside the scope). */
async function ownMasjid(ctx: TxContext, masjidId: UUID): Promise<Doc> {
  const masjid = await scoped(ctx, 'masjids').findOne({ _id: masjidId });
  if (!masjid) throw new StateError('MASJID_NOT_FOUND');
  return masjid as Doc; // `_id` is the UUID just matched
}

/** The masjid's own published campaign (`CAMPAIGN_NOT_FOUND` otherwise). */
async function ownCampaign(ctx: TxContext, masjidId: UUID, itemId: UUID): Promise<Doc> {
  const item = await scoped(ctx, 'items').findOne({
    _id: itemId,
    masjid_id: masjidId,
    type: 'campaign',
    status: 'published',
  });
  if (!item) throw new StateError('CAMPAIGN_NOT_FOUND');
  return item as Doc; // `_id` is the UUID just matched
}

const campaignOf = (item: Doc): Record<string, unknown> => (item['campaign'] ?? {}) as Record<string, unknown>; // by schema

/**
 * Creates a campaign (B8 create flow → Publish). The masjid's active UPI details are recorded with it (00 §4.3).
 *
 * @param input.notify - "Notify followers" (counts against the daily quota).
 * @returns the item ids and the outbox job (when notifying).
 * @throws StateError MASJID_NOT_FOUND, CAMPAIGN_INVALID (title 1–120, description ≤ 1,500, target ≥ ₹1,000, dates, a
 *   cover of another masjid or without the ownership tick), CAMPAIGN_NO_PAYMENT (no active UPI details),
 *   CAMPAIGN_LIMIT_REACHED (3 active — also when creates race: the version bump serializes them), NOTIFY_QUOTA_EXCEEDED.
 */
export async function createCampaign(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly campaign: CampaignInput; readonly notify: boolean },
): Promise<{ item: { id: string; publicId: string }; notificationJobId: string | null; quotaLeft: number | null }> {
  const adminId = adminOf(scope, input.masjidId);
  checkInput(input.masjidId, input.campaign);
  const now = input.now ?? new Date();
  const c = input.campaign;
  return withTransaction(handle, scope, async (ctx) => {
    const masjid = await ownMasjid(ctx, input.masjidId);
    const profile = await scoped(ctx, 'payment_profiles').findOne({ masjid_id: input.masjidId, status: 'active' });
    if (!profile) throw new StateError('CAMPAIGN_NO_PAYMENT');
    const active = await scoped(ctx, 'items').count({
      masjid_id: input.masjidId,
      type: 'campaign',
      status: 'published',
      'campaign.status': 'active',
    });
    if (active >= CAMPAIGNS_ACTIVE_MAX) throw new StateError('CAMPAIGN_LIMIT_REACHED');
    const version = (numberOf(masjid, 'content_version') ?? 0) + 1;
    const result = await contentWrite(ctx, input.masjidId, async (content) => {
      const item = await insertPublishedItem(
        content,
        {
          type: 'campaign',
          audience: 'everyone',
          isImportant: false,
          notify: input.notify,
          title: c.title.trim(),
          ...(c.description.trim() === '' ? {} : { body: c.description.trim() }),
          ...(c.cover ? { image: c.cover } : {}),
          detail: {
            campaign: {
              purpose: c.purpose,
              target_paise: toInt64(c.targetPaise),
              received_paise: toInt64(0),
              starts_on: c.startsOn,
              ...(c.endsOn === undefined ? {} : { ends_on: c.endsOn }),
              status: 'active',
              payment_profile_id: profile['_id'],
              ...(c.cover ? { cover_key: c.cover.key, cover_thumbhash: c.cover.thumbhash } : {}),
            },
          },
          createdBy: adminId,
          masjidVisible: masjid['status'] === 'active',
          version,
        },
        now,
      );
      if (!input.notify) return { item, jobId: null, quotaLeft: null };
      const limit = numberOf(masjid, 'push_daily_quota') ?? 0;
      const { jobId, used } = await enqueueNotification(
        content,
        { masjidId: input.masjidId, itemId: item.itemId, audience: 'everyone', limit },
        now,
      );
      return { item, jobId, quotaLeft: Math.max(0, limit - used) };
    });
    await writeAudit(ctx, {
      action: 'campaign.create',
      masjidId: input.masjidId,
      targetType: 'items',
      targetId: idText(result.item.itemId),
      meta: { purpose: c.purpose, notify: input.notify },
      ...audit(input.requestId),
    });
    return {
      item: { id: idText(result.item.itemId), publicId: result.item.publicId },
      notificationJobId: result.jobId ? idText(result.jobId) : null,
      quotaLeft: result.quotaLeft,
    };
  });
}

export interface CampaignPatch {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly endsOn?: string | null | undefined;
  /** Only upward (00 §4.3 — donors relied on the old figure). */
  readonly targetPaise?: number | undefined;
  /** `null` removes the cover. */
  readonly cover?: CampaignCover | null | undefined;
}

/**
 * Edits an active campaign: title, description, cover, end date, and the target only upward (audited).
 *
 * @throws StateError MASJID_NOT_FOUND, CAMPAIGN_NOT_FOUND, CAMPAIGN_NOT_ACTIVE, CAMPAIGN_INVALID,
 *   CAMPAIGN_TARGET_LOWER, NOTHING_TO_UPDATE.
 */
export async function updateCampaign(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly itemId: UUID; readonly patch: CampaignPatch },
): Promise<void> {
  adminOf(scope, input.masjidId);
  const { patch } = input;
  const fields = Object.keys(patch).filter((key) => patch[key as keyof CampaignPatch] !== undefined);
  if (fields.length === 0) throw new StateError('NOTHING_TO_UPDATE');
  const now = input.now ?? new Date();
  if (patch.cover) checkCover(input.masjidId, patch.cover);
  await withTransaction(handle, scope, async (ctx) => {
    await ownMasjid(ctx, input.masjidId);
    const item = await ownCampaign(ctx, input.masjidId, input.itemId);
    const current = campaignOf(item);
    if (current['status'] !== 'active') throw new StateError('CAMPAIGN_NOT_ACTIVE');
    const target = numberOf(current, 'target_paise') ?? 0;
    const title = patch.title?.trim();
    const startsOn = String(current['starts_on']);
    const valid =
      (title === undefined || (title.length >= 1 && title.length <= 120)) &&
      (patch.description === undefined || patch.description.length <= 1500) &&
      (patch.endsOn === undefined ||
        patch.endsOn === null ||
        (isCalendarDate(patch.endsOn) && patch.endsOn >= startsOn)) &&
      (patch.targetPaise === undefined || validPaise(patch.targetPaise));
    if (!valid) throw new StateError('CAMPAIGN_INVALID');
    if (patch.targetPaise !== undefined && patch.targetPaise < target) throw new StateError('CAMPAIGN_TARGET_LOWER');
    const set: Record<string, unknown> = { updated_at: now, edited_at: now };
    const unset: Record<string, ''> = {};
    if (title !== undefined) set['title'] = title;
    if (patch.description !== undefined) {
      if (patch.description.trim() === '') unset['body'] = '';
      else set['body'] = patch.description.trim();
    }
    if (patch.targetPaise !== undefined) set['campaign.target_paise'] = toInt64(patch.targetPaise);
    if (patch.endsOn === null) unset['campaign.ends_on'] = '';
    else if (patch.endsOn !== undefined) set['campaign.ends_on'] = patch.endsOn;
    if (patch.cover === null)
      Object.assign(unset, {
        image_key: '',
        image_thumbhash: '',
        'campaign.cover_key': '',
        'campaign.cover_thumbhash': '',
      });
    else if (patch.cover) {
      Object.assign(set, {
        image_key: patch.cover.key,
        image_thumbhash: patch.cover.thumbhash,
        rights_confirmed: true,
        'campaign.cover_key': patch.cover.key,
        'campaign.cover_thumbhash': patch.cover.thumbhash,
      });
    }
    await contentWrite(ctx, input.masjidId, async (content) => {
      const matched = await scoped(content, 'items').updateOne(
        { _id: input.itemId, status: 'published', 'campaign.status': 'active' },
        { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) },
      );
      if (matched !== 1) throw new StateError('CAMPAIGN_NOT_FOUND');
    });
    await writeAudit(ctx, {
      action: 'campaign.update',
      masjidId: input.masjidId,
      targetType: 'items',
      targetId: idText(input.itemId),
      meta: { fields, target_raised: patch.targetPaise !== undefined && patch.targetPaise > target },
      ...audit(input.requestId),
    });
  });
}

/**
 * "Update amount" (B8): the received amount as the masjid reports it, with an append-only history row (who, when).
 * Allowed while the campaign is active or completed (money can still come in after "done"); not once closed.
 *
 * @param input.notify - "Notify followers" (off by default in the UI; counts against the daily quota).
 * @throws StateError MASJID_NOT_FOUND, CAMPAIGN_NOT_FOUND, CAMPAIGN_INVALID (not paise 0 … 10^12), CAMPAIGN_CLOSED,
 *   NOTIFY_QUOTA_EXCEEDED.
 */
export async function setCampaignReceived(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly itemId: UUID; readonly receivedPaise: number; readonly notify: boolean },
): Promise<{ notificationJobId: string | null; quotaLeft: number | null }> {
  const adminId = adminOf(scope, input.masjidId);
  if (!validPaise(input.receivedPaise)) throw new StateError('CAMPAIGN_INVALID');
  const now = input.now ?? new Date();
  return withTransaction(handle, scope, async (ctx) => {
    const masjid = await ownMasjid(ctx, input.masjidId);
    const item = await ownCampaign(ctx, input.masjidId, input.itemId);
    if (campaignOf(item)['status'] === 'closed') throw new StateError('CAMPAIGN_CLOSED');
    const job = await contentWrite(ctx, input.masjidId, async (content) => {
      const matched = await scoped(content, 'items').updateOne(
        { _id: input.itemId, status: 'published', 'campaign.status': { $in: ['active', 'completed'] } },
        {
          $set: {
            'campaign.received_paise': toInt64(input.receivedPaise),
            'campaign.received_updated_at': now,
            'campaign.received_updated_by': adminId,
            updated_at: now,
          },
        },
      );
      if (matched !== 1) throw new StateError('CAMPAIGN_CLOSED');
      await scoped(content, 'campaign_amount_history').insertOne({
        _id: newId(),
        campaign_item_id: input.itemId,
        masjid_id: input.masjidId,
        received_paise: toInt64(input.receivedPaise),
        updated_by: adminId,
        created_at: now,
      });
      if (!input.notify) return null;
      const limit = numberOf(masjid, 'push_daily_quota') ?? 0;
      const job = await enqueueNotification(
        content,
        { masjidId: input.masjidId, itemId: input.itemId, audience: 'everyone', limit },
        now,
      );
      return { jobId: job.jobId, quotaLeft: Math.max(0, limit - job.used) };
    });
    await writeAudit(ctx, {
      action: 'campaign.received',
      masjidId: input.masjidId,
      targetType: 'items',
      targetId: idText(input.itemId),
      meta: { notify: input.notify },
      ...audit(input.requestId),
    });
    return { notificationJobId: job ? idText(job.jobId) : null, quotaLeft: job?.quotaLeft ?? null };
  });
}

/**
 * "Mark completed" (B8): active → completed. Followers still see it (Donate stays — DECISIONS #148).
 *
 * @throws StateError MASJID_NOT_FOUND, CAMPAIGN_NOT_FOUND, CAMPAIGN_NOT_ACTIVE.
 */
export async function completeCampaign(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly itemId: UUID },
): Promise<void> {
  adminOf(scope, input.masjidId);
  const now = input.now ?? new Date();
  await withTransaction(handle, scope, async (ctx) => {
    await ownMasjid(ctx, input.masjidId);
    const item = await ownCampaign(ctx, input.masjidId, input.itemId);
    if (campaignOf(item)['status'] !== 'active') throw new StateError('CAMPAIGN_NOT_ACTIVE');
    await contentWrite(ctx, input.masjidId, async (content) => {
      const matched = await scoped(content, 'items').updateOne(
        { _id: input.itemId, status: 'published', 'campaign.status': 'active' },
        { $set: { 'campaign.status': 'completed', updated_at: now } },
      );
      if (matched !== 1) throw new StateError('CAMPAIGN_NOT_ACTIVE');
    });
    await writeAudit(ctx, {
      action: 'campaign.complete',
      masjidId: input.masjidId,
      targetType: 'items',
      targetId: idText(input.itemId),
      ...audit(input.requestId),
    });
  });
}

/**
 * The `campaign-close` job (daily 00:10 IST, `mc_system`): campaigns whose end date has passed (`ends_on < today`) →
 * `closed`, one transaction per masjid (version bump). Idempotent.
 *
 * @param input.today - "YYYY-MM-DD" in IST.
 * @returns how many campaigns were closed.
 * @throws StateError FORBIDDEN outside the system scope.
 */
export async function closeEndedCampaigns(
  handle: DbHandle,
  scope: Scope,
  input: { readonly today: string; readonly now?: Date | undefined },
): Promise<number> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  if (!isCalendarDate(input.today)) throw new RangeError('closeEndedCampaigns(): today must be YYYY-MM-DD');
  const now = input.now ?? new Date();
  const ended = {
    type: 'campaign',
    status: 'published',
    'campaign.status': { $in: ['active', 'completed'] },
    'campaign.ends_on': { $lt: input.today },
  };
  const db = await handle.db();
  const masjids = await db.collection<Doc>('items').distinct('masjid_id', ended);
  let closed = 0;
  for (const masjidId of masjids as UUID[]) {
    // distinct over a UUID field
    closed += await withTransaction(handle, scope, async (ctx) => {
      let count = 0;
      await contentWrite(ctx, masjidId, async (content) => {
        count = await scoped(content, 'items').updateMany(
          { ...ended, masjid_id: masjidId },
          { $set: { 'campaign.status': 'closed', updated_at: now } },
        );
      });
      return count;
    });
  }
  return closed;
}
