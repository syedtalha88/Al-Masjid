import { useTranslation } from '@mc/i18n/react';
import type { AdminLibraryEntry } from '@mc/shared/contracts';
import { StepHeader } from '@mc/ui/admin';
import { EmptyState, SegmentedControl, Skeleton } from '@mc/ui/components';
import { BookOpenIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { LibrarySearchSheet, PublishedTodayNote, SuggestionCard } from '../features/daily/components/DailyParts.tsx';
import { useSuggestion } from '../features/daily/hooks/use-daily.ts';
import { DAILY_KINDS, type DailyKind, draftForEntry } from '../features/daily/lib/daily.ts';
import { setDailyDraft, useDailyDraft } from '../features/daily/lib/draft-store.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';

export const Route = createFileRoute('/daily/')({
  component: ChooseDailyScreen,
});

/**
 * B6 step 1 — Choose (07 B6, PHASE_03 T3.7): Hadith | Ayah, today's suggestion from the verified library (the same all
 * day, not one of the masjid's last 60 days) with "Use this", or "Choose another" in the search sheet. A warning when
 * one of the kind already went out today. Picking an entry starts a new draft and opens step 2.
 */
function ChooseDailyScreen() {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const errorText = useErrorText();
  const draft = useDailyDraft();
  const [kind, setKind] = useState<DailyKind>(draft?.kind ?? 'hadith');
  const [searching, setSearching] = useState(false);
  const suggestion = useSuggestion(masjid?.id, kind);
  const entry = suggestion.data?.entry;

  const choose = (chosen: AdminLibraryEntry) => {
    setDailyDraft(draftForEntry(kind, chosen, suggestion.data?.publishedToday ?? false));
    setSearching(false);
    navigator.push('/daily/note');
  };

  return (
    <Screen title={t('daily.title')}>
      <div className="flex flex-col gap-6 pb-6">
        <StepHeader step={1} total={3} label={t('notice.step', { n: 1, total: 3 })} title={t('daily.chooseTitle')} />
        <SegmentedControl<DailyKind>
          label={t('daily.kinds')}
          segments={DAILY_KINDS.map((id) => ({ id, label: t(`daily.${id}`) }))}
          value={kind}
          onChange={setKind}
        />
        {suggestion.data?.publishedToday ? <PublishedTodayNote kind={kind} /> : null}
        {suggestion.isError ? (
          <EmptyState title={errorText(suggestion.error)} />
        ) : entry ? (
          <SuggestionCard
            entry={entry}
            onUse={() => {
              choose(entry);
            }}
            onChooseAnother={() => {
              setSearching(true);
            }}
          />
        ) : suggestion.data ? (
          <EmptyState
            illustration={<BookOpenIcon size={48} />}
            title={t(kind === 'ayah' ? 'daily.noneAyah' : 'daily.noneHadith')}
            body={t('daily.noneBody')}
          />
        ) : (
          <Skeleton className="h-[360px] w-full rounded-md" />
        )}
      </div>
      <LibrarySearchSheet
        open={searching}
        onClose={() => {
          setSearching(false);
        }}
        masjidId={masjid?.id}
        kind={kind}
        onPick={choose}
      />
    </Screen>
  );
}
