import { describe, expect, it } from 'vitest';

import { editableUntil, emptyVideo, linkState, videoBody, videoIssues, withPreview } from '../lib/video.ts';

// PHASE_06 T6.2 · 07 B10: the instant link check, the preview filling the title, what blocks Publish, the request body.
const URL = 'https://youtu.be/AbC_123-xYz';
const preview = { youtubeId: 'AbC_123-xYz', title: 'Test bayan from YouTube', thumbnail: 'data:image/jpeg;base64,AA' };

describe('B10 draft', () => {
  it('checks the pasted link instantly', () => {
    expect(linkState('')).toBe('empty');
    expect(linkState('  ')).toBe('empty');
    expect(linkState(URL)).toBe('ok');
    expect(linkState('https://youtube.com.evil.example/watch?v=AbC_123-xYz')).toBe('invalid');
    expect(linkState('hello')).toBe('invalid');
  });

  it('the preview fills an empty title, never one the admin typed', () => {
    const filled = withPreview({ ...emptyVideo(), url: URL }, URL, preview);
    expect(filled.title).toBe('Test bayan from YouTube');
    const typed = withPreview({ ...emptyVideo(), url: URL, title: 'Test own title' }, URL, preview);
    expect(typed.title).toBe('Test own title');
  });

  it('lists what blocks Publish; the audience has no default; a changed link needs a new preview', () => {
    expect(videoIssues(emptyVideo())).toEqual(['link', 'title', 'audience', 'rights']);
    const ready = {
      ...withPreview({ ...emptyVideo(), url: URL }, URL, preview),
      audience: 'sisters',
      rights: true,
    } as const;
    expect(videoIssues(ready)).toEqual([]);
    expect(videoIssues({ ...ready, url: 'https://youtu.be/Other_id-12' })).toEqual(['link']);
    expect(videoIssues({ ...ready, title: 'x'.repeat(121) })).toEqual(['title']);
  });

  it('builds the body with trimmed optional texts, or null while something is missing', () => {
    const ready = {
      ...withPreview({ ...emptyVideo(), url: ` ${URL} ` }, URL, preview),
      url: ` ${URL} `,
      audience: 'everyone',
      rights: true,
      speaker: '  ',
      description: ' Placeholder ',
    } as const;
    expect(videoBody(ready, 'ur', true)).toEqual({
      url: URL,
      title: 'Test bayan from YouTube',
      description: 'Placeholder',
      audience: 'everyone',
      locale: 'ur',
      rightsConfirmed: true,
      notify: true,
    });
    expect(videoBody({ ...ready, rights: false }, 'en', false)).toBeNull();
  });

  it('is editable for 24 h after publishing', () => {
    expect(editableUntil('2026-11-13T06:30:00.000Z').toISOString()).toBe('2026-11-14T06:30:00.000Z');
  });
});
