// A feed item as the musalli app shows it in its section (07 A7–A9): the item → card glue shared by the musalli screens
// and the admin preview (T3.11 — the preview renders exactly these, never a copy). App concerns (navigation, Ameen,
// Saved, Share) come in as props.
import { calendarDateInZone, wallClockInZone } from '@mc/domain/time';
import type { Formatters } from '@mc/i18n/format';
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { FeedItem, NoticeTemplate } from '@mc/shared/contracts/public';
import type { ReactNode } from 'react';

import { AmeenButton } from '../components/AmeenButton.tsx';
import { AnnouncementCard, DuaRequestCard } from '../components/ContentCards.tsx';
import { HadithCard } from '../components/HadithCard.tsx';
import type { Tone } from '../components/tone.ts';
import { HadithHeroArt } from '../illustrations/HadithHeroArt.tsx';
import { type AnnouncementTag, announcementTags, duaPerson, libraryText } from './content-view.ts';
import { itemKind, itemTitle } from './item-view.ts';
import { DUA_TONE, ItemIcon } from './ItemIcon.tsx';
import { useNoticeBody } from './use-notice-body.ts';

export const TAG_TONE: Readonly<Record<AnnouncementTag, Tone>> = {
  important: 'danger',
  general: 'neutral',
  event: 'primary',
  facilities: 'sun',
  timing: 'info',
};

/** "Sat, 26 Sep · 8:45 PM" (IST). */
export const eventLabel = (at: string, format: Formatters): string => {
  const date = new Date(at);
  return `${format.date(date, 'weekday')} · ${format.time(wallClockInZone(date)).text}`;
};

/** "Today, 5:30 PM" / "Sat, 26 Sep, 5:30 PM" (IST) — when the janaza prayer is. */
export function janazaWhen(at: string, now: Date, format: Formatters, today: string): string {
  const date = new Date(at);
  const time = format.time(wallClockInZone(date)).text;
  return calendarDateInZone(date) === calendarDateInZone(now)
    ? `${today}, ${time}`
    : `${format.date(date, 'weekday')}, ${time}`;
}

export interface AnnouncementItemCardProps {
  readonly item: FeedItem;
  /** The active templates (`GET /templates`); `undefined` while they load. */
  readonly templates: readonly NoticeTemplate[] | undefined;
  readonly now: Date;
  /** Masjid name on cross-masjid lists. */
  readonly masjid?: string | undefined;
  readonly onPress: () => void;
}

/** A7: a notice — template title and body in the reader's language, tags, event date. */
export function AnnouncementItemCard({ item, templates, now, masjid, onPress }: AnnouncementItemCardProps) {
  const { t } = useTranslation('content');
  const { t: tc } = useTranslation();
  const { locale, format } = useLocale();
  const body = useNoticeBody(item, templates);
  const badge = useVoiceBadge(item);
  const eventAt = item.announcement?.eventAt;
  return (
    <AnnouncementCard
      icon={<ItemIcon item={item} />}
      title={itemTitle(item, locale, templates, tc(`item.${itemKind(item)}`))}
      time={format.relative(new Date(item.publishedAt), now)}
      body={body}
      tags={[
        ...announcementTags(item).map((tag) => ({ label: t(`tag.${tag}`), tone: TAG_TONE[tag] })),
        ...(badge ? [badge] : []),
      ]}
      eventDate={eventAt ? eventLabel(eventAt, format) : undefined}
      masjid={masjid}
      onPress={onPress}
    />
  );
}

export interface DailyItemCardProps {
  readonly item: FeedItem;
  /** The newest of its kind: the large card with art. */
  readonly hero: boolean;
  /** Published today (IST): "Today's Hadith" / "Today's Ayah". */
  readonly today: boolean;
  readonly saved: boolean;
  readonly onToggleSave: () => void;
  readonly onShare: () => void;
  readonly onReadFull: () => void;
  /** The voice note's player (the app knows the media origin — F54). */
  readonly voice?: ReactNode;
}

/** A8: a hadith / ayah from the verified library with the masjid's note; `null` without its library entry. */
export function DailyItemCard({
  item,
  hero,
  today,
  saved,
  onToggleSave,
  onShare,
  onReadFull,
  voice,
}: DailyItemCardProps) {
  const { t } = useTranslation('content');
  const { locale, format } = useLocale();
  const library = item.daily?.library;
  if (!library) return null;
  const text = libraryText(library, locale);
  const ayah = item.daily?.kind === 'ayah';
  return (
    <HadithCard
      variant={hero ? 'hero' : 'regular'}
      arabic={library.arabic}
      transliteration={text.transliteration}
      translation={t('quoted', { text: text.translation })}
      translationTag={text.fallback ? t('english') : undefined}
      italic={locale === 'en' || text.fallback}
      reference={library.reference}
      date={format.date(new Date(item.publishedAt), 'medium')}
      todayLabel={today ? t(ayah ? 'todayAyah' : 'todayHadith') : undefined}
      note={item.daily?.note ? { label: t('noteFromMasjid'), text: item.daily.note } : undefined}
      voice={voice}
      saved={saved}
      onToggleSave={onToggleSave}
      saveLabel={t('save')}
      savedLabel={t('saved')}
      onShare={onShare}
      shareLabel={t('share')}
      onReadFull={onReadFull}
      readFullLabel={t('readFull')}
      art={hero ? <HadithHeroArt /> : undefined}
    />
  );
}

