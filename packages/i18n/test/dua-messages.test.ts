import { describe, expect, it } from 'vitest';

import { DUA_CATEGORIES, duaMessage, duaMessages } from '../src/dua-messages.ts';
import { LOCALES } from '../src/locales.ts';

// 07 B7 (PHASE_03 T3.8): the ready-made dua request messages — every category has some, in every language, with the
// same keys, short enough for the 500-character message, and plain text (no ICU arguments to fill in).
describe('dua messages', () => {
  it('each category has messages in all four languages with the same keys', () => {
    for (const category of DUA_CATEGORIES) {
      const keys = duaMessages(category, 'en').map((message) => message.key);
      expect(keys.length).toBeGreaterThan(0);
      for (const locale of LOCALES) {
        const messages = duaMessages(category, locale);
        expect(messages.map((message) => message.key)).toEqual(keys);
        for (const { text } of messages) {
          expect(text.trim()).not.toBe('');
          expect(text.length).toBeLessThanOrEqual(500);
          expect(text).not.toMatch(/[{}]/);
        }
      }
    }
  });

  it('looks one message up by key; an unknown key is undefined', () => {
    const [first] = duaMessages('illness', 'ur');
    expect(first).toBeDefined();
    expect(duaMessage('illness', first?.key ?? '', 'ur')).toBe(first?.text);
    expect(duaMessage('illness', 'no_such_key', 'en')).toBeUndefined();
  });
});
