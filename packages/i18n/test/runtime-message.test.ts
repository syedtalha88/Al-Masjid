import { describe, expect, it } from 'vitest';

import { formatRuntimeMessage } from '../src/runtime-message.ts';

describe('formatRuntimeMessage (notice templates arriving from the API)', () => {
  it('fills named arguments', () => {
    expect(
      formatRuntimeMessage('From {hours_start} to {hours_end}.', 'en', { hours_start: '10 AM', hours_end: '2 PM' }),
    ).toBe('From 10 AM to 2 PM.');
  });

  it('applies the locale’s plural rules', () => {
    const message = '{n, plural, one {# day} other {# days}}';
    expect(formatRuntimeMessage(message, 'en', { n: 1 })).toBe('1 day');
    expect(formatRuntimeMessage(message, 'en', { n: 5 })).toBe('5 days');
    expect(formatRuntimeMessage('{n, plural, one {# दिन} other {# दिन}}', 'hi', { n: 2 })).toBe('2 दिन');
  });

  it('treats tags as text and never returns markup', () => {
    expect(formatRuntimeMessage('<b>{x}</b>', 'en', { x: 'y' })).toBe('<b>y</b>');
  });

  it('returns null for malformed messages or missing arguments (the caller falls back)', () => {
    expect(formatRuntimeMessage('{unclosed', 'en', {})).toBeNull();
    expect(formatRuntimeMessage('Hello {name}', 'en', {})).toBeNull();
  });

  it('caches per locale and message', () => {
    expect(formatRuntimeMessage('{a}', 'ur', { a: '1' })).toBe('1');
    expect(formatRuntimeMessage('{a}', 'ur', { a: '2' })).toBe('2');
  });
});
