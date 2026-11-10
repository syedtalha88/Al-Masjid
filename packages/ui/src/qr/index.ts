// `@mc/ui/qr` — QR code generation (UPI QR sheet, A10). Import it only from lazily loaded code: the generator must stay
// out of the app's entry chunk (01 §9 budgets, PHASE_05 T5.7).
export { QR_QUIET_MODULES, type QrImageOptions, type QrMatrix, qrMatrix, qrPath, qrPng } from './qr.ts';
export { QrCodeView, type QrCodeViewProps } from './QrCodeView.tsx';
