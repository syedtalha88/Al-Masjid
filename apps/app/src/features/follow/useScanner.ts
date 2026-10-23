// Camera + detection loop of the Scan modal (07 A4). Never asks for the camera without a tap unless the permission is
// already granted; checks a frame every 200 ms while visible and not paused (a sheet is open, a code is being looked
// up); turns the torch on/off where the device supports it; stops the camera when the screen goes away.
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import {
  CameraError,
  cameraPermission,
  closeCamera,
  loadQrDetector,
  openCamera,
  type QrDetector,
  setTorch,
  torchSupported,
} from './camera.ts';

export type ScannerState = 'checking' | 'ask' | 'starting' | 'scanning' | 'denied' | 'unavailable' | 'busy';

/** Time between two frame checks, ms (≈ 5 checks/s: quick to detect, light on a low-end CPU). */
const FRAME_INTERVAL_MS = 200;

export interface Scanner {
  readonly state: ScannerState;
  /** The open camera (the screen shows it in its <video>). */
  readonly stream: MediaStream | null;
  /** Asks for the camera (the "Allow camera" / "Try again" button). */
  readonly start: () => void;
  /** The device can switch its flashlight. */
  readonly torchAvailable: boolean;
  readonly torchOn: boolean;
  readonly toggleTorch: () => void;
}

export interface ScannerOptions {
  readonly video: RefObject<HTMLVideoElement | null>;
  /** No frames are checked while paused (the camera stays on, so resuming is instant). */
  readonly paused: boolean;
  /** Every QR text seen in a frame (the caller validates it). */
  readonly onText: (text: string) => void;
  /** For tests. */
  readonly detector?: () => Promise<QrDetector | null>;
}

export function useScanner({
  video,
  paused,
  onText,
  detector: loadDetector = loadQrDetector,
}: ScannerOptions): Scanner {
  const [state, setState] = useState<ScannerState>('checking');
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const opened = useRef<MediaStream | null>(null);
  const detector = useRef<QrDetector | null>(null);
  const alive = useRef(true);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  const start = useCallback(() => {
    void (async () => {
      setState('starting');
      try {
        const camera = await openCamera();
        if (!alive.current) {
          closeCamera(camera);
          return;
        }
        opened.current = camera;
        setStream(camera);
        setTorchAvailable(torchSupported(camera.getVideoTracks()[0]));
        setState('scanning');
      } catch (error) {
        if (alive.current) setState(error instanceof CameraError ? error.reason : 'busy');
      }
    })();
  }, []);

  // Detector first (no camera prompt when nothing could read the frames), then the permission.
  useEffect(() => {
    alive.current = true;
    const run = { cancelled: false };
    const cancelled = () => run.cancelled; // read fresh after each await
    void (async () => {
      detector.current = await loadDetector();
      if (cancelled()) return;
      if (!detector.current) {
        setState('unavailable');
        return;
      }
      const permission = await cameraPermission();
      if (cancelled()) return;
      if (permission === 'granted') start();
      else setState(permission === 'denied' ? 'denied' : 'ask');
    })();
    return () => {
      run.cancelled = true;
      alive.current = false;
      closeCamera(opened.current);
      opened.current = null;
    };
  }, [loadDetector, start]);

  // Frame loop.
  useEffect(() => {
    if (state !== 'scanning' || paused) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      const element = video.current;
      const current = detector.current;
      if (element && current && document.visibilityState === 'visible' && element.readyState >= 2) {
        try {
          for (const text of await current.detect(element)) {
            if (stopped) return;
            onTextRef.current(text);
          }
        } catch {
          // A frame that could not be read (camera switching, page hidden) — the next one will do.
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), FRAME_INTERVAL_MS);
    };
    timer = setTimeout(() => void tick(), FRAME_INTERVAL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [state, paused, video]);

  const toggleTorch = useCallback(() => {
    const track = opened.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    void setTorch(track, next).then((applied) => {
      if (applied && alive.current) setTorchOn(next);
    });
  }, [torchOn]);

  return { state, stream, start, torchAvailable, torchOn, toggleTorch };
}
