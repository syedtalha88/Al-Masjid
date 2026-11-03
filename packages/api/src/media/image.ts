// Image sanitizing (01 §5.5, 04 §6 "Files", DECISIONS #40, PHASE_03 T3.6): every admin photo is identified by its
// magic bytes (never the claimed name or type), checked for its pixel count before anything is decoded, decoded once
// with sharp under a pixel limit, rotated upright and re-encoded as one JPEG master of at most 1440 px — no metadata
// survives (EXIF incl. GPS, XMP, IPTC, ICC, comments), nor anything a polyglot file carried after or inside the image.
// A ThumbHash of the result is the blurred placeholder. Everything happens in memory.
import { rgbaToThumbHash } from '@mc/domain/thumbhash';
import sharp, { type Metadata } from 'sharp';

/** 01 §5.5: uploads up to 10 MB. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** 01 §5.5: decoding stops above 40 megapixels (a decompression bomb is refused before it is decoded). */
export const IMAGE_MAX_PIXELS = 40_000_000;
/** The delivery widths (Cloudinary named transformations, DECISIONS #40). */
export const IMAGE_WIDTHS = [480, 960, 1440] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];
export const IMAGE_FORMATS = ['avif', 'webp'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];
/** The longest side of the stored master. */
export const MASTER_MAX_SIDE = 1440;

/** What an accepted file is, by its first bytes. */
export type SniffedImage = 'jpeg' | 'png' | 'webp' | 'avif';

/** Why a file is refused (the route maps every reason to one friendly message). */
export class ImageRejected extends Error {
  readonly reason: 'not_an_image' | 'unsupported' | 'too_many_pixels' | 'undecodable';
  constructor(reason: ImageRejected['reason']) {
    super(reason);
    this.reason = reason;
  }
}

const startsWith = (bytes: Buffer, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);
const ascii = (bytes: Buffer, start: number, end: number) => bytes.subarray(start, end).toString('latin1');

/**
 * The image type of `bytes` by magic number: JPEG, PNG, WebP (RIFF…WEBP) or AVIF (ISO-BMFF `ftyp` with an AVIF
 * brand). HEIC/HEIF photos are recognised but not accepted — the server's decoder has no HEVC (iPhones upload JPEG
 * from a web page's `image/*` picker).
 *
 * @returns the type, or `null` for anything else.
 * @throws ImageRejected `unsupported` for HEIC/HEIF.
 */
export function sniffImage(bytes: Buffer): SniffedImage | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) {
      throw new ImageRejected('unsupported');
    }
  }
  return null;
}

/** sharp's own name for each accepted type (the decoder must agree with the magic bytes). */
const DECODER_FORMAT: Readonly<Record<SniffedImage, string>> = {
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  avif: 'heif',
};

export interface SanitizedImage {
  /** The JPEG master (≤ 1440 px on the longest side, sRGB, no metadata). */
  readonly master: Buffer;
  readonly width: number;
  readonly height: number;
  /** Base64 ThumbHash (≈ 25 bytes) of the master. */
  readonly thumbhash: string;
}

const decoder = (bytes: Buffer) =>
  sharp(bytes, { limitInputPixels: IMAGE_MAX_PIXELS, failOn: 'error', animated: false, sequentialRead: true });

/**
 * Sanitizes an uploaded photo.
 *
 * @returns the master and its ThumbHash.
 * @throws ImageRejected `not_an_image` (no accepted magic bytes), `unsupported` (HEIC), `too_many_pixels` (over
 *   40 MP, checked from the header before decoding), `undecodable` (corrupt, truncated, or the content does not match
 *   its magic bytes).
 */
export async function sanitizeImage(bytes: Buffer): Promise<SanitizedImage> {
  const type = sniffImage(bytes);
  if (!type) throw new ImageRejected('not_an_image');

  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: false, animated: false }).metadata();
  } catch {
    throw new ImageRejected('undecodable');
  }
  if (meta.format !== DECODER_FORMAT[type]) throw new ImageRejected('undecodable');
  if ((meta.width || 0) * (meta.height || 0) > IMAGE_MAX_PIXELS) throw new ImageRejected('too_many_pixels');

  try {
    // `.rotate()` applies the EXIF orientation; sharp writes no metadata unless asked (`keepMetadata` is never used).
    const { data: master, info } = await decoder(bytes)
      .rotate()
      .resize({ width: MASTER_MAX_SIDE, height: MASTER_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const { data: rgba, info: small } = await sharp(master)
      .resize({ width: 100, height: 100, fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const thumbhash = Buffer.from(rgbaToThumbHash(small.width, small.height, rgba)).toString('base64');
    return { master, width: info.width, height: info.height, thumbhash };
  } catch (error) {
    if (error instanceof ImageRejected) throw error;
    throw new ImageRejected('undecodable');
  }
}

/**
 * One delivery variant of a master — what Cloudinary's named transformation `mc_<width>_<format>` produces; used by the
 * local file store (no Cloudinary locally) and the tests.
 */
export function renderVariant(master: Buffer, width: ImageWidth, format: ImageFormat): Promise<Buffer> {
  const resized = sharp(master).resize({ width, withoutEnlargement: true });
  return (format === 'avif' ? resized.avif({ quality: 55 }) : resized.webp({ quality: 78 })).toBuffer();
}
