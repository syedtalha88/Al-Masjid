// Blood donation camp cards (07 A22, PHASE_03 T3.17) for Home and Masjid Detail: one per camp that is not over yet. The
// card loads on demand (Home's startup bundle carries only the small check of which camps are on); tapping it opens the
// announcement.
import { useLocale } from '@mc/i18n/react';
import type { BloodCamp } from '@mc/ui/content';
import { useNavigator } from '@mc/ui/navigation';
import { lazy, Suspense } from 'react';

import { masjidName } from '../../../lib/masjid.ts';

const BloodCampCard = lazy(() =>
  import('@mc/ui/content/blood-camp').then((module) => ({ default: module.BloodCampCard })),
);

export function CampCards({
  camps,
  masjids,
}: {
  readonly camps: readonly BloodCamp[];
  /** Masjids by id, to name each camp's masjid (Home); absent on Masjid Detail, where the masjid is known. */
  readonly masjids?: ReadonlyMap<string, Parameters<typeof masjidName>[0]>;
}) {
  const { locale } = useLocale();
  const navigator = useNavigator();
  if (camps.length === 0) return null;
  return (
    <Suspense fallback={null}>
      {camps.map((camp) => {
        const masjid = masjids?.get(camp.item.masjidId);
        return (
          <BloodCampCard
            key={camp.item.publicId}
            camp={camp}
            masjid={masjid ? masjidName(masjid, locale) : undefined}
            onOpen={() => {
              navigator.push(`/items/${camp.item.publicId}`);
            }}
          />
        );
      })}
    </Suspense>
  );
}
