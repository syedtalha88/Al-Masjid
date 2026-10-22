import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { superAdminCreateSchema } from './super.ts';
import { hasUnsafeCharacters, safeText } from './text.ts';

// 04 §6 free text (security review M3). Test names only — no real people or religious text (10 §Fixtures).

describe('safeText (04 §6)', () => {
  const name = safeText(60, { min: 1 });

  it('normalizes to NFC and trims', () => {
    expect(name.parse('  Cafe\u0301 Test  ')).toBe('Café Test');
    expect(name.parse('\uFEFFTest')).toBe('Test'); // a leading BOM is trimmed away
  });

  it('refuses control characters, bidi overrides / isolates, zero-width space and BOM', () => {
    for (const bad of [
      'Test\u0000Name',
      'Test\tName',
      'Test\u007fName',
      'Test\u0085Name',
      'Test \u202EemaN',
      'Test \u2066Name\u2069',
      'Test\u200BName',
      'Te\uFEFFst',
      'Line one\nLine two',
    ]) {
      expect(name.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses every other invisible character by category: separators, word joiner, tags, private use, surrogates (review L-3)', () => {
    for (const bad of [
      'Test\u2028Name',
      'Test\u2029Name',
      'Test\u2060Name',
      'Test\u00ADName',
      'Test\u{E0001}\u{E0041}Name',
      'Test\uE000Name',
      'Test\uD800Name',
      'Test\u{F0000}Name',
    ]) {
      expect(name.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      expect(hasUnsafeCharacters(bad, true), JSON.stringify(bad)).toBe(true);
    }
  });

  it('refuses blank-looking letters, variation selectors and unassigned code points; needs a letter or digit (review L2)', () => {
    for (const bad of [
      '\u3164',
      'Test\u115FName',
      'Test\uFFA0Name',
      'Test\u034FName',
      'Test\u2800Name',
      'Test\u180BName',
      'Test\uFE00Name',
      'Test\u{E0100}Name',
      'Test\uFFFEName',
      'Test\u{50000}Name',
      '...',
      '- -',
    ]) {
      expect(name.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(name.parse('Phone 2 \u2764\uFE0F')).toBe('Phone 2 \u2764\uFE0F'); // emoji presentation stays allowed
    expect(safeText(20).parse('...')).toBe('...'); // optional fields may be punctuation
  });

  it('keeps the Arabic letter mark ALM (U+061C) for Urdu (review L-3)', () => {
    expect(name.parse('ٹیسٹ\u061Cنام')).toBe('ٹیسٹ\u061Cنام');
  });

  it('refuses raw input over 4 × max before normalizing it; OpenAPI shows the real limits (review L-4)', () => {
    const normalize = vi.spyOn(String.prototype, 'normalize');
    const tooLong = name.safeParse(`${' '.repeat(240)}x`);
    expect(tooLong.success).toBe(false);
    expect(normalize).not.toHaveBeenCalled(); // refused before NFC ever runs
    expect(tooLong.error?.issues.map((issue) => issue.code)).toEqual(['too_big']);
    normalize.mockRestore();
    expect(name.parse(`${' '.repeat(200)}x`)).toBe('x');
    expect(name.meta()).toMatchObject({ minLength: 1, maxLength: 60 });
  });

  it('keeps what Indian scripts need: ZWJ / ZWNJ and the LRM / RLM marks', () => {
    for (const ok of [
      'ट\u0947स\u094Dट\u200Dनाम',
      'ట\u0C46స\u0C4Dట\u0C4D\u200Cప\u0C47రు',
      'ٹیسٹ\u200Fنام',
      'Test\u200EName',
    ]) {
      expect(name.parse(ok)).toBe(ok.normalize('NFC'));
    }
  });

  it('multiline fields keep newlines: CRLF → LF, at most one blank line', () => {
    const body = safeText(500, { multiline: true });
    expect(body.parse('First\r\nSecond\n\n\n\nThird')).toBe('First\nSecond\n\nThird');
    expect(body.safeParse('First\u202ESecond').success).toBe(false);
  });

  it('length limits apply after normalization and trimming', () => {
    expect(name.safeParse('   ').success).toBe(false);
    expect(name.safeParse('x'.repeat(61)).success).toBe(false);
    expect(name.parse(`${'x'.repeat(60)}   `)).toHaveLength(60);
  });

  it('property: whatever it accepts is NFC, trimmed and free of unsafe characters', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 80 }), fc.boolean(), (input, multiline) => {
        const result = safeText(80, { multiline }).safeParse(input);
        if (!result.success) return;
        expect(result.data).toBe(result.data.normalize('NFC'));
        expect(result.data).toBe(result.data.trim());
        expect(hasUnsafeCharacters(result.data, multiline)).toBe(false);
      }),
    );
  });

  it('is what the contracts use (Super Admin creating an admin)', () => {
    const create = (displayName: string) =>
      superAdminCreateSchema.safeParse({ displayName, uiLocale: 'en', masjidId: crypto.randomUUID(), role: 'owner' });
    expect(create('Test Imam').success).toBe(true);
    expect(create('Test \u202EImam').success).toBe(false);
  });
});
