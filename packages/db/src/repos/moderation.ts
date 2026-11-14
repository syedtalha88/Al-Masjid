// The Super Admin's moderation queue (07 C5, 03 §5 `GET /reports`, PHASE_08 T8.2): reports grouped by what they are
// about — a post or a masjid — urgent first, then by the earliest SLA due time; each post in the shape musallis see
// (`itemOf`, whatever its status now), who posted it, and the masjid's removals in the last 90 days (05 §3 repeat
// violations). Read as the Super Admin through the policy layer.
import { type Document, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { StateError } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { itemOf, libraryIdOf, libraryOf, type PublicItem, type PublicLibraryEntry } from './public.ts';
import { idOf, iso, text, uuidOf } from './read.ts';

/** At most this many reports are grouped into one queue answer (the queue is worked from the top). */
export const QUEUE_REPORTS_MAX = 500;

export type ReportStatusValue = 'open' | 'actioned' | 'dismissed';

export interface QueueReport {
  readonly id: string;
  readonly reason: string;
  readonly details?: string;
  readonly urgent: boolean;
  readonly createdAt: string;
  readonly dueAt: string;
}

export interface QueueTarget {
  readonly targetType: 'item' | 'masjid';
  readonly targetId: string;
  readonly masjid: { readonly id: string; readonly name: string; readonly removals90d: number };
  readonly urgent: boolean;
  /** The earliest SLA due time among its reports. */
  readonly dueAt: string;
  readonly reports: QueueReport[];
  /** Posts only: its status now, the musalli shape, who posted it, and why it was removed. */
  readonly itemStatus?: string;
  readonly item?: PublicItem;
  readonly postedBy?: string;
  readonly removedReason?: string;
}

/**
 * The queue for one report status.
 *
 * @param input.now - "now" for the 90-day repeat-violation window.
 * @returns targets, urgent first, then by the earliest due time.
 * @throws StateError FORBIDDEN unless the Super Admin.
 */
export async function listModerationQueue(
  handle: DbHandle,
  scope: Scope,
  input: { readonly status: ReportStatusValue; readonly now: Date; readonly windowMs: number },
): Promise<QueueTarget[]> {
  if (scope.kind !== 'super') throw new StateError('FORBIDDEN');
  const db = await handle.db();
  const ctx = { scope, db };
  const reports = await scoped(ctx, 'reports').find(
    { status: input.status },
    { sort: { sla_due_at: 1, _id: 1 }, limit: QUEUE_REPORTS_MAX },
  );
  if (reports.length === 0) return [];

  const groups = new Map<string, Document[]>();
  for (const report of reports) {
    const key = `${text(report, 'target_type') ?? ''}:${idOf(report, 'target_id')}`;
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }
  const itemIds = reports.filter((r) => r['target_type'] === 'item').map((r) => uuidOf(r, 'target_id'));
  const items = itemIds.length > 0 ? await scoped(ctx, 'items').find({ _id: { $in: itemIds } }) : [];
  const itemById = new Map(items.map((doc) => [idOf(doc), doc]));
  const library = await libraryFor(ctx, items);
  const masjidIds = [...new Map(reports.map((r) => [idOf(r, 'masjid_id'), uuidOf(r, 'masjid_id')])).values()];
  const masjids = await scoped(ctx, 'masjids').find({ _id: { $in: masjidIds } });
  const nameOf = new Map(masjids.map((doc) => [idOf(doc), text(doc, 'name') ?? '']));
  const since = new Date(input.now.getTime() - input.windowMs);
  const removed = await scoped(ctx, 'items').find({ masjid_id: { $in: masjidIds }, removed_at: { $gte: since } });
  const removals = new Map<string, number>();
  for (const doc of removed) {
    const key = idOf(doc, 'masjid_id');
    removals.set(key, (removals.get(key) ?? 0) + 1);
  }

  const targets = [...groups.values()].map((group): QueueTarget => {
    const [first] = group;
    if (!first) throw new Error('empty report group'); // never: a group starts with its first report
    const masjidId = idOf(first, 'masjid_id');
    const targetType = first['target_type'] === 'masjid' ? 'masjid' : 'item';
    const targetId = idOf(first, 'target_id');
    const rows = group.map((report): QueueReport => ({
      id: idOf(report),
      reason: text(report, 'reason') ?? 'other',
      ...detailsOf(report),
      urgent: report['urgent'] === true,
      createdAt: iso(report, 'created_at') ?? '',
      dueAt: iso(report, 'sla_due_at') ?? '',
    }));
    const doc = targetType === 'item' ? itemById.get(targetId) : undefined;
    const createdBy: unknown = doc?.['created_by'];
    return {
      targetType,
      targetId,
      masjid: { id: masjidId, name: nameOf.get(masjidId) ?? '', removals90d: removals.get(masjidId) ?? 0 },
      urgent: rows.some((row) => row.urgent),
      dueAt: rows.map((row) => row.dueAt).sort()[0] ?? '',
      reports: rows,
      ...(doc
        ? {
            itemStatus: text(doc, 'status') ?? 'published',
            item: itemOf(doc, library),
            ...(createdBy instanceof UUID ? { postedBy: idText(createdBy) } : {}),
            ...removedReasonOf(doc),
          }
        : {}),
    };
  });
  return targets.sort((a, b) => (a.urgent === b.urgent ? a.dueAt.localeCompare(b.dueAt) : a.urgent ? -1 : 1));
}

async function libraryFor(
  ctx: Parameters<typeof scoped>[0],
  items: readonly Document[],
): Promise<Map<string, PublicLibraryEntry>> {
  const ids = [
    ...new Map(
      items.flatMap((doc) => {
        const id = libraryIdOf(doc);
        return id ? [[idText(id), id] as const] : [];
      }),
    ).values(),
  ];
  const library = new Map<string, PublicLibraryEntry>();
  if (ids.length === 0) return library;
  for (const entry of await scoped(ctx, 'content_library').find({ _id: { $in: ids } })) {
    library.set(idOf(entry), libraryOf(entry));
  }
  return library;
}

const detailsOf = (report: Document): { details?: string } => {
  const details = text(report, 'details');
  return details ? { details } : {};
};

const removedReasonOf = (doc: Document): { removedReason?: string } => {
  const reason = text(doc, 'removed_reason');
  return reason ? { removedReason: reason } : {};
};
