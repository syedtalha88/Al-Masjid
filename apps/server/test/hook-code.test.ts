import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { containsHookCode, HOOK_PATHS } from '../scripts/hook-code.mjs';

// DECISIONS #31 / security review M-A: the build and image checks must recognise hook code however the bundler quotes
// it — a single-quote-only search never matched the real (double-quoted) build output.
describe('containsHookCode', () => {
  it('finds every hook path in any quote style, and the marker', () => {
    for (const path of HOOK_PATHS) {
      for (const quote of ['"', "'", '`']) expect(containsHookCode(`path: ${quote}${path}${quote},`), path).toBe(true);
    }
    expect(containsHookCode('const m = "mc-test-hooks-module";')).toBe(true);
  });

  it('ignores ordinary code (a path prefix or a longer path is not a hook)', () => {
    expect(containsHookCode('fetch("/api/v1/health"); // see /test/ docs')).toBe(false);
    expect(containsHookCode('path: "/test/clockwork"')).toBe(false);
  });

  it('recognises the real built hook module', () => {
    const built = new URL('../dist-test/test-hooks.mjs', import.meta.url);
    if (!existsSync(built)) return; // not built in this run (CI builds before the image checks)
    expect(containsHookCode(readFileSync(built, 'utf8'))).toBe(true);
  });
});
