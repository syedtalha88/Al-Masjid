import { useLocale, useTranslation } from '@mc/i18n/react';
import { StepHeader } from '@mc/ui/admin';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';

import { CategoryCards } from '../features/dua/components/DuaParts.tsx';
import { setDuaDraft } from '../features/dua/lib/draft-store.ts';
import { draftForCategory } from '../features/dua/lib/dua.ts';

export const Route = createFileRoute('/dua/')({
  component: CategoryDuaScreen,
});

/**
 * B7 step 1 — Category (07 B7, PHASE_03 T3.8): Illness · Inteqal (passed away) · Other as three big cards. A tap starts
 * a new draft (the category's first ready-made message in the admin's language, the name private) and opens step 2.
 */
function CategoryDuaScreen() {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const navigator = useNavigator();
  return (
    <Screen title={t('dua.title')}>
      <div className="flex flex-col gap-6 pb-6">
        <StepHeader step={1} total={4} label={t('notice.step', { n: 1, total: 4 })} title={t('dua.categoryTitle')} />
        <CategoryCards
          onCategory={(category) => {
            setDuaDraft(draftForCategory(category, locale));
            navigator.push('/dua/details');
          }}
        />
      </div>
    </Screen>
  );
}
