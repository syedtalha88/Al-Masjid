// A12 Bayans (07 A12, DECISIONS #39, PHASE_06 T6.3): a masjid's bayans newest first — our own thumbnail copy with a play
// glyph, title, speaker · date, "YouTube". The audience is filtered by the server (a brothers device never receives a
// sisters-only bayan). Tap → the player (item detail). Nothing here contacts YouTube.
import { useTranslation } from '@mc/i18n/react';
import type { FeedItem } from '@mc/shared/contracts/public';
import { MosqueIllustration } from '@mc/ui';
import { VideoCard } from '@mc/ui/content';
import { useNavigator, useScreen } from '@mc/ui/navigation';
import { memo } from 'react';

import { mediaUrl } from '../../lib/media.ts';
import { ContentGate } from './components/ContentGate.tsx';
import { SectionFrame } from './components/SectionFrame.tsx';
import { useSection } from './hooks/useSection.ts';

export function BayansScreen() {
  const { params } = useScreen();
  return (
    <ContentGate>
      <Bayans masjidId={params['masjidId'] ?? ''} />
    </ContentGate>
  );
}

function Bayans({ masjidId }: { readonly masjidId: string }) {
  const { t } = useTranslation('content');
  const section = useSection(masjidId, 'video');
  const items = section.timeline.items;
  return (
    <SectionFrame
      title={t('bayans')}
      subtitle={section.name}
      timeline={section.timeline}
      unavailable={section.unavailable}
      illustration={<MosqueIllustration width={160} />}
      emptyTitle={t('emptyBayans')}
      emptyBody={t('emptyBayansBody')}
      filteredEmpty={false}
    >
      <ul className="flex flex-col gap-5" data-bayans>
        {items.map((item) => (
          <li key={item.publicId}>
            <BayanRow item={item} />
          </li>
        ))}
      </ul>
    </SectionFrame>
  );
}

/** One card — memoised so other rows and the clock do not re-render it. */
export const BayanRow = memo(function BayanRow({ item }: { readonly item: FeedItem }) {
  const navigator = useNavigator();
  const thumb = item.video?.thumb;
  return (
    <VideoCard
      item={item}
      thumbSrc={thumb ? mediaUrl(thumb.key, 960) : null}
      onPress={() => {
        navigator.push(`/items/${item.publicId}`);
      }}
    />
  );
});
