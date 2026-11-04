import { useTranslation } from '@mc/i18n/react';
import type { ItemPublished } from '@mc/shared/contracts';
import { StepHeader } from '@mc/ui/admin';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { DuaLost, DuaPreview } from '../features/dua/components/DuaParts.tsx';
import { setDuaDraft, useDuaDraft } from '../features/dua/lib/draft-store.ts';
import { duaPreviewItem, duaPublishBody } from '../features/dua/lib/dua.ts';
import { masjidApi } from '../features/home/api/masjid-api.ts';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { PublishedMoment, PublishStep } from '../features/publish/PublishStep.tsx';

export const Route = createFileRoute('/dua/preview')({
  component: PreviewDuaScreen,
});

/**
 * B7 step 4 — Preview & Publish (07 B7): the request as musallis will see it in Duas (a private name as "a brother or
 * sister from our community"), in each language, then "Notify followers" and Publish; success as in B5.
 */
function PreviewDuaScreen() {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  const draft = useDuaDraft();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const now = useMinute();
  const [published, setPublished] = useState<ItemPublished | null>(null);

  if (published) {
    return (
      <PublishedMoment
        published={published}
        onDone={() => {
          setDuaDraft(null);
          navigator.selectTab('home');
        }}
      />
    );
  }
  if (!draft) return <DuaLost />;
  return (
    <Screen title={t('dua.title')}>
      <div className="flex flex-col gap-6">
        <StepHeader step={4} total={4} label={t('notice.step', { n: 4, total: 4 })} title={t('notice.previewTitle')} />
        <DuaPreview item={duaPreviewItem(draft, masjid?.id ?? '', now)} now={now} />
        <PublishStep
          masjidId={masjid?.id}
          bodyFor={(notify) => duaPublishBody(draft, notify)}
          send={masjidApi.publishDua}
          onPublished={setPublished}
        />
      </div>
    </Screen>
  );
}
