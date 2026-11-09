// The full QR detector of the musalli app (DECISIONS #94): native where the browser reads QR codes, else the lazy
// WebAssembly reader. A separate entry (`@mc/ui/scanner/fallback`) so an app that may not compile WebAssembly — the
// admin origin's CSP (DECISIONS #147) — never bundles or precaches the reader.
import { nativeQrDetector, type QrDetector } from './camera.ts';

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
