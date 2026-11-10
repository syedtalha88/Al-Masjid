// A10 campaign detail (07 A10, ref-3/4 + ref-2/3, 08 §5.7): the 16:9 cover with its status pill, an overlapping sheet
// with the title and short description, received (count-up, "reported by masjid") vs goal, the progress bar (fills when
// it first comes into view) with the percentage, "Last updated … by masjid admin", Started · Ends · Purpose, About this
// campaign, Donate Now (the `upi://pay` link to the masjid's live, change-locked UPI details — 04 R1; the QR sheet when
// no UPI app took it) and Show UPI QR Code, the "no money through us" note in every language (05 §8). Closed: no buttons,
// the thank-you banner. The QR sheet is a lazy chunk.
import { calendarDateInZone, wallClockInZone } from '@mc/domain/time';
import { buildUpiUri } from '@mc/domain/upi';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { ltrIsolate } from '@mc/i18n/template-args';
import { BRAND } from '@mc/shared/brand';
import type { FeedItem } from '@mc/shared/contracts/public';
import { AmountPair, Button, Card, InfoNote, MetaRow, ProgressBar, StatusPill, useToast } from '@mc/ui/components';
import { CampaignCover, campaignProgress, campaignStarted, PurposeIcon } from '@mc/ui/content';
import { CalendarIcon, CheckCircleIcon, ClockIcon, HeartIcon, QrCodeIcon } from '@mc/ui/icons';
import { CountUp } from '@mc/ui/motion';
import { Screen } from '@mc/ui/navigation';
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useNow } from '../../lib/clock.ts';
import { mediaUrl } from '../../lib/media.ts';
import { useMasjidBundle } from '../masjid/hooks/useMasjidBundle.ts';
import { openUpiLink, UPI_FALLBACK_MS } from './lib/upi-actions.ts';

const loadQrSheet = () => import('./UpiQrSheet.tsx');
const UpiQrSheet = lazy(loadQrSheet);

/** Cover width requested from the media CDN (full-width hero; 2× density on a 480 px screen). */
const COVER_WIDTH = 960;

export interface CampaignDetailProps {
  readonly item: FeedItem;
  /** The masjid's name (bar subtitle). */
  readonly masjidName: string | undefined;
  /** Share button (the item detail's own). */
  readonly share: ReactNode;
  /** The post landing's actions (Follow, get the app); nothing in the app. */
  readonly footer: ReactNode;
}

