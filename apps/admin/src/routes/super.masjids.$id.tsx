import { Bdi, useLocale, useTranslation } from '@mc/i18n/react';
import type { InviteLink, SuperAdminRow, SuperMasjidDetail } from '@mc/shared/contracts';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  InfoNote,
  ListRow,
  SectionHeader,
  Select,
  Sheet,
  SkeletonText,
  Tag,
  TextField,
  useToast,
} from '@mc/ui/components';
import { DotsIcon, MasjidTile, PlusIcon } from '@mc/ui/icons';
import { useNavigator, useScreen } from '@mc/ui/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi, type Transition } from '../features/super/api/super-api.ts';
import { InviteLinkSheet } from '../features/super/components/InviteLinkSheet.tsx';
import { StepUpCancelled, useStepUp } from '../features/super/components/StepUpProvider.tsx';
import { StatusTag, SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/masjids/$id')({
  component: MasjidPage,
});

/** C2 masjid page: profile, status actions (★ suspend/unsuspend/delete), quota, admins with their ★ actions. */
function MasjidPage() {
  const { t } = useTranslation('super');
  const { params } = useScreen();
  const masjidId = params['id'] ?? '';
  const errorText = useErrorText();
  const detail = useQuery({
    queryKey: ['super', 'masjid', masjidId],
    queryFn: ({ signal }) => superApi.masjid(masjidId, signal),
  });
  return (
    <SuperFrame title={detail.data?.masjid.name ?? t('nav.masjids')} section="masjids">
      {detail.data ? (
        <Body data={detail.data} />
      ) : detail.isError ? (
        <EmptyState title={errorText(detail.error)} className="mt-8" />
      ) : (
        <SkeletonText lines={10} />
      )}
    </SuperFrame>
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="type-caption text-text-tertiary">{label}</dt>
      <dd className="type-body text-text">{children}</dd>
    </div>
  );
}

const QUOTAS = ['0', '2', '4', '6', '8', '10', '12', '15', '20', '30', '50'] as const;

