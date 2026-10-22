import { wallClockInZone } from '@mc/domain/time';
import { Bdi, Time, useLocale, useTranslation } from '@mc/i18n/react';
import type { AuditRow } from '@mc/shared/contracts';
import { Button, EmptyState, Select, SkeletonText, useToast } from '@mc/ui/components';
import { CaretDownIcon, DownloadIcon } from '@mc/ui/icons';
import { Pressable } from '@mc/ui/motion';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { StepUpCancelled, useStepUp } from '../features/auth/components/StepUpProvider.tsx';
import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/audit')({
  component: Audit,
});

/** The audit vocabulary (mirrors AUDIT_ACTIONS in @mc/db) — shown as written: these are log identifiers. */
const ACTIONS = [
  'masjid.create',
  'masjid.update',
  'masjid.activate',
  'masjid.suspend',
  'masjid.unsuspend',
  'masjid.delete',
  'admin.create',
  'admin.add_to_masjid',
  'admin.remove_from_masjid',
  'admin.invite',
  'admin.phone_view',
  'admin.undertaking_accept',
  'invite.consume',
  'auth.register',
  'auth.login',
  'auth.login_failed',
  'auth.step_up',
  'auth.logout',
  'session.revoke',
  'credential.revoke',
  'settings.update',
] as const;
type ActionFilter = 'all' | (typeof ACTIONS)[number];

/** C11 Audit log: filter by action, newest first, expandable details, "Show more"; ★ CSV export of the filter. */
function Audit() {
  const { t } = useTranslation('super');
  return (
    <SuperFrame title={t('nav.audit')} section="audit">
      <AuditLog />
    </SuperFrame>
  );
}

/** Inside the frame, so the ★ export can use the step-up dialog the frame provides. */
function AuditLog() {
  const { t } = useTranslation('super');
  const toast = useToast();
  const errorText = useErrorText();
  const run = useStepUp();
  const [action, setAction] = useState<ActionFilter>('all');
  const filters = action === 'all' ? {} : { action };
  const log = useInfiniteQuery({
    queryKey: ['super', 'audit', action],
    queryFn: ({ pageParam, signal }) =>
      superApi.audit({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }, signal),
    initialPageParam: '',
    getNextPageParam: (page) => page.next,
  });
  const exportCsv = useMutation({
    mutationFn: () => run(() => superApi.auditCsv(filters)),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'audit.csv';
      anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    },
    onError: (error) => {
      if (!(error instanceof StepUpCancelled)) toast.show({ message: errorText(error), tone: 'error' });
    },
  });
  const rows = log.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <Select<ActionFilter>
            label={t('audit.action')}
            value={action}
            onChange={setAction}
            options={[
              { value: 'all', label: t('audit.allActions') },
              ...ACTIONS.map((value) => ({ value, label: value })),
            ]}
          />
        </div>
        <Button
          variant="outline"
          leadingIcon={<DownloadIcon />}
          loading={exportCsv.isPending}
          onPress={() => {
            exportCsv.mutate();
          }}
        >
          {t('audit.export')}
        </Button>
      </div>
      {log.isPending ? (
        <SkeletonText lines={8} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('audit.empty')} className="mt-8" />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1">
            {rows.map((row) => (
              <AuditEntry key={row.id} row={row} />
            ))}
          </ul>
          {log.hasNextPage ? (
            <Button
              variant="outline"
              fullWidth
              className="mt-4"
              loading={log.isFetchingNextPage}
              onPress={() => {
                void log.fetchNextPage();
              }}
            >
              {t('audit.loadMore')}
            </Button>
          ) : null}
        </>
      )}
    </>
  );
}

function AuditEntry({ row }: { readonly row: AuditRow }) {
  const { t } = useTranslation('super');
  const { format } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <li>
      <Pressable
        kind="card"
        aria-expanded={open}
        onPress={() => {
          setOpen((value) => !value);
        }}
        className="flex w-full min-h-14 items-center gap-3 px-4 py-3 text-start"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span dir="ltr" className="type-subhead-strong text-text text-start">
            {row.action}
          </span>
          {/* Latin runs (id, time) are isolated so they never reorder inside Urdu text (09 §5). */}
          <span className="type-footnote text-text-secondary">
            {t('audit.by', { actor: t(`audit.actorType.${row.actorType}`) })}
            {row.actorId ? (
              <>
                {' · '}
                <Bdi>{row.actorId.slice(0, 8)}</Bdi>
              </>
            ) : null}
            {' · '}
            {format.date(new Date(row.at), 'medium')} <Time value={wallClockInZone(new Date(row.at))} />
          </span>
        </span>
        <CaretDownIcon size={18} className={open ? 'rotate-180' : ''} />
      </Pressable>
      {open ? (
        <div className="px-4 pb-4">
          <pre dir="ltr" className="overflow-x-auto rounded-sm bg-surface-muted p-3 type-footnote text-text-secondary">
            {JSON.stringify(
              {
                actor: row.actorId ?? row.actorType,
                ...(row.masjidId ? { masjid: row.masjidId } : {}),
                ...(row.targetType ? { target: `${row.targetType} ${row.targetId ?? ''}` } : {}),
                ...(row.meta ? { meta: row.meta } : {}),
                ...(row.requestId ? { request: row.requestId } : {}),
              },
              null,
              2,
            )}
          </pre>
        </div>
      ) : null}
    </li>
  );
}
