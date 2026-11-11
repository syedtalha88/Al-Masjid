// Push fan-out state (01 §5.3, 02 notification_jobs / device_follows / devices, PHASE_04 T4.4): what the worker's
// `push-fanout`, `push-send-batch` and `outbox-sweeper` processors read and write. Every function takes the caller's
// scope — the worker passes `systemScope()` (the policy gives the other scopes no cell here) — and every write is a
// conditional update, so a retried or duplicated job never moves a counter twice for the same step.
import type { Document, UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { StateError } from '../effects.ts';
import { arrayOf, need, numberOf, objectOf, oneOf, text } from '../repos/read.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText, isId } from '../values.ts';

export type PushLocale = 'en' | 'hi' | 'ur' | 'te';
const LOCALES: readonly PushLocale[] = ['en', 'hi', 'ur', 'te'];
const JOB_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

function requireSystem(scope: Scope): void {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
}

/** A `notification_jobs` document as the worker uses it. */
export interface FanoutJob {
  readonly id: UUID;
  readonly itemId: UUID;
  readonly masjidId: UUID;
  readonly status: (typeof JOB_STATUSES)[number];
  readonly audienceTargets: readonly ('brothers' | 'sisters')[];
  /** The next page to read (0 before the first). */
  readonly fanoutPage: number;
  /** The last device id read, `undefined` before the first page. */
  readonly fanoutCursor: UUID | undefined;
  readonly fanoutDone: boolean;
  readonly pendingBatches: number;
  readonly createdAt: Date;
}

function jobOf(doc: Document): FanoutJob {
  const cursor: unknown = doc['fanout_cursor'];
  const targets = (doc['audience_targets'] as unknown[]).filter(
    // validated: brothers | sisters, ≤ 2
    (value): value is 'brothers' | 'sisters' => value === 'brothers' || value === 'sisters',
  );
  return {
    id: doc['_id'] as UUID, // validated collection: UUID ids
    itemId: doc['item_id'] as UUID,
    masjidId: doc['masjid_id'] as UUID,
    status: oneOf(doc, 'status', JOB_STATUSES),
    audienceTargets: targets,
    fanoutPage: numberOf(doc, 'fanout_page') ?? 0,
    fanoutCursor: isId(cursor) ? cursor : undefined,
    fanoutDone: doc['fanout_done'] === true,
    pendingBatches: numberOf(doc, 'pending_batches') ?? 0,
    createdAt: doc['created_at'] as Date,
  };
}

/**
 * The outbox job `jobId`.
 *
 * @returns `null` when it does not exist.
 * @throws StateError FORBIDDEN (not the system scope).
 */
export async function getFanoutJob(handle: DbHandle, scope: Scope, jobId: UUID): Promise<FanoutJob | null> {
  requireSystem(scope);
  const doc = await scoped({ scope, db: await handle.db() }, 'notification_jobs').findOne({ _id: jobId });
  return doc ? jobOf(doc) : null;
}

/**
 * Moves a pending job to `running` (first fan-out run) or keeps a running one (a retry) and returns it; a completed
 * or failed job is returned unchanged — the caller stops.
 *
 * @returns `null` when the job does not exist.
 */
export async function beginFanout(handle: DbHandle, scope: Scope, jobId: UUID, now: Date): Promise<FanoutJob | null> {
  requireSystem(scope);
  const jobs = scoped({ scope, db: await handle.db() }, 'notification_jobs');
  await jobs.updateOne(
    { _id: jobId, status: 'pending' },
    { $set: { status: 'running', started_at: now, last_progress_at: now, fanout_page: 0 } },
  );
  const doc = await jobs.findOne({ _id: jobId });
  return doc ? jobOf(doc) : null;
}

/** One follower a notification goes to: the device and the language its text is written in. */
export interface FanoutRecipient {
  readonly deviceId: UUID;
  readonly locale: PushLocale;
}

/**
 * One page of recipients (01 §5.3 step 2): follows of `masjidId` that are not muted, have push on and whose Brother /
 * Sister choice is targeted, after `after` in device-id order — keyset pagination on the fan-out index
 * `{masjid_id, muted, push_active, audience_pref, device_id}`.
 */
export async function fanoutPage(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly masjidId: UUID;
    readonly targets: readonly ('brothers' | 'sisters')[];
    readonly after: UUID | undefined;
    readonly limit: number;
  },
): Promise<FanoutRecipient[]> {
  requireSystem(scope);
  const docs = await scoped({ scope, db: await handle.db() }, 'device_follows').find(
    {
      masjid_id: input.masjidId,
      muted: false,
      push_active: true,
      audience_pref: { $in: [...input.targets] },
      ...(input.after === undefined ? {} : { device_id: { $gt: input.after } }),
    },
    { sort: { device_id: 1 }, limit: input.limit },
  );
  return docs.map((doc) => ({ deviceId: doc['device_id'] as UUID, locale: oneOf(doc, 'locale', LOCALES) }));
}

