// Error-report scrubbing for Sentry (DECISIONS #17; CLAUDE.md §2.1, §6 "never log"; PHASE_00 T0.13). Runs in
// `beforeSend` / `beforeBreadcrumb` of every SDK (browser + node), on top of `dataCollection` all off.
// Musallis have no accounts and must stay unidentifiable, so an event leaves the process with: no user, no
// cookies/headers/bodies/query strings, and every string scrubbed of emails, phone numbers, IPs, ids and tokens.

/** Replacement texts (stable, so issues still group). */
export const SCRUBBED = {
  email: '[email]',
  phone: '[phone]',
  ip: '[ip]',
  id: '[id]',
  token: '[token]',
  redacted: '[redacted]',
} as const;

/** Keys whose values are dropped wherever they appear (case-insensitive, `-`/`_` ignored). */
const SENSITIVE_KEY =
  /^(authorization|cookies?|setcookie|password|passwd|secret|token|accesstoken|refreshtoken|apikey|session|sessionid|xmccsrf|csrf|ipaddress|ip|email|phone|phonenumber|mobile|vpa|upiid|secrethash|pushsubscription|p256dh|auth|endpoint)$/;

const normaliseKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, '');

/** Sentry's own structural fields: ids and the release SHA look like tokens but must reach Sentry unchanged. */
const STRUCTURAL_KEY =
  /^(event_id|trace_id|span_id|parent_span_id|debug_id|release|dist|environment|platform|level|timestamp|start_timestamp|type|sdk|sid|did)$/;

/** Ordered: specific token formats before the generic ones. */
const STRING_RULES: readonly (readonly [RegExp, string])[] = [
  // Credentials and tokens
  [/\b(Bearer|Device|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${SCRUBBED.token}`],
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, SCRUBBED.token], // JWT
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@"'`]+:[^\s@"'`]+@/gi, `$1${SCRUBBED.token}@`], // user:pass@ in URLs
  // URLs keep scheme/host/path only (query strings and fragments carry ids, codes and tokens).
  [/(\bhttps?:\/\/[^\s?#"'`<>]+)[?#][^\s"'`<>]*/gi, '$1'],
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, SCRUBBED.email],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, SCRUBBED.id], // UUIDs (device/admin ids)
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, SCRUBBED.ip], // IPv4
  // IPv6: compressed (`::`) forms first, then full forms with ≥ 3 colons — so clock times (12:30:45) stay.
  [/(?<![\w:])::(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4}\b/gi, SCRUBBED.ip],
  [/\b(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4}\b/gi, SCRUBBED.ip],
  [/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, SCRUBBED.ip],
  // Phone-like: an optional +, then ≥ 10 digits possibly separated by spaces/dashes.
  [/(?<![\w.])\+?\d(?:[\s-]?\d){9,14}(?![\w.])/g, SCRUBBED.phone],
  // Long opaque secrets (base64url/hex ≥ 32 chars) — device secrets, invite tokens, VAPID keys.
  [/\b[A-Za-z0-9_-]{32,}\b/g, SCRUBBED.token],
];

/**
 * Removes personal data and secrets from one string.
 *
 * @returns the scrubbed string (unchanged when nothing matched).
 */
export function scrubString(value: string): string {
  let result = value;
  for (const [pattern, replacement] of STRING_RULES) result = result.replace(pattern, replacement);
  return result;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MAX_DEPTH = 12;

/** Request parts that never leave the process (identity, secrets, bodies). */
const DROPPED_REQUEST_KEYS = new Set(['cookies', 'headers', 'data', 'query_string', 'env']);

/** Deep copy with sensitive keys redacted and every string scrubbed. Cycles and very deep values are cut. */
function scrubValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object' || value === null) return value;
  if (depth > MAX_DEPTH || seen.has(value)) return SCRUBBED.redacted;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(normaliseKey(key))) out[key] = SCRUBBED.redacted;
    else if (STRUCTURAL_KEY.test(key) && typeof item !== 'object') out[key] = item;
    else out[key] = scrubValue(item, depth + 1, seen);
  }
  return out;
}

/**
 * Scrubs a Sentry event (or breadcrumb) before it is sent: removes `user`, request cookies/headers/body/query
 * and environment, keeps `request.url` without its query, redacts sensitive keys anywhere and scrubs every
 * string. Works on any object shape, so it needs no Sentry types.
 *
 * @returns a scrubbed copy; the input is not modified.
 */
export function scrubEvent<T extends object>(event: T): T {
  const copy = scrubValue(event, 0, new WeakSet()) as Record<string, unknown>; // same shape as T, values scrubbed
  delete copy['user'];
  const request = copy['request'];
  if (isRecord(request)) {
    copy['request'] = Object.fromEntries(Object.entries(request).filter(([key]) => !DROPPED_REQUEST_KEYS.has(key)));
  }
  return copy as T; // keys only removed, never added
}

/**
 * Sentry v11 `dataCollection` for every SDK (browser + node): collect nothing about people or requests.
 * v11 collects cookies, bodies, headers, query params and user info when this is unset (migration guide
 * v10→v11), so every field is explicit. Shaped like Sentry's `DataCollection` without importing its types.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [] as never[],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 5,
};
