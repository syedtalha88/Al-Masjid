// A20 Adhkar after salah (07 A20): the masjid's ordered `dhikr` entries — Arabic (Amiri, never mirrored; the reader's
// A−/A+ size), transliteration (the reader's switch, A8), translation, reference, source — each with its repeat count
// and a large tap counter: a haptic tick per tap, a success pattern at the count. Counts live in memory on this phone
// only and reset when the app restarts (07 A20 "resets per session"). Text only from the verified Content Library
// (CLAUDE.md §2.3); the set comes with the masjid's bundle, so it works offline.
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { LibraryEntry } from '@mc/shared/contracts/public';
import { MosqueIllustration } from '@mc/ui';
import {
  ArabicText,
  Button,
  Card,
  EmptyState,
  Skeleton,
  SkeletonGroup,
  SkeletonText,
  Switch,
  Tag,
} from '@mc/ui/components';
import { libraryText } from '@mc/ui/content';
import { RefreshIcon } from '@mc/ui/icons';
import { DigitRoll, haptic, Pressable } from '@mc/ui/motion';
import { Screen, useNavigator, useScreen } from '@mc/ui/navigation';
import { memo, useState } from 'react';

import { useAppData, useDeviceSelector } from '../../lib/data.tsx';
import { masjidName } from '../../lib/masjid.ts';
import { useMasjidDetail } from '../masjid/hooks/useMasjidDetail.ts';
import { ContentGate } from './components/ContentGate.tsx';

/** Taps per entry id for this app session (07 A20) — never stored, never sent. */
const sessionCounts = new Map<string, number>();

export function AdhkarScreen() {
  const { params } = useScreen();
  return (
    <ContentGate>
      <AdhkarList masjidId={params['masjidId'] ?? ''} />
    </ContentGate>
  );
}

function AdhkarList({ masjidId }: { readonly masjidId: string }) {
  const { t } = useTranslation('content');
  const { t: tm } = useTranslation('masjid');
  const { locale } = useLocale();
  const navigator = useNavigator();
  const { store } = useAppData();
  const showTransliteration = useDeviceSelector((state) => state.settings.transliteration);
  const scale = useDeviceSelector((state) => state.settings.arabicScale);
  const { masjid } = useMasjidDetail(masjidId);
  const entries = masjid.state === 'active' ? (masjid.bundle.adhkar?.entries ?? []) : [];
  const anyTransliteration = entries.some((entry) => libraryText(entry, locale).transliteration !== undefined);
  const back = (
    <Button
      variant="outline"
      onPress={() => {
        navigator.back();
      }}
    >
      {t('back')}
    </Button>
  );

  const body = (() => {
    if (masjid.state === 'loading') {
      return (
        <SkeletonGroup className="flex flex-col gap-4">
          {[0, 1].map((row) => (
            <span key={row} className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-e1">
              <Skeleton className="h-10 w-full rounded-xs" />
              <SkeletonText lines={2} />
            </span>
          ))}
        </SkeletonGroup>
      );
    }
    if (masjid.state === 'suspended' || masjid.state === 'gone') {
      return <EmptyState className="pt-8" title={tm(masjid.state)} action={back} />;
    }
    if (masjid.state === 'failed' || entries.length === 0) {
      return (
        <EmptyState
          className="pt-8"
          illustration={<MosqueIllustration width={160} />}
          title={t('emptyAdhkar')}
          body={t('emptyAdhkarBody')}
          action={back}
        />
      );
    }
    return (
      <>
        {anyTransliteration ? (
          <Switch
            checked={showTransliteration}
            label={t('transliteration')}
            onChange={(checked) => {
              void store.update((current) => ({
                ...current,
                settings: { ...current.settings, transliteration: checked },
              }));
            }}
          />
        ) : null}
        <ol className="flex flex-col gap-4">
          {entries.map((entry) => (
            <li key={entry.id}>
              <DhikrCard entry={entry} showTransliteration={showTransliteration} scale={scale} />
            </li>
          ))}
        </ol>
      </>
    );
  })();

  return (
    <Screen
      title={t('adhkarTitle')}
      {...(masjid.state === 'active' ? { subtitle: masjidName(masjid.bundle.masjid, locale) } : {})}
    >
      <div className="flex flex-col gap-4 pt-2 pb-6" data-adhkar-list>
        {body}
      </div>
    </Screen>
  );
}

/** One dhikr with its counter — memoised (the clock tick and other cards' taps must not re-render it). */
const DhikrCard = memo(function DhikrCard({
  entry,
  showTransliteration,
  scale,
}: {
  readonly entry: LibraryEntry;
  readonly showTransliteration: boolean;
  readonly scale: number;
}) {
  const { t } = useTranslation('content');
  const { locale, format } = useLocale();
  const text = libraryText(entry, locale);
  const total = entry.repeat ?? 1;
  const [count, setCount] = useState(() => sessionCounts.get(entry.id) ?? 0);
  const done = count >= total;
  const set = (next: number) => {
    sessionCounts.set(entry.id, next);
    setCount(next);
  };
  return (
    <Card className="flex flex-col gap-4 text-center" data-dhikr>
      <ArabicText variant="hero" scale={scale}>
        {entry.arabic}
      </ArabicText>
      {showTransliteration && text.transliteration ? (
        <p dir="auto" className="type-callout text-text-secondary">
          {text.transliteration}
        </p>
      ) : null}
      <p className={`type-body text-text ${locale === 'en' || text.fallback ? 'italic' : ''}`}>
        {t('quoted', { text: text.translation })}
        {text.fallback ? (
          <Tag tone="neutral" className="ms-2 align-middle not-italic">
            {t('english')}
          </Tag>
        ) : null}
      </p>
      <p className="type-footnote text-text-secondary">
        <bdi>{entry.reference}</bdi>
      </p>
      <div className="flex flex-col items-center gap-2">
        <span className="type-caption text-text-secondary">{t('repeat', { count: total })}</span>
        <Pressable
          kind="fab"
          aria-label={
            done
              ? t('counterDone', { total: format.number(total) })
              : t('counter', { count: format.number(count), total: format.number(total) })
          }
          aria-disabled={done}
          data-done={done ? '' : undefined}
          className={`flex size-24 flex-col items-center justify-center rounded-full shadow-e2 ${
            done ? 'bg-primary-700 text-on-primary' : 'bg-mint-50 text-primary-900'
          }`}
          onPress={() => {
            if (done) return;
            const next = count + 1;
            haptic(next >= total ? 'success' : 'selection');
            set(next);
          }}
        >
          <span aria-hidden className="type-title1 tabular-nums">
            <DigitRoll text={format.number(count)} />
          </span>
          <span aria-hidden className="type-caption">
            / {format.number(total)}
          </span>
        </Pressable>
        {count > 0 ? (
          <Button
            variant="ghost"
            leadingIcon={<RefreshIcon />}
            onPress={() => {
              set(0);
            }}
          >
            {t('resetCount')}
          </Button>
        ) : null}
      </div>
      <p className="type-caption text-text-tertiary">
        {t('source', { name: entry.sourceName })} · {t('license', { license: entry.sourceLicense })}
      </p>
    </Card>
  );
});
