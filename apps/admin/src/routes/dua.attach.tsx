import { useTranslation } from '@mc/i18n/react';
import { StepHeader } from '@mc/ui/admin';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';

import { useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { DuaChoices, DuaLost } from '../features/dua/components/DuaParts.tsx';
import { setDuaDraft, useDuaDraft } from '../features/dua/lib/draft-store.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';

export const Route = createFileRoute('/dua/attach')({
  component: AttachDuaScreen,
});

/**
 * B7 step 3 — Attach dua (07 B7): the verified duas of the request's category (Arabic, the translation in the admin's
 * language, the reference). A tap attaches one and opens the preview.
 */
function AttachDuaScreen() {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const draft = useDuaDraft();
  if (!draft) return <DuaLost />;
  return (
    <Screen title={t('dua.title')}>
      <div className="flex flex-col gap-6 pb-6">
        <StepHeader step={3} total={4} label={t('notice.step', { n: 3, total: 4 })} title={t('dua.attachTitle')} />
        <p className="type-callout text-text-secondary">{t('dua.attachHint')}</p>
        <DuaChoices
          masjidId={masjid?.id}
          category={draft.category}
          chosen={draft.entry?.id ?? null}
          onPick={(entry) => {
            setDuaDraft({ ...draft, entry });
            navigator.push('/dua/preview');
          }}
        />
      </div>
    </Screen>
  );
}
