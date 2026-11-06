// A voice note in a publish flow's draft (07 B14, DECISIONS #126, DECISIONS #127): the uploaded recording and, when the post has
// no title of its own (a template notice, a hadith / ayah, a dua request), the title a voice note always needs.

export const VOICE_TITLE_MAX = 120;

/** A recording stored by `POST /audio`; `url` plays it in the admin's previews (a blob URL; `null` when editing). */
export interface AttachedVoice {
  readonly key: string;
  readonly durationS: number;
  readonly peaks: readonly number[];
  readonly url: string | null;
}

/** The draft fields every flow shares (optional, so existing drafts stay as they were). */
export interface VoiceDraftFields {
  readonly voice?: AttachedVoice | null | undefined;
  readonly voiceTitle?: string | undefined;
}

/** A voice note is attached but the post has no title for it yet (or one over 120 characters). */
export function voiceTitleMissing(fields: VoiceDraftFields, needsTitle: boolean): boolean {
  if (!fields.voice || !needsTitle) return false;
  const title = (fields.voiceTitle ?? '').trim();
  return title === '' || title.length > VOICE_TITLE_MAX;
}

/**
 * The voice part of a publish / edit body and of the preview item: `voice` and, when the post needs one, its `title`.
 * Empty without a voice note (the server refuses a title alone).
 */
export function voiceBody(
  fields: VoiceDraftFields,
  needsTitle: boolean,
): { voice?: { key: string; durationS: number; peaks: number[] }; title?: string } {
  if (!fields.voice) return {};
  const { key, durationS, peaks } = fields.voice;
  const title = (fields.voiceTitle ?? '').trim();
  return { voice: { key, durationS, peaks: [...peaks] }, ...(needsTitle && title !== '' ? { title } : {}) };
}
