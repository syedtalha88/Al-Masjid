import { useTranslation } from '@mc/i18n/react';
import { Screen, useNavigator, useScreen } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';

import { FollowLanding } from '../features/follow/FollowLanding.tsx';

export const Route = createFileRoute('/m/$code')({
  component: FollowLandingScreen,
});

/** A16 `/m/:code` follow landing inside the app; following opens Masjid Detail in its place. */
function FollowLandingScreen() {
  const { t } = useTranslation('follow');
  const navigator = useNavigator();
  const { params } = useScreen();
  return (
    <Screen title={t('landing.title')}>
      <FollowLanding
        code={params['code'] ?? ''}
        onOpen={(masjidId) => {
          navigator.replace(`/masjid/${masjidId}`);
        }}
        onManage={() => {
          navigator.selectTab('masjids');
        }}
        onScan={() => {
          navigator.presentModal('/scan');
        }}
      />
    </Screen>
  );
}
