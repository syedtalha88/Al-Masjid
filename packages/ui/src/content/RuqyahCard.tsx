// A Ruqyah entry (07 A19, DECISIONS #104) — shared by the musalli list and the admin B15 preview (T3.11: the preview
// renders the real component). Optional title; a library entry shows its Arabic (Amiri, never mirrored), transliteration,
// translation, reference and source line; text the masjid entered shows the same layout with "Added by <masjid>" and
// NEVER a source or verified line (05 §9); a recording is the A18 player. The masjid's instruction sits in a muted note
// under the entry. Texts come only from the verified library or from the masjid itself (CLAUDE.md §2.3).
import type { Locale } from '@mc/i18n/locales';
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { RuqyahEntry } from '@mc/shared/contracts/public';

import { ArabicText } from '../components/ArabicText.tsx';
import { Tag } from '../components/Badges.tsx';
import { Card } from '../components/Card.tsx';
import { InfoNote } from '../components/InfoNote.tsx';
import { VoiceNote } from '../components/VoiceNote.tsx';
import { libraryText } from './content-view.ts';

/** Language names in their own script — shown when masjid text is not in the app language. */
const AUTONYM: Readonly<Record<Locale, string>> = { en: 'English', hi: 'हिन्दी', ur: 'اردو', te: 'తెలుగు' };

export interface RuqyahCardProps {
  readonly entry: RuqyahEntry;
  /** The masjid's name in the app language ("Added by <masjid>"). */
  readonly masjid: string;
  /** The recording's URL on the media origin (`null` without one); used for audio entries only. */
  readonly audioSrc?: string | null;
  /** Reader text size factor for the Arabic (07 A8 A−/A+). */
  readonly scale?: number | undefined;
  readonly showTransliteration?: boolean;
}

export function RuqyahCard({ entry, masjid, audioSrc = null, scale, showTransliteration = false }: RuqyahCardProps) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const quote = (text: string) => t('ui.ruqyah.quoted', { text });

  const content = (() => {
    if (entry.library) {
      const text = libraryText(entry.library, locale);
      return (
        <>
          <ArabicText scale={scale}>{entry.library.arabic}</ArabicText>
          {showTransliteration && text.transliteration ? (
            <p dir="auto" className="type-callout text-text-secondary">
              {text.transliteration}
            </p>
          ) : null}
          <p className={`type-body text-text ${locale === 'en' || text.fallback ? 'italic' : ''}`}>
            {quote(text.translation)}
            {text.fallback ? (
              <Tag tone="neutral" className="ms-2 align-middle not-italic">
                {AUTONYM.en}
              </Tag>
            ) : null}
          </p>
          <p className="type-footnote text-text-secondary">
            <bdi>{entry.library.reference}</bdi>
          </p>
          <p className="type-caption text-text-tertiary" data-ruqyah-source>
            {t('ui.ruqyah.source', { name: entry.library.sourceName, license: entry.library.sourceLicense })}
          </p>
        </>
      );
    }
    if (entry.text) {
      const other = entry.text.translationLocale !== locale;
      return (
        <>
          <ArabicText scale={scale}>{entry.text.arabic}</ArabicText>
          <p lang={entry.text.translationLocale} dir="auto" className="type-body text-text">
            {quote(entry.text.translation)}
            {other ? (
              <Tag tone="neutral" className="ms-2 align-middle">
                {AUTONYM[entry.text.translationLocale]}
              </Tag>
            ) : null}
          </p>
          {entry.text.reference ? (
            <p className="type-footnote text-text-secondary">
              <bdi>{entry.text.reference}</bdi>
            </p>
          ) : null}
          <p className="type-caption text-text-tertiary" data-ruqyah-added-by>
            {t('ui.ruqyah.addedBy', { masjid })}
          </p>
        </>
      );
    }
    if (entry.audio) {
      return <VoiceNote src={audioSrc} durationS={entry.audio.durationS} peaks={entry.audio.peaks} />;
    }
    return null;
  })();

  return (
    <Card className={`flex flex-col gap-3 ${entry.audio ? '' : 'text-center'}`} data-ruqyah-entry={entry.source}>
      {entry.title ? (
        <h3 dir="auto" className="text-start type-headline text-text">
          {entry.title}
        </h3>
      ) : null}
      {content}
      {entry.instructions ? (
        <InfoNote className="text-start">
          <span className="sr-only">{t('ui.ruqyah.instructions')}: </span>
          <span lang={entry.instructionsLocale} dir="auto">
            {entry.instructions}
          </span>
        </InfoNote>
      ) : null}
    </Card>
  );
}
