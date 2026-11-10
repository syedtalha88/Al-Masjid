import { useMemo } from 'react';

import { QR_QUIET_MODULES, qrMatrix, qrPath } from './qr.ts';

export interface QrCodeViewProps {
  /** The text to encode (a `upi://pay?…` link). */
  readonly value: string;
  /** Accessible name ("UPI QR code for <payee>"). */
  readonly label: string;
  /** Rendered width and height in px (default 240 — 07 A10). */
  readonly size?: number;
  /** Under the code (the payee name). */
  readonly caption?: string;
  readonly className?: string;
}

/**
 * QrCodeView (06 §6): an SVG QR code with its quiet zone on a white card, the caption below. Crisp at any size (one
 * path, `crispEdges`); always dark on white so every UPI app reads it.
 */
export function QrCodeView({ value, label, size = 240, caption, className }: QrCodeViewProps) {
  const { path, modules } = useMemo(() => {
    const matrix = qrMatrix(value);
    return { path: qrPath(matrix), modules: matrix.size + QR_QUIET_MODULES * 2 };
  }, [value]);
  return (
    <figure className={`flex flex-col items-center gap-2 rounded-lg bg-surface p-3 shadow-e1 ${className ?? ''}`}>
      <svg
        role="img"
        aria-label={label}
        viewBox={`${String(-QR_QUIET_MODULES)} ${String(-QR_QUIET_MODULES)} ${String(modules)} ${String(modules)}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        className="bg-surface text-text"
        data-qr
      >
        <path d={path} fill="currentColor" fillRule="evenodd" />
      </svg>
      {caption ? (
        <figcaption dir="auto" className="max-w-full truncate px-2 type-subhead-strong text-text">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
