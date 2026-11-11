import { formatters } from '@mc/i18n/format';
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { AdminCampaign } from '@mc/shared/contracts';
import {
  Button,
  Dialog,
  EmptyState,
  InfoNote,
  NumberPad,
  ProgressBar,
  Sheet,
  SkeletonText,
  Switch,
  Tag,
  useToast,
} from '@mc/ui/components';
import { HeartIcon, PlusIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useCampaigns, useCampaignWrites } from '../features/campaign/hooks/use-campaigns.ts';
import { campaignActions, campaignPercent, canStartAnother } from '../features/campaign/lib/campaign.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { usePayment } from '../features/payment/hooks/use-payment.ts';

export const Route = createFileRoute('/donation/')({
  component: DonationScreen,
});

const STATUS_TONE = { active: 'primary', completed: 'info', closed: 'neutral' } as const;

/**
 * B8 Donation Drive (07 B8, 00 §4.3, PHASE_05 T5.3): the masjid's drives with progress and a big "Update amount" each
 * (NumberPad sheet with the live percentage; "Notify followers" off by default), "Mark completed", and "New drive" —
 * blocked with "Set up your masjid's UPI first" until the masjid has active UPI details (the change-lock, T5.2).
 */
function DonationScreen() {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const navigator = useNavigator();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const list = useCampaigns(masjid?.id);
  const payment = usePayment(masjid?.id);
  const hasUpi = (payment.data?.active ?? null) !== null;
  const campaigns = list.data?.campaigns ?? [];
  const canStart = canStartAnother(campaigns);

  return (
    <Screen title={t('donation.title')}>
      <div className="flex flex-col gap-4 pb-6" data-donation>
        <p className="type-callout text-text-secondary">{t('donation.intro')}</p>
        {payment.data && !hasUpi ? (
          <div className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-e1" data-donation-no-upi>
            <h2 className="type-headline text-text">{t('donation.noUpi')}</h2>
            <p className="type-body text-text-secondary">{t('donation.noUpiBody')}</p>
            <Button
              size="lg"
              fullWidth
              onPress={() => {
                navigator.push('/payment');
              }}
            >
              {t('donation.setUpUpi')}
            </Button>
          </div>
        ) : null}
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
          <div aria-busy>
            <SkeletonText lines={6} />
          </div>
        ) : campaigns.length === 0 ? (
          <EmptyState className="mt-4" title={t('donation.empty')} body={t('donation.emptyBody')} />
        ) : (
          <ul className="flex flex-col gap-4">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <DriveCard masjidId={masjid?.id} campaign={campaign} />
              </li>
            ))}
          </ul>
        )}
        {hasUpi && list.data ? (
          <>
            <Button
              size="lg"
              fullWidth
              leadingIcon={<PlusIcon />}
              disabled={!canStart}
              onPress={() => {
                navigator.push('/donation/new');
              }}
            >
              {t('donation.new')}
            </Button>
            {canStart ? null : <InfoNote>{t('donation.limit')}</InfoNote>}
          </>
        ) : null}
      </div>
    </Screen>
  );
}

function DriveCard({
  masjidId,
  campaign,
}: {
  readonly masjidId: string | undefined;
  readonly campaign: AdminCampaign;
}) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const format = formatters(locale);
  const toast = useToast();
  const errorText = useErrorText();
  const { received, complete } = useCampaignWrites(masjidId);
  const actions = campaignActions(campaign);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(campaign.receivedPaise);
  const [notify, setNotify] = useState(false);
  const [completing, setCompleting] = useState(false);
  const percent = campaignPercent(campaign.receivedPaise, campaign.targetPaise);
  const livePercent = campaignPercent(amount, campaign.targetPaise);

  return (
    <article className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-e1" data-drive={campaign.id}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <HeartIcon size={24} filled className="mt-1 shrink-0 text-heart" />
          <h2 className="type-headline text-text" dir="auto">
            {campaign.title}
          </h2>
        </div>
        <Tag tone={STATUS_TONE[campaign.status]}>{t(`donation.status.${campaign.status}`)}</Tag>
      </header>
      <ProgressBar
        value={campaign.targetPaise > 0 ? campaign.receivedPaise / campaign.targetPaise : 0}
        label={t('donation.receivedLabel')}
        valueText={`${String(percent)}%`}
      />
      <p className="type-body text-text">
        {t('donation.amounts', {
          received: format.money(campaign.receivedPaise),
          target: format.money(campaign.targetPaise),
        })}{' '}
        <span className="text-text-secondary">· {`${String(percent)}%`}</span>
      </p>
      {actions.updateAmount ? (
        <Button
          size="lg"
          fullWidth
          onPress={() => {
            setAmount(campaign.receivedPaise);
            setNotify(false);
            setEditing(true);
          }}
        >
          {t('donation.updateAmount')}
        </Button>
      ) : null}
      {actions.complete ? (
        <Button
          variant="outline"
          size="lg"
          fullWidth
          onPress={() => {
            setCompleting(true);
          }}
        >
          {t('donation.complete')}
        </Button>
      ) : null}

      <Sheet
        open={editing}
        onClose={() => {
          setEditing(false);
        }}
        title={t('donation.updateTitle')}
        footer={
          <Button
            size="lg"
            fullWidth
            loading={received.isPending}
            disabled={amount === campaign.receivedPaise && !notify}
            onPress={() => {
              received.mutate(
                { campaignId: campaign.id, body: { receivedPaise: amount, notify } },
                {
                  onSuccess: () => {
                    setEditing(false);
                    toast.show({ message: t('donation.saved'), tone: 'success' });
                  },
                  onError: (error) => {
                    toast.show({ message: errorText(error), tone: 'error' });
                  },
                },
              );
            }}
          >
            {t('donation.save')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-2" data-update-amount>
          <p className="type-title2 text-center text-text" aria-live="polite">
            {format.money(amount)}{' '}
            <span className="type-headline text-text-secondary">· {`${String(livePercent)}%`}</span>
          </p>
          <ProgressBar
            value={campaign.targetPaise > 0 ? amount / campaign.targetPaise : 0}
            label={t('donation.receivedLabel')}
            valueText={`${String(livePercent)}%`}
          />
          <NumberPad value={amount} onChange={setAmount} label={t('donation.updateTitle')} />
          <Switch
            checked={notify}
            onChange={setNotify}
            label={t('donation.notify')}
            description={t('donation.notifyHint')}
          />
        </div>
      </Sheet>

      <Dialog
        open={completing}
        loading={complete.isPending}
        onClose={() => {
          setCompleting(false);
        }}
        title={t('donation.completeTitle')}
        body={t('donation.completeBody')}
        confirmLabel={t('donation.complete')}
        onConfirm={() => {
          complete.mutate(campaign.id, {
            onSuccess: () => {
              setCompleting(false);
              toast.show({ message: t('donation.completed'), tone: 'success' });
            },
            onError: (error) => {
              setCompleting(false);
              toast.show({ message: errorText(error), tone: 'error' });
            },
          });
        }}
      />
    </article>
  );
}
