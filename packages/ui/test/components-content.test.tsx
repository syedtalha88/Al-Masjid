// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ArabicText,
  Button,
  Card,
  CircleAction,
  CountBadge,
  Divider,
  EmptyState,
  IconButton,
  IconCircle,
  InfoNote,
  ListRow,
  PressableCard,
  ProgressBar,
  SectionHeader,
  Skeleton,
  SkeletonGroup,
  SkeletonText,
  Tag,
  VerifiedBadge,
} from '../src/components/index.ts';
import { PlusIcon, ShareIcon } from '../src/icons/glyphs.tsx';
import { renderUi } from './render.tsx';

// T0.10 component tests (06 §6): render, roles/labels, interactions. Religious-text fixture per 10 §5.
const ARABIC_FIXTURE = 'نص تجريبي للعرض فقط';

afterEach(cleanup);

/** A pointer tap as a finger does it: pointerdown → pointerup → click. */
function tap(element: Element) {
  fireEvent.pointerDown(element, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(element, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.click(element, { detail: 1 });
}

describe('Button', () => {
  it('is a button with its label; press fires onPress', async () => {
    const onPress = vi.fn();
    await renderUi(<Button onPress={onPress}>Donate Now</Button>);
    tap(screen.getByRole('button', { name: 'Donate Now' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each(['primary', 'secondary', 'outline', 'ghost', 'danger'] as const)('variant %s renders', async (variant) => {
    await renderUi(<Button variant={variant}>Label</Button>);
    expect(screen.getByRole('button', { name: 'Label' }).className).toContain('rounded-full');
  });

  it('loading: busy, still named, presses ignored, label kept for a locked width', async () => {
    const onPress = vi.fn();
    await renderUi(
      <Button loading onPress={onPress}>
        Donate Now
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Donate Now' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.querySelector('.spin')).not.toBeNull();
    tap(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('loading with a leading icon: the spinner takes the icon slot', async () => {
    await renderUi(
      <Button loading leadingIcon={<PlusIcon />}>
        Add
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Add' });
    expect(button.querySelectorAll('.spin')).toHaveLength(1);
    expect(button.querySelector('span.opacity-0')).toBeNull();
  });

  it('disabled: not activatable', async () => {
    const onPress = vi.fn();
    await renderUi(
      <Button disabled onPress={onPress}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('keyboard activation works (native button)', async () => {
    const onPress = vi.fn();
    await renderUi(<Button onPress={onPress}>Go</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }), { detail: 0 });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('IconButton / CircleAction', () => {
  it('icon-only button is named by its label and has a ≥ 44 px hit area', async () => {
    await renderUi(<IconButton label="More options" icon={<ShareIcon />} variant="onImage" />);
    const button = screen.getByRole('button', { name: 'More options' });
    expect(button.className).toContain('size-(--mc-hit)');
    expect(button.querySelector('svg')?.closest('[aria-hidden]')).not.toBeNull();
  });

  it('circle action shows a caption and is one button', async () => {
    const onPress = vi.fn();
    await renderUi(<CircleAction icon={<ShareIcon />} label="Share" onPress={onPress} />);
    tap(screen.getByRole('button', { name: 'Share' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Card / ListRow', () => {
  it.each(['plain', 'mint', 'outline'] as const)('card variant %s', async (variant) => {
    const { container } = await renderUi(<Card variant={variant}>Body</Card>);
    expect(container.textContent).toBe('Body');
  });

  it('pressable card is one button', async () => {
    const onPress = vi.fn();
    await renderUi(<PressableCard onPress={onPress}>Masjid Al-Noor</PressableCard>);
    tap(screen.getByRole('button', { name: 'Masjid Al-Noor' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('pressable row: one button with title, subtitle, meta; chevron by default', async () => {
    const onPress = vi.fn();
    await renderUi(
      <ListRow
        leading={<IconCircle>i</IconCircle>}
        title="Water not available"
        subtitle="Maintenance work"
        meta="2 hours ago"
        trailing={<CountBadge count={3} />}
        onPress={onPress}
      />,
    );
    const row = screen.getByRole('button');
    expect(row.textContent).toContain('Water not available');
    expect(row.textContent).toContain('Maintenance work');
    expect(row.textContent).toContain('2 hours ago');
    expect(screen.getByRole('img', { name: '3 new' })).toBeTruthy();
    expect(row.querySelector('svg.rtl\\:-scale-x-100')).not.toBeNull();
    tap(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('static row: no button, no chevron', async () => {
    const { container } = await renderUi(<ListRow title="Static" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('badges', () => {
  it('CountBadge: "9+" above max, full count spoken, nothing for 0', async () => {
    const { container } = await renderUi(
      <>
        <CountBadge count={12} />
        <CountBadge count={0} />
      </>,
    );
    const badge = screen.getByRole('img', { name: '12 new' });
    expect(badge.textContent).toBe('9+');
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(1);
  });

  it('VerifiedBadge and Tag render translated text', async () => {
    await renderUi(
      <>
        <VerifiedBadge />
        <Tag tone="danger">Important</Tag>
      </>,
      { locale: 'hi' },
    );
    expect(screen.getByText('सत्यापित')).toBeTruthy();
    expect(screen.getByText('Important').className).toContain('text-danger');
  });
});

describe('InfoNote / Divider / SectionHeader / EmptyState', () => {
  it('info note shows its text with a decorative icon', async () => {
    const { container } = await renderUi(<InfoNote>Timings may change.</InfoNote>);
    expect(screen.getByText('Timings may change.')).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('divider is a separator', async () => {
    await renderUi(<Divider inset="icon" />);
    expect(screen.getByRole('separator').className).toContain('hairline');
  });

  it('section header: heading + "See All" described by the heading', async () => {
    const onSeeAll = vi.fn();
    await renderUi(<SectionHeader title="Recent Updates" onSeeAll={onSeeAll} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Recent Updates' });
    const seeAll = screen.getByRole('button', { name: 'See All' });
    expect(seeAll.getAttribute('aria-describedby')).toBe(heading.id);
    tap(seeAll);
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('empty state: heading, body and action', async () => {
    await renderUi(<EmptyState title="No masjids yet" body="Scan a QR code" action={<Button>Scan</Button>} />);
    expect(screen.getByRole('heading', { name: 'No masjids yet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scan' })).toBeTruthy();
  });
});

describe('ProgressBar (08 §5.7)', () => {
  it('exposes the value to assistive tech and animates the fill to it', async () => {
    const { container } = await renderUi(<ProgressBar value={0.72} label="Raised so far" />);
    const bar = screen.getByRole('progressbar', { name: 'Raised so far' });
    expect(bar.getAttribute('aria-valuenow')).toBe('72');
    expect(bar.getAttribute('aria-valuetext')).toBe('72%');
    const fill = container.querySelector<HTMLElement>('[role="progressbar"] > div');
    // jsdom has no IntersectionObserver → starts at once, springs from 0 to 0.72.
    await vi.waitFor(
      () => {
        expect(Number(fill?.style.getPropertyValue('--mc-progress'))).toBeCloseTo(0.72, 2);
      },
      { timeout: 3000 },
    );
  });

  it('reduced motion shows the value immediately; values are clamped', async () => {
    const { container } = await renderUi(<ProgressBar value={1.4} label="Raised" />, { reduced: true });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    const fill = container.querySelector<HTMLElement>('[role="progressbar"] > div');
    expect(fill?.style.getPropertyValue('--mc-progress')).toBe('1');
  });

  it('starts only when scrolled into view', async () => {
    // The stub only needs what ProgressBar reads (`isIntersecting`).
    type Callback = (entries: { isIntersecting: boolean }[]) => void;
    const callbacks: Callback[] = [];
    const Observer = vi.fn(function (this: unknown, callback: Callback) {
      callbacks.push(callback);
      return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn(), takeRecords: () => [] };
    });
    vi.stubGlobal('IntersectionObserver', Observer);
    const { container } = await renderUi(<ProgressBar value={0.5} label="Raised" />);
    const fill = container.querySelector<HTMLElement>('[role="progressbar"] > div');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fill?.style.getPropertyValue('--mc-progress')).toBe('0');
    act(() => {
      for (const callback of callbacks) {
        callback([{ isIntersecting: true }]);
      }
    });
    await vi.waitFor(
      () => {
        expect(Number(fill?.style.getPropertyValue('--mc-progress'))).toBeCloseTo(0.5, 2);
      },
      { timeout: 3000 },
    );
    vi.unstubAllGlobals();
  });
});

describe('ArabicText', () => {
  it('is Arabic, right-to-left, never mirrored by the UI locale', async () => {
    await renderUi(<ArabicText variant="hero">{ARABIC_FIXTURE}</ArabicText>, { locale: 'te' });
    const text = screen.getByText(ARABIC_FIXTURE);
    expect(text.getAttribute('lang')).toBe('ar');
    expect(text.getAttribute('dir')).toBe('rtl');
    expect(text.className).toContain('type-arabic-hero');
    expect(text.className).toContain('text-center');
  });
});

describe('Skeleton', () => {
  it('shapes are decorative; the group announces loading once', async () => {
    const { container } = await renderUi(
      <SkeletonGroup>
        <Skeleton className="h-12 w-12 rounded-full" />
        <SkeletonText lines={3} />
      </SkeletonGroup>,
    );
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toBe('Loading…');
    expect(container.querySelectorAll('.skeleton')).toHaveLength(4);
  });
});
