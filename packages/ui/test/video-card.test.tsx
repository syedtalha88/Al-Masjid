// @vitest-environment jsdom
import type { FeedItem } from '@mc/shared/contracts/public';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VideoCard, YouTubeFacade } from '../src/content/index.ts';
import { renderUi } from './render.tsx';

// PHASE_06 T6.3 · 07 A12 · DECISIONS #39: the bayan card and the YouTube facade show OUR thumbnail; the youtube-nocookie
// iframe exists only after Play is tapped; offline there is no Play. Made-up ids and fake titles only.

const EMBED = 'https://www.youtube-nocookie.com/embed/AbC_123-xYz?autoplay=1&rel=0&playsinline=1';
const item: FeedItem = {
  publicId: 'videoAAAAAAA',
  masjidId: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
  type: 'video',
  audience: 'sisters',
  isImportant: false,
  title: 'Test bayan title',
  publishedAt: '2026-11-13T06:30:00.000Z',
  video: {
    youtubeId: 'AbC_123-xYz',
    speaker: 'Test Speaker',
    thumb: { key: 'm/x/thumb', thumbhash: 'AAAA' },
  },
};

afterEach(cleanup);

describe('VideoCard', () => {
  it('title, speaker, the "YouTube" text tag, our thumbnail; press opens', async () => {
    const onPress = vi.fn();
    await renderUi(<VideoCard item={item} thumbSrc="https://media.test/i/960/webp/m/x/thumb" onPress={onPress} />, {
      namespaces: ['common'],
    });
    expect(screen.getByText('Test bayan title')).toBeTruthy();
    expect(screen.getByText('Test Speaker')).toBeTruthy();
    expect(screen.getByText('YouTube')).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://media.test/i/960/webp/m/x/thumb');
    fireEvent.click(screen.getByText('Test bayan title'));
    expect(onPress).toHaveBeenCalledOnce();
  });
});

describe('YouTubeFacade', () => {
  it('no iframe until Play; the button is named with the title; then the nocookie embed', async () => {
    await renderUi(<YouTubeFacade title="Test bayan title" thumbSrc={null} embedSrc={EMBED} offline={false} />, {
      namespaces: ['common'],
    });
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByText('Plays from YouTube')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play Test bayan title' }));
    const frame = document.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe(EMBED);
    expect(frame?.getAttribute('title')).toBe('Test bayan title');
    expect(frame?.getAttribute('allow')).toBe('autoplay; encrypted-media; picture-in-picture; fullscreen');
    expect(frame?.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
  });

  it('offline: no Play, "Connect to the internet to watch", no iframe', async () => {
    await renderUi(<YouTubeFacade title="Test bayan title" thumbSrc={null} embedSrc={EMBED} offline />, {
      namespaces: ['common'],
    });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Connect to the internet to watch');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('Urdu: the Play name is translated', async () => {
    await renderUi(<YouTubeFacade title="Test bayan title" thumbSrc={null} embedSrc={EMBED} offline={false} />, {
      locale: 'ur',
      namespaces: ['common'],
    });
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Test bayan title');
  });
});
