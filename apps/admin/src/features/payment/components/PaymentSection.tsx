// B8 "UPI setup / change" in B13 Masjid Profile (07 B8, 04 R1, PHASE_05 T5.2): the UPI ID and payee name followers pay
// now (or "Not set up yet"), the change in progress as a three-step timeline — Requested → Approved (on hold until
// <time>) → Live — or the reason it was not approved, and "Set up UPI" / "Change UPI".
import { formatters } from '@mc/i18n/format';
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { AdminPayment } from '@mc/shared/contracts';
import { Button, SkeletonText } from '@mc/ui/components';
import { CheckIcon } from '@mc/ui/icons';
import { useNavigator } from '@mc/ui/navigation';

import { useErrorText } from '../../auth/hooks/use-session.ts';
import { usePayment } from '../hooks/use-payment.ts';
import { liveAtText, stepsDone } from '../lib/payment.ts';

const STEPS = ['requested', 'approved', 'live'] as const;

export function PaymentSection({
  masjidId,
  isOwner,
}: {
  readonly masjidId: string | undefined;
  /** Only an owner may ask for a change (DECISIONS #161); an editor sees who to ask instead of the button. */
  readonly isOwner: boolean;
}) {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const navigator = useNavigator();
  const errorText = useErrorText();
  const payment = usePayment(masjidId);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="profile-payment" data-payment-admin>
      <h2 id="profile-payment" className="type-headline text-text">
        {t('payment.title')}
      </h2>
      <p className="type-callout text-text-secondary">{t('payment.intro')}</p>
      {payment.isError ? (
        <div className="flex flex-col gap-3">
          <p className="type-callout text-text-secondary">{errorText(payment.error)}</p>
          <Button
            variant="secondary"
            size="lg"
            onPress={() => {
              void payment.refetch();
            }}
          >
            {tc('appError.retry')}
          </Button>
        </div>
      ) : !payment.data ? (
        <div aria-busy>
          <SkeletonText lines={3} />
        </div>
      ) : (
        <>
          <LiveDetails payment={payment.data} />
          {payment.data.request ? <RequestStatus request={payment.data.request} /> : null}
          {isOwner ? (
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onPress={() => {
                navigator.push('/payment');
              }}
            >
              {t(payment.data.active ? 'payment.change' : 'payment.setUp')}
            </Button>
          ) : (
            <p className="type-callout text-text-secondary" data-payment-owner-only>
              {t('payment.ownerOnly')}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function LiveDetails({ payment }: { readonly payment: AdminPayment }) {
  const { t } = useTranslation('admin');
  if (!payment.active) {
    return (
      <p className="rounded-md bg-surface px-4 py-3 type-body text-text-secondary shadow-e1">{t('payment.notSet')}</p>
    );
  }
  return (
    <dl className="flex flex-col gap-1 rounded-md bg-surface px-4 py-3 shadow-e1" data-payment-live>
      <dt className="type-footnote text-text-secondary">{t('payment.current')}</dt>
      <dd className="type-headline text-text" dir="ltr">
        {payment.active.vpa}
      </dd>
      <dd className="type-body text-text" dir="auto">
        {payment.active.payeeName}
      </dd>
    </dl>
  );
}

function RequestStatus({ request }: { readonly request: NonNullable<AdminPayment['request']> }) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const done = stepsDone(request);
  const line =
    request.status === 'approved_on_hold' && request.effectiveAt
      ? t('payment.status.approved_on_hold', { time: liveAtText(request.effectiveAt, formatters(locale)) })
      : request.status === 'rejected'
        ? request.rejectCode === 'requester_removed'
          ? t('payment.status.requester_removed')
          : t('payment.status.rejected', { reason: request.rejectReason ?? '' })
        : t('payment.status.pending');
  return (
    <div
      className="flex flex-col gap-3 rounded-md bg-surface px-4 py-3 shadow-e1"
      data-payment-request={request.status}
    >
      <p className="type-subhead-strong text-text" dir="ltr">
        {request.vpa}
      </p>
      {request.status === 'rejected' ? null : (
        <ol className="flex items-center gap-2" aria-label={line}>
          {STEPS.map((step, index) => (
            <li key={step} className="flex flex-1 flex-col items-center gap-1">
              <span
                aria-hidden
                className={`flex size-8 items-center justify-center rounded-full ${
                  index < done ? 'bg-primary-700 text-on-primary' : 'bg-surface-muted text-text-secondary'
                }`}
              >
                {index < done ? <CheckIcon size={18} /> : null}
              </span>
              <span className="type-caption text-text-secondary">{t(`payment.step.${step}`)}</span>
            </li>
          ))}
        </ol>
      )}
      <p
        className={`type-callout ${request.status === 'rejected' ? 'text-danger' : 'text-text-secondary'}`}
        aria-live="polite"
      >
        {line}
      </p>
    </div>
  );
}
