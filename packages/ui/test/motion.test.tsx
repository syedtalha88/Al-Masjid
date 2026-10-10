// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { domAnimation } from 'motion/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CountUp } from '../src/motion/CountUp.tsx';
import { motionCss } from '../src/motion/css.ts';
import { DigitRoll } from '../src/motion/DigitRoll.tsx';
import { haptic, HAPTICS, setHapticsEnabled } from '../src/motion/haptics.ts';
import { type FrameClock, isLowEndDevice, JANK, JankMonitor } from '../src/motion/lite.ts';
import { MotionProvider } from '../src/motion/MotionProvider.tsx';
import { CROSSFADE, motionOrFade } from '../src/motion/presence.ts';
import { Pressable } from '../src/motion/Pressable.tsx';
import { useReducedMotionPref } from '../src/motion/reduced.ts';
import { SuccessCheck } from '../src/motion/SuccessCheck.tsx';
import { css, gesture, press, spring, stagger, tween } from '../src/motion/tokens.ts';

const REDUCE = '(prefers-reduced-motion: reduce)';

/** Mocks `matchMedia`; returns a setter that flips the reduced-motion query and notifies listeners. */
function mockReducedMotion(initial: boolean) {
  const listeners = new Set<() => void>();
  const state = { matches: initial };
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query === REDUCE && state.matches;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
  return (matches: boolean) => {
    state.matches = matches;
    for (const listener of listeners) listener();
  };
}

const withMotion = ({ children }: { children: ReactNode }) => (
  <MotionProvider features={domAnimation}>{children}</MotionProvider>
);

beforeEach(() => {
  mockReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setHapticsEnabled(true);
});

describe('tokens (08 §2)', () => {
  it('match the spec table', () => {
    expect(spring.snappy).toEqual({ type: 'spring', visualDuration: 0.25, bounce: 0 });
    expect(spring.smooth).toEqual({ type: 'spring', visualDuration: 0.38, bounce: 0 });
    expect(spring.gentle).toEqual({ type: 'spring', visualDuration: 0.55, bounce: 0 });
    expect(spring.bouncy).toEqual({ type: 'spring', visualDuration: 0.45, bounce: 0.28 });
    expect(tween.fade).toEqual({ duration: 0.18, ease: [0.2, 0, 0, 1] });
    expect(tween.quick).toEqual({ duration: 0.12, ease: 'easeOut' });
    expect(press).toEqual({ button: 0.96, card: 0.98, fab: 0.92 });
    expect(gesture).toMatchObject({ edgeWidth: 24, dismissVelocity: 500, dismissDistance: 0.35 });
    expect(css.ios.transition('opacity', 'transform')).toBe(
      'opacity 400ms cubic-bezier(0.32, 0.72, 0, 1), transform 400ms cubic-bezier(0.32, 0.72, 0, 1)',
    );
  });

  it('stagger: 30 ms per item for the first 8 items, then flat', () => {
    expect(stagger.delay(0)).toBe(0);
    expect(stagger.delay(3)).toBeCloseTo(0.09);
    expect(stagger.delay(8)).toBeCloseTo(0.24);
    expect(stagger.delay(40)).toBeCloseTo(0.24);
  });

  it('motion.css carries every spring as a CSS linear() curve with a cubic-bezier fallback first', () => {
    const generated = motionCss();
    for (const name of Object.keys(spring))
      expect(generated).toMatch(new RegExp(`--mc-spring-${name}: \\d+ms linear\\(`));
    expect(generated.indexOf('var(--mc-ease-ios)')).toBeLessThan(generated.indexOf('var(--mc-spring-snappy)'));
  });
});

