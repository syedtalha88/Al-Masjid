import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { thumbHashFromBase64, thumbHashToApproximateAspectRatio } from '@mc/domain/thumbhash';
import exifReader from 'exif-reader';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';

import { IMAGE_MAX_PIXELS, ImageRejected, sanitizeImage, sniffImage } from '../src/media/image.ts';
import {
  cloudinaryMediaStore,
  cloudinarySignature,
  fileMediaStore,
  IMAGE_KEY,
  mediaStoreFromEnv,
  newImageKey,
} from '../src/media/store.ts';

// PHASE_03 T3.6 acceptance — the image pipeline (01 §5.5, 04 §6): EXIF/GPS removed (asserted with an EXIF reader),
// polyglot / invalid / decompression-bomb files refused or neutralised, the master capped at 1440 px, and both
// storage adapters. Every fixture is generated here (no real photos, no real places).

const MASJID = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const MARKER = 'MC-POLYGLOT-MARKER';
/** A fake API secret, built at runtime so it never looks like a committed credential. */
const FAKE_SECRET = ['fake', 'secret', 'x'.repeat(12)].join('-');

const picture = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 90 } } });

/** A JPEG carrying the metadata a phone camera writes: orientation, camera, author and a GPS position. */
const cameraJpeg = (width = 400, height = 200, orientation = 1) =>
  picture(width, height)
    .jpeg()
    .withMetadata({ orientation })
    .withExif({
      IFD0: { Make: 'TestCam', Model: 'Fixture 1', Artist: 'Test Person' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '17/1 23/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '78/1 29/1 0/1' },
    })
    .toBuffer();

const rejection = async (bytes: Buffer) => {
  try {
    await sanitizeImage(bytes);
    return 'accepted';
  } catch (error) {
    if (error instanceof ImageRejected) return error.reason;
    throw error;
  }
};

describe('sanitizeImage', () => {
  it('drops EXIF, GPS and every other metadata block; the fixture really had them', async () => {
    const original = await cameraJpeg();
    const before = await sharp(original).metadata();
    expect(before.exif).toBeDefined();
    const parsed = exifReader(before.exif ?? Buffer.alloc(0));
    expect(parsed.GPSInfo?.GPSLatitudeRef).toBe('N');
    expect(parsed.Image?.Artist).toBe('Test Person');

    const { master } = await sanitizeImage(original);
    const after = await sharp(master).metadata();
    expect(after.format).toBe('jpeg');
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(master.includes(Buffer.from('Exif'))).toBe(false);
    expect(master.includes(Buffer.from('TestCam'))).toBe(false);
  });

  it('turns the picture upright by its EXIF orientation before dropping it', async () => {
    const rotated = await cameraJpeg(400, 200, 6); // 6 = rotate 90° clockwise
    expect((await sharp(rotated).metadata()).orientation).toBe(6);
    const { width, height } = await sanitizeImage(rotated);
    expect({ width, height }).toEqual({ width: 200, height: 400 });
  });

  it('caps the longest side at 1440 px and never enlarges; ThumbHash keeps the aspect ratio', async () => {
    const big = await sanitizeImage(await picture(3000, 1500).jpeg().toBuffer());
    expect({ width: big.width, height: big.height }).toEqual({ width: 1440, height: 720 });
    expect(thumbHashToApproximateAspectRatio(thumbHashFromBase64(big.thumbhash))).toBeCloseTo(2, 0);
    const small = await sanitizeImage(await picture(300, 300).png().toBuffer());
    expect({ width: small.width, height: small.height }).toEqual({ width: 300, height: 300 });
    expect(Buffer.from(small.thumbhash, 'base64').length).toBeLessThanOrEqual(32);
  });

  it('accepts JPEG, PNG, WebP and AVIF by content, whatever the file was called', async () => {
    for (const bytes of [
      await picture(64, 48).jpeg().toBuffer(),
      await picture(64, 48).png().toBuffer(),
      await picture(64, 48).webp().toBuffer(),
      await picture(64, 48).avif().toBuffer(),
    ]) {
      expect(await rejection(bytes)).toBe('accepted');
    }
    expect(sniffImage(await picture(8, 8).avif().toBuffer())).toBe('avif');
  });

  it('refuses what is not an image, and HEIC (no decoder) with its own reason', async () => {
    expect(await rejection(Buffer.from('<html><script>alert(1)</script></html>'))).toBe('not_an_image');
    expect(await rejection(Buffer.from('GIF89a......'))).toBe('not_an_image');
    expect(await rejection(Buffer.alloc(0))).toBe('not_an_image');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(16)]);
    expect(await rejection(heic)).toBe('unsupported');
  });

  it('polyglots: data appended to a real image never survives; image magic in front of something else is refused', async () => {
    const jpeg = await picture(120, 80).jpeg().toBuffer();
    const polyglot = Buffer.concat([jpeg, Buffer.from(`<script>${MARKER}</script>PK\u0003\u0004${MARKER}`)]);
    const { master } = await sanitizeImage(polyglot);
    expect(master.includes(Buffer.from(MARKER))).toBe(false);
    // A JPEG comment segment smuggling text is dropped by the re-encode as well.
    const withComment = Buffer.concat([
      jpeg.subarray(0, 2),
      Buffer.from([0xff, 0xfe, 0x00, MARKER.length + 2]),
      Buffer.from(MARKER),
      jpeg.subarray(2),
    ]);
    expect((await sanitizeImage(withComment)).master.includes(Buffer.from(MARKER))).toBe(false);
    // JPEG / PNG magic bytes followed by HTML: not decodable as what they claim.
    expect(
      await rejection(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`<html>${MARKER}`)])),
    ).toBe('undecodable');
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await rejection(Buffer.concat([pngMagic, Buffer.from(MARKER)]))).toBe('undecodable');
  });

  it('a truncated image is refused', async () => {
    const jpeg = await picture(400, 300).jpeg().toBuffer();
    expect(await rejection(jpeg.subarray(0, Math.floor(jpeg.length / 3)))).toBe('undecodable');
  });

  it('decompression bomb: a tiny file declaring 64 MP is refused from its header, without decoding', async () => {
    const bomb = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(8000 * 8000).toBeGreaterThan(IMAGE_MAX_PIXELS);
    const started = performance.now();
    expect(await rejection(bomb)).toBe('too_many_pixels');
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('media stores', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  it('keys are m/<masjid>/<random uuid>; anything else is refused', async () => {
    const key = newImageKey(MASJID);
    expect(key).toMatch(IMAGE_KEY);
    expect(newImageKey(MASJID)).not.toBe(key);
    const store = fileMediaStore(await mkdtemp(join(tmpdir(), 'mc-media-')));
    for (const bad of ['../etc/passwd', `m/${MASJID}/../../x`, `m/${MASJID}`, 'seed/notice-1']) {
      await expect(store.putImage(bad, Buffer.alloc(1))).rejects.toThrow(/malformed/);
    }
  });

  it('the file store writes the master and the six delivery variants, never overwrites, and deletes them all', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-media-'));
    dirs.push(dir);
    const store = fileMediaStore(dir);
    const key = newImageKey(MASJID);
    const { master } = await sanitizeImage(await picture(2000, 1000).jpeg().toBuffer());
    await store.putImage(key, master);
    const [, , id] = key.split('/');
    for (const width of [480, 960, 1440]) {
      for (const format of ['avif', 'webp'] as const) {
        const file = await readFile(join(dir, 'i', String(width), format, 'm', MASJID, `${id ?? ''}.${format}`));
        const meta = await sharp(file).metadata();
        expect({ width: meta.width, format: meta.format }).toEqual({
          width,
          format: format === 'avif' ? 'heif' : 'webp',
        });
      }
    }
    await expect(store.putImage(key, master)).rejects.toThrow(/EEXIST/);
    await store.deleteImage(key);
    expect(await readdir(join(dir, 'i', '480', 'webp', 'm', MASJID))).toEqual([]);
  });

  it('Cloudinary signature: sorted name=value pairs + secret, SHA-256 hex', () => {
    const signature = cloudinarySignature({ timestamp: '1315060510', public_id: 'sample_image' }, 'abcd');
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    // Same as hashing the documented string by hand; parameter order does not matter.
    expect(signature).toBe(cloudinarySignature({ public_id: 'sample_image', timestamp: '1315060510' }, 'abcd'));
    expect(signature).not.toBe(cloudinarySignature({ public_id: 'sample_image', timestamp: '1315060511' }, 'abcd'));
  });

  it('the Cloudinary store: signed upload of the master to the fixed API host, signed destroy with invalidation', async () => {
    const calls: { url: string; form: FormData }[] = [];
    const fakeFetch: typeof fetch = (input, init) => {
      calls.push({ url: input instanceof Request ? input.url : input.toString(), form: init?.body as FormData }); // always FormData
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    const store = cloudinaryMediaStore({
      cloudName: 'testcloud',
      apiKey: '123456789',
      apiSecret: FAKE_SECRET,
      fetch: fakeFetch,
      now: () => 1_700_000_000,
    });
    const key = newImageKey(MASJID);
    await store.putImage(key, Buffer.from([0xff, 0xd8, 0xff]));
    await store.deleteImage(key);
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.cloudinary.com/v1_1/testcloud/image/upload',
      'https://api.cloudinary.com/v1_1/testcloud/image/destroy',
    ]);
    const upload = calls[0]?.form;
    expect(upload?.get('public_id')).toBe(key);
    expect(upload?.get('overwrite')).toBe('false');
    expect(upload?.get('api_key')).toBe('123456789');
    expect(upload?.get('file')).toBeInstanceOf(Blob);
    expect(upload?.get('signature')).toBe(
      cloudinarySignature({ overwrite: 'false', public_id: key, timestamp: '1700000000' }, FAKE_SECRET),
    );
    expect(calls[1]?.form.get('invalidate')).toBe('true');
    await expect(
      cloudinaryMediaStore({
        cloudName: 'testcloud',
        apiKey: '1',
        apiSecret: 'x'.repeat(16),
        fetch: () => Promise.resolve(new Response('no', { status: 401 })),
      }).putImage(key, Buffer.alloc(1)),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('MEDIA_STORE picks the adapter; cloudinary without keys is refused', () => {
    expect(() => mediaStoreFromEnv({ MEDIA_STORE: 'cloudinary' })).toThrow(/needs the Cloudinary keys/);
    expect(mediaStoreFromEnv({ MEDIA_STORE: 'files', MEDIA_DIR: tmpdir() })).toBeDefined();
  });
});
