// B8 donation drive logic (07 B8, 00 §4.3, PHASE_05 T5.3): the create draft and what is still missing, the request
// body (amounts in integer paise), the live percentage of "Update amount", and what the list allows per drive. Pure.
import { percentOf } from '@mc/domain/money';
import { compareCalendarDates } from '@mc/domain/time';
import {
  type AdminCampaign,
  CAMPAIGN_DESCRIPTION_MAX,
  CAMPAIGN_TARGET_MIN_PAISE,
  CAMPAIGN_TITLE_MAX,
  type CampaignCreate,
  type CampaignPurpose,
  CAMPAIGNS_ACTIVE_MAX,
} from '@mc/shared/contracts';

import type { NoticePhoto } from '../../notice/lib/notice.ts';

export interface CampaignDraft {
  readonly purpose: CampaignPurpose | null;
  readonly title: string;
  readonly description: string;
  readonly targetPaise: number;
  readonly startsOn: string;
  /** Empty = no end date. */
  readonly endsOn: string;
  readonly cover: NoticePhoto | null;
  readonly notify: boolean;
}

export type CampaignIssue = 'purpose' | 'title' | 'target' | 'dates';

export const emptyCampaign = (today: string): CampaignDraft => ({
  purpose: null,
  title: '',
  description: '',
  targetPaise: 0,
  startsOn: today,
  endsOn: '',
  cover: null,
  notify: true,
});

/** What still keeps the drive from being published, in form order. */
export function campaignIssues(draft: CampaignDraft): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  if (draft.purpose === null) issues.push('purpose');
  const title = draft.title.trim();
  if (title.length < 1 || title.length > CAMPAIGN_TITLE_MAX) issues.push('title');
  if (draft.targetPaise < CAMPAIGN_TARGET_MIN_PAISE) issues.push('target');
  if (draft.endsOn !== '' && compareCalendarDates(draft.endsOn, draft.startsOn) < 0) issues.push('dates');
  return issues;
}

/** The body of `POST /campaigns`, or `null` while something is missing. */
export function campaignBody(draft: CampaignDraft): CampaignCreate | null {
  if (campaignIssues(draft).length > 0 || draft.purpose === null) return null;
  const description = draft.description.trim().slice(0, CAMPAIGN_DESCRIPTION_MAX);
  return {
    title: draft.title.trim(),
    purpose: draft.purpose,
    targetPaise: draft.targetPaise,
    startsOn: draft.startsOn,
    notify: draft.notify,
    ...(description === '' ? {} : { description }),
    ...(draft.endsOn === '' ? {} : { endsOn: draft.endsOn }),
    ...(draft.cover
      ? { cover: { key: draft.cover.key, thumbhash: draft.cover.thumbhash, rightsConfirmed: true as const } }
      : {}),
  };
}

/** Whole percent of the target (may exceed 100 — the bar caps, the text shows the real value; 00 §4.3). */
export const campaignPercent = (receivedPaise: number, targetPaise: number): number =>
  percentOf(receivedPaise, targetPaise);

/** "New drive" is offered below the limit of active drives. */
export const canStartAnother = (campaigns: readonly AdminCampaign[]): boolean =>
  campaigns.filter((campaign) => campaign.status === 'active').length < CAMPAIGNS_ACTIVE_MAX;

/** What a drive's card offers: the amount until it closes; "Mark completed" while active. */
export const campaignActions = (campaign: AdminCampaign) => ({
  updateAmount: campaign.status !== 'closed',
  complete: campaign.status === 'active',
});
