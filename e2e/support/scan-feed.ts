// Fake camera feed for the scan journey (10 §6 journey 2): a Y4M video Chromium plays as its camera
// (`--use-file-for-fake-video-capture`). First a QR that is NOT ours (must be refused without navigating), then the
// follow QR of the seeded masjid; Chromium loops the file. QR codes are drawn by ZXing's writer (zxing-wasm, the same
// library the app reads them with) — no binary fixture in git.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer';

const WIDTH = 640;
const HEIGHT = 480;
const FPS = 5;
/** Seconds each QR stays in view. */
const SECONDS_EACH = 3;
/** QR side in pixels (quiet zone included), centered — big enough for the reader at 640×480. */
const QR_PX = 320;

/** The file the `scan` project hands to Chromium. */
export const SCAN_FEED = join(import.meta.dirname, '..', '.cache', 'scan-feed.y4m');
/** What the first QR says: a link to another site. */
export const FOREIGN_QR_TEXT = 'https://example.com/m/TESTA001';

/** One luma plane with the QR modules (black on white) centered. */
async function lumaFrame(text: string): Promise<Uint8Array> {
  const { symbol, error } = await writeBarcode(text, { format: 'QRCode', scale: 1, addQuietZones: false });
  if (error) throw new Error(`scan feed: could not encode QR (${error})`);
  const quiet = 4;
  const modules = symbol.width + 2 * quiet;
  const cell = Math.floor(QR_PX / modules);
  const size = cell * modules;
  const left = Math.floor((WIDTH - size) / 2);
  const top = Math.floor((HEIGHT - size) / 2);
  const plane = new Uint8Array(WIDTH * HEIGHT).fill(235);
  for (let y = 0; y < symbol.height; y += 1) {
    for (let x = 0; x < symbol.width; x += 1) {
      if ((symbol.data[y * symbol.width + x] ?? 255) >= 128) continue; // light module
      for (let dy = 0; dy < cell; dy += 1) {
        const row = (top + (y + quiet) * cell + dy) * WIDTH + left + (x + quiet) * cell;
        plane.fill(16, row, row + cell);
      }
    }
  }
  return plane;
}

/**
 * Writes the feed.
 *
 * @param appUrl - the app origin under test; the second QR is `<appUrl>/m/TESTA001`.
 */
export async function writeScanFeed(appUrl: string): Promise<string> {
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(
    join(dirname(require.resolve('zxing-wasm/writer')), '..', '..', 'writer', 'zxing_writer.wasm'),
  );
  prepareZXingModule({
    overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) },
  });
  const chroma = new Uint8Array((WIDTH / 2) * (HEIGHT / 2) * 2).fill(128); // grey: no colour
  const frames: Uint8Array[] = [];
  for (const text of [FOREIGN_QR_TEXT, `${new URL(appUrl).origin}/m/TESTA001`]) {
    const luma = await lumaFrame(text);
    for (let index = 0; index < FPS * SECONDS_EACH; index += 1) frames.push(Buffer.from('FRAME\n'), luma, chroma);
  }
  mkdirSync(dirname(SCAN_FEED), { recursive: true });
  writeFileSync(
    SCAN_FEED,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${String(WIDTH)} H${String(HEIGHT)} F${String(FPS)}:1 Ip A1:1 C420jpeg\n`),
      ...frames,
    ]),
  );
  return SCAN_FEED;
}
