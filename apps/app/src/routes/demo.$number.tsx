import { useTranslation } from '@mc/i18n/react';
import { useScreen } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderScreen } from '../app/PlaceholderScreen.tsx';

export const Route = createFileRoute('/demo/$number')({
  component: DemoScreen,
});

/** Pushable placeholder used to exercise the navigator until real screens exist (PROGRESS F18). */
function DemoScreen() {
  const { t } = useTranslation();
  const raw = Number(useScreen().params['number']);
  const number = Number.isInteger(raw) && raw > 0 && raw < 100 ? raw : 1;
  return <PlaceholderScreen title={t('placeholder.screenTitle', { number })} />;
}
