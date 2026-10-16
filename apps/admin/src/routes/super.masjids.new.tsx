import { useTranslation } from '@mc/i18n/react';
import { useToast } from '@mc/ui/components';
import { useNavigator } from '@mc/ui/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { MasjidForm, type MasjidFormResult } from '../features/super/components/MasjidForm.tsx';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/masjids/new')({
  component: NewMasjid,
});

/** C2 create: the masjid starts as pending; it goes live when activated (needs an admin who accepted the undertaking). */
function NewMasjid() {
  const { t } = useTranslation('super');
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: ({ hijriOffset, ...rest }: MasjidFormResult) =>
      superApi.createMasjid({ ...rest, ...(hijriOffset === null ? {} : { hijriOffset }) }),
    onSuccess: async () => {
      toast.show({ message: t('detail.changed'), tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['super'] });
      navigator.back();
    },
  });
  return (
    <SuperFrame title={t('form.newTitle')} section="masjids">
      <div className="max-w-xl">
        <MasjidForm
          submitLabel={t('form.create')}
          busy={create.isPending}
          error={create.error ? errorText(create.error) : null}
          onSubmit={(values) => {
            create.mutate(values);
          }}
        />
      </div>
    </SuperFrame>
  );
}
