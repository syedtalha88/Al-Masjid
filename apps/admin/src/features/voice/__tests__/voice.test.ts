import {
  type AdminLibraryEntry,
  announcementPublishSchema,
  dailyContentPublishSchema,
  duaPublishSchema,
} from '@mc/shared/contracts';
import { describe, expect, it } from 'vitest';

import { dailyPublishBody, draftForEntry } from '../../daily/lib/daily.ts';
import { draftForCategory, duaPublishBody } from '../../dua/lib/dua.ts';
import { draftForText, publishBody } from '../../notice/lib/notice.ts';
import { peaksOf, recordingType } from '../lib/measure.ts';
import { voiceBody, voiceTitleMissing } from '../lib/voice.ts';

// 07 B14 (PHASE_03 T3.13): the peak envelope, the recording format, and a voice note in the three flows' bodies — they
// must pass the server's contracts (a title with every voice note; the free-text notice's own). Fake texts only.

const MASJID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const VOICE = {
  key: `m/${MASJID}/a/0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f`,
  durationS: 95,
  peaks: Array.from({ length: 48 }, (_, index) => (index * 5) % 256),
  url: null,
};
const ENTRY: AdminLibraryEntry = {
  id: '0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f',
  kind: 'hadith',
  arabic: 'نَصٌّ تجريبي للعرض فقط',
  transliteration: {},
  translation: { en: 'Sample translation text for development.' },
  reference: 'DEV-SAMPLE-001',
  sourceName: 'Development fixture',
  sourceLicense: 'N/A — not for production',
  tags: [],
};

describe('peaksOf', () => {
  it('the loudest |sample| per slice, scaled to 255; silence is 0', () => {
    const samples = new Float32Array(96);
    samples[0] = 0.5;
    samples[3] = -1;
    samples[50] = 0.25;
    const peaks = peaksOf(samples);
    expect(peaks).toHaveLength(48);
    expect(peaks[1]).toBe(255); // −1 in the second slice (samples 2–3)
    expect(peaks[0]).toBe(128);
    expect(peaks[25]).toBe(64);
    expect(peaksOf(new Float32Array(100)).every((peak) => peak === 0)).toBe(true);
  });

  it('the recording format: the first one the browser supports', () => {
    expect(recordingType((type) => type === 'audio/webm')).toBe('audio/webm');
    expect(recordingType((type) => type.startsWith('audio/mp4'))).toBe('audio/mp4');
    expect(recordingType(() => false)).toBeUndefined();
  });
});

describe('voice notes in drafts', () => {
  it('needs a title only where the post has none of its own', () => {
    expect(voiceTitleMissing({ voice: VOICE }, true)).toBe(true);
    expect(voiceTitleMissing({ voice: VOICE, voiceTitle: ' Test title ' }, true)).toBe(false);
    expect(voiceTitleMissing({ voice: VOICE }, false)).toBe(false);
    expect(voiceTitleMissing({}, true)).toBe(false);
    expect(voiceBody({ voiceTitle: 'Test title' }, true)).toEqual({}); // no title without a voice note
  });

  it('the notice, hadith and dua bodies carry it and pass the server contracts', () => {
    const notice = publishBody(
      {
        ...draftForText('en'),
        content: { kind: 'text', title: 'Test', body: 'Test body', locale: 'en' },
        voice: VOICE,
      },
      undefined,
      false,
    );
    expect(notice).toMatchObject({ voice: { key: VOICE.key, durationS: 95 } });
    expect(notice).not.toHaveProperty('title');
    expect(announcementPublishSchema.safeParse(notice).success).toBe(true);
    const daily = dailyPublishBody({ ...draftForEntry('hadith', ENTRY, false), voice: VOICE }, false);
    expect(daily).toBeNull(); // the voice note needs a title
    const titled = dailyPublishBody(
      { ...draftForEntry('hadith', ENTRY, false), voice: VOICE, voiceTitle: 'Test title' },
      false,
    );
    expect(titled).toMatchObject({ title: 'Test title', voice: { durationS: 95 } });
    expect(dailyContentPublishSchema.safeParse(titled).success).toBe(true);
    const dua = duaPublishBody(
      {
        ...draftForCategory('illness', 'en'),
        entry: { ...ENTRY, kind: 'dua' },
        voice: VOICE,
        voiceTitle: 'Test title',
      },
      false,
    );
    expect(duaPublishSchema.safeParse(dua).success).toBe(true);
  });
});
