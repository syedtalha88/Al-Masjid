// B5 notice draft (07 B5, 00 §4.3 Announcements, PHASE_03 T3.6): what the admin has chosen and filled in, the checks
// that hold the Next / Publish buttons, the `POST /items/announcement` body and the musalli item the preview renders.
// Pure: the screens keep the draft, these functions read it.
import { istInstant } from '@mc/domain/time';
import type { Locale } from '@mc/i18n/locales';
import { type TemplateValue, templateValueProblems } from '@mc/i18n/template-args';
import { type AnnouncementPublish, NOTICE_BODY_MAX, NOTICE_TITLE_MAX } from '@mc/shared/contracts';
import type { FeedItem, NoticeTemplate } from '@mc/shared/contracts/public';

import type { ItemEditing } from '../../publish/use-publish.ts';
import { voiceBody, type VoiceDraftFields, voiceTitleMissing } from '../../voice/lib/voice.ts';

export type NoticeCategory = 'general' | 'event' | 'facilities' | 'timing';
export const NOTICE_CATEGORIES: readonly NoticeCategory[] = ['general', 'event', 'facilities', 'timing'];

/** A photo stored by `POST /images` (the ownership tick was given before it was chosen). */
export interface NoticePhoto {
  readonly key: string;
  readonly thumbhash: string;
  /** Small delivery URL for the thumbnail on the Fill step; `null` for the photo of a notice being edited (ThumbHash). */
  readonly url: string | null;
}

export type NoticeContent =
  | {
      readonly kind: 'template';
      readonly key: string;
      readonly values: Readonly<Record<string, TemplateValue>>;
    }
  | { readonly kind: 'text'; readonly title: string; readonly body: string; readonly locale: Locale };

export interface NoticeDraft extends VoiceDraftFields {
  readonly content: NoticeContent;
  readonly category: NoticeCategory;
  readonly isImportant: boolean;
  /** Category `event` only: when it happens (IST), shown as a date badge. Both or neither. */
  readonly eventDate: string | null;
  readonly eventTime: string | null;
  readonly photo: NoticePhoto | null;
  /** Set when the draft edits a published notice (B12, T3.9): the last step saves instead of publishing. */
  readonly editing?: ItemEditing;
}

/** A new draft from a template: its category and Important preset (editable), no values yet. */
export function draftForTemplate(template: NoticeTemplate): NoticeDraft {
  return {
    content: { kind: 'template', key: template.key, values: {} },
    category: template.category,
    isImportant: template.isImportantDefault,
    eventDate: null,
    eventTime: null,
    photo: null,
  };
}

/** A new "Write your own" draft, tagged with the admin's UI language (00 §4.3; editable). */
export function draftForText(locale: Locale): NoticeDraft {
  return {
    content: { kind: 'text', title: '', body: '', locale },
    category: 'general',
    isImportant: false,
    eventDate: null,
    eventTime: null,
    photo: null,
  };
}

/** Why the draft cannot go to the preview yet (the Fill step shows each one). */
export type NoticeIssue =
  | { readonly kind: 'param'; readonly name: string }
  | { readonly kind: 'title' | 'body' | 'event' | 'template' | 'voiceTitle' };

/**
 * @param template - the draft's template (`undefined` while the list loads or when it was retired meanwhile).
 * @returns what is missing or wrong: params that do not fit the template (`@mc/i18n/template-args`, the same check as
 *   the server), an empty or too long title / body, half an event time.
 */
export function noticeIssues(draft: NoticeDraft, template: NoticeTemplate | undefined): NoticeIssue[] {
  const issues: NoticeIssue[] = [];
  const { content } = draft;
  if (content.kind === 'template') {
    if (!template) return [{ kind: 'template' }];
    for (const name of templateValueProblems(content.values, template.params)) issues.push({ kind: 'param', name });
  } else {
    const title = content.title.trim();
    const body = content.body.trim();
    if (title.length === 0 || title.length > NOTICE_TITLE_MAX) issues.push({ kind: 'title' });
    if (body.length === 0 || body.length > NOTICE_BODY_MAX) issues.push({ kind: 'body' });
  }
  if (draft.category === 'event' && (draft.eventDate === null) !== (draft.eventTime === null)) {
    issues.push({ kind: 'event' });
  }
  if (voiceTitleMissing(draft, content.kind === 'template')) issues.push({ kind: 'voiceTitle' });
  return issues;
}

/** The event instant (ISO) when the draft is an event with a date and time. */
export function eventAtOf(draft: NoticeDraft): string | undefined {
  if (draft.category !== 'event' || draft.eventDate === null || draft.eventTime === null) return undefined;
  return istInstant(draft.eventDate, draft.eventTime).toISOString();
}

/** The `POST /items/announcement` body; `null` while the draft has issues. */
export function publishBody(
  draft: NoticeDraft,
  template: NoticeTemplate | undefined,
  notify: boolean,
): AnnouncementPublish | null {
  if (noticeIssues(draft, template).length > 0) return null;
  const { content } = draft;
  const eventAt = eventAtOf(draft);
  return {
    content:
      content.kind === 'template'
        ? { kind: 'template', key: content.key, params: { ...content.values } }
        : { kind: 'text', title: content.title.trim(), body: content.body.trim(), locale: content.locale },
    category: draft.category,
    isImportant: draft.isImportant,
    ...(eventAt === undefined ? {} : { eventAt }),
    ...(draft.photo
      ? { image: { key: draft.photo.key, thumbhash: draft.photo.thumbhash, rightsConfirmed: true } }
      : {}),
    ...voiceBody(draft, content.kind === 'template'),
    notify,
  };
}

/** Stand-in public id of the preview item (never sent; the shape of a real one). */
const PREVIEW_ID = 'previewNotice';

/** The item as musallis will receive it, published `now` — what `PreviewFrame` renders with the musalli card. */
export function previewItem(draft: NoticeDraft, masjidId: string, now: Date): FeedItem {
  const { content } = draft;
  const eventAt = eventAtOf(draft);
  return {
    publicId: PREVIEW_ID,
    masjidId,
    type: 'announcement',
    audience: 'everyone',
    ...(content.kind === 'template'
      ? { templateKey: content.key, templateParams: { ...content.values } }
      : { title: content.title.trim(), body: content.body.trim(), contentLocale: content.locale }),
    isImportant: draft.isImportant,
    ...(draft.photo ? { image: { key: draft.photo.key, thumbhash: draft.photo.thumbhash } } : {}),
    ...voiceBody(draft, content.kind === 'template'),
    publishedAt: now.toISOString(),
    announcement: { category: draft.category, ...(eventAt === undefined ? {} : { eventAt }) },
  };
}

/** The draft's template among the admin's templates. */
export function templateOf(
  draft: NoticeDraft,
  templates: readonly NoticeTemplate[] | undefined,
): NoticeTemplate | undefined {
  const { content } = draft;
  return content.kind === 'template' ? templates?.find((entry) => entry.key === content.key) : undefined;
}

/**
 * A phone number as an admin types it ("98765 43210", "+91 98765-43210") in E.164: spaces and dashes go, a 10-digit
 * Indian mobile number gets +91. Anything else is returned as typed (the check then names the param).
 */
export function phoneValue(typed: string): string {
  const compact = typed.replace(/[\s-]/g, '');
  return /^[6-9]\d{9}$/.test(compact) ? `+91${compact}` : compact;
}
