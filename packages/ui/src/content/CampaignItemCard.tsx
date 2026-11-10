// A donation campaign item as A10 lists it (07 A10, ref-3/4): the feed item → `CampaignCard` glue — localized status,
// amounts, percentage and days left. The cover's URL comes from the app (media origin).
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { FeedItem } from '@mc/shared/contracts/public';
import type { ReactNode } from 'react';

import { CampaignCard } from '../components/Donation.tsx';
import { Image } from '../components/Image.tsx';
import { HeartIcon } from '../icons/glyph/HeartIcon.tsx';
import { LightningIcon } from '../icons/glyph/LightningIcon.tsx';
import { MosqueIcon } from '../icons/glyph/MosqueIcon.tsx';
import { UsersIcon } from '../icons/glyph/UsersIcon.tsx';
import { WrenchIcon } from '../icons/glyph/WrenchIcon.tsx';
import { campaignDaysLeft, type CampaignDetail, campaignProgress } from './campaign-view.ts';

/** The icon of each campaign purpose (meta row, cover placeholder). */
export function PurposeIcon({
  purpose,
  size = 20,
}: {
  readonly purpose: CampaignDetail['purpose'];
  readonly size?: number;
}) {
  switch (purpose) {
    case 'renovation':
      return <MosqueIcon size={size} />;
    case 'repair':
      return <WrenchIcon size={size} />;
    case 'utilities':
      return <LightningIcon size={size} />;
    case 'welfare':
      return <UsersIcon size={size} />;
    case 'other':
      return <HeartIcon size={size} />;
  }
}

/** A campaign without its own photo: the purpose icon on mint, in the same 16:9 box. */
export function CampaignCoverPlaceholder({
  purpose,
  className,
}: {
  readonly purpose: CampaignDetail['purpose'];
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`flex aspect-video w-full items-center justify-center bg-mint-100 text-primary-700 ${className ?? ''}`}
    >
      <PurposeIcon purpose={purpose} size={56} />
    </span>
  );
}

/** The 16:9 cover of a campaign: its photo (ThumbHash first) or the placeholder. */
export function CampaignCover({
  campaign,
  src,
  rounded = 'rounded-none',
  priority = false,
}: {
  readonly campaign: CampaignDetail;
  /** The photo URL, or `null` without a media origin. */
  readonly src: string | null;
  readonly rounded?: string;
  readonly priority?: boolean;
}): ReactNode {
  if (!campaign.cover) return <CampaignCoverPlaceholder purpose={campaign.purpose} className={rounded} />;
  return (
    <Image src={src} alt="" thumbhash={campaign.cover.thumbhash} ratio="16/9" rounded={rounded} priority={priority} />
  );
}

export interface CampaignItemCardProps {
  readonly item: FeedItem;
  /** "YYYY-MM-DD" in IST (days left). */
  readonly today: string;
  /** The cover photo URL (`null` without a media origin or cover). */
  readonly coverSrc: string | null;
  /** Masjid name on cross-masjid lists. */
  readonly masjid?: string | undefined;
  readonly onPress: () => void;
}

/** A10 list row: `null` for an item that is not a campaign. */
export function CampaignItemCard({ item, today, coverSrc, masjid, onPress }: CampaignItemCardProps) {
  const { t } = useTranslation('content');
  const { format } = useLocale();
  const campaign = item.campaign;
  if (item.type !== 'campaign' || !campaign) return null;
  const { fraction, percent } = campaignProgress(campaign);
  const left = campaignDaysLeft(campaign, today);
  const meta =
    left !== null
      ? t('campaign.daysLeft', { count: left })
      : campaign.status === 'closed' && campaign.endsOn
        ? t('campaign.endedOn', { date: format.calendarDate(campaign.endsOn, 'medium') })
        : undefined;
  return (
    <CampaignCard
      cover={<CampaignCover campaign={campaign} src={coverSrc} />}
      status={campaign.status}
      statusLabel={t(`campaign.status.${campaign.status}`)}
      title={item.title ?? t('campaign.detailTitle')}
      progress={fraction}
      progressLabel={t('campaign.progressLabel')}
      progressText={t('campaign.percent', { percent })}
      amounts={t('campaign.raisedOf', {
        received: format.money(campaign.receivedPaise),
        target: format.money(campaign.targetPaise),
      })}
      meta={meta}
      masjid={masjid}
      onPress={onPress}
    />
  );
}
