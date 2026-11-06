// A21 Ilm — "Ask the masjid" (07 A21, DECISIONS #104): the people the masjid lists for Islamic questions and advice,
// only those for this device's Brother/Sister choice. Each row opens a WhatsApp chat with "Assalamu alaikum" in the app
// language; the number is never shown. The contacts come with the masjid's bundle, so the list works offline (opening
// WhatsApp needs it installed or a connection).
import { useLocale, useTranslation } from '@mc/i18n/react';
import { MosqueIllustration } from '@mc/ui';
import { Button, EmptyState, Skeleton, SkeletonGroup, SkeletonText } from '@mc/ui/components';
import { IlmContactCard } from '@mc/ui/content';
import { Screen, useNavigator, useScreen } from '@mc/ui/navigation';

import { masjidName } from '../../lib/masjid.ts';
import { useMasjidDetail } from '../masjid/hooks/useMasjidDetail.ts';
import { contactsFor } from '../masjid/lib/detail-view.ts';
import { ContentGate } from './components/ContentGate.tsx';

export function IlmScreen() {
  const { params } = useScreen();
  return (
    <ContentGate>
      <IlmList masjidId={params['masjidId'] ?? ''} />
    </ContentGate>
  );
}

function IlmList({ masjidId }: { readonly masjidId: string }) {
  const { t } = useTranslation('content');
  const { t: tm } = useTranslation('masjid');
  const { locale } = useLocale();
  const navigator = useNavigator();
  const { masjid, audience } = useMasjidDetail(masjidId);
  const contacts = masjid.state === 'active' ? contactsFor(masjid.bundle, audience) : [];
  const back = (
    <Button
      variant="outline"
      onPress={() => {
        navigator.back();
      }}
    >
      {t('back')}
    </Button>
  );

  const body = (() => {
    if (masjid.state === 'loading') {
      return (
        <SkeletonGroup className="flex flex-col gap-4">
          {[0, 1].map((row) => (
            <span key={row} className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-e1">
              <span className="flex items-center gap-3">
                <Skeleton className="size-11 rounded-full" />
                <SkeletonText lines={2} className="flex-1" />
              </span>
              <Skeleton className="h-12 w-full rounded-full" />
            </span>
          ))}
        </SkeletonGroup>
      );
    }
    if (masjid.state === 'suspended' || masjid.state === 'gone') {
      return <EmptyState className="pt-8" title={tm(masjid.state)} action={back} />;
    }
    if (masjid.state === 'failed' || contacts.length === 0) {
      return (
        <EmptyState
          className="pt-8"
          illustration={<MosqueIllustration width={160} />}
          title={t('emptyIlm')}
          body={t('emptyIlmBody')}
          action={back}
        />
      );
    }
    return (
      <>
        <p className="type-callout text-text-secondary">{t('ilmIntro')}</p>
        <ul className="flex flex-col gap-4">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <IlmContactCard contact={contact} />
            </li>
          ))}
        </ul>
      </>
    );
  })();

  return (
    <Screen
      title={t('ilmTitle')}
      {...(masjid.state === 'active' ? { subtitle: masjidName(masjid.bundle.masjid, locale) } : {})}
    >
      <div className="flex flex-col gap-4 pt-2 pb-6" data-ilm-list>
        {body}
      </div>
    </Screen>
  );
}
