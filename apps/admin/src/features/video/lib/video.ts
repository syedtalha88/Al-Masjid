// B10 "Bayan Video" draft (07 B10, DECISIONS #39, PHASE_06 T6.2): a pasted YouTube link checked instantly on the phone
// (the server checks it again, and asks YouTube), the preview the server returned, editable title, optional speaker and
// description, the audience (required — no default) and the ownership tick. Pure: no React, no I/O.
import { parseYouTubeLink } from '@mc/domain/youtube';
import {
  VIDEO_DESCRIPTION_MAX,
  VIDEO_SPEAKER_MAX,
  VIDEO_TITLE_MAX,
  type VideoCreate,
  type VideoPreview,
} from '@mc/shared/contracts';

export type VideoAudience = VideoCreate['audience'];
export const VIDEO_AUDIENCES: readonly VideoAudience[] = ['everyone', 'brothers', 'sisters'];

export interface VideoDraft {
  readonly url: string;
  /** What the server said about `previewFor` (YouTube's title, our thumbnail). */
  readonly preview: VideoPreview | null;
  /** The link the preview belongs to (a changed link needs a new preview). */
  readonly previewFor: string;
  readonly title: string;
  readonly speaker: string;
  readonly description: string;
  readonly audience: VideoAudience | null;
  readonly rights: boolean;
}

export const emptyVideo = (): VideoDraft => ({
  url: '',
  preview: null,
  previewFor: '',
  title: '',
  speaker: '',
  description: '',
  audience: null,
  rights: false,
});

/** The instant check of what was pasted: nothing yet, fine, or not a link to one YouTube video. */
export function linkState(url: string): 'empty' | 'ok' | 'invalid' {
  if (url.trim() === '') return 'empty';
  return 'error' in parseYouTubeLink(url) ? 'invalid' : 'ok';
}

/** The draft with the server's preview: YouTube's title fills the title unless the admin already typed one. */
export function withPreview(draft: VideoDraft, url: string, preview: VideoPreview): VideoDraft {
  return {
    ...draft,
    preview,
    previewFor: url.trim(),
    title: draft.title.trim() === '' ? preview.title.slice(0, VIDEO_TITLE_MAX) : draft.title,
  };
}

export type VideoIssue = 'link' | 'title' | 'audience' | 'rights';

/** What still blocks Publish, in screen order. */
export function videoIssues(draft: VideoDraft): VideoIssue[] {
  const issues: VideoIssue[] = [];
  if (draft.preview === null || draft.previewFor !== draft.url.trim()) issues.push('link');
  const title = draft.title.trim();
  if (title.length < 1 || title.length > VIDEO_TITLE_MAX) issues.push('title');
  if (draft.audience === null) issues.push('audience');
  if (!draft.rights) issues.push('rights');
  return issues;
}

/**
 * The publish body, or `null` while something is missing.
 *
 * @param locale - the bayan's language as the admin app's language (shown in 4 scripts anyway — it is a video).
 */
export function videoBody(draft: VideoDraft, locale: VideoCreate['locale'], notify: boolean): VideoCreate | null {
  if (videoIssues(draft).length > 0 || draft.audience === null) return null;
  const speaker = draft.speaker.trim().slice(0, VIDEO_SPEAKER_MAX);
  const description = draft.description.trim().slice(0, VIDEO_DESCRIPTION_MAX);
  return {
    url: draft.url.trim(),
    title: draft.title.trim(),
    ...(speaker === '' ? {} : { speaker }),
    ...(description === '' ? {} : { description }),
    audience: draft.audience,
    locale,
    rightsConfirmed: true,
    notify,
  };
}

/** Within 24 h of publishing a bayan's texts may be edited (00 §4.3). */
export function editableUntil(publishedAt: string): Date {
  return new Date(new Date(publishedAt).getTime() + 24 * 60 * 60 * 1000);
}
