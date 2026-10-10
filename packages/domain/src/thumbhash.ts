// ThumbHash — tiny image placeholders (06 §5: "always with thumbhash placeholder, computed at upload").
// Typed port of the encoder/decoder from `thumbhash` 0.1.1 by Evan Wallace (MIT,
// https://github.com/evanw/thumbhash), vendored instead of depended on: the package has had no release since
// March 2023 (CLAUDE.md §6 dependency rule; DECISIONS #45). Algorithm unchanged; only types and naming.
//
// MIT License — Copyright (c) 2023 Evan Wallace. Permission is hereby granted, free of charge, to any person
// obtaining a copy of this software and associated documentation files (the "Software"), to deal in the
// Software without restriction, including without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions: The above copyright notice and this permission
// notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED
// "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

export interface RgbaImage {
  readonly w: number;
  readonly h: number;
  /** Row-major RGBA, not premultiplied, `w * h * 4` bytes. */
  readonly rgba: Uint8Array;
}

const at = (values: ArrayLike<number>, index: number) => values[index] ?? 0;

/**
 * Encodes an RGBA image (≤ 100×100) to a ThumbHash.
 *
 * @throws Error when the image is larger than 100×100 (downscale first) or `rgba` has the wrong length.
 */
export function rgbaToThumbHash(w: number, h: number, rgba: ArrayLike<number>): Uint8Array {
  if (w > 100 || h > 100) throw new Error(`${String(w)}x${String(h)} doesn't fit in 100x100`);
  if (rgba.length !== w * h * 4) throw new Error('rgba must have w*h*4 elements');
  const { PI, round, max, cos, abs } = Math;

  // Average color.
  let avgR = 0;
  let avgG = 0;
  let avgB = 0;
  let avgA = 0;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const alpha = at(rgba, j + 3) / 255;
    avgR += (alpha / 255) * at(rgba, j);
    avgG += (alpha / 255) * at(rgba, j + 1);
    avgB += (alpha / 255) * at(rgba, j + 2);
    avgA += alpha;
  }
  if (avgA) {
    avgR /= avgA;
    avgG /= avgA;
    avgB /= avgA;
  }

  const hasAlpha = avgA < w * h;
  const lLimit = hasAlpha ? 5 : 7; // fewer luminance bits when there is alpha
  const lx = max(1, round((lLimit * w) / max(w, h)));
  const ly = max(1, round((lLimit * h) / max(w, h)));
  const l: number[] = []; // luminance
  const p: number[] = []; // yellow − blue
  const q: number[] = []; // red − green
  const a: number[] = []; // alpha

  // RGBA → LPQA, composited atop the average color.
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const alpha = at(rgba, j + 3) / 255;
    const r = avgR * (1 - alpha) + (alpha / 255) * at(rgba, j);
    const g = avgG * (1 - alpha) + (alpha / 255) * at(rgba, j + 1);
    const b = avgB * (1 - alpha) + (alpha / 255) * at(rgba, j + 2);
    l[i] = (r + g + b) / 3;
    p[i] = (r + g) / 2 - b;
    q[i] = r - g;
    a[i] = alpha;
  }

  // DCT into a DC (constant) term and normalized AC (varying) terms.
  const encodeChannel = (channel: number[], nx: number, ny: number): [number, number[], number] => {
    let dc = 0;
    let scale = 0;
    const ac: number[] = [];
    const fx: number[] = [];
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx * ny < nx * (ny - cy); cx++) {
        let f = 0;
        for (let x = 0; x < w; x++) fx[x] = cos((PI / w) * cx * (x + 0.5));
        for (let y = 0; y < h; y++) {
          const fy = cos((PI / h) * cy * (y + 0.5));
          for (let x = 0; x < w; x++) f += at(channel, x + y * w) * at(fx, x) * fy;
        }
        f /= w * h;
        if (cx || cy) {
          ac.push(f);
          scale = max(scale, abs(f));
        } else {
          dc = f;
        }
      }
    }
    if (scale) for (let i = 0; i < ac.length; i++) ac[i] = 0.5 + (0.5 / scale) * at(ac, i);
    return [dc, ac, scale];
  };
  const [lDc, lAc, lScale] = encodeChannel(l, max(3, lx), max(3, ly));
  const [pDc, pAc, pScale] = encodeChannel(p, 3, 3);
  const [qDc, qAc, qScale] = encodeChannel(q, 3, 3);
  const [aDc, aAc, aScale] = hasAlpha ? encodeChannel(a, 5, 5) : [0, [], 0];

  // Constants.
  const isLandscape = w > h;
  const header24 =
    round(63 * lDc) |
    (round(31.5 + 31.5 * pDc) << 6) |
    (round(31.5 + 31.5 * qDc) << 12) |
    (round(31 * lScale) << 18) |
    (Number(hasAlpha) << 23);
  const header16 =
    (isLandscape ? ly : lx) | (round(63 * pScale) << 3) | (round(63 * qScale) << 9) | (Number(isLandscape) << 15);
  const hash = [header24 & 255, (header24 >> 8) & 255, header24 >> 16, header16 & 255, header16 >> 8];
  const acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  if (hasAlpha) hash.push(round(15 * aDc) | (round(15 * aScale) << 4));

  // Varying factors, two 4-bit values per byte.
  for (const ac of hasAlpha ? [lAc, pAc, qAc, aAc] : [lAc, pAc, qAc]) {
    for (const f of ac) {
      const index = acStart + (acIndex >> 1);
      hash[index] = at(hash, index) | (round(15 * f) << ((acIndex & 1) << 2));
      acIndex += 1;
    }
  }
  return new Uint8Array(hash);
}

