import { useTranslation } from '@mc/i18n/react';
import { Button, EmptyState, SkeletonText } from '@mc/ui/components';
import { type ReactNode, useState } from 'react';

import { isSignedOut, MeContext, useErrorText, useMe } from '../hooks/use-session.ts';
import { FlowLayout } from './FlowLayout.tsx';
import { InviteFlow } from './InviteFlow.tsx';
import { LoginScreen } from './LoginScreen.tsx';
import { UndertakingScreen } from './UndertakingScreen.tsx';

/**
 * Decides what the admin app shows (T1.10): an invite link → the invite flow; no session → Login (with "you were
 * logged out" after an expiry); the current undertaking not accepted → Undertaking; otherwise the app, with the
 * signed-in admin in context. The server enforces all of this too (401 / UNDERTAKING_REQUIRED) — this only spares
 * the admin screens they cannot use.
 */
export function SessionGate({ children }: { readonly children: ReactNode }) {
  const [onInvite] = useState(() => window.location.pathname === '/invite');
  if (onInvite) {
    return (
      <InviteFlow
        onDone={() => {
          // A fresh start of the app with the new session cookie (the router never saw a signed-in admin yet).
          window.location.replace('/');
        }}
      />
    );
  }
  return <SignedIn>{children}</SignedIn>;
}

function SignedIn({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation('common');
  const errorText = useErrorText();
  const me = useMe();
  if (me.isError) {
    if (isSignedOut(me.error)) return <LoginScreen />;
    return (
      <FlowLayout
        footer={
          <Button
            size="lg"
            fullWidth
            onPress={() => {
              void me.refetch();
            }}
          >
            {t('appError.retry')}
          </Button>
        }
      >
        <EmptyState title={t('appError.title')} body={errorText(me.error)} className="my-auto" />
      </FlowLayout>
    );
  }
  if (me.isPending) {
    return (
      <FlowLayout>
        <SkeletonText lines={5} />
      </FlowLayout>
    );
  }
  if (me.data.undertakingRequired) return <UndertakingScreen />;
  return <MeContext value={me.data}>{children}</MeContext>;
}
