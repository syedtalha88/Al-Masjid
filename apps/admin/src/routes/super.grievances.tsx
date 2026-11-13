import { formatters } from '@mc/i18n/format';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { slaProgress } from '@mc/shared/compliance';
import type { GrievanceList } from '@mc/shared/contracts/grievances';
import { Button, Dialog, EmptyState, SkeletonText, Tag, TextArea, type Tone, useToast } from '@mc/ui/components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { StepUpCancelled, useStepUp } from '../features/auth/components/StepUpProvider.tsx';
import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/grievances')({
  component: GrievancesScreen,
});

type Row = GrievanceList['grievances'][number];
const KEY = ['super', 'grievances'] as const;

const CATEGORY_KEY = {
  privacy: 'grievances.category.privacy',
  content: 'grievances.category.content',
  technical: 'grievances.category.technical',
  feedback: 'grievances.category.feedback',
  other: 'grievances.category.other',
} as const satisfies Readonly<Record<Row['category'], string>>;
const STATUS_KEY = {
  open: 'grievances.status.open',
  acknowledged: 'grievances.status.acknowledged',
  resolved: 'grievances.status.resolved',
  rejected: 'grievances.status.rejected',
} as const satisfies Readonly<Record<Row['status'], string>>;

/**
 * C6 Grievances (07 C6, 05 §3, PHASE_08 T8.4): unfinished first by their next due time with a timer (acknowledge
 * within 24 h, resolve within 72 h — red under 20 % left), then the finished ones. Acknowledge; Resolve / Reject with
 * a note; ★ Show contact (step-up, audited) when the person left one.
 */
function GrievancesScreen() {
  const { t } = useTranslation('super');
  const { t: tc } = useTranslation();
  const errorText = useErrorText();
  const list = useQuery({ queryKey: KEY, queryFn: ({ signal }) => superApi.grievances(signal) });
  return (
    <SuperFrame title={t('grievances.title')} section="grievances">
      {list.isError ? (
        <EmptyState
          className="mt-8"
          title={errorText(list.error)}
          action={
            <Button
              size="lg"
              onPress={() => {
                void list.refetch();
              }}
            >
              {tc('appError.retry')}
            </Button>
          }
        />
      ) : !list.data ? (
        <SkeletonText lines={8} />
      ) : list.data.grievances.length === 0 ? (
        <EmptyState className="mt-8" title={t('grievances.empty')} />
      ) : (
        <ul className="flex flex-col gap-4">
          {list.data.grievances.map((row) => (
            <li key={row.id}>
              <GrievanceCard row={row} />
            </li>
          ))}
        </ul>
      )}
    </SuperFrame>
  );
}

function GrievanceCard({ row }: { readonly row: Row }) {
  const { t } = useTranslation('super');
  const { locale } = useLocale();
  const format = formatters(locale);
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const run = useStepUp();
  const [resolving, setResolving] = useState<'resolved' | 'rejected' | null>(null);
  const [note, setNote] = useState('');
  const [contact, setContact] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const onError = (error: unknown) => {
    if (!(error instanceof StepUpCancelled)) toast.show({ message: errorText(error), tone: 'error' });
  };
  const ack = useMutation({
    mutationFn: () => superApi.ackGrievance(row.id),
    onSuccess: async () => {
      toast.show({ message: t('grievances.acknowledged'), tone: 'success' });
      await refresh();
    },
    onError,
  });
  const resolve = useMutation({
    mutationFn: (status: 'resolved' | 'rejected') => superApi.resolveGrievance(row.id, status, note.trim()),
    onSuccess: async () => {
      setResolving(null);
      toast.show({ message: t('grievances.closed'), tone: 'success' });
      await refresh();
    },
    onError,
  });
  const reveal = useMutation({
    mutationFn: () => run(() => superApi.grievanceContact(row.id)),
    onSuccess: (result) => {
      setContact(result.contact ?? '');
    },
    onError,
  });

  const now = new Date();
  const finished = row.status === 'resolved' || row.status === 'rejected';
  const start = new Date(row.status === 'open' ? row.createdAt : (row.acknowledgedAt ?? row.createdAt));
  const due = new Date(row.status === 'open' ? row.ackDueAt : row.resolveDueAt);
  const progress = slaProgress(start, due, now);
  const dueTone: Tone = progress.overdue ? 'danger' : progress.red ? 'sun' : 'info';

  return (
    <article className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-e1" data-grievance={row.publicRef}>
      <header className="flex flex-wrap items-center gap-2">
        <bdi dir="ltr" className="type-headline text-text">
          {row.publicRef}
        </bdi>
        <Tag tone={finished ? 'neutral' : 'slate'}>{t(STATUS_KEY[row.status])}</Tag>
        <Tag tone="neutral">{t(CATEGORY_KEY[row.category])}</Tag>
        {finished ? null : (
          <span data-due>
            <Tag tone={dueTone}>
              {t(
                row.status === 'open'
                  ? progress.overdue
                    ? 'grievances.ackOverdue'
                    : 'grievances.ackDue'
                  : progress.overdue
                    ? 'grievances.resolveOverdue'
                    : 'grievances.resolveDue',
                { when: format.relative(due, now) },
              )}
            </Tag>
          </span>
        )}
      </header>
      <p className="type-caption text-text-tertiary">{format.relative(new Date(row.createdAt), now)}</p>
      <p className="type-body whitespace-pre-line text-text" dir="auto">
        {row.description}
      </p>
      {row.resolution ? (
        <p className="rounded-sm bg-surface-muted p-3 type-footnote whitespace-pre-line text-text" dir="auto">
          {row.resolution}
        </p>
      ) : null}
      {contact !== null ? (
        <p className="type-callout text-text" data-grievance-contact>
          {contact === '' ? t('grievances.noContact') : <bdi dir="ltr">{contact}</bdi>}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {row.status === 'open' ? (
          <Button
            size="lg"
            loading={ack.isPending}
            onPress={() => {
              ack.mutate();
            }}
          >
            {t('grievances.acknowledge')}
          </Button>
        ) : null}
        {finished ? null : (
          <>
            <Button
              variant="outline"
              size="lg"
              onPress={() => {
                setNote('');
                setResolving('resolved');
              }}
            >
              {t('grievances.resolve')}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onPress={() => {
                setNote('');
                setResolving('rejected');
              }}
            >
              {t('grievances.reject')}
            </Button>
          </>
        )}
        {row.hasContact && contact === null ? (
          <Button
            variant="secondary"
            size="lg"
            loading={reveal.isPending}
            onPress={() => {
              reveal.mutate();
            }}
          >
            {`${t('grievances.showContact')} ★`}
          </Button>
        ) : null}
      </div>
      <Dialog
        open={resolving !== null}
        loading={resolve.isPending}
        onClose={() => {
          setResolving(null);
        }}
        title={t(resolving === 'rejected' ? 'grievances.rejectTitle' : 'grievances.resolveTitle')}
        body={
          <TextArea
            label={t('grievances.note')}
            dir="auto"
            maxLength={2000}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        }
        confirmLabel={t(resolving === 'rejected' ? 'grievances.reject' : 'grievances.resolve')}
        onConfirm={() => {
          if (resolving && note.trim().length > 0) resolve.mutate(resolving);
        }}
      />
    </article>
  );
}