export function CampaignDetail({ item, masjidName, share, footer }: CampaignDetailProps) {
  const { t } = useTranslation('content');
  const { format } = useLocale();
  const toast = useToast();
  const now = useNow();
  const { masjid } = useMasjidBundle(item.masjidId);
  const [opening, setOpening] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrMounted, setQrMounted] = useState(false);
  const cancelOpen = useRef<(() => void) | null>(null);
  const money = useCallback((paise: number) => format.money(paise), [format]);

  const campaign = item.campaign;
  const payment = masjid.state === 'active' ? masjid.bundle.payment : null;
  const title = item.title ?? t('campaign.detailTitle');
  const link = useMemo(() => {
    if (!payment) return null;
    try {
      return buildUpiUri({ vpa: payment.vpa, payeeName: payment.payeeName, note: title });
    } catch {
      return null;
    }
  }, [payment, title]);

  // The QR sheet's chunk loads while the musalli reads, so the no-UPI-app fallback opens without a wait (and offline).
  useEffect(() => {
    void loadQrSheet().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!opening) return;
    const timer = setTimeout(() => {
      setOpening(false);
    }, UPI_FALLBACK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [opening]);
  useEffect(
    () => () => {
      cancelOpen.current?.();
    },
    [],
  );

  if (!campaign) return null;
  const { fraction, percent } = campaignProgress(campaign);
  const today = calendarDateInZone(now);
  const closed = campaign.status === 'closed';
  const updatedAt = campaign.receivedUpdatedAt ? new Date(campaign.receivedUpdatedAt) : null;
  const description = item.body?.trim();

  const showQr = () => {
    setQrMounted(true);
    setQrOpen(true);
  };
  const donate = () => {
    if (!link || opening) return;
    setOpening(true);
    toast.show({ message: t('campaign.opening') });
    cancelOpen.current?.();
    cancelOpen.current = openUpiLink(link, showQr);
  };

  return (
    <Screen title={t('campaign.detailTitle')} {...(masjidName ? { subtitle: masjidName } : {})}>
      <article className="flex flex-col pt-2 pb-6" data-campaign={campaign.status}>
        <div className="relative overflow-hidden rounded-lg">
          <CampaignCover
            campaign={campaign}
            src={campaign.cover ? mediaUrl(campaign.cover.key, COVER_WIDTH) : null}
            rounded="rounded-lg"
            priority
          />
          <StatusPill status={campaign.status} className="absolute end-3 top-3">
            {t(`campaign.status.${campaign.status}`)}
          </StatusPill>
        </div>

        <div className="relative -mt-6 flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-e1">
          <header className="flex flex-col gap-1">
            <h2 dir="auto" className="type-title1 text-text">
              {title}
            </h2>
            {description ? (
              <p dir="auto" className="line-clamp-2 type-callout text-text-secondary">
                {description}
              </p>
            ) : null}
          </header>

          <AmountPair
            received={<CountUp value={campaign.receivedPaise} format={money} />}
            receivedLabel={t('campaign.received')}
            target={format.money(campaign.targetPaise)}
            targetLabel={t('campaign.goal')}
          />
          <div className="flex items-center gap-3">
            <ProgressBar
              value={fraction}
              label={t('campaign.progressLabel')}
              valueText={t('campaign.percent', { percent })}
              className="flex-1"
            />
            <span className="type-subhead-strong tabular-nums text-primary-700">
              {t('campaign.percent', { percent })}
            </span>
          </div>
          {updatedAt ? (
            <p className="flex items-center gap-2 rounded-sm bg-mint-50 px-3 py-2 type-footnote text-text-secondary">
              <ClockIcon size={18} className="shrink-0 text-primary-700" />
              {t('campaign.lastUpdated', {
                // The time is an LTR isolate: inside an Urdu sentence it would read "PM 10:10" (DECISIONS #136).
                when: `${format.date(updatedAt, 'short')}, ${ltrIsolate(format.time(wallClockInZone(updatedAt)).text)}`,
              })}
            </p>
          ) : null}

          <MetaRow
            items={[
              {
                icon: <CalendarIcon size={18} />,
                label: t(campaignStarted(campaign, today) ? 'campaign.started' : 'campaign.starts'),
                value: format.calendarDate(campaign.startsOn, 'medium'),
              },
              {
                icon: <CalendarIcon size={18} />,
                label: t('campaign.ends'),
                value: campaign.endsOn ? format.calendarDate(campaign.endsOn, 'medium') : t('campaign.noEnd'),
              },
              {
                icon: <PurposeIcon purpose={campaign.purpose} size={18} />,
                label: t('campaign.purposeLabel'),
                value: t(`campaign.purpose.${campaign.purpose}`),
              },
            ]}
          />

          {description ? (
            <section className="flex flex-col gap-1" aria-labelledby="campaign-about">
              <h3 id="campaign-about" className="type-headline text-text">
                {t('campaign.about')}
              </h3>
              <p dir="auto" className="type-body whitespace-pre-line text-text">
                {description}
              </p>
            </section>
          ) : null}

          {closed ? (
            <Card variant="mint" className="flex items-start gap-3" data-campaign-closed>
              <CheckCircleIcon size={22} className="shrink-0 text-primary-700" />
              <p className="type-callout text-primary-800">{t('campaign.closedBanner')}</p>
            </Card>
          ) : link ? (
            <div className="flex flex-col gap-3">
              <Button
                size="lg"
                fullWidth
                loading={opening}
                leadingIcon={<HeartIcon filled />}
                onPress={donate}
                data-donate
              >
                {t('campaign.donateNow')}
              </Button>
              <Button variant="secondary" size="lg" fullWidth leadingIcon={<QrCodeIcon />} onPress={showQr}>
                {t('campaign.showQr')}
              </Button>
            </div>
          ) : masjid.state !== 'loading' ? (
            <InfoNote>{t('campaign.noUpi')}</InfoNote>
          ) : null}

          <InfoNote>
            <span data-disclaimer>{t('campaign.disclaimer', { app: BRAND.name })}</span>
          </InfoNote>
          {share}
          {footer}
        </div>
      </article>
      {qrMounted && payment ? (
        <Suspense fallback={null}>
          <UpiQrSheet
            open={qrOpen}
            onClose={() => {
              setQrOpen(false);
            }}
            payment={payment}
            note={title}
          />
        </Suspense>
      ) : null}
    </Screen>
  );
}
