// The B14 recorder (07 B14, PHASE_03 T3.13): the microphone through MediaRecorder — record, pause / resume, stop (also
// automatically at 10:00), a live level for the meter and the elapsed time. The finished recording is a Blob; nothing
// leaves the phone until the admin chooses "Use this".
import { useCallback, useEffect, useRef, useState } from 'react';

import { recordingType, VOICE_MAX_SECONDS } from '../lib/measure.ts';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'done' | 'denied';

export interface Recorder {
  readonly state: RecorderState;
  readonly seconds: number;
  /** 0…1, the live input level while recording. */
  readonly level: number;
  readonly recording: Blob | null;
  readonly start: () => Promise<void>;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly stop: () => void;
  readonly reset: () => void;
}

/** MediaRecorder + an AnalyserNode for the level meter; everything is released on stop and on unmount. */
export function useRecorder(): Recorder {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [recording, setRecording] = useState<Blob | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const frame = useRef<number | null>(null);

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    void context.current?.close();
    context.current = null;
    setLevel(0);
  }, []);

  useEffect(
    () => () => {
      if (recorder.current?.state !== 'inactive') recorder.current?.stop();
      release();
    },
    [release],
  );

  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState('denied');
      return;
    }
    stream.current = media;
    const type = recordingType((candidate) => MediaRecorder.isTypeSupported(candidate));
    const next = new MediaRecorder(media, type ? { mimeType: type } : {});
    const chunks: Blob[] = [];
    next.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    next.onstop = () => {
      setRecording(new Blob(chunks, { type: next.mimeType || type || 'audio/webm' }));
      setState('done');
      release();
    };
    recorder.current = next;
    // The level meter: RMS of the analyser's time-domain samples each frame.
    const audio = new AudioContext();
    context.current = audio;
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(media).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    setSeconds(0);
    setRecording(null);
    next.start(1000);
    setState('recording');
    timer.current = setInterval(() => {
      if (next.state !== 'recording') return;
      setSeconds((value) => {
        if (value + 1 >= VOICE_MAX_SECONDS) next.stop(); // 07 B14: auto-stop at 10:00
        return value + 1;
      });
    }, 1000);
  }, [release]);

  return {
    state,
    seconds,
    level,
    recording,
    start,
    pause: () => {
      recorder.current?.pause();
      setState('paused');
    },
    resume: () => {
      recorder.current?.resume();
      setState('recording');
    },
    stop,
    reset: () => {
      setRecording(null);
      setSeconds(0);
      setState('idle');
    },
  };
}
