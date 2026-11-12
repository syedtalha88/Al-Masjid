import type { AdminCampaign } from '@mc/shared/contracts';
import { describe, expect, it } from 'vitest';

import {
  campaignActions,
  campaignBody,
  campaignIssues,
  campaignPercent,
  canStartAnother,
  emptyCampaign,
} from '../lib/campaign.ts';

// PHASE_05 T5.3 — B8: what blocks Publish, the body (integer paise, optional parts left out), the live percentage of
// "Update amount", and what each drive's card offers. Fake titles and amounts only.

const TODAY = '2026-11-10';
const ready = {
  ...emptyCampaign(TODAY),
  purpose: 'repair' as const,
  title: 'Test roof repair',
  targetPaise: 10_000_000,
};

describe('B8 create', () => {
  it('needs a purpose, a title, a target of at least ₹1,000 and an end date not before the start', () => {
    expect(campaignIssues(emptyCampaign(TODAY))).toEqual(['purpose', 'title', 'target']);
    expect(campaignIssues({ ...ready, targetPaise: 99_999 })).toEqual(['target']);
    expect(campaignIssues({ ...ready, endsOn: '2026-11-09' })).toEqual(['dates']);
    expect(campaignIssues({ ...ready, endsOn: TODAY })).toEqual([]);
    expect(campaignBody(emptyCampaign(TODAY))).toBeNull();
  });

  it('sends paise, trims text and leaves out what is empty', () => {
    expect(campaignBody({ ...ready, title: '  Test roof repair ', description: '  ' })).toEqual({
      title: 'Test roof repair',
      purpose: 'repair',
      targetPaise: 10_000_000,
      startsOn: TODAY,
      notify: true,
    });
    expect(
      campaignBody({
        ...ready,
        description: 'Placeholder',
        endsOn: '2026-12-31',
        cover: { key: 'm/a/b', thumbhash: 'AAAA', url: null },
        notify: false,
      }),
    ).toMatchObject({
      description: 'Placeholder',
      endsOn: '2026-12-31',
      cover: { key: 'm/a/b', thumbhash: 'AAAA', rightsConfirmed: true },
      notify: false,
    });
  });
});

describe('B8 list', () => {
  const drive = (status: AdminCampaign['status']): AdminCampaign => ({
    id: status,
    publicId: 'p',
    title: 'Test',
    purpose: 'repair',
    status,
    targetPaise: 10_000_000,
    receivedPaise: 7_200_000,
    startsOn: TODAY,
    publishedAt: '2026-11-10T06:30:00.000Z',
  });

  it('shows the real percentage, above 100 too', () => {
    expect(campaignPercent(7_200_000, 10_000_000)).toBe(72);
    expect(campaignPercent(12_000_000, 10_000_000)).toBe(120);
    expect(campaignPercent(5, 0)).toBe(0);
  });

  it('offers "New drive" below 3 active; completed and closed do not count', () => {
    expect(canStartAnother([drive('active'), drive('active'), drive('completed'), drive('closed')])).toBe(true);
    expect(canStartAnother([drive('active'), drive('active'), drive('active')])).toBe(false);
  });

  it('the amount can change until the drive closes; "Mark completed" only while active', () => {
    expect(campaignActions(drive('active'))).toEqual({ updateAmount: true, complete: true });
    expect(campaignActions(drive('completed'))).toEqual({ updateAmount: true, complete: false });
    expect(campaignActions(drive('closed'))).toEqual({ updateAmount: false, complete: false });
  });
});
