// @vitest-environment jsdom
// QR generation for the UPI QR sheet (07 A10, PHASE_05 T5.4): every code we draw is read back by a real decoder — the
// ZXing reader the app already ships (`zxing-wasm`, its own .wasm from node_modules: no network) — and must give back
// exactly the link. Fake payee data only.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { buildUpiUri } from '@mc/domain/upi';
import { render, screen } from '@testing-library/react';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

import { QR_QUIET_MODULES, QrCodeView, type QrMatrix, qrMatrix, qrPath } from '../src/qr/index.ts';

const require = createRequire(import.meta.url);

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
  await prepareZXingModule({
    overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) },
    fireImmediately: true,
  });
});

/** The matrix as RGBA pixels (4 px per module, quiet zone included) — what a camera would see. */
function pixels(matrix: QrMatrix, scale = 4) {
  const side = (matrix.size + QR_QUIET_MODULES * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      if (matrix.get(Math.floor(x / scale) - QR_QUIET_MODULES, Math.floor(y / scale) - QR_QUIET_MODULES)) {
        const at = (y * side + x) * 4;
        data[at] = 0;
        data[at + 1] = 0;
        data[at + 2] = 0;
      }
    }
  }
  return { width: side, height: side, data, colorSpace: 'srgb' as const };
}

async function decode(text: string): Promise<string | undefined> {
  const results = await readBarcodes(pixels(qrMatrix(text)), { formats: ['QRCode'], tryHarder: true });
  return results[0]?.text;
}

const SAMPLE = buildUpiUri({ vpa: 'test.masjid@okbank', payeeName: 'Test Masjid Committee', note: 'Test roof repair' });

describe('qrMatrix', () => {
  it('encodes a UPI link that a QR reader reads back exactly', async () => {
    expect(await decode(SAMPLE)).toBe(SAMPLE);
  });

  it('round-trips links with non-Latin payee names and notes (percent-encoded UTF-8)', async () => {
    const vpa = fc.stringMatching(/^[a-z0-9][a-z0-9._-]{1,20}@[a-z]{3,10}$/);
    const text = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 50 }).filter((value) => value.trim() !== '');
    const links = fc.sample(
      fc.record({ vpa, payeeName: text, note: text }).map((payee) => {
        try {
          return buildUpiUri(payee);
        } catch {
          return SAMPLE; // a name that cleans to nothing
        }
      }),
      { numRuns: 12, seed: 5 },
    );
    for (const link of links) expect(await decode(link)).toBe(link);
  });

  it('uses error correction M or better, and a quiet zone of 4 modules around the path', () => {
    const matrix = qrMatrix(SAMPLE);
    expect(matrix.size).toBeGreaterThanOrEqual(21);
    expect(matrix.get(-1, 0)).toBe(false);
    expect(qrPath(matrix)).toMatch(/^M/);
  });
});

describe('QrCodeView', () => {
  it('renders one path with its accessible name and caption', () => {
    render(<QrCodeView value={SAMPLE} label="UPI QR code for Test Masjid Committee" caption="Test Masjid Committee" />);
    const image = screen.getByRole('img', { name: 'UPI QR code for Test Masjid Committee' });
    expect(image.getAttribute('width')).toBe('240');
    expect(image.querySelectorAll('path')).toHaveLength(1);
    expect(image.getAttribute('viewBox')).toMatch(/^-4 -4 \d+ \d+$/);
    expect(screen.getByText('Test Masjid Committee')).toBeTruthy();
  });
});
