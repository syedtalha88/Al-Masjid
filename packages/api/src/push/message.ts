// The words of a musalli notification (00 §4.4, 07 A17, 01 §5.3 step 5): title = the masjid's name in the reader's
// script; body = the item's one-line title (the admin's, else the template's in the reader's language, else the item
// label the apps show) and its text — a template notice rendered by the same ICU code and argument formatting as the
// apps (`@mc/i18n/runtime-message`, `template-args`), free text as written. A voice note adds "🎤 Voice message"; the
// push never carries audio (DECISIONS #104). Built once per locale group at fan-out.
import type { PushContent } from '@mc/db/state';
import { formatters } from '@mc/i18n/format';
import type { Locale } from '@mc/i18n/locales';
import { itemLabel, prayerName, pushText } from '@mc/i18n/push-text';
import { formatRuntimeMessage } from '@mc/i18n/runtime-message';
import { templateArguments, type TemplateValue } from '@mc/i18n/template-args';
import {
  PUSH_BODY_MAX,
  PUSH_PAYLOAD_MAX_BYTES,
  PUSH_TITLE_MAX,
  type PushPayload,
  pushPayloadSchema,
} from '@mc/shared/contracts/push';

import type { PushOptions } from './sender.ts';

const present = (value: string | undefined): value is string => value !== undefined && value.trim() !== '';

/** Cuts `text` to at most `max` characters on a grapheme boundary, with "…" when cut. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (out.length + segment.length > max - 1) break;
    out += segment;
  }
  return `${out.trimEnd()}…`;
}

/** The label kind of an item (`common.item.<kind>`), as the apps choose it (`@mc/ui/content` itemKind). */
function kindOf(content: PushContent): string {
  switch (content.type) {
    case 'announcement':
      return content.category === undefined || content.category === 'general' ? 'announcement' : content.category;
    case 'timing_update':
      return 'timing';
    case 'daily_content':
      return content.category ?? 'hadith';
    case 'dua_request':
      return 'dua';
    case 'chanda_update':
      return 'chanda';
    default:
      return content.type; // campaign, video
  }
}

function headline(content: PushContent, locale: Locale): string {
  if (present(content.title)) return content.title.trim();
  if (content.template) {
    const title = content.template.title[locale] ?? content.template.title.en;
    if (present(title)) return title.trim();
  }
  const firstLine = content.body?.split('\n').find((line) => line.trim() !== '');
  return firstLine?.trim() ?? itemLabel(kindOf(content), locale);
}

function detailText(content: PushContent, locale: Locale): string | undefined {
  if (!content.template || content.templateKey === undefined)
    return present(content.body) ? content.body.trim() : undefined;
  const message = content.template.body[locale] ?? content.template.body.en;
  if (!present(message)) return undefined;
  const format = formatters(locale);
  const values = templateArguments(
    (content.templateParams ?? {}) as Readonly<Record<string, TemplateValue>>, // checked against the template at publish
    content.template.params as Parameters<typeof templateArguments>[1], // the template's own declared params
    {
      time: (hhmm) => format.time(hhmm).text,
      date: (date) => format.calendarDate(date, 'medium'),
      prayer: (name) => prayerName(name, locale),
    },
  );
  return formatRuntimeMessage(message, locale, values) ?? undefined;
}

/**
 * The notification for `content` in `locale`, validated against the service worker's schema and within the 3 KB
 * payload budget (the body is shortened further if needed).
 *
 * @throws Error when the result is still invalid (a payload bug — the batch logs it, never sends it).
 */
export function pushMessage(content: PushContent, locale: Locale): PushPayload {
  const title = cutText(content.masjidNameI18n[locale] ?? content.masjidName, PUSH_TITLE_MAX);
  const head = content.hasVoice
    ? `${headline(content, locale)} · ${pushText('voice', locale)}`
    : headline(content, locale);
  const detail = detailText(content, locale);
  let body = cutText(detail === undefined || detail === head ? head : `${head}\n${detail}`, PUSH_BODY_MAX);
  const build = (): PushPayload => ({
    v: 1,
    t: title,
    b: body,
    u: `/items/${content.publicId}`,
    m: content.masjidId,
    cv: content.contentVersion,
    tag: content.publicId,
    l: locale,
  });
  let payload = build();
  while (Buffer.byteLength(JSON.stringify(payload)) > PUSH_PAYLOAD_MAX_BYTES && body.length > 40) {
    body = cutText(body, Math.floor(body.length * 0.8));
    payload = build();
  }
  return pushPayloadSchema.parse(payload);
}

/** 01 §5.3 step 3: announcements live a day at the push service, everything else 12 hours. */
const TTL_ANNOUNCEMENT_S = 86_400;
const TTL_OTHER_S = 43_200;

/** Delivery hints: `Urgency: high` for important notices and inteqal requests; `Topic` = the item (collapses). */
export function pushOptions(content: PushContent): PushOptions {
  const urgent = content.isImportant || (content.type === 'dua_request' && content.category === 'inteqal');
  return {
    ttlS: content.type === 'announcement' ? TTL_ANNOUNCEMENT_S : TTL_OTHER_S,
    urgency: urgent ? 'high' : 'normal',
    topic: content.publicId,
  };
}
