import { useTranslation } from '@mc/i18n/react';
import { EmptyState, SkeletonText } from '@mc/ui/components';
import { BLOOD_CAMP_TEMPLATE } from '@mc/ui/content';
import { DropIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { useNoticeTemplates } from '../features/notice/hooks/use-notice.ts';
import { setNoticeDraft } from '../features/notice/lib/draft-store.ts';
import { draftForTemplate } from '../features/notice/lib/notice.ts';

export const Route = createFileRoute('/blood-camp')({
  component: BloodCampScreen,
});

/**
 * B18 Blood donation camp (07 B18, PHASE_03 T3.17): the Admin Home tile opens B5 straight at step 2 with the
 * `blood_donation_camp` template — date, time range, place, contact number — then the preview and Publish (notify on by
 * default). When the Super Admin has not switched the template on, it says so.
 */
function BloodCampScreen() {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const templates = useNoticeTemplates(masjid?.id);
  const template = templates.data?.templates.find((entry) => entry.key === BLOOD_CAMP_TEMPLATE);

  useEffect(() => {
    if (!template) return;
    setNoticeDraft(draftForTemplate(template));
    navigator.replace('/notice/fill');
  }, [template, navigator]);

  return (
    <Screen title={t('notice.title')}>
      {templates.isError ? (
        <EmptyState className="mt-8" title={errorText(templates.error)} />
      ) : templates.data && !template ? (
        <EmptyState
          className="mt-8"
          illustration={<DropIcon size={48} />}
          title={t('bloodCamp.unavailableTitle')}
          body={t('bloodCamp.unavailableBody')}
        />
      ) : (
        <div aria-busy className="py-4">
          <SkeletonText lines={6} />
        </div>
      )}
    </Screen>
  );
}
