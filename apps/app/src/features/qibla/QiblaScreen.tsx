// A14 Qibla (07 A14, DECISIONS #118, PHASE_07 T7.3): full-screen from the Home header. Where from: the phone's location
// ("Use my location", kept on the phone) or the first followed masjid's. The dial turns with the phone where it has a
// compass; without one it stays North-up and the bearing is shown large with a hint. Simple cards for the states:
// location needed, motion permission (iOS), denied. No map, no city list, no calibration (DECISIONS #118). Nothing on
// this page sends the location anywhere.
import { distanceToKaabaKm, qiblaBearing } from '@mc/domain/qibla';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { Button, Card, InfoNote } from '@mc/ui/components';
import { CompassIcon, MapPinIcon } from '@mc/ui/icons';
import { Screen } from '@mc/ui/navigation';
import { memo } from 'react';

import { QiblaDial } from './components/QiblaDial.tsx';
import { useHeading } from './hooks/useHeading.ts';
import { useQiblaLocation } from './hooks/useQiblaLocation.ts';

export function QiblaScreen() {
  const { t } = useTranslation();
  const { locale, format } = useLocale();
  const { source, ask, locateMe } = useQiblaLocation();
  const from = source.kind === 'none' ? null : source.at;
  const bearing = from ? qiblaBearing(from) : null;
  const degrees = bearing === null ? '' : format.number(Math.round(bearing));

  const locationButton = (
    <Button
      variant="outline"
      size="lg"
      fullWidth
      leadingIcon={<MapPinIcon />}
      loading={ask === 'asking'}
      onPress={locateMe}
    >
      {ask === 'asking' ? t('qibla.locating') : t('qibla.useMyLocation')}
    </Button>
  );
  const askProblem = ask === 'denied' ? t('qibla.denied') : ask === 'unavailable' ? t('qibla.unavailable') : null;

  return (
    <Screen title={t('qibla.title')}>
      <div className="flex flex-col gap-5 pt-2 pb-8" data-qibla lang={locale}>
        {from === null || bearing === null ? (
          <Card className="flex flex-col gap-3" data-qibla-need-location>
            <h2 className="type-headline text-text">{t('qibla.needLocationTitle')}</h2>
            <p className="type-body text-text-secondary">{t('qibla.needLocationBody')}</p>
            {askProblem ? (
              <p className="type-callout text-danger" role="alert">
                {askProblem}
              </p>
            ) : null}
            {locationButton}
          </Card>
        ) : (
          <>
            <Compass bearing={bearing} degrees={degrees} />
            <dl className="flex flex-col gap-1 text-center">
              <dt className="sr-only">{t('qibla.title')}</dt>
              <dd className="type-headline text-text" data-qibla-bearing>
                {t('qibla.bearing', { degrees })}
              </dd>
              <dd className="type-callout text-text-secondary" data-qibla-distance>
                {t('qibla.distance', { km: format.number(Math.round(distanceToKaabaKm(from))) })}
              </dd>
            </dl>
            <Card className="flex flex-col gap-3" data-qibla-source>
              <p className="flex items-center gap-2 type-callout text-text-secondary">
                <MapPinIcon size={18} />
                {source.kind === 'device'
                  ? t('qibla.usingDevice')
                  : t('qibla.usingMasjid', { name: source.kind === 'masjid' ? source.name : '' })}
              </p>
              {askProblem ? (
                <p className="type-footnote text-danger" role="alert">
                  {askProblem}
                </p>
              ) : null}
              {source.kind === 'masjid' ? locationButton : null}
            </Card>
          </>
        )}
      </div>
    </Screen>
  );
}

/**
 * The live part — the only component that hears about the heading's state changes (live / no compass / aligned), so an
 * alignment change re-renders the dial and its line, not the page (08 §8: no long task while the phone turns).
 */
const Compass = memo(function Compass({ bearing, degrees }: { readonly bearing: number; readonly degrees: string }) {
  const { t } = useTranslation();
  const { heading, status, aligned, enable } = useHeading(bearing);
  const live = status === 'live';
  return (
    <div className="flex flex-col gap-5" data-qibla-status={status}>
      <QiblaDial
        bearing={bearing}
        heading={live ? heading : null}
        aligned={live && aligned}
        label={t('qibla.dialLabel', { degrees })}
      />
      {/* Both lines stay in the same grid cell; aligning flips visibility (paint, not layout — 08 §8). */}
      <p className="grid text-center type-title2" aria-live="polite" data-qibla-facing>
        <span className={`[grid-area:1/1] text-text ${live && !aligned ? '' : 'invisible'}`}>{t('qibla.turn')}</span>
        <span className={`[grid-area:1/1] text-primary-700 ${live && aligned ? '' : 'invisible'}`}>
          {t('qibla.facing')}
        </span>
      </p>
      {status === 'needs-permission' ? (
        <Card className="flex flex-col gap-3" data-qibla-motion>
          <h2 className="type-headline text-text">{t('qibla.motionTitle')}</h2>
          <p className="type-body text-text-secondary">{t('qibla.motionBody')}</p>
          <Button
            size="lg"
            fullWidth
            leadingIcon={<CompassIcon />}
            onPress={() => {
              void enable();
            }}
          >
            {t('qibla.motionButton')}
          </Button>
        </Card>
      ) : null}
      {status === 'none' || status === 'denied' ? (
        <div className="flex flex-col items-center gap-2 text-center" data-qibla-no-compass>
          <p className="type-large-title text-text" dir="ltr">
            {`${degrees}°`}
          </p>
          <InfoNote icon={<CompassIcon />}>
            {status === 'denied' ? t('qibla.motionDenied') : t('qibla.noCompass', { degrees })}
          </InfoNote>
        </div>
      ) : null}
    </div>
  );
});
