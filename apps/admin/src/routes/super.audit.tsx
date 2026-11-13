import { addDays, calendarDateInZone, istInstant, wallClockInZone } from '@mc/domain/time';
import { Bdi, Time, useLocale, useTranslation } from '@mc/i18n/react';
import { AUDIT_ACTION_NAMES, type AuditActionName, type AuditQuery, type AuditRow } from '@mc/shared/contracts';
import { Button, DatePickerSheet, EmptyState, IconButton, Select, SkeletonText, useToast } from '@mc/ui/components';
import { CaretDownIcon, DownloadIcon, XIcon } from '@mc/ui/icons';
import { Pressable } from '@mc/ui/motion';
import { useNavigator, useScreen } from '@mc/ui/navigation';
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

type ActionFilter = 'all' | AuditActionName;
/** Every action, sorted — so each noun's actions (`masjid.*`, `item.*` …) sit together. Log identifiers, as written. */
const ACTION_OPTIONS = AUDIT_ACTION_NAMES.map((value) => ({ value, label: value }));

/** `/super/audit?masjid=<id>&actor=<id>` — set from a masjid's page, its admins, or an entry ("Only this …"). */
const auditHref = (search: { readonly masjid?: string | undefined; readonly actor?: string | undefined }) => {
  const params = new URLSearchParams();
  if (search.masjid) params.set('masjid', search.masjid);
  if (search.actor) params.set('actor', search.actor);
  const query = params.toString();
  return query ? `/super/audit?${query}` : '/super/audit';
};

/**
 * C11 Audit log (T1.11, final in T8.10): filter by action (every action, grouped), masjid and admin (from the URL —
 * removable chips) and India dates; newest first, expandable details, "Show more"; ★ CSV export of the same filter.
 */
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
  const navigator = useNavigator();
  const { format } = useLocale();
  const { search } = useScreen();
  const masjid = search['masjid'];
  const actor = search['actor'];
  const [action, setAction] = useState<ActionFilter>('all');
  const [from, setFrom] = useState<string | null>(null);
  const [until, setUntil] = useState<string | null>(null);
  const [picking, setPicking] = useState<'from' | 'until' | null>(null);
  const today = calendarDateInZone(new Date());
  const filters: AuditQuery = {
    ...(action === 'all' ? {} : { action }),
    ...(masjid ? { masjid } : {}),
    ...(actor ? { actor } : {}),
    // India days: from the start of `from` up to (not including) the day after `until`.
    ...(from ? { from: istInstant(from, '00:00').toISOString() } : {}),
    ...(until ? { to: istInstant(addDays(until, 1), '00:00').toISOString() } : {}),
  };
  const log = useInfiniteQuery({
    queryKey: ['super', 'audit', filters],
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
  // T8.7: the worker counts what retention would delete; the summary arrives as a `retention.run` entry.
  const dryRun = useMutation({
    mutationFn: () => run(() => superApi.retentionDryRun()),
    onSuccess: (result) => {
      toast.show({
        message: t(result.queued ? 'audit.retentionQueued' : 'audit.retentionNotQueued'),
        tone: result.queued ? 'success' : 'error',
      });
    },
    onError: (error) => {
      if (!(error instanceof StepUpCancelled)) toast.show({ message: errorText(error), tone: 'error' });
    },
  });
  const rows = log.data?.pages.flatMap((page) => page.entries) ?? [];
  const dayText = (day: string | null) => (day ? format.date(istInstant(day, '12:00'), 'medium') : t('audit.anyDate'));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <Select<ActionFilter>
            label={t('audit.action')}
            value={action}
            onChange={setAction}
            options={[{ value: 'all', label: t('audit.allActions') }, ...ACTION_OPTIONS]}
          />
        </div>
        <Button
          variant="outline"
          onPress={() => {
            setPicking('from');
          }}
        >
          {`${t('audit.from')}: ${dayText(from)}`}
        </Button>
        <Button
          variant="outline"
          onPress={() => {
            setPicking('until');
          }}
        >
          {`${t('audit.to')}: ${dayText(until)}`}
        </Button>
        {from || until ? (
          <Button
            variant="ghost"
            onPress={() => {
              setFrom(null);
              setUntil(null);
            }}
          >
            {t('audit.clearDates')}
          </Button>
        ) : null}
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
        <Button
          variant="ghost"
          loading={dryRun.isPending}
          onPress={() => {
            dryRun.mutate();
          }}
        >
          {`${t('audit.retentionDryRun')} ★`}
        </Button>
      </div>
      {masjid || actor ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {masjid ? (
            <FilterChip
              label={t('audit.masjidFilter', { id: masjid.slice(0, 8) })}
              removeLabel={t('audit.removeFilter', { name: t('audit.masjidFilter', { id: masjid.slice(0, 8) }) })}
              onRemove={() => {
                navigator.replace(auditHref({ actor }));
              }}
            />
          ) : null}
          {actor ? (
            <FilterChip
              label={t('audit.actorFilter', { id: actor.slice(0, 8) })}
              removeLabel={t('audit.removeFilter', { name: t('audit.actorFilter', { id: actor.slice(0, 8) }) })}
              onRemove={() => {
                navigator.replace(auditHref({ masjid }));
              }}
            />
          ) : null}
        </div>
      ) : null}
      <DatePickerSheet
        open={picking !== null}
        onClose={() => {
          setPicking(null);
        }}
        title={picking === 'until' ? t('audit.to') : t('audit.from')}
        value={picking === 'until' ? until : from}
        max={today}
        today={today}
        {...(picking === 'until' && from ? { min: from } : {})}
        onChange={(day) => {
          if (picking === 'until') setUntil(day);
          else {
            setFrom(day);
            if (until && day > until) setUntil(null);
          }
          setPicking(null);
        }}
      />
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

/** A filter set from the URL, removable (C11). */
function FilterChip({
  label,
  removeLabel,
  onRemove,
}: {
  readonly label: string;
  readonly removeLabel: string;
  readonly onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-mint-50 ps-4 type-footnote text-primary-700">
      <Bdi>{label}</Bdi>
      <IconButton label={removeLabel} icon={<XIcon size={18} />} onPress={onRemove} />
    </span>
  );
}

function AuditEntry({ row }: { readonly row: AuditRow }) {
  const { t } = useTranslation('super');
  const navigator = useNavigator();
  const { search } = useScreen();
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
          {row.actorId || row.masjidId ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {row.actorId && row.actorId !== search['actor'] ? (
                <Button
                  variant="ghost"
                  size="md"
                  onPress={() => {
                    navigator.replace(auditHref({ masjid: search['masjid'], actor: row.actorId }));
                  }}
                >
                  {t('audit.onlyActor')}
                </Button>
              ) : null}
              {row.masjidId && row.masjidId !== search['masjid'] ? (
                <Button
                  variant="ghost"
                  size="md"
                  onPress={() => {
                    navigator.replace(auditHref({ masjid: row.masjidId, actor: search['actor'] }));
                  }}
                >
                  {t('audit.onlyMasjid')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
