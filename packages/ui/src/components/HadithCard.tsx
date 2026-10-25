import type { ReactNode } from 'react';

import { BookmarkIcon } from '../icons/glyph/BookmarkIcon.tsx';
import { ShareIcon } from '../icons/glyph/ShareIcon.tsx';
import { ArabicText } from './ArabicText.tsx';
import { Tag } from './Badges.tsx';
import { Button, IconButton } from './Button.tsx';

export interface HadithCardProps {
  /** `hero`: today's item with the picture header (07 A8, ref-2/2); `regular`: older items (ref-3/2). */
  readonly variant?: 'hero' | 'regular';
  /** Licensed library text only (CLAUDE.md §2.3). */
  readonly arabic: string;
  readonly transliteration?: string | undefined;
  /** In the app language, already in quotation marks. */
  readonly translation: string;
  /** "English" when the translation fell back from the app language (00 §4.3). */
  readonly translationTag?: string | undefined;
  /** Italic translation — Latin scripts only (07 A8). */
  readonly italic?: boolean;
  readonly reference: string;
  /** "26 Sep 2026": a pill on the hero picture, bottom-end on regular cards. */
  readonly date: string;
  /** "Today's Hadith" / "Today's Ayah" mint pill (hero, when it is today's). */
  readonly todayLabel?: string | undefined;
  /** The admin's short note (07 A8 "Note from masjid"). */
  readonly note?: { readonly label: string; readonly text: string } | undefined;
  readonly saved: boolean;
  readonly onToggleSave: () => void;
  /** "Save" / "Saved" (accessible names of the bookmark). */
  readonly saveLabel: string;
  readonly savedLabel: string;
  readonly onShare: () => void;
  readonly shareLabel: string;
  readonly onReadFull: () => void;
  readonly readFullLabel: string;
  /** The hero header picture. */
  readonly art?: ReactNode;
}

/**
 * Hadith / Ayah card (06 §6, 07 A8): Arabic in Amiri (never mirrored), transliteration, translation, reference,
 * optional note, Share (outline) · Read Full (secondary), and a bookmark that saves on this phone. The hero variant
 * adds the picture header with the date pill and the bookmark on it.
 */
export function HadithCard({
  variant = 'regular',
  arabic,
  transliteration,
  translation,
  translationTag,
  italic = false,
  reference,
  date,
  todayLabel,
  note,
  saved,
  onToggleSave,
  saveLabel,
  savedLabel,
  onShare,
  shareLabel,
  onReadFull,
  readFullLabel,
  art,
}: HadithCardProps) {
  const hero = variant === 'hero';
  const bookmark = (
    <IconButton
      label={saved ? savedLabel : saveLabel}
      aria-pressed={saved}
      icon={<BookmarkIcon filled={saved} />}
      variant={hero ? 'onImage' : 'plain'}
      className={saved && !hero ? 'text-primary-700' : undefined}
      onPress={onToggleSave}
    />
  );
  const body = (
    <div className="flex flex-col gap-3 text-center">
      {hero && todayLabel ? (
        <Tag tone="primary" className="self-start">
          {todayLabel}
        </Tag>
      ) : null}
      <ArabicText variant={hero ? 'hero' : 'body'} className={hero ? '' : 'pe-8'}>
        {arabic}
      </ArabicText>
      {transliteration ? (
        <p dir="auto" className="type-callout text-text-secondary">
          {transliteration}
        </p>
      ) : null}
      <p className={`type-body text-text ${italic ? 'italic' : ''}`}>
        {translation}
        {translationTag ? (
          <Tag tone="neutral" className="ms-2 align-middle not-italic">
            {translationTag}
          </Tag>
        ) : null}
      </p>
      <p className="type-caption text-text-secondary">
        <bdi>{reference}</bdi>
      </p>
      {note ? (
        <figure className="rounded-sm bg-mint-50 p-3 text-start">
          <figcaption className="type-caption font-semibold text-primary-700">{note.label}</figcaption>
          <blockquote dir="auto" className="mt-1 type-footnote text-text">
            {note.text}
          </blockquote>
        </figure>
      ) : null}
      <div className="mt-1 flex gap-3">
        <Button variant="outline" className="flex-1" leadingIcon={<ShareIcon />} onPress={onShare}>
          {shareLabel}
        </Button>
        <Button variant="secondary" className="flex-1" onPress={onReadFull}>
          {readFullLabel}
        </Button>
      </div>
    </div>
  );

  if (hero) {
    return (
      <article className="overflow-hidden rounded-lg bg-surface shadow-e1">
        <div className="relative aspect-[2/1] overflow-hidden">
          {art ? <div className="absolute inset-0 [&>svg]:size-full">{art}</div> : null}
          <span className="absolute start-4 top-4 rounded-full bg-primary-700 px-3 py-1 type-caption text-on-primary">
            {date}
          </span>
          <span className="absolute end-3 top-3">{bookmark}</span>
        </div>
        <div className="relative -mt-5 rounded-t-lg bg-surface p-4 pt-5">{body}</div>
      </article>
    );
  }
  return (
    <article className="relative rounded-md bg-surface p-4 shadow-e1">
      <span className="absolute end-2 top-2">{bookmark}</span>
      {body}
      <p className="mt-3 text-end type-caption text-text-tertiary">{date}</p>
    </article>
  );
}
