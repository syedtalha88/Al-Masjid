// @vitest-environment jsdom
// A10 donation components (06 §6, 07 A10, PHASE_05 T5.4): the campaign card as one button (title + amounts, bar hidden
// from assistive tech inside it), status pills, the AmountPair / MetaRow structure, and the item → card glue in English
// and Urdu. Fake campaign data only.
import type { FeedItem } from '@mc/shared/contracts/public';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AmountPair, MetaRow, ProgressBar, StatusPill } from '../src/components/index.ts';
import { CampaignItemCard } from '../src/content/index.ts';
import { renderUi } from './render.tsx';

afterEach(cleanup);

const item = (overrides: Partial<NonNullable<FeedItem['campaign']>> = {}): FeedItem => ({
  publicId: 'CAMP0001',
  masjidId: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
  type: 'campaign',
  audience: 'everyone',
  title: 'Test roof repair',
  body: 'Placeholder description',
  isImportant: false,
  publishedAt: '2026-11-01T05:00:00.000Z',
  campaign: {
    purpose: 'repair',
    targetPaise: 10_000_000,
    receivedPaise: 7_200_000,
    startsOn: '2026-11-01',
    endsOn: '2026-11-22',
    status: 'active',
    ...overrides,
  },
});

describe('CampaignItemCard', () => {
  it('is one button named by its title; amounts, percentage and days left describe it', async () => {
    const onPress = vi.fn();
    await renderUi(<CampaignItemCard item={item()} today="2026-11-10" coverSrc={null} onPress={onPress} />, {
      namespaces: ['common', 'content'],
    });
    const button = screen.getByRole('button', { name: 'Test roof repair' });
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    expect(button.textContent).toContain('₹72,000 raised of ₹1,00,000');
    expect(button.textContent).toContain('72%');
    expect(button.textContent).toContain('12 days left');
    expect(screen.getByText('Active').getAttribute('data-status')).toBe('active');
    // The bar inside the button is decorative (a button's children are presentational).
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('closed: the end date instead of days left; over the target: the real percentage', async () => {
    await renderUi(
      <CampaignItemCard
        item={item({ status: 'closed', receivedPaise: 13_000_000, endsOn: '2026-11-05' })}
        today="2026-11-10"
        coverSrc={null}
        onPress={vi.fn()}
      />,
      { namespaces: ['common', 'content'] },
    );
    const button = screen.getByRole('button', { name: 'Test roof repair' });
    expect(button.textContent).toContain('130%');
    expect(button.textContent).toContain('Ended 5 Nov 2026');
    expect(screen.getByText('Closed').getAttribute('data-status')).toBe('closed');
  });

  it('renders in Urdu (RTL strings present, amounts kept in Latin digits)', async () => {
    await renderUi(<CampaignItemCard item={item()} today="2026-11-10" coverSrc={null} onPress={vi.fn()} />, {
      locale: 'ur',
      namespaces: ['common', 'content'],
    });
    const button = screen.getByRole('button', { name: 'Test roof repair' });
    expect(button.textContent).toContain('₹72,000');
    expect(button.textContent).toContain('جاری');
  });

  it('is nothing for an item that is not a campaign', async () => {
    const { container } = await renderUi(
      <CampaignItemCard
        item={{ ...item(), type: 'announcement', campaign: undefined }}
        today="2026-11-10"
        coverSrc={null}
        onPress={vi.fn()}
      />,
      { namespaces: ['common', 'content'] },
    );
    expect(container.textContent).toBe('');
  });
});

describe('donation components', () => {
  it('AmountPair pairs each amount with its caption; MetaRow its labels with values', async () => {
    await renderUi(
      <>
        <AmountPair
          received="₹72,000"
          receivedLabel="Received (reported by masjid)"
          target="₹1,00,000"
          targetLabel="Goal"
        />
        <MetaRow
          items={[
            { icon: null, label: 'Started', value: '1 Nov 2026' },
            { icon: null, label: 'Ends', value: '22 Nov 2026' },
            { icon: null, label: 'Purpose', value: 'Repair' },
          ]}
        />
      </>,
    );
    const terms = screen.getAllByRole('term').map((node) => node.textContent);
    const values = screen.getAllByRole('definition').map((node) => node.textContent);
    expect(terms).toEqual(['Received (reported by masjid)', 'Goal', 'Started', 'Ends', 'Purpose']);
    expect(values).toEqual(['₹72,000', '₹1,00,000', '1 Nov 2026', '22 Nov 2026', 'Repair']);
  });

  it('StatusPill tones; a decorative ProgressBar has no role', async () => {
    await renderUi(
      <>
        <StatusPill status="completed">Completed</StatusPill>
        <ProgressBar value={0.4} label="Raised" decorative />
        <ProgressBar value={0.4} label="Raised" />
      </>,
    );
    expect(screen.getByText('Completed').className).toContain('bg-mint-100');
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });
});
