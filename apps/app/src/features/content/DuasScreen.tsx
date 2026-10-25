// A9 Dua Requests (07 A9, ref-3/3): chips All · Illness · Inteqal · Other; DuaRequestCards (tag + time, "Request for
// Dua", message, the person only when the family allowed the name, the attached dua in its mint box, janaza row for
// inteqal) with Ameen (once per device, 08 §5.6); requests older than 30 days in a collapsible "Older" section.
import { calendarDateInZone, wallClockInZone } from '@mc/domain/time';
import type { Formatters } from '@mc/i18n/format';
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { FeedItem } from '@mc/shared/contracts/public';
import { MosqueIllustration } from '@mc/ui';
import { AmeenButton, ChipGroup, DuaRequestCard, type Tone } from '@mc/ui/components';
import { CaretDownIcon } from '@mc/ui/icons';
import { Pressable } from '@mc/ui/motion';
import { useNavigator, useScreen } from '@mc/ui/navigation';
import { memo, useId, useMemo, useState } from 'react';

import { useNow } from '../../lib/clock.ts';
import { ContentGate } from './components/ContentGate.tsx';
import { SectionFrame } from './components/SectionFrame.tsx';
import { type AmeenApi, useAmeen } from './hooks/useAmeen.ts';
import { useSection } from './hooks/useSection.ts';
import { ItemIcon } from './ItemIcon.tsx';
import { DUA_FILTERS, type DuaFilter, duaPerson, filterDuas, libraryText, splitArchived } from './lib/content-view.ts';

export const DUA_TAG_TONE: Readonly<Record<'illness' | 'inteqal' | 'other', Tone>> = {
  illness: 'rose',
  inteqal: 'slate',
  other: 'primary',
};

/** "Today, 5:30 PM" / "Sat, 26 Sep, 5:30 PM" (IST) — when the janaza prayer is. */
export function janazaWhen(at: string, now: Date, format: Formatters, today: string): string {
  const date = new Date(at);
  const time = format.time(wallClockInZone(date)).text;
  return calendarDateInZone(date) === calendarDateInZone(now)
    ? `${today}, ${time}`
    : `${format.date(date, 'weekday')}, ${time}`;
}

export function DuasScreen() {
  const { params } = useScreen();
  return (
    <ContentGate>
      <Duas masjidId={params['masjidId'] ?? ''} />
    </ContentGate>
  );
}

function Duas({ masjidId }: { readonly masjidId: string }) {
  const { t } = useTranslation('content');
  const section = useSection(masjidId, 'dua_request');
  const [filter, setFilter] = useState<DuaFilter>('all');
  const [showOlder, setShowOlder] = useState(false);
  const olderId = useId();
  const now = useNow();
  const items = useMemo(() => filterDuas(section.timeline.items, filter), [section.timeline.items, filter]);
  const { current, older } = useMemo(() => splitArchived(items, now), [items, now]);
  const ids = useMemo(() => items.map((item) => item.publicId), [items]);
  const ameen = useAmeen(ids);
  return (
    <SectionFrame
      title={t('duaRequests')}
      subtitle={section.name}
      timeline={section.timeline}
      unavailable={section.unavailable}
      illustration={<MosqueIllustration width={160} />}
      emptyTitle={t('emptyDuas')}
      emptyBody={t('emptyDuasBody')}
      filteredEmpty={items.length === 0}
      header={
        <ChipGroup
          className="mx-bleed"
          label={t('filters')}
          chips={DUA_FILTERS.map((id) => ({ id, label: t(`chip.${id}`) }))}
          value={filter}
          onChange={setFilter}
        />
      }
    >
      <ul className="flex flex-col gap-3">
        {current.map((item) => (
          <li key={item.publicId}>
            <DuaRow item={item} now={now} ameen={ameen} />
          </li>
        ))}
      </ul>
      {older.length > 0 ? (
        <section className="flex flex-col gap-3 pt-2">
          <Pressable
            aria-expanded={showOlder}
            aria-controls={olderId}
            onPress={() => {
              setShowOlder((open) => !open);
            }}
            className="flex min-h-11 items-center justify-between rounded-md px-1 text-start"
          >
            <span className="flex flex-col">
              <span className="type-subhead-strong text-text">{t('older', { count: older.length })}</span>
              <span className="type-caption text-text-secondary">{t('olderHint')}</span>
            </span>
            <CaretDownIcon className={`text-text-tertiary transition-state ${showOlder ? 'rotate-180' : ''}`} />
          </Pressable>
          <ul id={olderId} hidden={!showOlder} className="flex flex-col gap-3">
            {older.map((item) => (
              <li key={item.publicId}>
                <DuaRow item={item} now={now} ameen={ameen} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </SectionFrame>
  );
}

/** One request — memoised: it re-renders when its own Ameen state or the clock changes. */
export const DuaRow = memo(function DuaRow({
  item,
  now,
  ameen,
}: {
  readonly item: FeedItem;
  readonly now: Date;
  readonly ameen: AmeenApi;
}) {
  const { t } = useTranslation('content');
  const { t: tc } = useTranslation();
  const { locale, format } = useLocale();
  const navigator = useNavigator();
  const dua = item.dua;
  if (!dua) return null;
  const person = duaPerson(item);
  const library = dua.library;
  const text = library ? libraryText(library, locale) : null;
  const count = ameen.count(item.publicId);
  const when = dua.janazaAt ? janazaWhen(dua.janazaAt, now, format, tc('home.today')) : undefined;
  return (
    <DuaRequestCard
      icon={<ItemIcon item={item} size={56} />}
      tag={{ label: t(`tag.${dua.category}`), tone: DUA_TAG_TONE[dua.category] }}
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
          said={ameen.said(item.publicId)}
          onSay={() => {
            ameen.say(item.publicId);
          }}
          label={t('ameen')}
          saidLabel={t('ameenSaid')}
          count={count === undefined ? undefined : t('ameenCount', { count })}
        />
      }
      onPress={() => {
        navigator.push(`/items/${item.publicId}`);
      }}
    />
  );
});
