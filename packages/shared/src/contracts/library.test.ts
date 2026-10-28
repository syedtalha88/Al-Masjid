import { describe, expect, it } from 'vitest';

import {
  LIBRARY_IMPORT_FORMAT,
  LIBRARY_IMPORT_MAX_ENTRIES,
  libraryImportFileSchema,
  libraryImportRowSchema,
  libraryVerifySchema,
  superLibraryPatchSchema,
} from './library.ts';

// PHASE_03 T3.4: the Content Library import format. Religious text: the 10 §5 placeholders only.
const ROW = {
  kind: 'hadith',
  arabic: 'نص تجريبي للعرض فقط',
  transliteration: { en: 'Sample transliteration — DEV ONLY' },
  translation: {
    en: 'Sample translation text for development. Not a real hadith.',
    hi: 'विकास के लिए नमूना अनुवाद। यह वास्तविक हदीस नहीं है।',
    ur: 'ترقی کے لیے نمونہ ترجمہ۔ یہ اصل حدیث نہیں ہے۔',
    te: 'అభివృద్ధి కోసం నమూనా అనువాదం. ఇది నిజమైన హదీస్ కాదు.',
  },
  reference: 'DEV-SAMPLE-001',
  source_name: 'Development fixture',
  source_license: 'N/A — not for production',
  tags: ['patience'],
} as const;

const issuePaths = (value: unknown) => {
  const result = libraryImportRowSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('libraryImportRowSchema', () => {
  it('accepts a complete row', () => {
    expect(libraryImportRowSchema.parse(ROW)).toMatchObject({ kind: 'hadith', reference: 'DEV-SAMPLE-001' });
  });

  it('rejects rows missing source, license, reference or the English translation (acceptance)', () => {
    for (const field of ['source_name', 'source_license', 'reference', 'kind', 'arabic'] as const) {
      const { [field]: _removed, ...rest } = ROW;
      expect(issuePaths(rest)).toContain(field);
    }
    expect(issuePaths({ ...ROW, translation: { hi: ROW.translation.hi } })).toContain('translation.en');
    expect(issuePaths({ ...ROW, source_license: '   ' })).toContain('source_license');
  });

  it('refuses unknown keys anywhere (a typo must not vanish)', () => {
    expect(issuePaths({ ...ROW, sourceName: 'x' })).toEqual(['']);
    expect(issuePaths({ ...ROW, translation: { ...ROW.translation, fr: 'x' } })).toEqual(['translation']);
  });

  it('kind-specific fields: dua_category on duas only, repeat/occasions on dhikr only', () => {
    expect(issuePaths({ ...ROW, kind: 'dua', dua_category: 'illness' })).toEqual([]);
    expect(issuePaths({ ...ROW, dua_category: 'illness' })).toEqual(['dua_category']);
    expect(issuePaths({ ...ROW, kind: 'dhikr', repeat: 33, occasions: ['after_salah'] })).toEqual([]);
    expect(issuePaths({ ...ROW, repeat: 33, occasions: ['morning'] })).toEqual(['repeat', 'occasions']);
    expect(issuePaths({ ...ROW, kind: 'dhikr', repeat: 0 })).toEqual(['repeat']);
    expect(issuePaths({ ...ROW, kind: 'dhikr', occasions: ['morning', 'morning'] })).toEqual(['occasions']);
  });

  it('tags are unique lower-case slugs, at most 20', () => {
    expect(issuePaths({ ...ROW, tags: ['Patience'] })).toEqual(['tags.0']);
    expect(issuePaths({ ...ROW, tags: ['a', 'a'] })).toEqual(['tags']);
    expect(issuePaths({ ...ROW, tags: Array.from({ length: 21 }, (_, i) => `t${String(i)}`) })).toEqual(['tags']);
  });

  it('Arabic may carry the end-of-ayah sign; bidi overrides are refused everywhere', () => {
    expect(issuePaths({ ...ROW, arabic: `${ROW.arabic} ${String.fromCodePoint(0x06dd)}١` })).toEqual([]);
    expect(issuePaths({ ...ROW, arabic: `${ROW.arabic}${String.fromCodePoint(0x202e)}` })).toEqual(['arabic']);
    expect(issuePaths({ ...ROW, reference: `DEV${String.fromCodePoint(0x06dd)}` })).toEqual(['reference']);
  });
});

describe('libraryImportFileSchema', () => {
  const file = (entries: unknown[]) => ({ format: LIBRARY_IMPORT_FORMAT, version: 1, entries });

  it('needs the format marker, version 1 and 1…500 entries — rows are checked later, one by one', () => {
    expect(libraryImportFileSchema.safeParse(file([{ anything: true }])).success).toBe(true);
    expect(libraryImportFileSchema.safeParse({ ...file([ROW]), format: 'other' }).success).toBe(false);
    expect(libraryImportFileSchema.safeParse({ ...file([ROW]), version: 2 }).success).toBe(false);
    expect(libraryImportFileSchema.safeParse(file([])).success).toBe(false);
    expect(
      libraryImportFileSchema.safeParse(file(Array.from({ length: LIBRARY_IMPORT_MAX_ENTRIES + 1 }, () => ROW)))
        .success,
    ).toBe(false);
  });
});

describe('Super Admin edits', () => {
  it('a patch needs at least one field; kind-independent nulls clear optional fields', () => {
    expect(superLibraryPatchSchema.safeParse({}).success).toBe(false);
    expect(superLibraryPatchSchema.parse({ tags: ['patience'], dua_category: null })).toEqual({
      tags: ['patience'],
      dua_category: null,
    });
    expect(superLibraryPatchSchema.safeParse({ kind: 'ayah' }).success).toBe(false); // kind never changes
  });

  it('verification records who verified (at least 2 readable characters)', () => {
    expect(libraryVerifySchema.parse({ verifiedBy: '  Test Reviewer ' })).toEqual({ verifiedBy: 'Test Reviewer' });
    expect(libraryVerifySchema.safeParse({ verifiedBy: 'x' }).success).toBe(false);
  });
});
