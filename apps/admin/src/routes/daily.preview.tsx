import { useTranslation } from '@mc/i18n/react';
import type { ItemPublished } from '@mc/shared/contracts';
import { StepHeader } from '@mc/ui/admin';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { DailyLost, DailyPreview, PublishedTodayNote } from '../features/daily/components/DailyParts.tsx';
import { dailyPreviewItem, dailyPublishBody } from '../features/daily/lib/daily.ts';
import { setDailyDraft, useDailyDraft } from '../features/daily/lib/draft-store.ts';
import { masjidApi } from '../features/home/api/masjid-api.ts';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { PublishedMoment, PublishStep } from '../features/publish/PublishStep.tsx';

export const Route = createFileRoute('/daily/preview')({
  component: PreviewDailyScreen,
});

/**
 * B6 step 3 — Preview & Publish (07 B6): the post as musallis will see it (the Hadith & Quran "Today's" hero), in each
 * language, then "Notify followers" and Publish. The "already one today" warning again; success as in B5.
 */
function PreviewDailyScreen() {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  const draft = useDailyDraft();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const now = useMinute();
  const [published, setPublished] = useState<ItemPublished | null>(null);

  if (published) {
    return (
      <PublishedMoment
        published={published}
        onDone={() => {
          setDailyDraft(null);
          navigator.selectTab('home');
        }}
      />
    );
  }
  if (!draft) return <DailyLost />;
  return (
    <Screen title={t('daily.title')}>
      <div className="flex flex-col gap-6">
        <StepHeader step={3} total={3} label={t('notice.step', { n: 3, total: 3 })} title={t('notice.previewTitle')} />
        {draft.publishedToday ? <PublishedTodayNote kind={draft.kind} /> : null}
        <DailyPreview item={dailyPreviewItem(draft, masjid?.id ?? '', now)} now={now} />
        <PublishStep
          masjidId={masjid?.id}
          bodyFor={(notify) => dailyPublishBody(draft, notify)}
          send={masjidApi.publishDaily}
          onPublished={setPublished}
        />
      </div>
    </Screen>
  );
}