describe('reduced motion (08 §6)', () => {
  it('useReducedMotionPref follows the OS setting live', () => {
    const setReduced = mockReducedMotion(false);
    const { result } = renderHook(() => useReducedMotionPref());
    expect(result.current).toBe(false);
    act(() => {
      setReduced(true);
    });
    expect(result.current).toBe(true);
  });

  it('motionOrFade swaps any movement for the crossfade', () => {
    const slide = { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '-28%' }, transition: spring.smooth };
    expect(motionOrFade(false, slide)).toBe(slide);
    expect(motionOrFade(true, slide)).toBe(CROSSFADE);
    expect(CROSSFADE.transition).toBe(tween.fade);
  });

  it('DigitRoll rolls changed digits with full motion…', () => {
    const { container, rerender } = render(<DigitRoll text="5:15" />, { wrapper: withMotion });
    rerender(<DigitRoll text="5:16" />);
    const entering = [...container.querySelectorAll('span.col-start-1')].find((node) => node.textContent === '6');
    expect(entering?.getAttribute('style')).toContain('translateY(100%)');
  });

  it('…and crossfades them when reduced motion is on (no transform)', () => {
    mockReducedMotion(true);
    const { container, rerender } = render(<DigitRoll text="5:15" />, { wrapper: withMotion });
    rerender(<DigitRoll text="5:16" />);
    const entering = [...container.querySelectorAll('span.col-start-1')].find((node) => node.textContent === '6');
    const style = entering?.getAttribute('style') ?? '';
    expect(style).toContain('opacity: 0');
    expect(style).not.toContain('translate');
    expect(screen.getByText('5:16', { selector: '.sr-only' })).toBeTruthy();
  });

  it('SuccessCheck appears fully drawn, without drawing animation, and completes at once', () => {
    mockReducedMotion(true);
    const onComplete = vi.fn();
    const { container } = render(<SuccessCheck title="Published" onComplete={onComplete} />, { wrapper: withMotion });
    expect(screen.getByRole('img', { name: 'Published' })).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/stroke-dash|pathLength|transform/);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('CountUp shows the final value immediately', () => {
    mockReducedMotion(true);
    const format = (paise: number) => `₹${String(paise / 100)}`;
    const { container } = render(<CountUp value={720_000} format={format} />, { wrapper: withMotion });
    expect(container.querySelector('[aria-hidden]')?.textContent).toBe('₹7200');
  });
});

describe('CountUp (08 §5.7)', () => {
  it('counts to the target, formatting every frame', async () => {
    const seen = new Set<string>();
    const format = (value: number) => {
      const text = new Intl.NumberFormat('en-IN').format(value);
      seen.add(text);
      return text;
    };
    const { container } = render(<CountUp value={100_000} format={format} />, { wrapper: withMotion });
    const visible = container.querySelector('[aria-hidden]');
    await waitFor(
      () => {
        expect(visible?.textContent).toBe('1,00,000');
      },
      { timeout: 3000 },
    );
    expect(screen.getByText('1,00,000', { selector: '.sr-only' })).toBeTruthy();
    expect(seen.size).toBeGreaterThan(2);
  });
});

