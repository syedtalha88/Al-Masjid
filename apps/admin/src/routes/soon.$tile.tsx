import { useTranslation } from '@mc/i18n/react';
import { EmptyState } from '@mc/ui/components';
import { Screen, useScreen } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';

import { isTileKey } from '../features/home/tiles.tsx';

export const Route = createFileRoute('/soon/$tile')({
  component: ComingSoon,
});

/** Where a tile leads until its phase lands (T1.10: tiles final, screens "Coming soon"). */
function ComingSoon() {
  const { t } = useTranslation('admin');
  const { params } = useScreen();
  const tile = params['tile'] ?? '';
  const title = isTileKey(tile)
    ? t(`home.tiles.${tile}`)
    : tile === 'superAdmin'
      ? t('home.superAdmin')
      : t('comingSoon.title');
  return (
    <Screen title={title}>
      <EmptyState title={t('comingSoon.title')} body={t('comingSoon.body')} className="mt-12" />
    </Screen>
  );
}
