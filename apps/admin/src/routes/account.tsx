import { useLocale, useTranslation } from '@mc/i18n/react';
import type { InviteLink } from '@mc/shared/contracts';
import {
  Button,
  Dialog,
  InfoNote,
  ListRow,
  SectionHeader,
  Sheet,
  SkeletonText,
  TextField,
  useToast,
} from '@mc/ui/components';
import { CopyIcon, DeviceMobileIcon, FingerprintIcon, PlusIcon, ShareIcon, SignOutIcon } from '@mc/ui/icons';
import { Screen } from '@mc/ui/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { authApi } from '../features/auth/api/auth-api.ts';
import { LanguagePicker } from '../features/auth/components/LanguagePicker.tsx';
import { StepUpCancelled, StepUpProvider, useStepUp } from '../features/auth/components/StepUpProvider.tsx';
import { ME_KEY, useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';

export const Route = createFileRoute('/account')({
  component: Account,
});

const SESSIONS_KEY = ['auth', 'sessions'] as const;
const PASSKEYS_KEY = ['auth', 'passkeys'] as const;

/**
 * B13 "My account": language, logins (passkeys: rename, add another phone), logged-in devices (log out one), log out,
 * log out everywhere, and the accepted undertaking version.
 */
/** Adding a passkey needs the screen lock again (security review H1), so the screen has the step-up dialog. */
function Account() {
  return (
    <StepUpProvider>
      <AccountContent />
    </StepUpProvider>
  );
}

function AccountContent() {
  const { t } = useTranslation('admin');
  const runWithStepUp = useStepUp();
  const { format } = useLocale();
  const errorText = useErrorText();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useSignedInAdmin();
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: ({ signal }) => authApi.sessions(signal) });
  const passkeys = useQuery({ queryKey: PASSKEYS_KEY, queryFn: ({ signal }) => authApi.passkeys(signal) });
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const [link, setLink] = useState<InviteLink | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const now = new Date();

  const onError = (error: unknown) => {
    toast.show({ message: errorText(error), tone: 'error' });
  };
  const signedOut = () => queryClient.resetQueries({ queryKey: ME_KEY });
  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
    onError,
  });
  const rename = useMutation({
    mutationFn: (input: { id: string; label: string }) => authApi.renamePasskey(input.id, input.label),
    onSuccess: async () => {
      setRenaming(null);
      await queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY });
    },
    onError,
  });
  const addDevice = useMutation({
    mutationFn: () => runWithStepUp(authApi.addDeviceLink),
    onSuccess: setLink,
    onError: (error) => {
      if (!(error instanceof StepUpCancelled)) onError(error);
    },
  });
  const logout = useMutation({ mutationFn: authApi.logout, onSuccess: signedOut, onError });
  const logoutAll = useMutation({ mutationFn: authApi.logoutAll, onSuccess: signedOut, onError });

  return (
    <Screen title={t('account.title')}>
      <div className="flex flex-col gap-8 pb-10">
        <section className="flex flex-col gap-3">
          <SectionHeader title={t('account.language')} />
          <LanguagePicker name="account-language" hideLegend />
        </section>

        <section className="flex flex-col gap-3">
          <SectionHeader title={t('account.passkeys')} />
          <p className="type-footnote text-text-secondary">{t('account.passkeysLead')}</p>
          {passkeys.data ? (
            <ul className="flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1">
              {passkeys.data.passkeys.map((p) => (
                <li key={p.id}>
                  <ListRow
                    className="px-4"
                    leading={<FingerprintIcon />}
                    title={p.label}
                    subtitle={t('account.passkeyAdded', { date: format.date(new Date(p.createdAt), 'medium') })}
                    trailing={
                      <Button
                        variant="ghost"
                        size="md"
                        onPress={() => {
                          setRenaming({ id: p.id, label: p.label });
                        }}
                      >
                        {t('account.rename')}
                      </Button>
                    }
                  />
                </li>
              ))}
            </ul>
          ) : (
            <SkeletonText lines={2} />
          )}
          <Button
            variant="outline"
            fullWidth
            leadingIcon={<PlusIcon />}
            loading={addDevice.isPending}
            onPress={() => {
              addDevice.mutate();
            }}
          >
            {t('account.addDevice')}
          </Button>
        </section>

        <section className="flex flex-col gap-3">
          <SectionHeader title={t('account.sessions')} />
          {sessions.data ? (
            <ul className="flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1">
              {sessions.data.sessions.map((s) => (
                <li key={s.id}>
                  <ListRow
                    className="px-4"
                    leading={<DeviceMobileIcon />}
                    title={s.device ?? t('account.unknownDevice')}
                    subtitle={
                      s.current
                        ? t('account.thisDevice')
                        : t('account.lastUsed', { time: format.relative(new Date(s.lastSeenAt), now) })
                    }
                    {...(s.current
                      ? {}
                      : {
                          trailing: (
                            <Button
                              variant="ghost"
                              size="md"
                              loading={revoke.isPending && revoke.variables === s.id}
                              onPress={() => {
                                revoke.mutate(s.id);
                              }}
                            >
                              {t('account.signOut')}
                            </Button>
                          ),
                        })}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <SkeletonText lines={2} />
          )}
        </section>

        {me.undertakingVersion ? (
          <section className="flex flex-col gap-3">
            <SectionHeader title={t('account.undertaking')} />
            <InfoNote>{t('undertaking.accepted', { version: me.undertakingVersion })}</InfoNote>
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <Button
            variant="outline"
            fullWidth
            leadingIcon={<SignOutIcon className="rtl:-scale-x-100" />}
            loading={logout.isPending}
            onPress={() => {
              logout.mutate();
            }}
          >
            {t('account.signOut')}
          </Button>
          <Button
            variant="danger"
            fullWidth
            onPress={() => {
              setConfirmAll(true);
            }}
          >
            {t('account.signOutAll')}
          </Button>
        </section>
      </div>

      <Sheet
        open={renaming !== null}
        onClose={() => {
          setRenaming(null);
        }}
        title={t('account.rename')}
        footer={
          <Button
            size="lg"
            fullWidth
            loading={rename.isPending}
            disabled={!renaming?.label.trim()}
            onPress={() => {
              if (renaming) rename.mutate({ id: renaming.id, label: renaming.label.trim() });
            }}
          >
            {t('account.save')}
          </Button>
        }
      >
        <TextField
          label={t('account.renameLabel')}
          value={renaming?.label ?? ''}
          maxLength={60}
          onChange={(event) => {
            setRenaming((current) => (current ? { ...current, label: event.target.value } : current));
          }}
        />
      </Sheet>

      <Sheet
        open={link !== null}
        onClose={() => {
          setLink(null);
        }}
        title={t('account.addDevice')}
      >
        <div className="flex flex-col gap-4 pb-4">
          <p className="type-body text-text-secondary">{t('account.addDeviceLead')}</p>
          <Button
            variant="secondary"
            fullWidth
            leadingIcon={<CopyIcon />}
            onPress={() => {
              if (!link) return;
              void navigator.clipboard.writeText(link.inviteUrl).then(() => {
                toast.show({ message: t('account.linkCopied'), tone: 'success' });
              }, onError);
            }}
          >
            {t('account.copyLink')}
          </Button>
          {link ? (
            <a
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full border-[1.5px] border-primary-700 px-5 type-subhead-strong text-primary-700"
              href={`https://wa.me/?text=${encodeURIComponent(t('account.whatsAppMessage', { url: link.inviteUrl }))}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ShareIcon />
              {t('account.shareWhatsApp')}
            </a>
          ) : null}
        </div>
      </Sheet>

      <Dialog
        open={confirmAll}
        onClose={() => {
          setConfirmAll(false);
        }}
        title={t('account.signOutAllConfirmTitle')}
        body={t('account.signOutAllConfirmBody')}
        confirmLabel={t('account.signOutAll')}
        destructive
        loading={logoutAll.isPending}
        onConfirm={() => {
          logoutAll.mutate();
        }}
      />
    </Screen>
  );
}
