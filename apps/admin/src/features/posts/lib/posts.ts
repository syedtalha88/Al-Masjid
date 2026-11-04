// B12 My Posts (07 B12, PHASE_03 T3.9): which posts can be edited, a post turned back into the draft of the flow that
// created it (B5 notice, B6 hadith/ayah, B7 dua request — marked `editing`, so the last step saves instead of
// publishing), and the PATCH body of an edited draft (the publish body without "Notify followers").
import { calendarDateInZone, wallClockInZone } from '@mc/domain/time';
import type { AdminItem, AdminLibraryEntry, ItemEditBody, NoticeTemplate } from '@mc/shared/contracts';
import type { LibraryEntry } from '@mc/shared/contracts/public';

import type { DailyDraft } from '../../daily/lib/daily.ts';
import { dailyPublishBody } from '../../daily/lib/daily.ts';
import { type DuaDraft, duaPublishBody } from '../../dua/lib/dua.ts';
import { type NoticeDraft, publishBody } from '../../notice/lib/notice.ts';

/** B12's type chips (`all` = no filter). */
export const POST_TYPES = ['all', 'announcement', 'daily_content', 'dua_request', 'timing_update'] as const;
export type PostType = (typeof POST_TYPES)[number];

/** Still inside its 24 h edit window and of a type a creation flow can reopen (with its library entry). */
export function canEdit(row: AdminItem, now: Date): boolean {
  if (row.editableUntil === undefined || new Date(row.editableUntil).getTime() <= now.getTime()) return false;
  const { item } = row;
  if (item.type === 'announcement') return true;
  if (item.type === 'daily_content') return item.daily?.library !== undefined;
  if (item.type === 'dua_request') return item.dua?.library !== undefined;
  return false;
}

/** Published posts can be deleted at any age; deleted and removed ones not. */
export const canDelete = (row: AdminItem): boolean => row.status === 'published';

const editingOf = (row: AdminItem) => ({ itemId: row.id, updatedAt: row.updatedAt });

/** A library entry as the admin flows hold it (the post carries the public shape; tags only matter for search). */
const adminEntryOf = (entry: LibraryEntry): AdminLibraryEntry => ({ ...entry, tags: [] });

/** An IST instant as the flows' date + time slots. */
const slotsOf = (at: string | undefined) =>
  at === undefined
    ? { date: null, time: null }
    : { date: calendarDateInZone(new Date(at)), time: wallClockInZone(new Date(at)) };

/** A notice back as its B5 draft (a photo keeps its key; the thumbnail shows its ThumbHash). */
export function noticeDraftOf(row: AdminItem): NoticeDraft | null {
  const { item } = row;
  if (item.type !== 'announcement' || !item.announcement) return null;
  const event = slotsOf(item.announcement.eventAt);
  return {
    content: item.templateKey
      ? { kind: 'template', key: item.templateKey, values: { ...item.templateParams } }
      : { kind: 'text', title: item.title ?? '', body: item.body ?? '', locale: item.contentLocale ?? 'en' },
    category: item.announcement.category,
    isImportant: item.isImportant,
    eventDate: event.date,
    eventTime: event.time,
    photo: item.image ? { key: item.image.key, thumbhash: item.image.thumbhash ?? '', url: null } : null,
    editing: editingOf(row),
  };
}

/** A hadith / ayah back as its B6 draft. */
export function dailyDraftOf(row: AdminItem): DailyDraft | null {
  const { daily } = row.item;
  if (row.item.type !== 'daily_content' || !daily?.library) return null;
  return {
    kind: daily.kind,
    entry: adminEntryOf(daily.library),
    note: daily.note ?? '',
    publishedToday: false,
    editing: editingOf(row),
  };
}

/** A dua request back as its B7 draft — with the private name, which only the masjid's admins see. */
export function duaDraftOf(row: AdminItem): DuaDraft | null {
  const { dua } = row.item;
  if (row.item.type !== 'dua_request' || !dua?.library) return null;
  const janaza = slotsOf(dua.janazaAt);
  return {
    category: dua.category,
    locale: row.item.contentLocale ?? 'en',
    messageKey: null,
    message: row.item.body ?? '',
    personName: row.privateName ?? dua.personName ?? '',
    namePrivate: dua.namePrivate,
    janazaDate: janaza.date,
    janazaTime: janaza.time,
    janazaPlace: dua.janazaPlace ?? '',
    entry: adminEntryOf(dua.library),
    editing: editingOf(row),
  };
}

/** The PATCH body of an edited notice; `null` while it has issues. */
export function noticeEditBody(draft: NoticeDraft, template: NoticeTemplate | undefined): ItemEditBody | null {
  const body = publishBody(draft, template, false);
  if (body === null) return null;
  const { notify: _notify, ...fields } = body;
  return { type: 'announcement', ...fields };
}

/** The PATCH body of an edited hadith / ayah. */
export function dailyEditBody(draft: DailyDraft): ItemEditBody | null {
  const body = dailyPublishBody(draft, false);
  if (body === null) return null;
  const { notify: _notify, ...fields } = body;
  return { type: 'daily_content', ...fields };
}

/** The PATCH body of an edited dua request. */
export function duaEditBody(draft: DuaDraft): ItemEditBody | null {
  const body = duaPublishBody(draft, false);
  if (body === null) return null;
  const { notify: _notify, ...fields } = body;
  return { type: 'dua_request', ...fields };
}
