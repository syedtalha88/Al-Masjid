// A9 Dua Requests (07 A9, ref-3/3): chips All · Illness · Inteqal · Other; DuaRequestCards (tag + time, "Request for
// Dua", message, the person only when the family allowed the name, the attached dua in its mint box, janaza row for
// inteqal) with Ameen (once per device, 08 §5.6); requests older than 30 days in a collapsible "Older" section.
import { useTranslation } from '@mc/i18n/react';
import type { FeedItem } from '@mc/shared/contracts/public';
import { MosqueIllustration } from '@mc/ui';
import { ChipGroup } from '@mc/ui/components';
import { DUA_FILTERS, type DuaFilter, DuaItemCard, filterDuas, splitArchived } from '@mc/ui/content';
import { CaretDownIcon } from '@mc/ui/icons';
import { Pressable } from '@mc/ui/motion';
import { useNavigator, useScreen } from '@mc/ui/navigation';
import { memo, useId, useMemo, useState } from 'react';

import { useNow } from '../../lib/clock.ts';
import { ContentGate } from './components/ContentGate.tsx';
import { SectionFrame } from './components/SectionFrame.tsx';
import { type AmeenApi, useAmeen } from './hooks/useAmeen.ts';
import { useSection } from './hooks/useSection.ts';

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

/**
 * One request (`@mc/ui/content`, the same as the admin preview) — memoised: it re-renders when its own Ameen state or
 * the clock changes.
 */
export const DuaRow = memo(function DuaRow({
  item,
  now,
  ameen,
}: {
  readonly item: FeedItem;
  readonly now: Date;
  readonly ameen: AmeenApi;
}) {
  const navigator = useNavigator();
  return (
    <DuaItemCard
      item={item}
      now={now}
      ameen={{
        said: ameen.said(item.publicId),
        count: ameen.count(item.publicId),
        onSay: () => {
          ameen.say(item.publicId);
        },
      }}
      onPress={() => {
        navigator.push(`/items/${item.publicId}`);
      }}
    />
  );
});