/**
 * Records that page `page` was handed to `batches` send batches reaching `targeted` devices. Conditional on the job
 * still being at that page — a retried fan-out that already recorded it changes nothing.
 *
 * @param cursor - the last device id of the page (`undefined` for an empty last page).
 * @param done - this was the last page.
 * @returns whether this call recorded the page.
 */
export async function recordFanoutPage(
  handle: DbHandle,
  scope: Scope,
  jobId: UUID,
  input: {
    readonly page: number;
    readonly cursor: UUID | undefined;
    readonly batches: number;
    readonly targeted: number;
    readonly done: boolean;
  },
  now: Date,
): Promise<boolean> {
  requireSystem(scope);
  const matched = await scoped({ scope, db: await handle.db() }, 'notification_jobs').updateOne(
    { _id: jobId, status: 'running', fanout_page: input.page },
    {
      $set: {
        fanout_page: input.page + 1,
        last_progress_at: now,
        ...(input.cursor === undefined ? {} : { fanout_cursor: input.cursor }),
        ...(input.done ? { fanout_done: true } : {}),
      },
      $inc: { pending_batches: input.batches, targeted: input.targeted },
    },
  );
  return matched === 1;
}

/** A device's stored subscription (02 devices `push_*`). */
export interface PushSubscriptionRow {
  readonly deviceId: UUID;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/**
 * The active subscriptions of a send batch's devices (01 §5.3 step 3) — only those that, right now, still follow the
 * job's masjid unmuted with push on and a Brother / Sister choice the job targets: a batch delayed by a pause or
 * retries never reaches someone who unfollowed or muted meanwhile, and a forged batch cannot reach other devices
 * (security review L5, DECISIONS #142). Devices without a subscription are left out.
 */
export async function getPushSubscriptions(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly deviceIds: readonly UUID[];
    readonly masjidId: UUID;
    readonly targets: readonly ('brothers' | 'sisters')[];
  },
): Promise<PushSubscriptionRow[]> {
  requireSystem(scope);
  if (input.deviceIds.length === 0 || input.targets.length === 0) return [];
  const db = await handle.db();
  const follows = await scoped({ scope, db }, 'device_follows').find({
    masjid_id: input.masjidId,
    device_id: { $in: [...input.deviceIds] },
    muted: false,
    push_active: true,
    audience_pref: { $in: [...input.targets] },
  });
  if (follows.length === 0) return [];
  const docs = await scoped({ scope, db }, 'devices').find({
    _id: { $in: follows.map((follow) => follow['device_id'] as UUID) },
    push_status: 'active',
  });
  return docs.flatMap((doc) => {
    const endpoint = text(doc, 'push_endpoint');
    const p256dh = text(doc, 'push_p256dh');
    const auth = text(doc, 'push_auth');
    return endpoint && p256dh && auth ? [{ deviceId: doc['_id'] as UUID, endpoint, p256dh, auth }] : [];
  });
}

/**
 * Marks subscriptions the push service called gone (404 / 410) as dead and turns push off on their follows, in one
 * transaction (02 §5 device mirror). Only where the device still has that endpoint — a device that re-subscribed
 * meanwhile keeps its new subscription. With `jobId`, the job's `pruned` counter grows by the devices this call
 * actually marked (a re-run marks none again, so it never counts twice).
 *
 * @returns how many devices were marked.
 */
export async function markSubscriptionsDead(
  handle: DbHandle,
  scope: Scope,
  gone: readonly { readonly deviceId: UUID; readonly endpoint: string }[],
  now: Date,
  jobId?: UUID,
): Promise<number> {
  requireSystem(scope);
  if (gone.length === 0) return 0;
  return withTransaction(handle, scope, async (ctx) => {
    let marked = 0;
    for (const entry of gone) {
      const matched = await scoped(ctx, 'devices').updateOne(
        { _id: entry.deviceId, push_endpoint: entry.endpoint, push_status: 'active' },
        { $set: { push_status: 'dead', push_updated_at: now } },
      );
      if (matched !== 1) continue;
      marked += 1;
      await scoped(ctx, 'device_follows').updateMany({ device_id: entry.deviceId }, { $set: { push_active: false } });
    }
    if (jobId !== undefined && marked > 0)
      await scoped(ctx, 'notification_jobs').updateOne({ _id: jobId }, { $inc: { pruned: marked } });
    return marked;
  });
}

/**
 * A send batch's result, once per batch (the caller guarantees "once" with its Redis ledger): adds the counters,
 * counts the batch off and completes the job when it was the last one of a finished fan-out.
 */
