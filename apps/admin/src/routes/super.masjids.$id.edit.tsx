import { useTranslation } from '@mc/i18n/react';
import type { SuperMasjidDetail, SuperMasjidPatch } from '@mc/shared/contracts';
import { SkeletonText, useToast } from '@mc/ui/components';
import { useNavigator, useScreen } from '@mc/ui/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { MasjidForm, type MasjidFormResult } from '../features/super/components/MasjidForm.tsx';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/masjids/$id/edit')({
  component: EditMasjid,
});

/** Only the fields that changed are sent (the audit entry lists them; nothing changed → nothing sent). */
function changes(before: SuperMasjidDetail['masjid'], after: MasjidFormResult): SuperMasjidPatch {
  const names = (n: SuperMasjidDetail['masjid']['nameI18n']) => JSON.stringify([n.hi ?? '', n.ur ?? '', n.te ?? '']);
  return {
    ...(after.name === before.name ? {} : { name: after.name }),
    ...(after.nameI18n && names(after.nameI18n) !== names(before.nameI18n) ? { nameI18n: after.nameI18n } : {}),
    ...(after.area === before.area ? {} : { area: after.area }),
    ...(after.city === before.city ? {} : { city: after.city }),
    ...(after.state === before.state ? {} : { state: after.state }),
    ...(after.address === before.address ? {} : { address: after.address }),
    ...(after.lat === before.lat ? {} : { lat: after.lat }),
    ...(after.lng === before.lng ? {} : { lng: after.lng }),
    ...(after.calcMethod === before.calcMethod ? {} : { calcMethod: after.calcMethod }),
    ...(after.asrMadhab === before.asrMadhab ? {} : { asrMadhab: after.asrMadhab }),
    ...(after.hijriOffset === (before.hijriOffset ?? null) ? {} : { hijriOffset: after.hijriOffset }),
  };
}

/** C2 edit: same form as create; status, follow code and counters are never edited here (04 §5). */
function EditMasjid() {
  const { t } = useTranslation('super');
  const { params } = useScreen();
  const masjidId = params['id'] ?? '';
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['super', 'masjid', masjidId],
    queryFn: ({ signal }) => superApi.masjid(masjidId, signal),
  });
  const save = useMutation({
    mutationFn: (patch: SuperMasjidPatch) =>
      Object.keys(patch).length === 0 ? Promise.resolve(null) : superApi.updateMasjid(masjidId, patch),
    onSuccess: async () => {
      toast.show({ message: t('detail.changed'), tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['super'] });
      navigator.back();
    },
  });
  const before = detail.data?.masjid;
  return (
    <SuperFrame title={t('form.editTitle')} section="masjids">
      <div className="max-w-xl">
        {before ? (
          <MasjidForm
            initial={before}
            submitLabel={t('form.save')}
            busy={save.isPending}
            error={save.error ? errorText(save.error) : detail.error ? errorText(detail.error) : null}
            onSubmit={(values) => {
              save.mutate(changes(before, values));
            }}
          />
        ) : (
          <SkeletonText lines={8} />
        )}
      </div>
    </SuperFrame>
  );
}
