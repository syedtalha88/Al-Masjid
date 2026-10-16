import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PROBLEM_CODES } from './contracts/problem.ts';
import { API_ERROR_CODES, API_ERRORS, statusOf } from './errors.ts';

// Client-only codes (no server response behind them).
const CLIENT_ONLY = ['NETWORK'];

describe('API error codes (PHASE_01 T1.6)', () => {
  it('every code has a message in errors.json, and errors.json has no stale codes', () => {
    // i18n:check keeps the four locales identical, so English stands for all of them.
    const messages = JSON.parse(
      readFileSync(new URL('../../i18n/locales/en/errors.json', import.meta.url), 'utf8'),
    ) as Record<string, string>; // locale file: a flat key → message object
    expect(Object.keys(messages).sort()).toEqual([...API_ERROR_CODES, ...CLIENT_ONLY].sort());
  });

  it('codes are SCREAMING_SNAKE with a 4xx/5xx status, and the problem contract uses the same list', () => {
    for (const code of API_ERROR_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(statusOf(code)).toBeGreaterThanOrEqual(400);
      expect(statusOf(code)).toBeLessThan(600);
    }
    expect(PROBLEM_CODES).toEqual(Object.keys(API_ERRORS));
    expect(statusOf('RATE_LIMITED')).toBe(429);
  });
});
