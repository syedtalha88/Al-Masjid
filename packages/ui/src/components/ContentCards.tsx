import { type ReactNode, useId } from 'react';

import { CaretRightIcon } from '../icons/glyph/CaretRightIcon.tsx';
import { ClockIcon } from '../icons/glyph/ClockIcon.tsx';
import { Pressable } from '../motion/Pressable.tsx';
import { ArabicText } from './ArabicText.tsx';
import { Tag } from './Badges.tsx';
import type { Tone } from './tone.ts';

export interface CardTag {
  readonly label: string;
  readonly tone: Tone;
}

const Chevron = () => (
  <span aria-hidden className="mt-0.5 shrink-0 text-text-tertiary">
    <CaretRightIcon size={20} className="rtl:-scale-x-100" />
  </span>
);

export interface AnnouncementCardProps {
  /** The category icon circle (48). */
  readonly icon: ReactNode;
  readonly title: string;
  /** Relative time ("2 hours ago"), under the title (ref-3). */
  readonly time: string;
  readonly body?: string | undefined;
  /** Important / Event / General … (06 §2 tones). */
  readonly tags: readonly CardTag[];
  /** Event date badge ("Sat, 26 Sep · 8:45 PM"). */
  readonly eventDate?: string | undefined;
  /** Masjid name on cross-masjid lists. */
  readonly masjid?: string | undefined;
  readonly onPress: () => void;
}

/**
 * Announcement card (06 §6, 07 A7, ref-2/1 + ref-3/1): category icon circle, title (2 lines), time, body (3 lines), tag
 * row with an optional event date, chevron. Important shows by its tag only. The whole card is one button named by
 * its title; the other text is its description.
 */
export function AnnouncementCard({ icon, title, time, body, tags, eventDate, masjid, onPress }: AnnouncementCardProps) {
  const titleId = useId();
  const detailId = useId();
  return (
    <Pressable
      kind="card"
      aria-labelledby={titleId}
      aria-describedby={detailId}
      onPress={onPress}
      className="flex w-full gap-3 rounded-md bg-surface p-4 text-start shadow-e1"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {masjid ? <bdi className="truncate type-caption text-text-secondary">{masjid}</bdi> : null}
        <span id={titleId} dir="auto" className="line-clamp-2 type-headline text-text">
          {title}
        </span>
        <span id={detailId} className="flex flex-col gap-1">
          <span className="type-caption text-text-tertiary">{time}</span>
          {body ? (
            <span dir="auto" className="line-clamp-3 type-callout text-text-secondary">
              {body}
            </span>
          ) : null}
          {tags.length > 0 || eventDate ? (
            <span className="mt-1 flex flex-wrap items-center gap-2">
              {tags.map((tag) => (
                <Tag key={tag.label} tone={tag.tone}>
                  {tag.label}
                </Tag>
              ))}
              {eventDate ? (
                <span className="inline-flex items-center gap-1 type-caption text-primary-700">
                  <ClockIcon size={14} />
                  {eventDate}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </span>
      <Chevron />
    </Pressable>
  );
}

export interface DuaBoxProps {
  /** Licensed library text only (CLAUDE.md §2.3). */
  readonly arabic: string;
  readonly transliteration?: string | undefined;
  readonly translation?: string | undefined;
  /** "English" when the translation fell back from the app language (00 §4.3). */
  readonly translationTag?: string | undefined;
  /** `lg` in the dua detail (hero Arabic size). */
  readonly size?: 'md' | 'lg';
  readonly className?: string;
}

/** The attached dua (06 §6 DuaBox, ref-3/3): a mint box with the Arabic (Amiri), transliteration and translation. */
export function DuaBox({ arabic, transliteration, translation, translationTag, size = 'md', className }: DuaBoxProps) {
  return (
    <span className={`flex flex-col gap-2 rounded-md bg-mint-50 p-4 text-center ${className ?? ''}`}>
      <ArabicText variant={size === 'lg' ? 'hero' : 'body'}>{arabic}</ArabicText>
      {transliteration ? (
        <span dir="auto" className="type-callout text-text-secondary">
          {transliteration}
        </span>
      ) : null}
      {translation ? (
        <span className="type-callout text-text">
          {translation}
          {translationTag ? (
            <Tag tone="neutral" className="ms-2 align-middle">
              {translationTag}
            </Tag>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

export interface DuaRequestCardProps {
  /** Category icon circle (56). */
  readonly icon: ReactNode;
  /** Illness / Inteqal / Other. */
  readonly tag: CardTag;
  readonly time: string;
  /** "Request for Dua". */
  readonly title: string;
  readonly message: string;
  /** "For Test Person A" — only when the family allowed the name (02 §4.2); else the private wording. */
  readonly person?: string | undefined;
  readonly dua?: DuaBoxProps | undefined;
  /** "Janaza: after Asr · Masjid Al-Noor" (inteqal). */
  readonly janaza?: string | undefined;
  readonly masjid?: string | undefined;
  /** The Ameen row (AmeenButton + count) — outside the card's own button. */
  readonly footer?: ReactNode;
  readonly onPress: () => void;
}

/**
 * Dua request card (06 §6, 07 A9, ref-3/3): icon circle, tag + time, "Request for Dua", message (3 lines), the dua in
 * its mint box, janaza row, and the Ameen row. The upper part is one button (named by the title); Ameen is its own
 * button below it.
 */
export function DuaRequestCard({
  icon,
  tag,
  time,
  title,
  message,
  person,
  dua,
  janaza,
  masjid,
  footer,
  onPress,
}: DuaRequestCardProps) {
  const titleId = useId();
  const detailId = useId();
  return (
    <article className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-e1">
      <Pressable
        kind="card"
        aria-labelledby={titleId}
        aria-describedby={detailId}
        onPress={onPress}
        className="flex w-full flex-col gap-3 rounded-sm text-start"
      >
        <span className="flex w-full gap-3">
          <span className="shrink-0">{icon}</span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <Tag tone={tag.tone}>{tag.label}</Tag>
              <span className="type-caption text-text-tertiary">{time}</span>
            </span>
            {masjid ? <bdi className="truncate type-caption text-text-secondary">{masjid}</bdi> : null}
            <span id={titleId} className="type-headline text-text">
              {title}
            </span>
            <span id={detailId} className="flex flex-col gap-1">
              {person ? <span className="type-subhead-strong text-text">{person}</span> : null}
              <span dir="auto" className="line-clamp-3 type-callout text-text-secondary">
                {message}
              </span>
            </span>
          </span>
          <Chevron />
        </span>
        {dua ? <DuaBox {...dua} className="w-full" /> : null}
      </Pressable>
      {janaza ? (
        <p className="flex items-center gap-2 type-footnote text-slate">
          <ClockIcon size={16} />
          {janaza}
        </p>
      ) : null}
      {footer ? <div className="flex items-center">{footer}</div> : null}
    </article>
  );
}