export async function recordBatchResult(
  handle: DbHandle,
  scope: Scope,
  jobId: UUID,
  result: { readonly sent: number; readonly failed: number; readonly pruned: number },
  now: Date,
): Promise<void> {
  requireSystem(scope);
  await scoped({ scope, db: await handle.db() }, 'notification_jobs').updateOne(
    { _id: jobId },
    {
      $inc: { sent: result.sent, failed: result.failed, pruned: result.pruned, pending_batches: -1 },
      $set: { last_progress_at: now },
    },
  );
  await completeIfDone(handle, scope, jobId, now);
}

/**
 * Completes a running job whose fan-out is done and whose batches are all counted off (01 §5.3 step 4).
 *
 * @returns whether this call completed it.
 */
export async function completeIfDone(handle: DbHandle, scope: Scope, jobId: UUID, now: Date): Promise<boolean> {
  requireSystem(scope);
  const matched = await scoped({ scope, db: await handle.db() }, 'notification_jobs').updateOne(
    { _id: jobId, status: 'running', fanout_done: true, pending_batches: { $lte: 0 } },
    { $set: { status: 'completed', completed_at: now, last_progress_at: now } },
  );
  return matched === 1;
}

/**
 * Ends a job that cannot go on (its item is gone, the stuck-job detector) — pending or running only.
 *
 * @param reason - a short machine reason (≤ 500), never content.
 */
export async function failJob(
  handle: DbHandle,
  scope: Scope,
  jobId: UUID,
  reason: string,
  now: Date,
): Promise<boolean> {
  requireSystem(scope);
  const matched = await scoped({ scope, db: await handle.db() }, 'notification_jobs').updateOne(
    { _id: jobId, status: { $in: ['pending', 'running'] } },
    { $set: { status: 'failed', completed_at: now, last_error: reason.slice(0, 500) } },
  );
  return matched === 1;
}

/**
 * Pending jobs created before `before` (the outbox sweeper re-enqueues them — 01 §5.3 step 7), oldest first.
 */
export async function listStalledPendingJobs(
  handle: DbHandle,
  scope: Scope,
  before: Date,
  limit: number,
): Promise<UUID[]> {
  requireSystem(scope);
  const docs = await scoped({ scope, db: await handle.db() }, 'notification_jobs').find(
    { status: 'pending', created_at: { $lt: before } },
    { sort: { created_at: 1 }, limit },
  );
  return docs.map((doc) => doc['_id'] as UUID);
}

/** A running job without recent progress — a candidate for the stuck-job detector. */
export interface StuckCandidate {
  readonly jobId: UUID;
  readonly masjidId: UUID;
  /** Fan-out pages recorded so far: its send batches are `<job>.<page>.<locale>` for page < this. */
  readonly fanoutPages: number;
}

/**
 * Running jobs without progress since `noProgressSince` (the stuck-job detector — 01 §5.3 step 7), oldest first. The
 * caller fails only those with no work left in the queues ({@link failJob}); one still waiting there (paused, or the
 * worker was down) gets {@link touchJobProgress} instead (DECISIONS #142).
 */
export async function listStuckCandidates(
  handle: DbHandle,
  scope: Scope,
  noProgressSince: Date,
  limit = 100,
): Promise<StuckCandidate[]> {
  requireSystem(scope);
  const docs = await scoped({ scope, db: await handle.db() }, 'notification_jobs').find(
    { status: 'running', last_progress_at: { $lt: noProgressSince } },
    { sort: { last_progress_at: 1 }, limit },
  );
  return docs.map((doc) => ({
    jobId: doc['_id'] as UUID,
    masjidId: doc['masjid_id'] as UUID,
    fanoutPages: numberOf(doc, 'fanout_page') ?? 0,
  }));
}

/**
 * Notes that a running job is still on its way (its work waits in the queues), so the detector looks again only after
 * another quiet period.
 *
 * @returns whether the job was running.
 */
export async function touchJobProgress(handle: DbHandle, scope: Scope, jobId: UUID, now: Date): Promise<boolean> {
  requireSystem(scope);
  const matched = await scoped({ scope, db: await handle.db() }, 'notification_jobs').updateOne(
    { _id: jobId, status: 'running' },
    { $set: { last_progress_at: now } },
  );
  return matched === 1;
}

/** `app_settings.push_paused` — the Super Admin's kill switch (T4.7). */
export async function isPushPaused(handle: DbHandle, scope: Scope): Promise<boolean> {
  requireSystem(scope);
  const settings = await scoped({ scope, db: await handle.db() }, 'app_settings').findOne({ _id: 'global' });
  return settings?.['push_paused'] === true;
}

