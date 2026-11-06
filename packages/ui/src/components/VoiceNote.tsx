import { useTranslation } from '@mc/i18n/react';
import { useEffect, useRef, useState } from 'react';

import { PauseIcon } from '../icons/glyph/PauseIcon.tsx';
import { PlayIcon } from '../icons/glyph/PlayIcon.tsx';
import { Pressable } from '../motion/Pressable.tsx';

export interface VoiceNoteProps {
  /** The recording's URL on the media origin; `null` when the app has no media origin (it shows "unavailable"). */
  readonly src: string | null;
  /** Whole seconds (from the post — known before anything loads). */
  readonly durationS: number;
  /** Up to 48 values 0…255 for the decorative waveform. */
  readonly peaks?: readonly number[] | undefined;
  readonly className?: string;
}

const SPEEDS = [1, 1.5, 2] as const;
/** The one note playing right now (07 A18: one plays at a time). */
let playing: HTMLAudioElement | null = null;

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
};

/**
 * A voice note (07 A18, DECISIONS #104): play / pause (56 px), the waveform from `peaks` (decorative, filled up to the
 * position), a scrub slider, elapsed / remaining, the speed chip 1× → 1.5× → 2×. Starting one pauses any other; leaving
 * the screen (unmount, or another screen pushed over it) pauses it. Nothing is fetched before the first play (`preload="none"`); the app's worker keeps a
 * played note for offline listening, and one that cannot load says "Available when online". The audio is requested
 * with CORS so the worker can read it.
 */
export function VoiceNote({ src, durationS, peaks, className }: VoiceNoteProps) {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [failed, setFailed] = useState(src === null);
  const total = Math.max(1, durationS);
  const bars = peaks && peaks.length > 0 ? peaks : Array.from({ length: 48 }, () => 96);
  const filled = Math.round((position / total) * bars.length);
  const spoken = t('ui.voice.label', {
    duration: t('ui.voice.duration', { minutes: Math.floor(total / 60), seconds: total % 60 }).trim(),
  });

  useEffect(() => {
    const element = audio.current;
    // Leaving the screen pauses — also when another screen is pushed over this one (the navigator makes the covered
    // screen `inert`; F54).
    const screen = element?.closest('[data-screen]');
    const observer =
      screen && typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            if (screen.hasAttribute('inert')) element?.pause();
          })
        : null;
    if (screen) observer?.observe(screen, { attributes: true, attributeFilter: ['inert'] });
    return () => {
      observer?.disconnect();
      element?.pause();
      if (playing === element) playing = null;
    };
  }, []);

  const toggle = () => {
    const element = audio.current;
    if (!element || failed) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    if (playing && playing !== element) playing.pause();
    playing = element;
    element.playbackRate = speed;
    // Only "no playable source" means unavailable: an AbortError (a pause or another note interrupted the start, e.g.
    // while it still loads on a slow phone) or a refused autoplay is not a broken recording. Load failures arrive as
    // the element's `error` event.
    element.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'NotSupportedError') setFailed(true);
    });
  };

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`} data-voice-note role="group" aria-label={spoken}>
      <div className="flex items-center gap-3">
        <Pressable
          aria-label={isPlaying ? t('ui.voice.pause') : t('ui.voice.play')}
          disabled={failed}
          onPress={toggle}
          className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-primary-700 text-on-primary disabled:opacity-40"
        >
          {isPlaying ? <PauseIcon size={28} /> : <PlayIcon size={28} />}
        </Pressable>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div aria-hidden className="flex h-8 items-center gap-[2px]">
            {bars.map((peak, index) => (
              <span
                key={index}
                className={`w-full min-w-[2px] rounded-full ${index < filled ? 'bg-primary-700' : 'bg-border'}`}
                style={{ height: `${String(Math.max(12, Math.round((peak / 255) * 100)))}%` }}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={total}
            step={1}
            value={Math.min(total, Math.round(position))}
            disabled={failed}
            aria-label={t('ui.voice.position')}
            aria-valuetext={t('ui.voice.positionValue', { elapsed: clock(position), total: clock(total) })}
            onChange={(event) => {
              const next = Number(event.target.value);
              setPosition(next);
              if (audio.current) audio.current.currentTime = next;
            }}
            className="h-2 w-full accent-primary-700"
          />
          <div className="flex justify-between type-caption tabular-nums text-text-tertiary" dir="ltr">
            <span>{clock(position)}</span>
            <span>−{clock(total - position)}</span>
          </div>
        </div>
        <Pressable
          aria-label={t('ui.voice.speed', { speed: `${String(speed)}×` })}
          disabled={failed}
          onPress={() => {
            const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
            setSpeed(next);
            if (audio.current) audio.current.playbackRate = next;
          }}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-surface-muted px-3 type-callout font-semibold tabular-nums text-text"
        >
          <span aria-hidden dir="ltr">{`${String(speed)}×`}</span>
        </Pressable>
      </div>
      {failed ? <p className="type-footnote text-text-secondary">{t('ui.voice.unavailable')}</p> : null}
      {src ? (
        // eslint-disable-next-line jsx-a11y-x/media-has-caption -- an admin's voice note has no transcript; its required title (shown above it) says what it is about
        <audio
          ref={audio}
          src={src}
          preload="none"
          crossOrigin="anonymous"
          onPlay={() => {
            setPlaying(true);
          }}
          onPause={() => {
            setPlaying(false);
          }}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
          onTimeUpdate={(event) => {
            setPosition(event.currentTarget.currentTime);
          }}
          onError={() => {
            setPlaying(false);
            setFailed(true);
          }}
        />
      ) : null}
    </div>
  );
}
