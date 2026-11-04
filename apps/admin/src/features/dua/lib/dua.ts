// B7 Dua request (07 B7, 00 §4.3 Dua requests, PHASE_03 T3.8): the draft (category, a ready-made or own message in a
// chosen language, the person's name with "Keep name private" on by default, an inteqal's janaza, the attached dua from
// the verified library), the checks behind "Next", the publish body and the item the preview renders.
import { istInstant } from '@mc/domain/time';
import { type DuaCategory, duaMessage, duaMessages } from '@mc/i18n/dua-messages';
import type { Locale } from '@mc/i18n/locales';
import {
  type AdminLibraryEntry,
  DUA_MESSAGE_MAX,
  DUA_NAME_MAX,
  type DuaPublish,
  JANAZA_PLACE_MAX,
} from '@mc/shared/contracts';
import type { FeedItem } from '@mc/shared/contracts/public';

export type { DuaCategory };

export interface DuaDraft {
  readonly category: DuaCategory;
  /** The language of the message (musallis see it as written). */
  readonly locale: Locale;
  /** The ready-made message the text came from; `null` once the admin edits it (or wrote their own). */
  readonly messageKey: string | null;
  readonly message: string;
  readonly personName: string;
  readonly namePrivate: boolean;
  readonly janazaDate: string | null;
  readonly janazaTime: string | null;
  readonly janazaPlace: string;
  readonly entry: AdminLibraryEntry | null;
}

/** What still blocks the next step, in the order the screen shows the fields. */
export type DuaIssue = 'message' | 'name' | 'janaza';

/** A new draft for `category`: its first ready-made message in `locale`, the name private, no dua yet. */
export function draftForCategory(category: DuaCategory, locale: Locale): DuaDraft {
  const [first] = duaMessages(category, locale);
  return {
    category,
    locale,
    messageKey: first?.key ?? null,
    message: first?.text ?? '',
    personName: '',
    namePrivate: true,
    janazaDate: null,
    janazaTime: null,
    janazaPlace: '',
    entry: null,
  };
}

/** Another language: an unedited ready-made message follows it; an own text stays as written. */
export function withLocale(draft: DuaDraft, locale: Locale): DuaDraft {
  const text = draft.messageKey === null ? undefined : duaMessage(draft.category, draft.messageKey, locale);
  return { ...draft, locale, ...(text === undefined ? {} : { message: text }) };
}

/** A ready-made message of the draft's category, in the draft's language. */
export function withMessageKey(draft: DuaDraft, key: string): DuaDraft {
  const text = duaMessage(draft.category, key, draft.locale);
  return text === undefined ? draft : { ...draft, messageKey: key, message: text };
}

/** The admin edited the text: it is their own from now on. */
export function withOwnMessage(draft: DuaDraft, message: string): DuaDraft {
  return { ...draft, messageKey: null, message };
}

/** Step 2's checks: a message (≤ 500), a name ≤ 80, a janaza with both date and time or neither (inteqal). */
export function detailIssues(draft: DuaDraft): DuaIssue[] {
  const issues: DuaIssue[] = [];
  const message = draft.message.trim();
  if (message === '' || message.length > DUA_MESSAGE_MAX) issues.push('message');
  if (draft.personName.trim().length > DUA_NAME_MAX) issues.push('name');
  if (
    draft.category === 'inteqal' &&
    ((draft.janazaDate === null) !== (draft.janazaTime === null) || draft.janazaPlace.trim().length > JANAZA_PLACE_MAX)
  ) {
    issues.push('janaza');
  }
  return issues;
}

/** The janaza instant (IST wall clock), for an inteqal with both date and time. */
export function janazaAtOf(draft: DuaDraft): string | undefined {
  if (draft.category !== 'inteqal' || draft.janazaDate === null || draft.janazaTime === null) return undefined;
  return istInstant(draft.janazaDate, draft.janazaTime).toISOString();
}

const trimmed = (value: string): string | undefined => {
  const text = value.trim();
  return text === '' ? undefined : text;
};

/** The body of `POST /items/dua`; `null` while step 2 has issues or no dua is attached. */
export function duaPublishBody(draft: DuaDraft, notify: boolean): DuaPublish | null {
  if (detailIssues(draft).length > 0 || draft.entry === null) return null;
  const personName = trimmed(draft.personName);
  const janazaAt = janazaAtOf(draft);
  const janazaPlace = draft.category === 'inteqal' ? trimmed(draft.janazaPlace) : undefined;
  return {
    category: draft.category,
    message: draft.message.trim(),
    locale: draft.locale,
    ...(personName === undefined ? {} : { personName }),
    namePrivate: draft.namePrivate,
    libraryId: draft.entry.id,
    ...(janazaAt === undefined ? {} : { janazaAt }),
    ...(janazaPlace === undefined ? {} : { janazaPlace }),
    notify,
  };
}

const PREVIEW_ID = 'previewDua';

/**
 * The item musallis will receive — as the public view serves it: a private name is not in it (02 §4.2), so the
 * preview shows "a brother or sister from our community" exactly as followers will.
 */
export function duaPreviewItem(draft: DuaDraft, masjidId: string, now: Date): FeedItem {
  const personName = trimmed(draft.personName);
  const janazaAt = janazaAtOf(draft);
  const janazaPlace = draft.category === 'inteqal' ? trimmed(draft.janazaPlace) : undefined;
  const { entry } = draft;
  return {
    publicId: PREVIEW_ID,
    masjidId,
    type: 'dua_request',
    audience: 'everyone',
    body: draft.message.trim(),
    contentLocale: draft.locale,
    isImportant: false,
    publishedAt: now.toISOString(),
    dua: {
      category: draft.category,
      ...(draft.namePrivate || personName === undefined ? {} : { personName }),
      namePrivate: draft.namePrivate,
      ...(janazaAt === undefined ? {} : { janazaAt }),
      ...(janazaPlace === undefined ? {} : { janazaPlace }),
      ...(entry
        ? {
            library: {
              id: entry.id,
              kind: entry.kind,
              arabic: entry.arabic,
              transliteration: entry.transliteration,
              translation: entry.translation,
              reference: entry.reference,
              sourceName: entry.sourceName,
              sourceLicense: entry.sourceLicense,
            },
          }
        : {}),
    },
  };
}