describe('Pressable (08 §5.1)', () => {
  it('enters the pressed state synchronously on pointerdown — same frame, no timers or rAF needed', () => {
    vi.useFakeTimers();
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    render(<Pressable onPress={vi.fn()}>Follow</Pressable>, { wrapper: withMotion });
    const button = screen.getByRole('button', { name: 'Follow' });
    fireEvent.pointerDown(button, { button: 0, clientX: 10, clientY: 10 });
    // Nothing advanced: no timer tick, no animation frame — the attribute is already there.
    expect(button.hasAttribute('data-pressed')).toBe(true);
    expect(raf).not.toHaveBeenCalled();
    fireEvent.pointerUp(button);
    expect(button.hasAttribute('data-pressed')).toBe(false);
  });

  it('activates on click and from the keyboard', () => {
    const onPress = vi.fn();
    render(<Pressable onPress={onPress}>Save</Pressable>);
    const button = screen.getByRole('button', { name: 'Save' });
    fireEvent.pointerDown(button, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(button);
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(button, { detail: 0 });
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it(`moving ≥ ${String(gesture.pressCancelDistance)} px (a scroll) releases without activating`, () => {
    const onPress = vi.fn();
    render(<Pressable onPress={onPress}>Card</Pressable>);
    const button = screen.getByRole('button', { name: 'Card' });
    fireEvent.pointerDown(button, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(button, { clientX: 0, clientY: 7 });
    expect(button.hasAttribute('data-pressed')).toBe(true);
    fireEvent.pointerMove(button, { clientX: 0, clientY: 9 });
    expect(button.hasAttribute('data-pressed')).toBe(false);
    fireEvent.pointerUp(button);
    fireEvent.click(button, { detail: 1 });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('pointercancel (browser took over for scrolling) releases without activating', () => {
    const onPress = vi.fn();
    render(<Pressable onPress={onPress}>Row</Pressable>);
    const button = screen.getByRole('button', { name: 'Row' });
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.pointerCancel(button);
    fireEvent.click(button, { detail: 1 });
    expect(button.hasAttribute('data-pressed')).toBe(false);
    expect(onPress).not.toHaveBeenCalled();
  });

  it(`long-press fires after ${String(gesture.longPressMs)} ms and suppresses the click`, () => {
    vi.useFakeTimers();
    const onPress = vi.fn();
    const onLongPress = vi.fn();
    render(
      <Pressable onPress={onPress} onLongPress={onLongPress}>
        Post
      </Pressable>,
    );
    const button = screen.getByRole('button', { name: 'Post' });
    fireEvent.pointerDown(button, { button: 0 });
    vi.advanceTimersByTime(gesture.longPressMs - 1);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(button);
    fireEvent.click(button, { detail: 1 });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('uses the kind-specific pressed scale class', () => {
    render(<Pressable kind="fab">Scan</Pressable>);
    expect(screen.getByRole('button', { name: 'Scan' }).className).toContain('press-fab');
  });
});

describe('lite motion (08 §6)', () => {
  it('low-end = ≤ 4 cores and (≤ 3 GB or unknown memory)', () => {
    expect(isLowEndDevice({ hardwareConcurrency: 4, deviceMemory: 2 })).toBe(true);
    expect(isLowEndDevice({ hardwareConcurrency: 4 })).toBe(true);
    expect(isLowEndDevice({ hardwareConcurrency: 4, deviceMemory: 4 })).toBe(false);
    expect(isLowEndDevice({ hardwareConcurrency: 8, deviceMemory: 2 })).toBe(false);
    expect(isLowEndDevice({})).toBe(false);
  });

  /** A manual frame clock: `frame(ms)` advances time and runs the pending callback. */
  function manualClock(hidden = () => false) {
    let time = 0;
    let pending: ((time: number) => void) | undefined;
    const clock: FrameClock = {
      now: () => time,
      requestFrame: (callback) => {
        pending = callback;
        return 1;
      },
      cancelFrame: () => {
        pending = undefined;
      },
      hidden,
    };
    const frame = (deltaMs: number) => {
      time += deltaMs;
      const callback = pending;
      pending = undefined;
      callback?.(time);
    };
    return { clock, frame };
  }

  it(`counts consecutive slow frames as one burst and switches to lite after ${String(JANK.burstsForLite)}`, () => {
    const onLite = vi.fn();
    const { clock, frame } = manualClock();
    const monitor = new JankMonitor(onLite, clock);
    const stop = monitor.watch();
    for (let burst = 0; burst < JANK.burstsForLite; burst += 1) {
      frame(16);
      frame(70);
      frame(80); // same burst
      frame(16);
    }
    expect(monitor.bursts).toBe(JANK.burstsForLite);
    expect(onLite).toHaveBeenCalledTimes(1);
    frame(90);
    frame(16);
    frame(90);
    expect(onLite).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ignores frames while the page is hidden and stops measuring when the animation ends', () => {
    const onLite = vi.fn();
    let hidden = true;
    const { clock, frame } = manualClock(() => hidden);
    const monitor = new JankMonitor(onLite, clock);
    const stop = monitor.watch();
    frame(500);
    expect(monitor.bursts).toBe(0);
    hidden = false;
    frame(16);
    stop();
    frame(500);
    expect(monitor.bursts).toBe(0);
  });
});

describe('haptics (08 §7)', () => {
  it('vibrates with the pattern when supported and enabled', () => {
    const vibrate = vi.fn(() => true);
    expect(haptic('success', { vibrate })).toBe(true);
    expect(vibrate).toHaveBeenCalledWith([...HAPTICS.success]);
    expect(haptic('selection', { vibrate })).toBe(true);
    expect(vibrate).toHaveBeenLastCalledWith(8);
  });

  it('is a no-op when the Vibration setting is off or the API is missing (iOS)', () => {
    const vibrate = vi.fn(() => true);
    setHapticsEnabled(false);
    expect(haptic('impactLight', { vibrate })).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    setHapticsEnabled(true);
    expect(haptic('impactLight', {})).toBe(false);
  });
});
