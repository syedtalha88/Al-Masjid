// The QR camera scanner (DECISIONS #94), shared by the musalli Scan modal (07 A4) and the admin's UPI-QR scan (07 B8,
// PHASE_05 T5.2): camera access, the native `BarcodeDetector` or the lazy WebAssembly fallback, and the frame loop.
// Callers validate every text they get (04 §6) — follow codes with `followCodeFromScan`, UPI QRs with `parseUpiUri`.
export {
  CameraError,
  cameraPermission,
  closeCamera,
  nativeQrDetector,
  openCamera,
  type QrDetector,
  setTorch,
  torchSupported,
} from './camera.ts';
export { type Scanner, type ScannerOptions, type ScannerState, useScanner } from './useScanner.ts';