/** Approximate aspect ratio (width / height) of the original image. */
export function thumbHashToApproximateAspectRatio(hash: ArrayLike<number>): number {
  const header = at(hash, 3);
  const hasAlpha = at(hash, 2) & 0x80;
  const isLandscape = at(hash, 4) & 0x80;
  const lx = isLandscape ? (hasAlpha ? 5 : 7) : header & 7;
  const ly = isLandscape ? header & 7 : hasAlpha ? 5 : 7;
  return lx / ly;
}

/**
 * Decodes a ThumbHash to a small RGBA image (≤ 32 px on the long side), to be drawn scaled up.
 *
 * @throws Error when `hash` is too short to be a ThumbHash.
 */
export function thumbHashToRgba(hash: ArrayLike<number>): RgbaImage {
  if (hash.length < 5) throw new Error('thumbhash too short');
  const { PI, min, max, cos, round } = Math;

  const header24 = at(hash, 0) | (at(hash, 1) << 8) | (at(hash, 2) << 16);
  const header16 = at(hash, 3) | (at(hash, 4) << 8);
  const lDc = (header24 & 63) / 63;
  const pDc = ((header24 >> 6) & 63) / 31.5 - 1;
  const qDc = ((header24 >> 12) & 63) / 31.5 - 1;
  const lScale = ((header24 >> 18) & 31) / 31;
  const hasAlpha = header24 >> 23 !== 0;
  const pScale = ((header16 >> 3) & 63) / 63;
  const qScale = ((header16 >> 9) & 63) / 63;
  const isLandscape = header16 >> 15 !== 0;
  const lx = max(3, isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7);
  const ly = max(3, isLandscape ? header16 & 7 : hasAlpha ? 5 : 7);
  const aDc = hasAlpha ? (at(hash, 5) & 15) / 15 : 1;
  const aScale = (at(hash, 5) >> 4) / 15;

  // Varying factors (saturation boosted 1.25× to compensate for quantization).
  const acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  const decodeChannel = (nx: number, ny: number, scale: number): number[] => {
    const ac: number[] = [];
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) {
        ac.push((((at(hash, acStart + (acIndex >> 1)) >> ((acIndex & 1) << 2)) & 15) / 7.5 - 1) * scale);
        acIndex += 1;
      }
    }
    return ac;
  };
  const lAc = decodeChannel(lx, ly, lScale);
  const pAc = decodeChannel(3, 3, pScale * 1.25);
  const qAc = decodeChannel(3, 3, qScale * 1.25);
  const aAc = hasAlpha ? decodeChannel(5, 5, aScale) : [];

  // Inverse DCT into RGB.
  const ratio = thumbHashToApproximateAspectRatio(hash);
  const w = round(ratio > 1 ? 32 : 32 * ratio);
  const h = round(ratio > 1 ? 32 / ratio : 32);
  const rgba = new Uint8Array(w * h * 4);
  const fx: number[] = [];
  const fy: number[] = [];
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      let l = lDc;
      let p = pDc;
      let q = qDc;
      let a = aDc;
      for (let cx = 0, n = max(lx, hasAlpha ? 5 : 3); cx < n; cx++) fx[cx] = cos((PI / w) * (x + 0.5) * cx);
      for (let cy = 0, n = max(ly, hasAlpha ? 5 : 3); cy < n; cy++) fy[cy] = cos((PI / h) * (y + 0.5) * cy);
      for (let cy = 0, j = 0; cy < ly; cy++) {
        const fy2 = at(fy, cy) * 2;
        for (let cx = cy ? 0 : 1; cx * ly < lx * (ly - cy); cx++, j++) l += at(lAc, j) * at(fx, cx) * fy2;
      }
      for (let cy = 0, j = 0; cy < 3; cy++) {
        const fy2 = at(fy, cy) * 2;
        for (let cx = cy ? 0 : 1; cx < 3 - cy; cx++, j++) {
          const f = at(fx, cx) * fy2;
          p += at(pAc, j) * f;
          q += at(qAc, j) * f;
        }
      }
      if (hasAlpha) {
        for (let cy = 0, j = 0; cy < 5; cy++) {
          const fy2 = at(fy, cy) * 2;
          for (let cx = cy ? 0 : 1; cx < 5 - cy; cx++, j++) a += at(aAc, j) * at(fx, cx) * fy2;
        }
      }
      const b = l - (2 / 3) * p;
      const r = (3 * l - b + q) / 2;
      const g = r - q;
      rgba[i] = max(0, 255 * min(1, r));
      rgba[i + 1] = max(0, 255 * min(1, g));
      rgba[i + 2] = max(0, 255 * min(1, b));
      rgba[i + 3] = max(0, 255 * min(1, a));
    }
  }
  return { w, h, rgba };
}

/** Average color of a ThumbHash, each channel 0–1 (not premultiplied). */
export function thumbHashToAverageRgba(hash: ArrayLike<number>): {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
} {
  const { min, max } = Math;
  const header = at(hash, 0) | (at(hash, 1) << 8) | (at(hash, 2) << 16);
  const l = (header & 63) / 63;
  const p = ((header >> 6) & 63) / 31.5 - 1;
  const q = ((header >> 12) & 63) / 31.5 - 1;
  const hasAlpha = header >> 23;
  const a = hasAlpha ? (at(hash, 5) & 15) / 15 : 1;
  const b = l - (2 / 3) * p;
  const r = (3 * l - b + q) / 2;
  const g = r - q;
  return { r: max(0, min(1, r)), g: max(0, min(1, g)), b: max(0, min(1, b)), a };
}

/** Base64 (as stored next to an image key) → hash bytes. Throws on invalid base64. */
export function thumbHashFromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