/** The device's Ameen for one request (08 §5.6). */
export interface AmeenState {
  readonly said: boolean;
  /** Confirmed count; `undefined` until known. */
  readonly count: number | undefined;
  readonly onSay: () => void;
}

export interface DuaItemCardProps {
  readonly item: FeedItem;
  readonly now: Date;
  readonly ameen: AmeenState;
  readonly onPress: () => void;
}

/**
 * A9: a dua request — the person only when the family allowed the name (private names never reach the app — 02 §4.2),
 * the attached dua, the janaza row for inteqal, Ameen. `null` for an item without its dua part.
 */
export function DuaItemCard({ item, now, ameen, onPress }: DuaItemCardProps) {
  const { t } = useTranslation('content');
  const { t: tc } = useTranslation();
  const { locale, format } = useLocale();
  const badge = useVoiceBadge(item);
  const dua = item.dua;
  if (!dua) return null;
  const person = duaPerson(item);
  const library = dua.library;
  const text = library ? libraryText(library, locale) : null;
  const when = dua.janazaAt ? janazaWhen(dua.janazaAt, now, format, tc('home.today')) : undefined;
  return (
    <DuaRequestCard
      icon={<ItemIcon item={item} size={56} />}
      tag={{ label: t(`tag.${dua.category}`), tone: DUA_TONE[dua.category] }}
      badge={badge}
      time={format.relative(new Date(item.publishedAt), now)}
      title={t('requestForDua')}
      message={item.body ?? ''}
      person={person?.kind === 'named' ? t('forPerson', { name: person.name }) : person ? t('forPrivate') : undefined}
      dua={
        library && text
          ? {
              arabic: library.arabic,
              transliteration: text.transliteration,
              translation: text.translation,
              translationTag: text.fallback ? t('english') : undefined,
            }
          : undefined
      }
      janaza={
        dua.category === 'inteqal' && when
          ? dua.janazaPlace
            ? t('janaza', { when, place: dua.janazaPlace })
            : t('janazaTime', { when })
          : undefined
      }
      footer={
        <AmeenButton
          said={ameen.said}
          onSay={ameen.onSay}
          label={t('ameen')}
          saidLabel={t('ameenSaid')}
          count={ameen.count === undefined ? undefined : t('ameenCount', { count: ameen.count })}
        />
      }
      onPress={onPress}
    />
  );
}

/**
 * "Voice message · 3:20" for a card whose item has a voice note (F54): the section cards are whole-card buttons and
 * cannot hold a player, so they say there is one; the detail plays it.
 */
function useVoiceBadge(item: FeedItem): { label: string; tone: 'info' } | undefined {
  const { t } = useTranslation();
  const seconds = item.voice?.durationS;
  if (seconds === undefined) return undefined;
  const clock = `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
  return { label: t('ui.voice.badge', { duration: clock }), tone: 'info' };
}

const noop = (): void => undefined;
const NO_AMEEN: AmeenState = { said: false, count: undefined, onSay: noop };

export interface FeedItemCardProps {
  readonly item: FeedItem;
  readonly templates: readonly NoticeTemplate[] | undefined;
  readonly now: Date;
}

/**
 * A freshly published item exactly as its section shows it to a musalli (the admin preview — 07 B5–B7): a notice in
 * Announcements, a hadith / ayah as "Today's" hero in Hadith & Quran, a dua request with nobody's Ameen yet. Buttons
 * do nothing here. `null` for types without a section card yet (later phases).
 */
export function FeedItemCard({ item, templates, now }: FeedItemCardProps) {
  switch (item.type) {
    case 'announcement':
    case 'timing_update':
      return <AnnouncementItemCard item={item} templates={templates} now={now} onPress={noop} />;
    case 'daily_content':
      return (
        <DailyItemCard
          item={item}
          hero
          today={calendarDateInZone(new Date(item.publishedAt)) === calendarDateInZone(now)}
          saved={false}
          onToggleSave={noop}
          onShare={noop}
          onReadFull={noop}
        />
      );
    case 'dua_request':
      return <DuaItemCard item={item} now={now} ameen={NO_AMEEN} onPress={noop} />;
    case 'campaign':
    case 'chanda_update':
    case 'video':
      return null;
  }
}
