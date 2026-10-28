import { describe, expect, it } from 'vitest';

import { isE164 } from '../src/phone.ts';

describe('isE164', () => {
  it('accepts + and 7–15 digits without a leading zero', () => {
    for (const value of ['+910000000000', '+1234567', '+123456789012345']) expect(isE164(value)).toBe(true);
  });

  it('refuses anything else', () => {
    for (const value of [
      '910000000000', // no +
      '+0910000000', // country code cannot start with 0
      '+123456', // too short
      '+1234567890123456', // too long
      '+91 00000 00000',
      '+91-0000000000',
      'tel:+910000000000',
      '+९१००००००००००', // non-ASCII digits
      ' +910000000000',
      '',
      910000000000,
      null,
      undefined,
    ])
      expect(isE164(value)).toBe(false);
  });
});
