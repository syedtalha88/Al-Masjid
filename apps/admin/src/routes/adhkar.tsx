import { useTranslation } from '@mc/i18n/react';
import { Button, EmptyState, SkeletonText } from '@mc/ui/components';
import { Screen } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';

import { AdhkarEditor } from '../features/adhkar/components/AdhkarEditor.tsx';
import { useAdhkar } from '../features/adhkar/hooks/use-adhkar.ts';
import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';

export const Route = createFileRoute('/adhkar')({
  component: AdhkarScreen,
});

/** B16 Adhkar after salah (07 B16, PHASE_03 T3.14): what musallis see on Home after each salah. */
function AdhkarScreen() {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const adhkar = useAdhkar(masjid?.id);
  return (
    <Screen title={t('adhkar.title')}>
      {adhkar.isError ? (
        <EmptyState
          title={errorText(adhkar.error)}
          action={
            <Button
              size="lg"
              onPress={() => {
                void adhkar.refetch();
              }}
            >
              {tc('appError.retry')}
            </Button>
          }
        />
      ) : adhkar.data ? (
        <AdhkarEditor masjidId={masjid?.id} masjidName={masjid?.name} saved={adhkar.data} />
      ) : (
        <SkeletonText lines={8} />
      )}
    </Screen>
  );
}
