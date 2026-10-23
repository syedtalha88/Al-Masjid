// QR fallback for browsers without a native QR `BarcodeDetector` (iPhone Safari, desktop) — DECISIONS #94. A lazy chunk:
// the `barcode-detector` ponyfill over ZXing compiled to WebAssembly. The `.wasm` is a hashed asset of OUR build (never
// the library's default CDN URL), cached by the service worker; compiling it needs CSP `'wasm-unsafe-eval'` (app only).
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
import readerWasm from 'zxing-wasm/reader/zxing_reader.wasm?url';

import type { QrDetector } from './camera.ts';

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? readerWasm : prefix + path),
  },
  // Start the download now: by the time the camera is up the reader is usually ready.
  fireImmediately: true,
}).catch(() => undefined); // a failed load surfaces again (and is retried) on the first detect()

/** A QR detector backed by the WebAssembly reader. */
export function fallbackQrDetector(): QrDetector {
  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  return {
    detect: async (source) => (await detector.detect(source)).map((barcode) => barcode.rawValue),
  };
}
