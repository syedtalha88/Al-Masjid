import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { draftLegalDocs, LEGAL_DOC_NAMES, loadLegalDoc, parseLegalDoc } from './legal.ts';
import { LOCALES } from './locales.ts';
import { assertLegalReady, readLegalFiles } from './vite-plugin.ts';

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

  it('every document exists in every locale with the same version and number of points; translations are marked', async () => {
    for (const name of LEGAL_DOC_NAMES) {
      const docs = await Promise.all(LOCALES.map((locale) => loadLegalDoc(name, locale)));
      const [en] = docs;
      expect(en?.draftTranslation, name).toBeUndefined();
      for (const [index, doc] of docs.entries()) {
        const where = `${name} ${LOCALES[index] ?? ''}`;
        expect(doc.version, where).toBe(en?.version);
        expect(doc.points, where).toHaveLength(en?.points.length ?? -1);
        if (LOCALES[index] !== 'en') expect(doc.draftTranslation, where).toBe(true);
      }
    }
  });

  it('the privacy notice is a draft whose version matches the server seed', async () => {
    const en = await loadLegalDoc('privacy', 'en');
    expect(en).toMatchObject({ version: 'draft-1', status: 'draft' });
    expect(en.points.length).toBeGreaterThan(5);
  });

  it('the production build refuses drafts (05 §10); other builds pass', () => {
    const files = readLegalFiles(join(import.meta.dirname, '..', 'legal'));
    expect(Object.keys(files)).toHaveLength(LEGAL_DOC_NAMES.length * LOCALES.length);
    expect(draftLegalDocs(files)).toContain('en/privacy.md');
    expect(() => {
      assertLegalReady({ MC_BUILD_ENV: 'production' }, files);
    }).toThrow(/still marked draft.*en\/privacy\.md/su);
    expect(() => {
      assertLegalReady({ MC_BUILD_ENV: 'staging' }, files);
    }).not.toThrow();
    expect(() => {
      assertLegalReady({}, files);
    }).not.toThrow();
    const reviewed = { 'en/x.md': '---\nversion: v1\nstatus: reviewed\n---\n- One\n' };
    expect(() => {
      assertLegalReady({ MC_BUILD_ENV: 'production' }, reviewed);
    }).not.toThrow();
  });
});
