// A10 campaign view rules (07 A10, 00 §4.3, PHASE_05 T5.4): progress capped for the bar but real in the text, days
// left, closed campaigns listed for 30 days, list order, "payment details changed" for 30 days. Fake data only.
import type { FeedItem } from '@mc/shared/contracts/public';
import { describe, expect, it } from 'vitest';

import {
  campaignDaysLeft,
  campaignListed,
  campaignProgress,
  campaignsForList,
  paymentChangedRecently,
} from '../src/content/campaign-view.ts';

type Campaign = NonNullable<FeedItem['campaign']>;
const campaign = (overrides: Partial<Campaign> = {}): Campaign => ({
  purpose: 'repair',
  targetPaise: 10_000_000,
  receivedPaise: 7_200_000,
  startsOn: '2026-10-01',
  status: 'active',
  ...overrides,
});
const item = (publicId: string, overrides: Partial<Campaign> = {}): FeedItem => ({
  publicId,
  masjidId: '00000000-0000-4000-8000-000000000001',
  type: 'campaign',
  audience: 'everyone',
  title: `Test ${publicId}`,
  isImportant: false,
  publishedAt: '2026-10-01T05:00:00.000Z',
  campaign: campaign(overrides),
});

describe('campaignProgress', () => {
  it('caps the bar at 100 % while the text shows the real percentage', () => {
    expect(campaignProgress(campaign())).toEqual({ fraction: 0.72, percent: 72 });
    expect(campaignProgress(campaign({ receivedPaise: 13_000_000 }))).toEqual({ fraction: 1, percent: 130 });
    expect(campaignProgress(campaign({ receivedPaise: 0 }))).toEqual({ fraction: 0, percent: 0 });
    expect(campaignProgress(campaign({ receivedPaise: 99_999 }))).toEqual({ fraction: 0.0099999, percent: 0 });
  });
});

describe('campaignDaysLeft', () => {
  it('counts down to the end date (0 = the last day); none without an end date or once not active', () => {
    expect(campaignDaysLeft(campaign({ endsOn: '2026-11-22' }), '2026-11-10')).toBe(12);
    expect(campaignDaysLeft(campaign({ endsOn: '2026-11-10' }), '2026-11-10')).toBe(0);
    expect(campaignDaysLeft(campaign({ endsOn: '2026-11-09' }), '2026-11-10')).toBeNull(); // the job closes it tonight
    expect(campaignDaysLeft(campaign(), '2026-11-10')).toBeNull();
    expect(campaignDaysLeft(campaign({ endsOn: '2026-11-22', status: 'completed' }), '2026-11-10')).toBeNull();
  });
});

describe('campaignListed', () => {
  it('lists active and completed campaigns; closed ones for 30 days after their end date', () => {
    expect(campaignListed(campaign(), '2026-11-10')).toBe(true);
    expect(campaignListed(campaign({ status: 'completed' }), '2030-01-01')).toBe(true);
    expect(campaignListed(campaign({ status: 'closed', endsOn: '2026-10-11' }), '2026-11-10')).toBe(true);
    expect(campaignListed(campaign({ status: 'closed', endsOn: '2026-10-10' }), '2026-11-10')).toBe(false);
    expect(campaignListed(campaign({ status: 'closed' }), '2026-11-10')).toBe(true); // no end date: never closed by the job
  });
});

describe('campaignsForList', () => {
  it('active first, then completed, then closed — newest first inside each (the feed order); others left out', () => {
    const items = [
      item('c1', { status: 'closed', endsOn: '2026-11-01' }),
      item('d1', { status: 'completed' }),
      item('a1'),
      item('x', { status: 'closed', endsOn: '2026-01-01' }),
      item('a2'),
      { ...item('n'), type: 'announcement' as const, campaign: undefined },
    ];
    expect(campaignsForList(items, '2026-11-10').map((entry) => entry.publicId)).toEqual(['a1', 'a2', 'd1', 'c1']);
  });
});

describe('paymentChangedRecently', () => {
  const now = new Date('2026-11-10T06:30:00Z');
  it('is the change date for 30 days after the new details went live', () => {
    expect(paymentChangedRecently('2026-11-02T04:00:00.000Z', now)?.toISOString()).toBe('2026-11-02T04:00:00.000Z');
    expect(paymentChangedRecently('2026-10-11T07:00:00.000Z', now)).not.toBeNull();
    expect(paymentChangedRecently('2026-10-11T06:00:00.000Z', now)).toBeNull();
    expect(paymentChangedRecently('not a date', now)).toBeNull();
  });
});
