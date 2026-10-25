// A16 `/p/:publicId` (07 A16): a shared post rendered read-only, then "Follow <masjid>" (the follow flow of `/m/:code`)
// and — outside the installed app — how to get the app (Android install prompt, iPhone guide). A browser cannot open
// the installed app by itself, so "Open app" is the install guidance here; inside the app nothing more is needed.
import { useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import { Button, Card, IosInstallGuide } from '@mc/ui/components';
import { DownloadIcon } from '@mc/ui/icons';
import { useNavigator, useScreen } from '@mc/ui/navigation';
import { type ReactNode, useState } from 'react';

import { promptInstall, useCanInstall } from '../../lib/install.ts';
import { isStandalone, platformKind } from '../../lib/platform.ts';
import { FollowActions, FollowNotes } from '../follow/FollowActions.tsx';
import { useFollowFlow } from '../follow/useFollowFlow.ts';
import { useItem } from './hooks/useItem.ts';
import { ItemDetailView } from './ItemDetailScreen.tsx';

export function PostLandingScreen() {
  const { params } = useScreen();
  const publicId = params['publicId'] ?? '';
  return (
    <LandingGate>
      <ItemDetailView publicId={publicId} mode={{ readOnly: true, footer: <LandingActions publicId={publicId} /> }} />
    </LandingGate>
  );
}

/**
 * All four namespaces the landing uses load together (a deep link has nothing cached; one gate after another would
 * fetch them in two rounds).
 */
function LandingGate({ children }: { readonly children: ReactNode }) {
  const { ready } = useTranslation(['content', 'masjid', 'follow', 'settings']);
  if (!ready) return <div aria-busy className="h-full bg-bg" />;
  return <>{children}</>;
}

function LandingActions({ publicId }: { readonly publicId: string }) {
  const { t } = useTranslation('settings');
  const navigator = useNavigator();
  const state = useItem(publicId);
  const masjid = state.state === 'ready' ? state.masjid : null;
  const open = (masjidId: string) => {
    navigator.push(`/masjid/${masjidId}`);
  };
  const flow = useFollowFlow(masjid?.id ?? null, open);
  const canInstall = useCanInstall();
  const [installing, setInstalling] = useState(false);
  const [guide, setGuide] = useState(true);
  const standalone = isStandalone();
  const ios = platformKind() === 'ios';
  return (
    <div className="flex flex-col gap-4 pt-2">
      {masjid ? (
        <Card className="flex flex-col gap-3">
          <FollowNotes masjid={masjid} flow={flow} />
          <FollowActions
            masjid={masjid}
            flow={flow}
            onOpen={open}
            onManage={() => {
              navigator.selectTab('masjids');
            }}
          />
        </Card>
      ) : null}
      {!standalone && ios && guide ? (
        <IosInstallGuide
          appName={BRAND.name}
          onDismiss={() => {
            setGuide(false);
          }}
        />
      ) : null}
      {!standalone && !ios && canInstall ? (
        <Card variant="mint" className="flex flex-col gap-3">
          <p className="type-headline text-text">{t('landingApp')}</p>
          <p className="type-callout text-text-secondary">{t('installBody')}</p>
          <Button
            leadingIcon={<DownloadIcon />}
            loading={installing}
            onPress={() => {
              setInstalling(true);
              void promptInstall().finally(() => {
                setInstalling(false);
              });
            }}
          >
            {t('installButton')}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
