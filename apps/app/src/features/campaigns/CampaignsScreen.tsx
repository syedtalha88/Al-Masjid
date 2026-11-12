// A10 Donation Campaigns list (07 A10, ref-3/4): one masjid's campaigns as CampaignCards — active, then completed, then
// closed (closed ones for 30 days after their end, 00 §4.3) — newest first inside each. Tap → the campaign detail.
import { calendarDateInZone } from '@mc/domain/time';
import { useTranslation } from '@mc/i18n/react';
import { MosqueIllustration } from '@mc/ui';
import { EmptyState } from '@mc/ui/components';
import { CampaignItemCard, campaignsForList } from '@mc/ui/content';
import { useNavigator, useScreen } from '@mc/ui/navigation';
import { useMemo } from 'react';

import { useNow } from '../../lib/clock.ts';
import { mediaUrl } from '../../lib/media.ts';
import { ContentGate } from '../content/components/ContentGate.tsx';
import { SectionFrame } from '../content/components/SectionFrame.tsx';
import { useSection } from '../content/hooks/useSection.ts';

/** Cover width requested from the media CDN (cards are at most ~560 px wide; 2× density). */
const COVER_WIDTH = 960;

export function CampaignsScreen() {
  const { params } = useScreen();
  return (
    <ContentGate>
      <Campaigns masjidId={params['masjidId'] ?? ''} />
    </ContentGate>
  );
}

function Campaigns({ masjidId }: { readonly masjidId: string }) {
  const { t } = useTranslation('content');
  const navigator = useNavigator();
  const section = useSection(masjidId, 'campaign');
  const today = calendarDateInZone(useNow());
  const items = useMemo(() => campaignsForList(section.timeline.items, today), [section.timeline.items, today]);
  const hiddenOnly = items.length === 0 && !section.timeline.hasMore;
  return (
    <SectionFrame
      title={t('campaign.title')}
      subtitle={section.name}
      timeline={section.timeline}
      unavailable={section.unavailable}
      illustration={<MosqueIllustration width={160} />}
      emptyTitle={t('campaign.empty')}
      emptyBody={t('campaign.emptyBody')}
      filteredEmpty={false}
    >
      {hiddenOnly ? (
        // Only campaigns closed more than 30 days ago: the same empty state as none at all.
        <EmptyState
          className="pt-8"
          illustration={<MosqueIllustration width={160} />}
          title={t('campaign.empty')}
          body={t('campaign.emptyBody')}
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.publicId}>
              <CampaignItemCard
                item={item}
                today={today}
                coverSrc={item.campaign?.cover ? mediaUrl(item.campaign.cover.key, COVER_WIDTH) : null}
                onPress={() => {
                  navigator.push(`/items/${item.publicId}`);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </SectionFrame>
  );
}
