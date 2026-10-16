import { describe, expect, it } from 'vitest';

import { loadLegalDoc, parseLegalDoc } from './legal.ts';
import { LOCALES } from './locales.ts';

describe('legal documents (09 §9)', () => {
  it('parses front matter and bullets; rejects malformed documents', () => {
    expect(parseLegalDoc('---\nversion: v-2\nstatus: reviewed\n---\n- One\n- Two\n')).toEqual({
      version: 'v-2',
      status: 'reviewed',
      points: ['One', 'Two'],
    });
    expect(() => parseLegalDoc('- no front matter')).toThrow(/front matter/);
    expect(() => parseLegalDoc('---\nstatus: draft\n---\n- x')).toThrow(/version/);
    expect(() => parseLegalDoc('---\nversion: 1\nstatus: final\n---\n- x')).toThrow(/status/);
    expect(() => parseLegalDoc('---\nversion: 1\nstatus: draft\n---\nprose')).toThrow(/bullet/);
  });

  it('every locale has the undertaking with the same version and number of points', async () => {
    const docs = await Promise.all(LOCALES.map((locale) => loadLegalDoc('undertaking', locale)));
    const [en] = docs;
    for (const doc of docs) {
      expect(doc.version).toBe(en?.version);
      expect(doc.points).toHaveLength(en?.points.length ?? -1);
    }
  });
});