type I18nText = Readonly<Partial<Record<PushLocale, string>>>;

/** What a notification says, before it is put into each locale's words (the worker builds the text). */
export interface PushContent {
  readonly publicId: string;
  readonly masjidId: string;
  /** The item can still be shown (`published` on a visible masjid); otherwise nothing is sent. */
  readonly published: boolean;
  readonly type: string;
  readonly isImportant: boolean;
  /** Announcement category, daily kind or dua category. */
  readonly category: string | undefined;
  readonly title: string | undefined;
  readonly body: string | undefined;
  readonly templateKey: string | undefined;
  readonly templateParams: Readonly<Record<string, unknown>> | undefined;
  readonly hasVoice: boolean;
  /** The masjid's content version now (the app refreshes that masjid when it is newer than its cache). */
  readonly contentVersion: number;
  readonly masjidName: string;
  readonly masjidNameI18n: I18nText;
  /** The notice template of a template item (any status — a retired one still renders, DECISIONS #111). */
  readonly template:
    | {
        readonly title: I18nText;
        readonly body: I18nText;
        readonly params: readonly { readonly name: string; readonly type: string }[];
      }
    | undefined;
  /** A donation campaign's goal and what the masjid reports as received (paise) — the push says "… raised of …". */
  readonly campaign: { readonly targetPaise: number; readonly receivedPaise: number } | undefined;
  /** A weekly chanda entry: the week ("YYYY-MM-DD") and its total (paise). */
  readonly chanda: { readonly weekStart: string; readonly amountPaise: number } | undefined;
}

const campaignOf = (item: Document): PushContent['campaign'] => {
  const campaign = objectOf(item, 'campaign');
  const targetPaise = campaign ? numberOf(campaign, 'target_paise') : undefined;
  if (!campaign || targetPaise === undefined) return undefined;
  return { targetPaise, receivedPaise: numberOf(campaign, 'received_paise') ?? 0 };
};

const chandaOf = (item: Document): PushContent['chanda'] => {
  const chanda = objectOf(item, 'chanda');
  const weekStart = chanda ? text(chanda, 'week_start') : undefined;
  const amountPaise = chanda ? numberOf(chanda, 'amount_paise') : undefined;
  return weekStart === undefined || amountPaise === undefined ? undefined : { weekStart, amountPaise };
};

const i18nOf = (doc: Document | undefined): I18nText => {
  const out: Partial<Record<PushLocale, string>> = {};
  if (!doc) return out;
  for (const locale of LOCALES) {
    const value = text(doc, locale);
    if (value !== undefined && value.trim() !== '') out[locale] = value;
  }
  return out;
};

/**
 * The content of item `itemId` for its notification, with its masjid's names and template. A private dua name is
 * never part of it (only the admin's message is).
 *
 * @returns `null` when the item or its masjid does not exist.
 */
export async function getPushContent(handle: DbHandle, scope: Scope, itemId: UUID): Promise<PushContent | null> {
  requireSystem(scope);
  const db = await handle.db();
  const item = await scoped({ scope, db }, 'items').findOne({ _id: itemId });
  if (!item) return null;
  const masjid = await scoped({ scope, db }, 'masjids').findOne({ _id: item['masjid_id'] as UUID });
  if (!masjid) return null;
  const templateKey = text(item, 'template_key');
  const template = templateKey ? await scoped({ scope, db }, 'notice_templates').findOne({ _id: templateKey }) : null;
  const detail = objectOf(item, 'announcement') ?? objectOf(item, 'daily') ?? objectOf(item, 'dua');
  const category = detail ? (text(detail, 'category') ?? text(detail, 'kind')) : undefined;
  const params = objectOf(item, 'template_params');
  return {
    publicId: need(item, 'public_id'),
    masjidId: idText(item['masjid_id'] as UUID),
    published: item['status'] === 'published' && item['masjid_visible'] === true,
    type: need(item, 'type'),
    isImportant: item['is_important'] === true,
    category,
    title: text(item, 'title'),
    body: text(item, 'body'),
    templateKey,
    templateParams: params,
    hasVoice: objectOf(item, 'voice') !== undefined,
    contentVersion: numberOf(masjid, 'content_version') ?? 1,
    masjidName: need(masjid, 'name'),
    masjidNameI18n: i18nOf(objectOf(masjid, 'name_i18n')),
    template: template
      ? {
          title: i18nOf(objectOf(template, 'title')),
          body: i18nOf(objectOf(template, 'body')),
          params: arrayOf(template, 'params').map((param) => ({
            name: need(param, 'name'),
            type: need(param, 'type'),
          })),
        }
      : undefined,
    campaign: campaignOf(item),
    chanda: chandaOf(item),
  };
}
