// Camera + QR detection for the Scan modal (07 A4, 04 §6). The native `BarcodeDetector` is used where it supports QR
// codes (Android Chrome); other browsers load the WebAssembly fallback (DECISIONS #94).
// Nothing here leaves the device: frames are decoded locally and only the follow code is used.

/** Decodes QR codes in a video frame. */
export interface QrDetector {
  /** The raw text of every QR code in the frame (empty when none). */
  detect(source: HTMLVideoElement): Promise<readonly string[]>;
}

interface DetectedBarcode {
  readonly rawValue: string;
}
interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<readonly DetectedBarcode[]>;
}
interface BarcodeDetectorClass {
  new (options: { formats: string[] }): BarcodeDetectorInstance;
  getSupportedFormats(): Promise<readonly string[]>;
}

/**
 * The platform's QR detector.
 *
 * @returns a detector, or `null` when the browser has no `BarcodeDetector` or it cannot read QR codes.
 */
export async function nativeQrDetector(scope: object = globalThis): Promise<QrDetector | null> {
  const Detector = (scope as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
  if (typeof Detector !== 'function') return null;
  try {
    if (!(await Detector.getSupportedFormats()).includes('qr_code')) return null;
    const detector = new Detector({ formats: ['qr_code'] });
    return {
      detect: async (source) => (await detector.detect(source)).map((barcode) => barcode.rawValue),
    };
  } catch {
    return null;
  }
}

/**
 * The detector to scan with: native where it reads QR codes, else the WebAssembly fallback (lazy chunk, DECISIONS #94).
 *
 * @returns `null` only when the fallback chunk cannot be loaded (offline before it was ever cached).
 */
export async function loadQrDetector(): Promise<QrDetector | null> {
  const native = await nativeQrDetector();
  if (native) return native;
  try {
    return (await import('./qr-fallback.ts')).fallbackQrDetector();
  } catch {
    return null;
  }
}

export type CameraPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

/** The camera permission without asking (`unknown` where the Permissions API cannot tell). */
export async function cameraPermission(nav: Navigator = navigator): Promise<CameraPermission> {
  try {
    // Browsers that do not know 'camera' (or the Permissions API) throw.
    const status = await nav.permissions.query({ name: 'camera' });
    return status.state;
  } catch {
    return 'unknown';
  }
}

export type CameraFailure = 'denied' | 'unavailable' | 'busy';

/** Opening the camera failed for a reason the screen explains. */
export class CameraError extends Error {
  readonly reason: CameraFailure;

  constructor(reason: CameraFailure) {
    super(`camera ${reason}`);
    this.name = 'CameraError';
    this.reason = reason;
  }
}

/**
 * Opens the back camera (asks for permission when needed).
 *
 * @throws CameraError — `denied` (permission refused), `unavailable` (no camera / no API / insecure context), `busy`
 *   (another app holds the camera, or it failed to start).
 */
export async function openCamera(nav: Navigator = navigator): Promise<MediaStream> {
  // Missing outside a secure context and in old browsers, whatever the DOM types say.
  const devices: MediaDevices | undefined = (nav as { mediaDevices?: MediaDevices }).mediaDevices;
  if (devices === undefined) throw new CameraError('unavailable');
  try {
    return await devices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraError('denied');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraError('unavailable');
    throw new CameraError('busy');
  }
}

/** Stops every track (the camera light goes off). */
export function closeCamera(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** Torch (flashlight) is a non-standard track capability (Android Chrome); absent elsewhere. */
interface TorchCapabilities {
  readonly torch?: boolean;
}

/** Can this video track switch the torch on? */
export function torchSupported(track: MediaStreamTrack | undefined): boolean {
  if (!track || typeof track.getCapabilities !== 'function') return false;
  return (track.getCapabilities() as TorchCapabilities).torch === true;
}

/**
 * Switches the torch.
 *
 * @returns whether the change was applied (some devices refuse while the camera is starting).
 */
export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  try {
    // `torch` is a non-standard constraint (Image Capture spec); TypeScript's MediaTrackConstraintSet lacks it.
    const torch: MediaTrackConstraintSet & { readonly torch: boolean } = { torch: on };
    await track.applyConstraints({ advanced: [torch] });
    return true;
  } catch {
    return false;
  }
}
