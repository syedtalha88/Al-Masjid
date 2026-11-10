// QR codes for UPI (06 QrCodeView, 07 A10 UPI QR sheet): Lean QR's nano encoder (a UPI link is ASCII once
// percent-encoded — `@mc/domain/upi`) at error correction M, drawn as one SVG path or onto a canvas for "Save QR".
// This module and its library load only with the QR sheet (01 §9 budgets: the QR generator is lazy — PHASE_05 T5.7).
import { toSvgPath } from 'lean-qr/extras/svg';
import { correction, generate } from 'lean-qr/nano';

import { COLORS } from '../tokens/tokens.ts';

/** ISO 18004 quiet zone: 4 modules of light space around the code. */
export const QR_QUIET_MODULES = 4;

export interface QrMatrix {
  /** Modules per side (without the quiet zone). */
  readonly size: number;
  /** `true` = dark module; out-of-range coordinates are light. */
  readonly get: (x: number, y: number) => boolean;
}

/**
 * The QR code of `text` (error correction M or higher when it fits — readable from a printed poster or a cracked
 * screen).
 *
 * @throws Error when `text` is too long for any QR version (a UPI link is far below that).
 */
export function qrMatrix(text: string): QrMatrix {
  return generate(text, { minCorrectionLevel: correction.M });
}

/** The dark modules as one SVG path in module units (`0 … size`). */
export const qrPath = (matrix: QrMatrix): string => toSvgPath(matrix);

export interface QrImageOptions {
  /** Lines under the code (payee name, UPI ID) so the saved picture says what it is. */
  readonly caption: readonly string[];
  /** Pixels per module (default 10 → ~450 px wide for a UPI link). */
  readonly scale?: number;
}

/** Caption size in modules: the first line bold and larger. */
const CAPTION_EM = [2.2, 1.8] as const;

/**
 * The code on a white card with its caption, as a PNG (A10 "Save QR to gallery"). Text uses the page's own font stack
 * so names in Hindi, Urdu or Telugu render with the fonts already loaded.
 *
 * @returns the PNG, or `null` when the browser cannot draw (no 2D canvas / `toBlob`).
 */
export async function qrPng(matrix: QrMatrix, { caption, scale = 10 }: QrImageOptions): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const side = (matrix.size + QR_QUIET_MODULES * 2) * scale;
  const lines = caption.filter((line) => line.trim() !== '');
  const lineHeights = lines.map((_, index) => (CAPTION_EM[index] ?? CAPTION_EM[1]) * scale * 1.4);
  canvas.width = side;
  canvas.height = side + lineHeights.reduce((sum, height) => sum + height, 0) + (lines.length > 0 ? scale * 2 : 0);

  context.fillStyle = COLORS.surface;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = COLORS.text;
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (matrix.get(x, y)) {
        context.fillRect((x + QR_QUIET_MODULES) * scale, (y + QR_QUIET_MODULES) * scale, scale, scale);
      }
    }
  }

  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  let top = side;
  lines.forEach((line, index) => {
    const em = (CAPTION_EM[index] ?? CAPTION_EM[1]) * scale;
    const height = lineHeights[index] ?? em;
    context.font = `${index === 0 ? '600' : '400'} ${String(em)}px ${family}`;
    context.fillStyle = index === 0 ? COLORS.text : COLORS['text-secondary'];
    context.fillText(line, canvas.width / 2, top + height / 2, canvas.width - scale * 4);
    top += height;
  });

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    }, 'image/png');
  });
}
