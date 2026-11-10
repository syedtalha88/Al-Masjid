// Donation campaign view rules (07 A10, 00 §4.3): progress, days left, which campaigns the list shows and in what
// order, and when the UPI QR sheet says the payment details changed. Pure — shared by the musalli screens and tests.
import { percentOf } from '@mc/domain/money';
import { compareCalendarDates, daysBetween } from '@mc/domain/time';
import type { FeedItem } from '@mc/shared/contracts/public';

export type CampaignDetail = NonNullable<FeedItem['campaign']>;

/** 00 §4.3: closed campaigns stay visible for 30 days with a "Closed" tag. */
export const CLOSED_VISIBLE_DAYS = 30;

/** 07 A10: "Payment details changed on 2 Oct" shows for 30 days after the change went live. */
export const PAYMENT_CHANGED_NOTICE_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * The bar's fill (0–1, capped) and the whole percentage the text shows (may exceed 100 — 00 §4.3).
 */
export function campaignProgress(campaign: CampaignDetail): { fraction: number; percent: number } {
  const { receivedPaise, targetPaise } = campaign;
  return {
    fraction: targetPaise > 0 ? Math.min(Math.max(receivedPaise / targetPaise, 0), 1) : 0,
    percent: percentOf(receivedPaise, targetPaise),
  };
}

/**
 * Days left of an active campaign with an end date (0 = it ends today), else `null` (no end date, completed, closed,
 * or past its end date and waiting for tonight's close).
 */
export function campaignDaysLeft(campaign: CampaignDetail, today: string): number | null {
  if (campaign.status !== 'active' || campaign.endsOn === undefined) return null;
  const left = daysBetween(today, campaign.endsOn);
  return left >= 0 ? left : null;
}

/** Whether the list still shows the campaign: closed ones for {@link CLOSED_VISIBLE_DAYS} after their end date. */
export function campaignListed(campaign: CampaignDetail, today: string): boolean {
  if (campaign.status !== 'closed' || campaign.endsOn === undefined) return true;
  return daysBetween(campaign.endsOn, today) <= CLOSED_VISIBLE_DAYS;
}

const RANK: Readonly<Record<CampaignDetail['status'], number>> = { active: 0, completed: 1, closed: 2 };

/**
 * The A10 list: campaign items only, those still listed, active → completed → closed, keeping the feed's newest-first
 * order inside each.
 */
export function campaignsForList(items: readonly FeedItem[], today: string): FeedItem[] {
  return items
    .filter((item) => item.type === 'campaign' && item.campaign !== undefined && campaignListed(item.campaign, today))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rank = RANK[a.item.campaign?.status ?? 'closed'] - RANK[b.item.campaign?.status ?? 'closed'];
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * When the masjid's UPI details went live, if that was in the last {@link PAYMENT_CHANGED_NOTICE_DAYS} days (the QR
 * sheet then says so — 04 R1: followers are told about a change), else `null`.
 */
export function paymentChangedRecently(effectiveAt: string, now: Date): Date | null {
  const at = new Date(effectiveAt);
  const age = now.getTime() - at.getTime();
  return Number.isFinite(age) && age < PAYMENT_CHANGED_NOTICE_DAYS * DAY_MS ? at : null;
}

/** Whether the campaign has started by `today` ("Started" vs "Starts" — it may be published before its start). */
export const campaignStarted = (campaign: CampaignDetail, today: string): boolean =>
  compareCalendarDates(campaign.startsOn, today) <= 0;
