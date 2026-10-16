import { useTranslation } from '@mc/i18n/react';
import { Button, InfoNote } from '@mc/ui/components';
import { FingerprintIcon, MasjidTile } from '@mc/ui/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ME_KEY, takeSessionEnded, useErrorText } from '../hooks/use-session.ts';
import { signIn } from '../lib/flows.ts';
import { hasScreenLockPasskey, PasskeyError } from '../lib/passkey.ts';
import { FlowLayout } from './FlowLayout.tsx';

/** B1 Login: logo, one big "Log in" button (discoverable passkey — no username), plain-language errors. */
export function LoginScreen() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const [ended] = useState(takeSessionEnded);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const logIn = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (!(await hasScreenLockPasskey())) {
        setMessage(t('login.noScreenLock'));
        return;
      }
      await signIn();
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
    } catch (error) {
      if (error instanceof PasskeyError) {
        setMessage(t(error.failure === 'cancelled' ? 'login.cancelled' : 'login.failed'));
      } else {
        setMessage(errorText(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const shown = message ?? (ended ? t('login.sessionEnded') : null);

  return (
    <FlowLayout
      footer={
        <>
          <Button
            size="lg"
            fullWidth
            loading={busy}
            leadingIcon={<FingerprintIcon />}
            onPress={() => {
              void logIn();
            }}
          >
            {t('login.button')}
          </Button>
          <p className="text-center type-footnote text-text-secondary">{t('login.screenLockHint')}</p>
        </>
      }
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <MasjidTile size="lg" />
        <h1 className="type-large-title text-text">{t('login.title')}</h1>
        <p className="type-body text-text-secondary">{t('login.lead')}</p>
        <div aria-live="polite" className="w-full">
          {shown ? <InfoNote className="text-start">{shown}</InfoNote> : null}
        </div>
      </div>
      <p className="text-center type-footnote text-text-tertiary">{t('login.trouble')}</p>
    </FlowLayout>
  );
}
