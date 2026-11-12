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

import { QiblaDial } from './components/QiblaDial.tsx';
import { useHeading } from './hooks/useHeading.ts';
import { useQiblaLocation } from './hooks/useQiblaLocation.ts';

export function QiblaScreen() {
  const { t } = useTranslation();
  const { locale, format } = useLocale();
  const { source, ask, locateMe } = useQiblaLocation();
  const from = source.kind === 'none' ? null : source.at;
  const bearing = from ? qiblaBearing(from) : null;
  const { heading, status, aligned, enable } = useHeading(bearing);
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
      <div className="flex flex-col gap-5 pt-2 pb-8" data-qibla data-qibla-status={status} lang={locale}>
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
            <QiblaDial
              bearing={bearing}
              heading={status === 'live' ? heading : null}
              aligned={status === 'live' && aligned}
              label={t('qibla.dialLabel', { degrees })}
            />
            <p
              className={`text-center type-title2 ${status === 'live' && aligned ? 'text-primary-700' : 'text-text'}`}
              aria-live="polite"
              data-qibla-facing
            >
              {status === 'live' ? (aligned ? t('qibla.facing') : t('qibla.turn')) : null}
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
