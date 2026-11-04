import { useLocale, useTranslation } from '@mc/i18n/react';
import { StepHeader } from '@mc/ui/admin';
import { EmptyState, Skeleton, SkeletonGroup } from '@mc/ui/components';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { TemplateGrid } from '../features/notice/components/NoticeParts.tsx';
import { useNoticeTemplates } from '../features/notice/hooks/use-notice.ts';
import { setNoticeDraft } from '../features/notice/lib/draft-store.ts';
import { draftForTemplate, draftForText } from '../features/notice/lib/notice.ts';

export const Route = createFileRoute('/notice/')({
  component: ChooseNoticeScreen,
});

/**
 * B5 step 1 — Choose (07 B5, PHASE_03 T3.6): the masjid's ready notices as icon tiles in the admin's language, and
 * "Write your own". A tap starts a new draft and opens step 2.
 */
function ChooseNoticeScreen() {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const navigator = useNavigator();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const templates = useNoticeTemplates(masjid?.id);
  const errorText = useErrorText();

  const fill = () => {
    navigator.push('/notice/fill');
  };

  return (
    <Screen title={t('notice.title')}>
      <div className="flex flex-col gap-6 pb-6">
        <StepHeader step={1} total={3} label={t('notice.step', { n: 1, total: 3 })} title={t('notice.chooseTitle')} />
        {templates.isError ? (
          <EmptyState className="mt-4" title={errorText(templates.error)} />
        ) : templates.data ? (
          <>
            {templates.data.templates.length === 0 ? (
              <EmptyState title={t('notice.noTemplatesTitle')} body={t('notice.noTemplatesBody')} />
            ) : null}
            <TemplateGrid
              templates={templates.data.templates}
              onTemplate={(template) => {
                setNoticeDraft(draftForTemplate(template));
                fill();
              }}
              onWriteOwn={() => {
                setNoticeDraft(draftForText(locale));
                fill();
              }}
            />
          </>
        ) : (
          <SkeletonGroup className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-[132px] w-full rounded-lg" />
            ))}
          </SkeletonGroup>
        )}
      </div>
    </Screen>
  );
}
