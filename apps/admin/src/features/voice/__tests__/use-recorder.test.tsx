// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRecorder } from '../hooks/use-recorder.ts';

// 07 B14 (T3.13): the recorder's states — record → pause → resume → stop gives a Blob; a refused microphone; the
// 10:00 auto-stop — with stand-ins for MediaRecorder, getUserMedia and the Web Audio analyser (jsdom has none).

class FakeRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm';
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}
class FakeAudioContext {
  createAnalyser() {
    return {
      fftSize: 512,
      getFloatTimeDomainData: (samples: Float32Array) => {
        samples.fill(0.1);
      },
    };
  }
  createMediaStreamSource() {
    return { connect: () => undefined };
  }
  close() {
    return Promise.resolve();
  }
}
const track = { stop: vi.fn() };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useRecorder', () => {
  it('records, pauses, resumes, stops with a Blob; the microphone is released', async () => {
    const { result } = renderHook(() => useRecorder());
    await act(() => result.current.start());
    expect(result.current.state).toBe('recording');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.seconds).toBe(3);
    act(() => {
      result.current.pause();
    });
    expect(result.current.state).toBe('paused');
    act(() => {
      result.current.resume();
      result.current.stop();
    });
    expect(result.current.state).toBe('done');
    expect(result.current.recording).toBeInstanceOf(Blob);
    expect(track.stop).toHaveBeenCalled();
    act(() => {
      result.current.reset();
    });
    expect(result.current).toMatchObject({ state: 'idle', recording: null, seconds: 0 });
  });

  it('stops by itself at 10:00', async () => {
    const { result } = renderHook(() => useRecorder());
    await act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(600_000);
    });
    expect(result.current.state).toBe('done');
  });

  it('a refused microphone is "denied"', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error('NotAllowedError')) },
    });
    const { result } = renderHook(() => useRecorder());
    await act(() => result.current.start());
    expect(result.current.state).toBe('denied');
  });
});
