// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Carousel } from '../src/components/Carousel.tsx';
import { MasjidCard } from '../src/components/MasjidCard.tsx';
import { CountdownText, NextPrayerPanel, PrayerStrip } from '../src/components/Prayer.tsx';
import { pullOffset, PullToRefresh } from '../src/components/PullToRefresh.tsx';
import { renderUi } from './render.tsx';

// T2.6 Home components (06 §6, 08 §4, §5.5): next-prayer panel + countdown buckets, jamaat strip with its highlight,
// masjid card, carousel dots, pull-to-refresh.

afterEach(cleanup);

const SLOTS = [
  { prayer: 'fajr', time: '05:30' },
  { prayer: 'jumuah', time: '13:30' },
  { prayer: 'asr', time: '16:45' },
  { prayer: 'maghrib', time: '18:30' },
  { prayer: 'isha', time: null },
] as const;

describe('CountdownText and NextPrayerPanel', () => {
  it.each([
    [{ kind: 'left', hours: 2, minutes: 18 }, '2h 18m left', false],
    [{ kind: 'left', hours: 0, minutes: 48 }, '48m left', false],
    [{ kind: 'soon', minutes: 8 }, 'Starts in 8 min', true],
    [{ kind: 'now' }, 'Jamaat now', true],
    [{ kind: 'past' }, '', false],
  ] as const)('%j → "%s"', async (value, text, urgent) => {
    await renderUi(<CountdownText value={value} />);
    expect(document.querySelector('.sr-only')?.textContent).toBe(text);
    expect(document.querySelector('.pulse-dot') !== null).toBe(urgent);
  });

  it('shows the prayer, its countdown and a chevron when pressable; the empty text otherwise', async () => {
    const onPress = vi.fn();
    await renderUi(
      <NextPrayerPanel prayer="jumuah" countdown={{ kind: 'left', hours: 1, minutes: 5 }} onPress={onPress} />,
    );
    expect(screen.getByText('Next Prayer')).toBeTruthy();
    expect(screen.getByText('Jumu’ah')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalled();
    cleanup();
    await renderUi(<NextPrayerPanel prayer={null} countdown={null} emptyText="No jamaat times set" />);
    expect(screen.getByText('No jamaat times set')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PrayerStrip', () => {
  it('lists five cells with localized names, 12-hour times and AM/PM; marks the next one', async () => {
    await renderUi(<PrayerStrip slots={SLOTS} activeIndex={1} label="Jamaat times" />);
    const cells = screen.getAllByRole('listitem');
    expect(cells).toHaveLength(5);
    expect(cells[0]?.textContent).toBe('Fajr5:30AM');
    expect(cells[1]?.textContent).toBe('Jumu’ah1:30PM');
    expect(cells[1]?.getAttribute('aria-current')).toBe('time');
    expect(cells[4]?.textContent).toBe('Isha–');
    const highlight = document.querySelector<HTMLElement>('[data-strip-highlight]');
    expect(highlight?.style.getPropertyValue('--mc-index')).toBe('1');
    expect(highlight?.style.width).toBe('20%');
  });

  it('no highlight without a next jamaat; Urdu names', async () => {
    await renderUi(<PrayerStrip slots={SLOTS} activeIndex={null} label="x" />, { locale: 'ur' });
    expect(document.querySelector('[data-strip-highlight]')).toBeNull();
    expect(screen.getAllByRole('listitem')[0]?.textContent).toContain('فجر');
  });
});

describe('MasjidCard', () => {
  it('opens the masjid from its row; photo or tile', async () => {
    const onPress = vi.fn();
    await renderUi(
      <MasjidCard name="Test Masjid Alpha" place="Area, City" onPress={onPress}>
        <p>panel</p>
      </MasjidCard>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Test Masjid Alpha/ }));
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByText('panel')).toBeTruthy();
    cleanup();
    await renderUi(<MasjidCard name="M" place="P" photo={{ src: 'https://media.example/x' }} onPress={onPress} />);
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://media.example/x');
  });
});

describe('Carousel', () => {
  it('one item: full width, no dots; several: snap list + dots following the scroll', async () => {
    await renderUi(
      <Carousel label="My Masjids">
        <p>one</p>
      </Carousel>,
    );
    expect(document.querySelector('[data-carousel-dots]')).toBeNull();
    cleanup();
    await renderUi(
      <Carousel label="My Masjids">
        <p>one</p>
        <p>two</p>
        <p>three</p>
      </Carousel>,
    );
    const list = screen.getByRole('list', { name: 'My Masjids' });
    const items = list.querySelectorAll('li');
    Object.defineProperty(items[0], 'offsetLeft', { value: 16 });
    Object.defineProperty(items[1], 'offsetLeft', { value: 316 });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    list.scrollLeft = 610;
    fireEvent.scroll(list);
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
    const dots = document.querySelectorAll('[data-carousel-dots] span > span');
    expect(dots[2]?.className).toContain('scale-x-100');
    expect(dots[0]?.className).not.toContain('scale-x-100');
    vi.restoreAllMocks();
  });
});

describe('PullToRefresh', () => {
  const touch = (y: number) => ({ touches: [{ clientY: y }] });

  it('rubber-bands the pull (distance ^ 0.7)', () => {
    expect(pullOffset(-10)).toBe(0);
    expect(pullOffset(100)).toBeCloseTo(100 ** 0.7);
  });

  it('a long pull refreshes and waits for the data; a short one springs back', async () => {
    let finish: () => void = () => undefined;
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    await renderUi(
      <div data-screen-scroll>
        <PullToRefresh onRefresh={onRefresh}>
          <p>content</p>
        </PullToRefresh>
      </div>,
    );
    const scroller = document.querySelector<HTMLElement>('[data-screen-scroll]');
    const content = screen.getByText('content').parentElement;
    if (!scroller || !content) throw new Error('missing');
    // Short pull: springs back, nothing refreshed.
    fireEvent.touchStart(scroller, touch(100));
    fireEvent.touchMove(scroller, touch(130));
    expect(content.style.transform).toMatch(/^translateY\(/);
    fireEvent.touchEnd(scroller);
    expect(content.style.transform).toBe('');
    expect(onRefresh).not.toHaveBeenCalled();
    // Long pull: refreshes, holds, then releases when the data settles.
    fireEvent.touchStart(scroller, touch(100));
    fireEvent.touchMove(scroller, touch(600));
    fireEvent.touchEnd(scroller);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(content.style.transform).toBe('translateY(56px)');
    expect(screen.getByRole('status').textContent).toBe('Refreshing…');
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(content.style.transform).toBe('');
    // Scrolled down: no pull.
    scroller.scrollTop = 50;
    fireEvent.touchStart(scroller, touch(100));
    fireEvent.touchMove(scroller, touch(400));
    fireEvent.touchEnd(scroller);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
