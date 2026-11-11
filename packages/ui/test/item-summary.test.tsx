// @vitest-environment jsdom
// PHASE_05 T5.6 — the money line of donation and chanda items in mixed lists (Home, Updates): the sentences of A10 /
// A11 from the `common` namespace (those lists render before `content` is loaded), per locale; nothing for other
// items. Fake data only.
import type { FeedItem } from '@mc/shared/contracts/public';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useItemSummary } from '../src/content/index.ts';
import { renderUi } from './render.tsx';

afterEach(cleanup);

const BASE = {
  masjidId: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
  audience: 'everyone',
  isImportant: false,
  publishedAt: '2026-11-07T05:00:00.000Z',
} as const;

const CAMPAIGN: FeedItem = {
  ...BASE,
  publicId: 'CAMP0001',
  type: 'campaign',
  title: 'Test roof repair',
  campaign: {
    purpose: 'repair',
    targetPaise: 10_000_000,
    receivedPaise: 7_200_000,
    startsOn: '2026-11-01',
    status: 'active',
  },
};
const CHANDA: FeedItem = {
  ...BASE,
  publicId: 'CHND0001',
  type: 'chanda_update',
  chanda: { weekStart: '2026-11-06', amountPaise: 1_850_000 },
};
const NOTICE: FeedItem = { ...BASE, publicId: 'NOTE0001', type: 'announcement', title: 'Test notice' };

function Lines({ items }: { readonly items: readonly FeedItem[] }) {
  const summary = useItemSummary();
  return (
    <ul>
      {items.map((item) => (
        <li key={item.publicId} data-testid={item.publicId}>
          {summary(item) ?? 'none'}
        </li>
      ))}
    </ul>
  );
}

describe('useItemSummary', () => {
  it('English: raised-of for a campaign, collected-in-the-week for chanda, nothing for a notice', async () => {
    // Only `common` is loaded — as on Home and Updates.
    await renderUi(
      <Lines items={[CAMPAIGN, CHANDA, NOTICE, { ...CHANDA, publicId: 'BARE0001', chanda: undefined }]} />,
      {
        namespaces: ['common'],
      },
    );
    expect(screen.getByTestId('CAMP0001').textContent).toBe('₹72,000 raised of ₹1,00,000');
    expect(screen.getByTestId('CHND0001').textContent).toBe('₹18,500 collected in the week of 6 Nov 2026');
    expect(screen.getByTestId('NOTE0001').textContent).toBe('none');
    expect(screen.getByTestId('BARE0001').textContent).toBe('none');
  });

  it.each(['hi', 'ur', 'te'] as const)('%s: translated sentences with the figures filled in', async (locale) => {
    await renderUi(<Lines items={[CAMPAIGN, CHANDA]} />, { locale, namespaces: ['common'] });
    for (const [id, figure] of [
      ['CAMP0001', '72,000'],
      ['CHND0001', '18,500'],
    ] as const) {
      const line = screen.getByTestId(id).textContent;
      expect(line).toContain(figure);
      expect(line).not.toMatch(/[{}]|summary\.|raised|collected/);
    }
  });
});
