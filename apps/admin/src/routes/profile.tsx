import { useTranslation } from '@mc/i18n/react';
import { Button, EmptyState, ListRow, SkeletonText } from '@mc/ui/components';
import { UserCircleIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { ContactsSection } from '../features/contacts/components/ContactsSection.tsx';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { PaymentSection } from '../features/payment/components/PaymentSection.tsx';
import { HijriSection, NamesSection, PhotoSection } from '../features/profile/components/ProfileParts.tsx';
import { useProfile } from '../features/profile/hooks/use-profile.ts';

export const Route = createFileRoute('/profile')({
  component: ProfileScreen,
});

/**
 * B13 Masjid Profile, partial (07 B13, PHASE_03 T3.10): the photo (change), the names in four scripts and the place
 * (view; "Request a change" goes to the Super Admin), the Hijri adjustment with today's Hijri date, the Ilm contacts (B17,
 * T3.16) and My account.
 * Payment and Chanda arrive with Phase 5.
 */
function ProfileScreen() {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const navigator = useNavigator();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const profile = useProfile(masjid?.id);
  const now = useMinute();

  return (
    <Screen title={t('profile.title')}>
      <div className="flex flex-col gap-8 pb-8">
        {profile.isError ? (
          <EmptyState
            title={errorText(profile.error)}
            action={
              <Button
                size="lg"
                onPress={() => {
                  void profile.refetch();
                }}
              >
                {tc('appError.retry')}
              </Button>
            }
          />
        ) : profile.data ? (
          <>
            <PhotoSection masjidId={masjid?.id} profile={profile.data} />
            <NamesSection masjidId={masjid?.id} profile={profile.data} />
            <HijriSection masjidId={masjid?.id} profile={profile.data} now={now} />
            <PaymentSection masjidId={masjid?.id} />
            <ContactsSection masjidId={masjid?.id} />
          </>
        ) : (
          <SkeletonText lines={10} />
        )}
        <ListRow
          className="rounded-md bg-surface px-4 shadow-e1"
          leading={<UserCircleIcon size={28} />}
          title={t('profile.account')}
          subtitle={t('profile.accountHint')}
          chevron
          onPress={() => {
            navigator.push('/account');
          }}
        />
      </div>
    </Screen>
  );
}
