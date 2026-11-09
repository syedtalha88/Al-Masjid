import { formatters } from '@mc/i18n/format';
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { SuperPaymentRow } from '@mc/shared/contracts';
import { Button, Checkbox, Dialog, EmptyState, SkeletonText, Tag, TextArea, useToast } from '@mc/ui/components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { StepUpCancelled, useStepUp } from '../features/auth/components/StepUpProvider.tsx';
import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { liveAtText } from '../features/payment/lib/payment.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/payments')({
  component: PaymentApprovalsScreen,
});

const PAYMENTS_KEY = ['super', 'payments'] as const;

/**
 * C4 Payment approvals (07 C4, 04 R1, PHASE_05 T5.2): open UPI change requests, oldest first — the masjid, who asked
 * and when, the details live now next to the requested ones, the masjid's note. A pending request needs both checks
 * (committee phoned; payee name matches) before ★ Approve; Reject asks for the reason the masjid will see. A request
 * on hold can still be stopped (DECISIONS #146).
 */
function PaymentApprovalsScreen() {
  const { t } = useTranslation('super');
  const { t: tc } = useTranslation();
  const errorText = useErrorText();
  const list = useQuery({ queryKey: PAYMENTS_KEY, queryFn: ({ signal }) => superApi.payments(signal) });
  return (
    <SuperFrame title={t('payments.title')} section="payments">
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
      ) : list.data.requests.length === 0 ? (
        <EmptyState className="mt-8" title={t('payments.empty')} />
      ) : (
        <ul className="flex flex-col gap-4">
          {list.data.requests.map((row) => (
            <li key={row.id}>
              <RequestCard row={row} />
            </li>
          ))}
        </ul>
      )}
    </SuperFrame>
  );
}

function RequestCard({ row }: { readonly row: SuperPaymentRow }) {
  const { t } = useTranslation('super');
  const { locale } = useLocale();
  const format = formatters(locale);
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const run = useStepUp();
  const [committee, setCommittee] = useState(false);
  const [name, setName] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: PAYMENTS_KEY });
  const approve = useMutation({
    mutationFn: () => run(() => superApi.approvePayment(row.id)),
    onSuccess: async (result) => {
      toast.show({
        message: t('payments.approved', { time: liveAtText(result.effectiveAt, format) }),
        tone: 'success',
      });
      await refresh();
    },
    onError: (error) => {
      if (!(error instanceof StepUpCancelled)) toast.show({ message: errorText(error), tone: 'error' });
    },
  });
  const reject = useMutation({
    mutationFn: () => superApi.rejectPayment(row.id, reason.trim()),
    onSuccess: async () => {
      setRejecting(false);
      toast.show({ message: t('payments.rejected'), tone: 'success' });
      await refresh();
    },
    onError: (error) => {
      toast.show({ message: errorText(error), tone: 'error' });
    },
  });
  const onHold = row.status === 'approved_on_hold';

  return (
    <article className="flex flex-col gap-4 rounded-md bg-surface p-4 shadow-e1" data-payment-row={row.id}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="type-headline text-text">{row.masjid.name}</h2>
          <p className="type-footnote text-text-secondary">
            {row.masjid.city} ·{' '}
            {t('payments.requestedBy', {
              name: row.requestedBy.displayName,
              when: format.relative(new Date(row.requestedAt), new Date()),
            })}
          </p>
        </div>
        <Tag tone={onHold ? 'sun' : 'info'}>
          {onHold && row.effectiveAt
            ? t('payments.onHold', { time: liveAtText(row.effectiveAt, format) })
            : t('payments.pending')}
        </Tag>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <Details
          label={t('payments.now')}
          vpa={row.current?.vpa}
          payee={row.current?.payeeName}
          none={t('payments.none')}
        />
        <Details label={t('payments.new')} vpa={row.vpa} payee={row.payeeName} none="" highlight />
      </div>
      {row.note ? (
        <div>
          <p className="type-footnote text-text-secondary">{t('payments.note')}</p>
          <p className="type-body text-text" dir="auto">
            {row.note}
          </p>
        </div>
      ) : null}
      {onHold ? null : (
        <div className="flex flex-col gap-2">
          <Checkbox checked={committee} onChange={setCommittee} label={t('payments.checkCommittee')} />
          <Checkbox checked={name} onChange={setName} label={t('payments.checkName')} />
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        {onHold ? null : (
          <Button
            size="lg"
            fullWidth
            disabled={!committee || !name}
            loading={approve.isPending}
            onPress={() => {
              approve.mutate();
            }}
          >
            {`${t('payments.approve')} ★`}
          </Button>
        )}
        <Button
          variant="outline"
          size="lg"
          fullWidth
          onPress={() => {
            setReason('');
            setRejecting(true);
          }}
        >
          {t(onHold ? 'payments.stop' : 'payments.reject')}
        </Button>
      </div>
      <Dialog
        open={rejecting}
        destructive
        loading={reject.isPending}
        onClose={() => {
          setRejecting(false);
        }}
        title={t('payments.rejectTitle')}
        body={
          <TextArea
            label={t('payments.rejectReason')}
            dir="auto"
            maxLength={300}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        }
        confirmLabel={t(onHold ? 'payments.stop' : 'payments.reject')}
        onConfirm={() => {
          if (reason.trim().length >= 3) reject.mutate();
        }}
      />
    </article>
  );
}

function Details({
  label,
  vpa,
  payee,
  none,
  highlight = false,
}: {
  readonly label: string;
  readonly vpa: string | undefined;
  readonly payee: string | undefined;
  readonly none: string;
  readonly highlight?: boolean;
}) {
  return (
    <dl className={`flex flex-col gap-1 rounded-sm p-3 ${highlight ? 'bg-mint-100' : 'bg-surface-muted'}`}>
      <dt className="type-footnote text-text-secondary">{label}</dt>
      {vpa === undefined ? (
        <dd className="type-body text-text-secondary">{none}</dd>
      ) : (
        <>
          <dd className="type-subhead-strong break-all text-text" dir="ltr">
            {vpa}
          </dd>
          <dd className="type-body text-text" dir="auto">
            {payee}
          </dd>
        </>
      )}
    </dl>
  );
}
