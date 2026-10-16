import { isLocale } from '@mc/i18n';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { ProblemError } from '@mc/shared/http';
import { Button, EmptyState, InfoNote, SkeletonText } from '@mc/ui/components';
import { FingerprintIcon, MasjidTile } from '@mc/ui/icons';
import { SuccessCheck } from '@mc/ui/motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { authApi } from '../api/auth-api.ts';
import { ME_KEY, useErrorText } from '../hooks/use-session.ts';
import { deviceLabel, registerWithInvite } from '../lib/flows.ts';
import { hasScreenLockPasskey, PasskeyError } from '../lib/passkey.ts';
import { FlowLayout } from './FlowLayout.tsx';
import { LanguagePicker } from './LanguagePicker.tsx';

/** Reads the invite token from the URL fragment once and removes it from the address bar and history (04 R3). */
function useInviteToken(): string | null {
  const [token] = useState(() => {
    const value = window.location.hash.slice(1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  });
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  return token;
}

export interface InviteFlowProps {
  /** Called after the passkey is registered and the session cookie set. */
  readonly onDone: () => void;
}

/**
 * B1 Invite landing: greeting with the admin's name, their masjid(s), language picker, one big "Create my login".
 * Every invalid link (unknown, used, expired) shows the same friendly message (04 R3).
 */
export function InviteFlow({ onDone }: InviteFlowProps) {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation('common');
  const { locale, setLocale } = useLocale();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const token = useInviteToken();
  const invite = useQuery({
    queryKey: ['auth', 'invite', token],
    queryFn: ({ signal }) => authApi.invite(token ?? '', signal),
    enabled: token !== null,
    retry: (count, error) => !(error instanceof ProblemError) && count < 2,
    staleTime: Infinity,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // First view: the language the Super Admin chose for this admin.
  const appliedLocale = useRef(false);
  useEffect(() => {
    const preferred = invite.data?.uiLocale;
    if (appliedLocale.current || !preferred || !isLocale(preferred)) return;
    appliedLocale.current = true;
    if (preferred !== locale) void setLocale(preferred);
  }, [invite.data, locale, setLocale]);

  if (!token) {
    return (
      <FlowLayout>
        <EmptyState title={t('invite.missingTitle')} body={t('invite.missingBody')} className="my-auto" />
      </FlowLayout>
    );
  }
  if (invite.isPending) {
    return (
      <FlowLayout>
        <SkeletonText lines={4} />
      </FlowLayout>
    );
  }
  if (invite.isError) {
    const invalid = invite.error instanceof ProblemError;
    return (
      <FlowLayout
        {...(invalid
          ? {}
          : {
              footer: (
                <Button
                  size="lg"
                  fullWidth
                  onPress={() => {
                    void invite.refetch();
                  }}
                >
                  {tc('appError.retry')}
                </Button>
              ),
            })}
      >
        <EmptyState
          title={invalid ? t('invite.invalidTitle') : tc('appError.title')}
          body={invalid ? t('invite.invalidBody') : errorText(invite.error)}
          className="my-auto"
        />
      </FlowLayout>
    );
  }

  const { adminDisplayName, masjidNames, purpose } = invite.data;
  if (done) {
    return (
      <FlowLayout>
        <div className="my-auto flex flex-col items-center gap-4 text-center">
          <SuccessCheck title={t('invite.done')} onComplete={onDone} />
          <p className="type-title2 text-text">{t('invite.done')}</p>
        </div>
      </FlowLayout>
    );
  }

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (!(await hasScreenLockPasskey())) {
        setMessage(t('login.noScreenLock'));
        return;
      }
      await registerWithInvite(token, deviceLabel(navigator.userAgent, new Date(), locale));
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
      setDone(true);
    } catch (error) {
      if (error instanceof PasskeyError) {
        setMessage(t(error.failure === 'cancelled' ? 'login.cancelled' : 'login.failed'));
      } else if (error instanceof ProblemError && error.problem.code === 'INVITE_INVALID') {
        setMessage(t('invite.invalidBody'));
      } else {
        setMessage(errorText(error));
      }
    } finally {
      setBusy(false);
    }
  };

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
              void create();
            }}
          >
            {purpose === 'add_device' ? t('invite.addDevice') : t('invite.create')}
          </Button>
          <p className="text-center type-footnote text-text-secondary">{t('login.screenLockHint')}</p>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-start gap-3">
          <MasjidTile size="lg" />
          <h1 className="type-large-title text-text">{t('invite.greeting', { name: adminDisplayName })}</h1>
          {purpose === 'add_device' ? (
            <p className="type-body text-text-secondary">{t('invite.addDeviceLead')}</p>
          ) : null}
          {purpose === 'recovery' ? <p className="type-body text-text-secondary">{t('invite.recoveryLead')}</p> : null}
        </div>
        {masjidNames.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="type-subhead-strong text-text-secondary">
              {t('invite.forMasjids', { count: masjidNames.length })}
            </h2>
            <ul className="flex flex-col gap-2">
              {masjidNames.map((name) => (
                <li key={name} className="flex items-center gap-3 rounded-md bg-surface p-3 shadow-e1">
                  <MasjidTile />
                  <span className="type-headline text-text" dir="auto">
                    {name}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <LanguagePicker name="invite-language" />
        <div aria-live="polite">{message ? <InfoNote>{message}</InfoNote> : null}</div>
      </div>
    </FlowLayout>
  );
}
