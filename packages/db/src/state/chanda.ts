// Weekly chanda (00 §4.3, 02 chanda_weeks + items.chanda, PHASE_05 T5.5, DECISIONS #152): the admin enters the total
// collected for a week (the masjid's week starts on Friday by default — or the day it chose) with an optional note; one
// `chanda_update` feed item per week carries the week's figures; "Show chanda to followers" (`setShowChanda`, default
// off) mirrors its visibility onto every week and every chanda item, so hidden chanda is never public. One transaction
// each, version bump, audited without amounts. We never touch money (CLAUDE.md §2.2): it is what the masjid reports.
import { chandaWeekOf, isChandaWeekStart } from '@mc/domain/chanda';
import { calendarDateInZone } from '@mc/domain/time';
import { mentionsPaymentAddress } from '@mc/domain/upi';
import type { UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { type ContentContext, contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import { numberOf, text } from '../repos/read.ts';
import { MAX_PAISE } from '../schema/dsl.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText, newId, toInt64 } from '../values.ts';
import { enqueueNotification, insertPublishedItem } from './publish.ts';

/** 02 chanda_weeks.note. */
export const CHANDA_NOTE_MAX = 200;
/** 02 masjids.chanda_week_start default (Friday). */
export const CHANDA_WEEK_START_DEFAULT = 5;

type Doc = { _id: UUID } & Record<string, unknown>;

const audit = (requestId: string | undefined) => (requestId ? { requestId } : {});

function adminOf(scope: Scope, masjidId: UUID): UUID {
  requireOwnMasjid(scope, masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  return scope.adminId;
}

async function ownMasjid(ctx: TxContext, masjidId: UUID): Promise<Doc> {
  const masjid = await scoped(ctx, 'masjids').findOne({ _id: masjidId });
  if (!masjid) throw new StateError('MASJID_NOT_FOUND');
  return masjid as Doc; // `_id` is the UUID just matched
}

/**
 * 02 §5 chanda visibility mirror: `visible` on every week of the masjid and on every chanda feed item — a data-layer
 * effect in the caller's transaction (the admin policy cells cannot write either field).
 */
async function mirrorChandaVisibility(ctx: TxContext, masjidId: UUID, visible: boolean, now: Date): Promise<void> {
  const session = { session: ctx.session };
  await ctx.db
    .collection<{ masjid_id: UUID }>('chanda_weeks')
    .updateMany({ masjid_id: masjidId }, { $set: { visible, updated_at: now } }, session);
  await ctx.db
    .collection<{ masjid_id: UUID }>('items')
    .updateMany({ masjid_id: masjidId, type: 'chanda_update' }, { $set: { 'chanda.visible': visible } }, session);
}

export interface ChandaWeekInput {
  readonly masjidId: UUID;
  /** "YYYY-MM-DD" — must fall on the masjid's week-start day, and not in a future week. */
  readonly weekStart: string;
  readonly amountPaise: number;
  /** Empty or absent removes the note. */
  readonly note?: string | undefined;
  /** "Notify followers" (off by default — 00 §4.3); only while the masjid shows its chanda. */
  readonly notify: boolean;
  readonly requestId?: string | undefined;
  readonly now?: Date | undefined;
}

/**
 * Saves the total of one week (B9 Save): creates the week and its `chanda_update` feed item the first time, updates
 * both afterwards (the item keeps its date; `edited_at` is set).
 *
 * @returns the week's id, its feed item and the outbox job (when notifying); `created` = the week was new.
 * @throws StateError MASJID_NOT_FOUND, CHANDA_INVALID (not a week start of this masjid, a future week, an amount that is
 *   not whole paise in 0 … ₹10^10, a note over 200 characters), CHANDA_HIDDEN (notify while chanda is not shown),
 *   NOTIFY_QUOTA_EXCEEDED.
 */
export async function setChandaWeek(
  handle: DbHandle,
  scope: Scope,
  input: ChandaWeekInput,
): Promise<{
  weekId: string;
  item: { id: string; publicId: string };
  created: boolean;
  notificationJobId: string | null;
  quotaLeft: number | null;
}> {
  const adminId = adminOf(scope, input.masjidId);
  const note = (input.note ?? '').trim();
  if (
    !Number.isSafeInteger(input.amountPaise) ||
    input.amountPaise < 0 ||
    input.amountPaise > MAX_PAISE ||
    note.length > CHANDA_NOTE_MAX
  ) {
    throw new StateError('CHANDA_INVALID');
  }
  if (mentionsPaymentAddress(note)) throw new StateError('PAYMENT_DETAILS_IN_TEXT'); // 04 R1, DECISIONS #160
  const now = input.now ?? new Date();
  return withTransaction(handle, scope, async (ctx) => {
    const masjid = await ownMasjid(ctx, input.masjidId);
    const weekStartDay = numberOf(masjid, 'chanda_week_start') ?? CHANDA_WEEK_START_DEFAULT;
    if (
      !isChandaWeekStart(input.weekStart, weekStartDay) ||
      input.weekStart > chandaWeekOf(calendarDateInZone(now), weekStartDay)
    ) {
      throw new StateError('CHANDA_INVALID');
    }
    const show = masjid['show_chanda'] === true;
    if (input.notify && !show) throw new StateError('CHANDA_HIDDEN');
    const version = (numberOf(masjid, 'content_version') ?? 0) + 1;
    const result = await contentWrite(ctx, input.masjidId, async (content) => {
      const weeks = scoped(content, 'chanda_weeks');
      const existing = await weeks.findOne({ masjid_id: input.masjidId, week_start: input.weekStart });
      const amount = toInt64(input.amountPaise);
      let weekId: UUID;
      let item: { itemId: UUID; publicId: string };
      const created = existing === null;
      if (existing) {
        weekId = existing['_id'] as UUID; // the document just read
        await weeks.updateOne(
          { _id: weekId },
          note === ''
            ? { $set: { amount_paise: amount }, $unset: { note: '' } }
            : { $set: { amount_paise: amount, note } },
        );
        const itemId: unknown = existing['item_id'];
        const linked = itemId ? await scoped(content, 'items').findOne({ _id: itemId, status: 'published' }) : null;
        if (linked) {
          await scoped(content, 'items').updateOne(
            { _id: linked['_id'] },
            { $set: { 'chanda.amount_paise': amount, edited_at: now } },
          );
          item = { itemId: linked['_id'] as UUID, publicId: text(linked, 'public_id') ?? '' }; // the document just read
        } else {
          item = await publishWeekItem(content, input, weekId, { adminId, show, version, masjid, now });
          await weeks.updateOne({ _id: weekId }, { $set: { item_id: item.itemId } });
        }
      } else {
        weekId = newId();
        item = await publishWeekItem(content, input, weekId, { adminId, show, version, masjid, now });
        await weeks.insertOne({
          _id: weekId,
          masjid_id: input.masjidId,
          week_start: input.weekStart,
          amount_paise: amount,
          ...(note === '' ? {} : { note }),
          item_id: item.itemId,
          visible: show,
          masjid_visible: masjid['status'] === 'active',
          created_by: adminId,
          created_at: now,
          updated_at: now,
        });
      }
      if (!input.notify) return { weekId, item, created, jobId: null, quotaLeft: null };
      const limit = numberOf(masjid, 'push_daily_quota') ?? 0;
      const { jobId, used } = await enqueueNotification(
        content,
        { masjidId: input.masjidId, itemId: item.itemId, audience: 'everyone', limit },
        now,
      );
      return { weekId, item, created, jobId, quotaLeft: Math.max(0, limit - used) };
    });
    await writeAudit(ctx, {
      action: 'chanda.save',
      masjidId: input.masjidId,
      targetType: 'chanda_weeks',
      targetId: idText(result.weekId),
      meta: { week_start: input.weekStart, notify: input.notify },
      ...audit(input.requestId),
    });
    return {
      weekId: idText(result.weekId),
      item: { id: idText(result.item.itemId), publicId: result.item.publicId },
      created: result.created,
      notificationJobId: result.jobId ? idText(result.jobId) : null,
      quotaLeft: result.quotaLeft,
    };
  });
}

/** The week's `chanda_update` feed item (everyone; its figures copied for the public feed; visibility = the masjid's). */
async function publishWeekItem(
  content: ContentContext,
  input: ChandaWeekInput,
  weekId: UUID,
  context: { adminId: UUID; show: boolean; version: number; masjid: Doc; now: Date },
): Promise<{ itemId: UUID; publicId: string }> {
  return insertPublishedItem(
    content,
    {
      type: 'chanda_update',
      audience: 'everyone',
      isImportant: false,
      notify: input.notify,
      detail: {
        chanda: {
          chanda_week_id: weekId,
          week_start: input.weekStart,
          amount_paise: toInt64(input.amountPaise),
          visible: context.show,
        },
      },
      createdBy: context.adminId,
      masjidVisible: context.masjid['status'] === 'active',
      version: context.version,
    },
    context.now,
  );
}

export interface ChandaSettingsInput {
  readonly masjidId: UUID;
  /** "Show chanda to followers" (02 masjids.show_chanda). */
  readonly show?: boolean | undefined;
  /** 1 = Monday … 7 = Sunday (02 masjids.chanda_week_start). Weeks already saved keep their dates. */
  readonly weekStart?: number | undefined;
  readonly requestId?: string | undefined;
  readonly now?: Date | undefined;
}

/**
 * B9 settings: show / hide the masjid's chanda (mirrored onto every week and chanda item in the same transaction — 02 §5)
 * and the day its week starts.
 *
 * @throws StateError MASJID_NOT_FOUND, CHANDA_INVALID (a week start outside 1–7), NOTHING_TO_UPDATE.
 */
export async function setChandaSettings(handle: DbHandle, scope: Scope, input: ChandaSettingsInput): Promise<void> {
  adminOf(scope, input.masjidId);
  if (
    input.weekStart !== undefined &&
    (!Number.isInteger(input.weekStart) || input.weekStart < 1 || input.weekStart > 7)
  ) {
    throw new StateError('CHANDA_INVALID');
  }
  if (input.show === undefined && input.weekStart === undefined) throw new StateError('NOTHING_TO_UPDATE');
  const now = input.now ?? new Date();
  await withTransaction(handle, scope, async (ctx) => {
    const masjid = await ownMasjid(ctx, input.masjidId);
    const set: Record<string, unknown> = {};
    if (input.show !== undefined && (masjid['show_chanda'] === true) !== input.show) set['show_chanda'] = input.show;
    if (input.weekStart !== undefined && numberOf(masjid, 'chanda_week_start') !== input.weekStart) {
      set['chanda_week_start'] = input.weekStart;
    }
    if (Object.keys(set).length === 0) return; // already so: nothing to bump
    await contentWrite(ctx, input.masjidId, async (content) => {
      await scoped(content, 'masjids').updateOne({ _id: input.masjidId }, { $set: set });
      if ('show_chanda' in set) await mirrorChandaVisibility(ctx, input.masjidId, input.show === true, now);
    });
    await writeAudit(ctx, {
      action: 'chanda.settings',
      masjidId: input.masjidId,
      targetType: 'masjids',
      targetId: idText(input.masjidId),
      meta: {
        ...('show_chanda' in set ? { show: input.show } : {}),
        ...('chanda_week_start' in set ? { week_start: input.weekStart } : {}),
      },
      ...audit(input.requestId),
    });
  });
}

/**
 * 02 §3 `setShowChanda` (admin): "Show chanda to followers" on or off, with the visibility mirror.
 *
 * @throws StateError as {@link setChandaSettings}.
 */
export const setShowChanda = (
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
  show: boolean,
  options: { readonly requestId?: string; readonly now?: Date } = {},
): Promise<void> => setChandaSettings(handle, scope, { masjidId, show, ...options });
