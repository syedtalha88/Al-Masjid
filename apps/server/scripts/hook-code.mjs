// Detects e2e test-hook code in a built bundle (10 §3, DECISIONS #31): the module marker, or any hook route path as a
// string literal in ANY quote style — bundlers write "…" (security review M-A: a single-quote search never matched).
export const HOOK_MARKER = 'mc-test-hooks-module';
export const HOOK_PATHS = ['/test/clock', '/test/super-admin-invite', '/test/rate-limits'];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** One pattern for the marker or a quoted hook path. Kept as source text so the image probe can embed it. */
export const HOOK_CODE_SOURCE = [escape(HOOK_MARKER), ...HOOK_PATHS.map((path) => `["'\`]${escape(path)}["'\`]`)].join(
  '|',
);

/** True when `code` contains test-hook code. */
export const containsHookCode = (code) => new RegExp(HOOK_CODE_SOURCE).test(code);
