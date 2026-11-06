// @vitest-environment jsdom
// A18 voice note player (PHASE_03 T3.13 "Player keyboard + screen-reader labels; reduced motion"): every control is a
// native button / range input with a spoken name, operable from the keyboard; screen readers hear the length and the
// position as words; one note plays at a time; nothing in the player animates, so reduced motion changes nothing.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { VoiceNote } from '../src/components/VoiceNote.tsx';
import { renderUi } from './render.tsx';

const PEAKS = Array.from({ length: 48 }, (_, index) => (index * 5) % 256);
/** The media element's play / pause, spied (jsdom has no playback). */
let play: MockInstance<HTMLMediaElement['play']>;
let pause: MockInstance<HTMLMediaElement['pause']>;

beforeEach(() => {
  // jsdom has no media playback: play / pause flip `paused` and fire the events a browser fires.
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play(this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function pause(this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
    this.dispatchEvent(new Event('pause'));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VoiceNote (A18)', () => {
  it('screen readers hear what it is and how long, and every control has a name', async () => {
    await renderUi(<VoiceNote src="https://media.test/a/m4a/m/x/a/y" durationS={95} peaks={PEAKS} />);
    expect(screen.getByRole('group', { name: 'Voice message, 1 minute 35 seconds' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    const slider = screen.getByRole('slider', { name: 'Position in the voice message' });
    expect(slider.getAttribute('aria-valuetext')).toBe('0:00 of 1:35');
    expect(screen.getByRole('button', { name: 'Playback speed 1×' })).toBeTruthy();
  });

  it('works from the keyboard: Tab to Play, Enter plays and pauses, the slider seeks, the speed chip cycles', async () => {
    const user = userEvent.setup();
    await renderUi(<VoiceNote src="https://media.test/a/m4a/m/x/a/y" durationS={95} peaks={PEAKS} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Play' }));
    await user.keyboard('{Enter}');
    expect(play).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Pause' })).toBe(document.activeElement);
    await user.keyboard(' ');
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Play' })).toBe(document.activeElement);

    await user.tab();
    const slider = screen.getByRole('slider', { name: 'Position in the voice message' });
    expect(document.activeElement).toBe(slider);
    // A native range input: the browser moves it with the arrow keys and fires `change` (jsdom does not move it).
    expect(slider.getAttribute('type')).toBe('range');
    fireEvent.change(slider, { target: { value: '61' } });
    expect(slider.getAttribute('aria-valuetext')).toBe('1:01 of 1:35');
    expect(screen.getByText('−0:34')).toBeTruthy();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Playback speed 1×' }));
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Playback speed 1.5×' })).toBe(document.activeElement);
    await user.keyboard('{Enter}{Enter}');
    expect(screen.getByRole('button', { name: 'Playback speed 1×' })).toBe(document.activeElement);
  });

  it('one note at a time: starting a second pauses the first', async () => {
    const user = userEvent.setup();
    await renderUi(
      <>
        <VoiceNote src="https://media.test/a/m4a/m/x/a/one" durationS={10} />
        <VoiceNote src="https://media.test/a/m4a/m/x/a/two" durationS={20} />
      </>,
    );
    const [first, second] = screen.getAllByRole('button', { name: 'Play' });
    if (!first || !second) throw new Error('two players');
    await user.click(first);
    await user.click(second);
    expect(screen.getAllByRole('button', { name: 'Play' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(1);
  });

  it('a start interrupted by a pause (AbortError) is not "unavailable"; no playable source is', async () => {
    const user = userEvent.setup();
    play.mockRejectedValueOnce(new DOMException('interrupted by a call to pause()', 'AbortError'));
    await renderUi(<VoiceNote src="https://media.test/a/m4a/m/x/a/y" durationS={95} />);
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.queryByText('Available when online')).toBeNull();
    play.mockRejectedValueOnce(new DOMException('no supported source', 'NotSupportedError'));
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(await screen.findByText('Available when online')).toBeTruthy();
  });

  it('without a media origin it says so, and its controls are disabled', async () => {
    await renderUi(<VoiceNote src={null} durationS={30} />);
    expect(screen.getByText('Available when online')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('slider').hasAttribute('disabled')).toBe(true);
  });

  it('reduced motion: the same player — nothing in it animates either way', async () => {
    for (const reduced of [false, true]) {
      const user = userEvent.setup();
      const { container } = await renderUi(<VoiceNote src="https://media.test/a/m4a/m/x/a/y" durationS={95} />, {
        reduced,
      });
      await user.click(screen.getByRole('button', { name: 'Play' }));
      expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
      const animated = [...container.querySelectorAll<HTMLElement>('*')].filter(
        (element) =>
          /\b(animate-|transition)/.test(element.getAttribute('class') ?? '') ||
          /transition|animation|transform/.test(element.getAttribute('style') ?? ''),
      );
      expect(animated.map((element) => element.outerHTML.slice(0, 80))).toEqual([]);
      cleanup();
    }
  });
});