function Body({ data }: { readonly data: SuperMasjidDetail }) {
  const { t } = useTranslation('super');
  const { format } = useLocale();
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const run = useStepUp();
  const { masjid } = data;
  const [reasonFor, setReasonFor] = useState<Transition | null>(null);
  const [reason, setReason] = useState('');
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState<{ link: InviteLink; name: string } | null>(null);
  const [selected, setSelected] = useState<SuperAdminRow | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['super'] });
  const fail = (error: unknown) => {
    if (!(error instanceof StepUpCancelled)) toast.show({ message: errorText(error), tone: 'error' });
  };

  const transition = useMutation({
    mutationFn: (input: { transition: Transition; reason?: string }) =>
      run(() => superApi.transition(masjid.id, input.transition, input.reason)),
    onSuccess: async () => {
      setReasonFor(null);
      setReason('');
      toast.show({ message: t('detail.changed'), tone: 'success' });
      await refresh();
    },
    onError: fail,
  });
  const quota = useMutation({
    mutationFn: (value: number) => superApi.setQuota(masjid.id, value),
    onSuccess: refresh,
    onError: fail,
  });

  const actions: readonly { transition: Transition; label: string; variant: 'primary' | 'outline' | 'danger' }[] =
    masjid.status === 'pending'
      ? [
          { transition: 'activate', label: t('detail.activate'), variant: 'primary' },
          { transition: 'delete', label: t('detail.delete'), variant: 'danger' },
        ]
      : masjid.status === 'active'
        ? [
            { transition: 'suspend', label: t('detail.suspend'), variant: 'outline' },
            { transition: 'delete', label: t('detail.delete'), variant: 'danger' },
          ]
        : masjid.status === 'suspended'
          ? [
              { transition: 'unsuspend', label: t('detail.unsuspend'), variant: 'primary' },
              { transition: 'delete', label: t('detail.delete'), variant: 'danger' },
            ]
          : [];
  const names = [masjid.nameI18n.ur, masjid.nameI18n.hi, masjid.nameI18n.te].filter(Boolean);

  return (
    <div className="flex flex-col gap-8">
      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <MasjidTile size="lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusTag status={masjid.status} />
              <span className="type-footnote text-text-secondary">
                {t('detail.followers', { count: data.followers })}
              </span>
            </div>
            {names.map((name) => (
              <span key={name} dir="auto" className="type-callout text-text-secondary">
                {name}
              </span>
            ))}
          </div>
          {masjid.status === 'deleted' ? null : (
            <Button
              variant="ghost"
              size="md"
              onPress={() => {
                navigator.push(`/super/masjids/${masjid.id}/edit`);
              }}
            >
              {t('detail.edit')}
            </Button>
          )}
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label={t('detail.followCode')}>
            <Bdi>{`${masjid.followCode.slice(0, 4)}-${masjid.followCode.slice(4)}`}</Bdi>
          </Fact>
          <Fact label={t('form.address')}>
            {[masjid.address, masjid.area, masjid.city, masjid.state].filter(Boolean).join(', ')}
          </Fact>
          <Fact label={t('form.location')}>
            <Bdi>{`${String(masjid.lat)}, ${String(masjid.lng)}`}</Bdi>
          </Fact>
          <Fact label={t('form.calcMethod')}>{t(`form.calcMethods.${masjid.calcMethod}`)}</Fact>
          <Fact label={t('form.asrMadhab')}>{t(`form.madhabs.${masjid.asrMadhab}`)}</Fact>
          <Fact label={t('form.hijriOffset')}>
            {masjid.hijriOffset === undefined ? t('form.hijriOffsetNone') : <Bdi>{String(masjid.hijriOffset)}</Bdi>}
          </Fact>
        </dl>
      </Card>

      {actions.length > 0 ? (
        <section className="flex flex-col gap-3">
          {masjid.status === 'pending' ? <InfoNote>{t('detail.activateHint')}</InfoNote> : null}
          <div className="flex flex-wrap gap-3">
            {actions.map((action) => (
              <Button
                key={action.transition}
                variant={action.variant}
                loading={transition.isPending && transition.variables.transition === action.transition}
                onPress={() => {
                  if (action.transition === 'activate') transition.mutate({ transition: 'activate' });
                  else setReasonFor(action.transition);
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {masjid.status === 'deleted' ? null : (
        <section className="flex max-w-xs flex-col gap-3">
          <Select<(typeof QUOTAS)[number]>
            label={t('form.quota')}
            value={
              (QUOTAS as readonly string[]).includes(String(masjid.pushDailyQuota))
                ? (String(masjid.pushDailyQuota) as (typeof QUOTAS)[number])
                : null
            }
            onChange={(value) => {
              quota.mutate(Number(value));
            }}
            options={QUOTAS.map((value) => ({ value, label: format.number(Number(value)) }))}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionHeader title={t('detail.admins')} />
        {data.admins.length === 0 ? <InfoNote>{t('detail.noAdmins')}</InfoNote> : null}
        {data.admins.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1">
            {data.admins.map((admin) => (
              <li key={admin.id}>
                <ListRow
                  className="px-4"
                  title={<span dir="auto">{admin.displayName}</span>}
                  subtitle={`${t(`admin.roles.${admin.role}`)} · ${t(`admin.statuses.${admin.status}`)}`}
                  {...(admin.lastLoginAt ? { meta: format.relative(new Date(admin.lastLoginAt), new Date()) } : {})}
                  trailing={
                    <Button
                      variant="ghost"
                      size="md"
                      aria-label={admin.displayName}
                      onPress={() => {
                        setSelected(admin);
                      }}
                    >
                      <DotsIcon />
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        ) : null}
        {masjid.status !== 'deleted' && masjid.adminCount < 5 ? (
          <Button
            variant="outline"
            leadingIcon={<PlusIcon />}
            onPress={() => {
              setAdding(true);
            }}
          >
            {t('detail.addAdmin')}
          </Button>
        ) : null}
      </section>

      <Sheet
        open={reasonFor !== null}
        onClose={() => {
          setReasonFor(null);
        }}
        title={reasonFor ? t(`detail.${reasonFor}`) : ''}
        footer={
          <Button
            size="lg"
            fullWidth
            variant={reasonFor === 'delete' ? 'danger' : 'primary'}
            disabled={reasonFor !== 'delete' && reason.trim().length < 3}
            loading={transition.isPending}
            onPress={() => {
              if (reasonFor) {
                transition.mutate({
                  transition: reasonFor,
                  ...(reason.trim().length >= 3 ? { reason: reason.trim() } : {}),
                });
              }
            }}
          >
            {reasonFor ? t(`detail.${reasonFor}`) : ''}
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-4">
          {reasonFor === 'delete' ? <InfoNote>{t('detail.deleteConfirmBody')}</InfoNote> : null}
          <TextField
            label={t('detail.reason')}
            optional={reasonFor === 'delete'}
            hint={t('detail.reasonHint')}
            value={reason}
            maxLength={300}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
        </div>
      </Sheet>

      <AddAdminSheet
        open={adding}
        masjidId={masjid.id}
        onClose={() => {
          setAdding(false);
        }}
        onCreated={async (created, name) => {
          setAdding(false);
          setLink({ link: created, name });
          await refresh();
        }}
      />
      <AdminActionsSheet
        admin={selected}
        masjidId={masjid.id}
        onClose={() => {
          setSelected(null);
        }}
        onLink={(created, name) => {
          setSelected(null);
          setLink({ link: created, name });
        }}
        onChanged={refresh}
      />
      <InviteLinkSheet
        link={link?.link ?? null}
        adminName={link?.name ?? ''}
        onClose={() => {
          setLink(null);
        }}
      />
    </div>
  );
}

function AddAdminSheet({
  open,
  masjidId,
  onClose,
  onCreated,
}: {
  readonly open: boolean;
  readonly masjidId: string;
  readonly onClose: () => void;
  readonly onCreated: (link: InviteLink, name: string) => Promise<void>;
}) {
  const { t } = useTranslation('super');
  const errorText = useErrorText();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [locale, setLocale] = useState<'en' | 'hi' | 'ur' | 'te'>('en');
  const [role, setRole] = useState<'owner' | 'editor'>('owner');
  const phoneInvalid = phone.trim() !== '' && !/^\+?[0-9]{10,15}$/.test(phone.replace(/[\s-]/g, ''));
  const create = useMutation({
    mutationFn: () =>
      superApi.createAdmin({
        displayName: name.trim(),
        ...(phone.trim() ? { phone: phone.replace(/[\s-]/g, '') } : {}),
        uiLocale: locale,
        masjidId,
        role,
      }),
    onSuccess: async (created) => {
      const shownName = name.trim();
      setName('');
      setPhone('');
      await onCreated(created, shownName);
    },
  });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('detail.addAdmin')}
      footer={
        <Button
          size="lg"
          fullWidth
          disabled={!name.trim() || phoneInvalid}
          loading={create.isPending}
          onPress={() => {
            create.mutate();
          }}
        >
          {t('admin.create')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-4">
        <TextField
          label={t('admin.name')}
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <TextField
          label={t('admin.phone')}
          optional
          type="tel"
          dir="ltr"
          hint={t('admin.phoneHint')}
          error={phoneInvalid ? t('form.required') : undefined}
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
          }}
        />
        <Select<'en' | 'hi' | 'ur' | 'te'>
          label={t('admin.language')}
          value={locale}
          onChange={setLocale}
          options={[
            { value: 'en', label: 'English' },
            { value: 'hi', label: 'हिन्दी' },
            { value: 'ur', label: 'اردو' },
            { value: 'te', label: 'తెలుగు' },
          ]}
        />
        <Select<'owner' | 'editor'>
          label={t('admin.role')}
          value={role}
          onChange={setRole}
          options={[
            { value: 'owner', label: t('admin.roles.owner') },
            { value: 'editor', label: t('admin.roles.editor') },
          ]}
        />
        {create.error ? <InfoNote>{errorText(create.error)}</InfoNote> : null}
      </div>
    </Sheet>
  );
}

function AdminActionsSheet({
  admin,
  masjidId,
  onClose,
  onLink,
  onChanged,
}: {
  readonly admin: SuperAdminRow | null;
  readonly masjidId: string;
  readonly onClose: () => void;
  readonly onLink: (link: InviteLink, name: string) => void;
  readonly onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation('super');
  const toast = useToast();
  const errorText = useErrorText();
  const run = useStepUp();
  const [phone, setPhone] = useState<string | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<'passkeys' | 'remove' | null>(null);
  const fail = (error: unknown) => {
    if (!(error instanceof StepUpCancelled)) toast.show({ message: errorText(error), tone: 'error' });
  };
  const action = useMutation({
    mutationFn: async (kind: 'link' | 'recovery' | 'sessions' | 'passkeys' | 'remove' | 'phone') => {
      if (!admin) return;
      switch (kind) {
        case 'link': {
          const purpose = admin.status === 'invited' ? 'register' : 'add_device';
          onLink(await run(() => superApi.newInvite(admin.id, purpose)), admin.displayName);
          return;
        }
        case 'recovery':
          onLink(await run(() => superApi.newInvite(admin.id, 'recovery')), admin.displayName);
          return;
        case 'sessions': {
          const { count } = await run(() => superApi.revokeSessions(admin.id));
          toast.show({ message: t('admin.sessionsEnded', { count }), tone: 'success' });
          return;
        }
        case 'passkeys':
          await run(() => superApi.revokePasskeys(admin.id));
          setConfirm(null);
          await onChanged();
          return;
        case 'remove':
          await run(() => superApi.removeAdmin(admin.id, masjidId));
          setConfirm(null);
          onClose();
          await onChanged();
          return;
        case 'phone':
          setPhone((await run(() => superApi.adminPhone(admin.id))).phone);
          return;
      }
    },
    onError: fail,
  });
  const close = () => {
    setPhone(undefined);
    onClose();
  };
  return (
    <>
      <Sheet open={admin !== null && confirm === null} onClose={close} title={admin?.displayName ?? ''}>
        {admin ? (
          <div className="flex flex-col gap-2 pb-4">
            <div className="flex gap-2 pb-2">
              <Tag tone="primary">{t(`admin.roles.${admin.role}`)}</Tag>
              <Tag tone={admin.status === 'active' ? 'primary' : 'neutral'}>{t(`admin.statuses.${admin.status}`)}</Tag>
            </div>
            {admin.hasPhone ? (
              phone === undefined ? (
                <Button
                  variant="secondary"
                  fullWidth
                  loading={action.isPending && action.variables === 'phone'}
                  onPress={() => {
                    action.mutate('phone');
                  }}
                >
                  {t('admin.viewPhone')}
                </Button>
              ) : (
                <InfoNote>
                  <Bdi>{phone ?? t('admin.noPhone')}</Bdi>
                </InfoNote>
              )
            ) : (
              <InfoNote>{t('admin.noPhone')}</InfoNote>
            )}
            <Button
              variant="outline"
              fullWidth
              loading={action.isPending && action.variables === 'link'}
              onPress={() => {
                action.mutate('link');
              }}
            >
              {t('admin.newLink')}
            </Button>
            {admin.status === 'invited' ? null : (
              <Button
                variant="outline"
                fullWidth
                loading={action.isPending && action.variables === 'recovery'}
                onPress={() => {
                  action.mutate('recovery');
                }}
              >
                {t('admin.recoveryLink')}
              </Button>
            )}
            <Button
              variant="outline"
              fullWidth
              loading={action.isPending && action.variables === 'sessions'}
              onPress={() => {
                action.mutate('sessions');
              }}
            >
              {t('admin.revokeSessions')}
            </Button>
            <Button
              variant="danger"
              fullWidth
              onPress={() => {
                setConfirm('passkeys');
              }}
            >
              {t('admin.revokePasskeys')}
            </Button>
            <Button
              variant="danger"
              fullWidth
              onPress={() => {
                setConfirm('remove');
              }}
            >
              {t('admin.remove')}
            </Button>
          </div>
        ) : null}
      </Sheet>
      <Dialog
        open={confirm !== null}
        onClose={() => {
          setConfirm(null);
        }}
        title={confirm === 'remove' ? t('admin.removeConfirmTitle') : t('admin.passkeysConfirmTitle')}
        body={confirm === 'remove' ? t('admin.removeConfirmBody') : t('admin.passkeysConfirmBody')}
        confirmLabel={confirm === 'remove' ? t('admin.remove') : t('admin.revokePasskeys')}
        destructive
        loading={action.isPending}
        onConfirm={() => {
          if (confirm) action.mutate(confirm);
        }}
      />
    </>
  );
}
