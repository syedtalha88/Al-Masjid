import { describe, expect, it } from 'vitest';

import { formatPhone, isE164, whatsappChatUrl } from '../src/phone.ts';

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

describe('whatsappChatUrl', () => {
  it('drops the + and URL-encodes the greeting (any script)', () => {
    expect(whatsappChatUrl('+910000000001')).toBe('https://wa.me/910000000001');
    expect(whatsappChatUrl('+910000000001', 'Hello there & welcome?')).toBe(
      'https://wa.me/910000000001?text=Hello%20there%20%26%20welcome%3F',
    );
    const url = whatsappChatUrl('+910000000001', 'نمونہ');
    expect(url).toBe('https://wa.me/910000000001?text=%D9%86%D9%85%D9%88%D9%86%DB%81');
    expect(new URL(url ?? '').searchParams.get('text')).toBe('نمونہ');
  });

  it('gives no link for a number that is not E.164', () => {
    for (const value of ['910000000001', '+91 00000 00001', 'javascript:alert(1)', '']) {
      expect(whatsappChatUrl(value, 'Hello')).toBeNull();
    }
  });
});

describe('formatPhone', () => {
  it('groups an Indian mobile number; leaves any other number as stored', () => {
    expect(formatPhone('+919876500001')).toBe('+91 98765 00001');
    expect(formatPhone('+442000000000')).toBe('+442000000000');
    expect(formatPhone('+9112345')).toBe('+9112345');
  });
});
