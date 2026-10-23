import { useTranslation } from '@mc/i18n/react';
import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderScreen } from '../app/PlaceholderScreen.tsx';

export const Route = createFileRoute('/items/$publicId')({
  component: ItemDetail,
});

/** In-app item detail (`/items/:publicId`, 07 Navigation map) — placeholder until T2.11. */
function ItemDetail() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t('home.updates')} />;
}
