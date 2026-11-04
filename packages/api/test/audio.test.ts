import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { audioUploadQuerySchema } from '@mc/shared/contracts';
import { afterAll, describe, expect, it } from 'vitest';

import { AUDIO_MAX_SECONDS, AudioRejected, keptDuration, sniffAudio } from '../src/media/audio.ts';
import { AUDIO_KEY, cloudinaryMediaStore, fileMediaStore, newAudioKey } from '../src/media/store.ts';

// PHASE_03 T3.13 (01 §5.5 Audio, 04 R14) — voice notes: the container allow-list by magic bytes (never the claimed
// type), the ten-minute rule (the storage's own measurement decides; the browser's otherwise), the upload query
// contract (rights tick, length, 48 peaks), and both stores (local file; Cloudinary as a `video` resource).

const MASJID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const FAKE_SECRET = 'not-a-real-secret-for-tests';
const head = (...bytes: number[]) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(32)]);
const text = (value: string) => Buffer.concat([Buffer.from(value, 'latin1'), Buffer.alloc(32)]);
const dirs: string[] = [];

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe('sniffAudio', () => {
  it('recognises the allowed containers by their first bytes', () => {
    expect(sniffAudio(text('OggS'))).toBe('ogg');
    expect(sniffAudio(head(0x1a, 0x45, 0xdf, 0xa3))).toBe('webm');
    expect(sniffAudio(text('\u0000\u0000\u0000 ftypM4A '))).toBe('mp4');
    expect(sniffAudio(text('\u0000\u0000\u0000\u0018ftypmp42'))).toBe('mp4');
    expect(sniffAudio(text('\u0000\u0000\u0000\u0018ftyp3gp4'))).toBe('mp4');
    expect(sniffAudio(text('RIFF\u0000\u0000\u0000\u0000WAVE'))).toBe('wav');
    expect(sniffAudio(text('ID3'))).toBe('mp3');
    expect(sniffAudio(head(0xff, 0xfb))).toBe('mp3');
    expect(sniffAudio(head(0xff, 0xf1))).toBe('aac');
  });

  it('refuses everything else: images, AVIF/HEIC boxes, documents, text, short files', () => {
    expect(sniffAudio(head(0xff, 0xd8, 0xff))).toBeNull(); // JPEG
    expect(sniffAudio(head(0x89, 0x50, 0x4e, 0x47))).toBeNull(); // PNG
    expect(sniffAudio(text('\u0000\u0000\u0000\u0018ftypavif'))).toBeNull();
    expect(sniffAudio(text('\u0000\u0000\u0000\u0018ftypheic'))).toBeNull();
    expect(sniffAudio(text('RIFF\u0000\u0000\u0000\u0000WEBP'))).toBeNull();
    expect(sniffAudio(text('%PDF-1.7'))).toBeNull();
    expect(sniffAudio(text('<html>'))).toBeNull();
    expect(sniffAudio(Buffer.from('OggS'))).toBeNull(); // shorter than any real header
  });
});

describe('keptDuration', () => {
  it('the storage measurement decides; else the browser value; whole seconds, 1…600', () => {
    expect(keptDuration(12.4, undefined)).toBe(12);
    expect(keptDuration(12.4, 90.6)).toBe(91);
    expect(keptDuration(0.6, undefined)).toBe(1);
    expect(keptDuration(600.4, undefined)).toBe(AUDIO_MAX_SECONDS);
    expect(keptDuration(30, Number.NaN)).toBe(30);
    expect(() => keptDuration(30, 601)).toThrow(AudioRejected);
  });
});

describe('the upload query contract', () => {
  const peaks = Array.from({ length: 48 }, (_, index) => String(index * 5)).join(',');
  it('needs the rights tick, a length up to ten minutes and exactly 48 peaks 0…255', () => {
    expect(audioUploadQuerySchema.parse({ rightsConfirmed: 'true', durationS: '125.5', peaks })).toMatchObject({
      durationS: 125.5,
      peaks: expect.arrayContaining([0, 235]) as unknown,
    });
    for (const query of [
      { durationS: '12', peaks },
      { rightsConfirmed: 'true', durationS: '601', peaks },
      { rightsConfirmed: 'true', durationS: '0', peaks },
      { rightsConfirmed: 'true', durationS: '1e3', peaks },
      { rightsConfirmed: 'true', durationS: '12', peaks: '1,2,3' },
      { rightsConfirmed: 'true', durationS: '12', peaks: peaks.replace('0', '256') },
      { rightsConfirmed: 'true', durationS: '12', peaks, extra: '1' },
    ]) {
      expect(audioUploadQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });
});

describe('stores', () => {
  it('local: the recording at its delivery path, never overwritten; malformed keys refused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-audio-'));
    dirs.push(dir);
    const store = fileMediaStore(dir);
    const key = newAudioKey(MASJID);
    expect(key).toMatch(AUDIO_KEY);
    const bytes = text('OggS');
    expect(await store.putAudio(key, bytes, 'ogg')).toEqual({});
    expect(await readFile(join(dir, 'a', 'm4a', key))).toEqual(bytes);
    await expect(store.putAudio(key, bytes, 'ogg')).rejects.toThrow(/EEXIST/);
    await store.deleteAudio(key);
    await expect(readFile(join(dir, 'a', 'm4a', key))).rejects.toThrow(/ENOENT/);
    for (const bad of [`m/${MASJID}/../../x`, `m/${MASJID}/not-audio`, 'a/b']) {
      await expect(store.putAudio(bad, bytes, 'ogg')).rejects.toThrow(/malformed/);
    }
  });

  it('Cloudinary: a signed upload as the video resource; its duration when returned; destroy invalidates', async () => {
    const calls: { url: string; form: FormData }[] = [];
    let answer = JSON.stringify({ duration: 42.3 });
    const fakeFetch: typeof fetch = (input, init) => {
      calls.push({ url: input instanceof Request ? input.url : input.toString(), form: init?.body as FormData }); // always FormData
      return Promise.resolve(new Response(answer, { status: 200 }));
    };
    const store = cloudinaryMediaStore({
      cloudName: 'testcloud',
      apiKey: '123456789',
      apiSecret: FAKE_SECRET,
      fetch: fakeFetch,
      now: () => 1_700_000_000,
    });
    const key = newAudioKey(MASJID);
    expect(await store.putAudio(key, text('OggS'), 'ogg')).toEqual({ durationS: 42.3 });
    answer = JSON.stringify({ public_id: key });
    expect(await store.putAudio(key, text('OggS'), 'ogg')).toEqual({});
    await store.deleteAudio(key);
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.cloudinary.com/v1_1/testcloud/video/upload',
      'https://api.cloudinary.com/v1_1/testcloud/video/upload',
      'https://api.cloudinary.com/v1_1/testcloud/video/destroy',
    ]);
    expect(calls[0]?.form.get('public_id')).toBe(key);
    expect((calls[0]?.form.get('file') as Blob | null)?.type).toBe('audio/ogg'); // the form's file part
    expect(calls[2]?.form.get('invalidate')).toBe('true');
  });
});
