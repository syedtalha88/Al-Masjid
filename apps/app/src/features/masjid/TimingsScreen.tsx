// A6 Prayer Timings screen (07 A6): inline bar "Prayer Timings" with the masjid name under it, then the timings content
// (shared with Masjid Detail's tab).
import { useLocale, useTranslation } from '@mc/i18n/react';
import { EmptyState, Skeleton, SkeletonText } from '@mc/ui/components';
import { Screen, useScreen } from '@mc/ui/navigation';

import { useNow } from '../../lib/clock.ts';
import { masjidName } from '../../lib/masjid.ts';
import { TimingsContent } from './components/TimingsContent.tsx';
import { useMasjidDetail } from './hooks/useMasjidDetail.ts';

export function TimingsScreen() {
  // The namespace loads with this chunk; never show raw keys.
  const { ready } = useTranslation('masjid');
  const { params } = useScreen();
  if (!ready) return <div aria-busy className="h-full bg-bg" />;
  return <Timings masjidId={params['masjidId'] ?? ''} />;
}

function Timings({ masjidId }: { readonly masjidId: string }) {
  const { t } = useTranslation('masjid');
  const { t: tc } = useTranslation();
  const { locale } = useLocale();
  const now = useNow();
  const { masjid } = useMasjidDetail(masjidId);
  const bundle = masjid.state === 'active' ? masjid.bundle : null;
  return (
    <Screen title={t('timings')} {...(bundle ? { subtitle: masjidName(bundle.masjid, locale) } : {})}>
      <div className="pt-2 pb-6">
        {bundle ? (
          <TimingsContent bundle={bundle} now={now} />
        ) : masjid.state === 'loading' ? (
          <div aria-busy className="flex flex-col gap-3">
            <Skeleton className="h-11 w-full rounded-full" />
            <SkeletonText lines={6} />
          </div>
        ) : (
          <EmptyState title={masjid.state === 'suspended' ? t('suspended') : tc('appError.title')} />
        )}
      </div>
    </Screen>
  );
}
