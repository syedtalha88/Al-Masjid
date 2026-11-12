// Web push contracts (01 §5.3, 03 §3 `PUT /devices/me/push`, 04 §6 / §11) — shared by the API (subscription checks),
// the worker (the payload it builds) and both service workers (the payload they show). zod/mini like `public.ts`: the
// musalli service worker parses every push with `pushPayloadSchema`.
import * as z from 'zod/mini';

import { LOCALE_VALUES, publicIdText, uuidText } from './public.ts';

/**
 * Push services a subscription may point at (04 §6): exact hosts, or a parent domain whose sub-hosts are allowed
 * (`web.push.apple.com`, `wns2-par02p.notify.windows.com`). Anything else would make the worker POST to a host the
 * subscriber chose (SSRF).
 */
export const PUSH_SERVICE_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'] as const;
export const PUSH_SERVICE_DOMAINS = ['push.apple.com', 'notify.windows.com'] as const;
/** 02 devices `push_endpoint` ≤ 1000. */
export const PUSH_ENDPOINT_MAX = 1000;

/**
 * Whether `endpoint` is an https URL on an allow-listed push service: no credentials, the default port, a host that is
 * one of {@link PUSH_SERVICE_HOSTS} or a sub-host of one of {@link PUSH_SERVICE_DOMAINS} (a suffix match on whole labels:
 * `push.apple.com.evil.example` and `evilpush.apple.com` fail).
 *
 * @returns `false` for anything that does not parse.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > PUSH_ENDPOINT_MAX) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return false;
  const host = url.hostname.toLowerCase();
  if ((PUSH_SERVICE_HOSTS as readonly string[]).includes(host)) return true;
  return PUSH_SERVICE_DOMAINS.some((domain) => host.endsWith(`.${domain}`));
}

/** `PushSubscription.toJSON().keys`: base64url (padding tolerated) — p256dh is a 65-byte P-256 point, auth 16 bytes. */
const p256dh = z.string().check(z.regex(/^[A-Za-z0-9_-]{86,87}={0,2}$/, { error: 'must be a base64url P-256 key' }));
const auth = z.string().check(z.regex(/^[A-Za-z0-9_-]{21,22}={0,2}$/, { error: 'must be a base64url 16-byte secret' }));

/** `PUT /devices/me/push` and `PUT /auth/push`: the browser's subscription (`PushSubscription.toJSON()` fields). */
export const pushSubscriptionSchema = z.strictObject({
  endpoint: z.string().check(z.refine(isAllowedPushEndpoint, { error: 'must be an allowed push service URL' })),
  keys: z.strictObject({ p256dh, auth }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/** 01 §5.3: a payload stays ≤ 3 KB (encrypted it grows by ~100 bytes; push services accept ~4 KB). */
export const PUSH_PAYLOAD_MAX_BYTES = 3072;
/** The visible title / body are cut to these lengths (grapheme-safe cut in the worker). */
export const PUSH_TITLE_MAX = 120;
export const PUSH_BODY_MAX = 400;

/**
 * A musalli notification (01 §5.3): `t` title, `b` body, `u` the same-origin path it opens, `m` masjid id, `cv` the
 * masjid's content version at publish (the app refreshes that masjid), `tag` the item's public id (an edit replaces,
 * never stacks), `l` the text's locale (`lang` / `dir` of the notification — DECISIONS #138).
 */
export const pushPayloadSchema = z.object({
  v: z.literal(1),
  t: z.string().check(z.minLength(1), z.maxLength(PUSH_TITLE_MAX)),
  b: z.string().check(z.maxLength(PUSH_BODY_MAX)),
  u: z.string().check(z.regex(/^\/items\/[A-Za-z0-9_-]{12}$/, { error: 'must be an item path' })),
  m: uuidText,
  cv: z.int().check(z.minimum(1)),
  tag: publicIdText,
  l: z.enum(LOCALE_VALUES),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

/** Admin alert types (T4.6; payment, moderation and SLA alerts join in Phases 5 and 8). */
export const ADMIN_ALERT_TYPES = [
  'credential_counter_regression',
  'super_passkey_added',
  'push_job_stuck',
  'test',
  // The UPI change-lock (04 R1, T5.2): Super Admin on every request; every owner of the masjid on the request and each
  // decision (DECISIONS #161 — F69).
  'payment_request',
  'payment_request_owner',
  'payment_approved',
  'payment_rejected',
  'payment_active',
] as const;

/**
 * An admin / Super Admin alert (03 §4 `PUT /auth/push`, 01 §5.8 `alert-send`): `t` / `b` the words, `u` the admin app
 * path it opens (same origin, no scheme or host), `tag` one per alert (a repeat replaces, never stacks), `l` the admin's
 * app language.
 */
export const adminAlertPayloadSchema = z.object({
  v: z.literal(1),
  kind: z.literal('alert'),
  type: z.enum(ADMIN_ALERT_TYPES),
  t: z.string().check(z.minLength(1), z.maxLength(PUSH_TITLE_MAX)),
  b: z.string().check(z.maxLength(PUSH_BODY_MAX)),
  u: z.string().check(z.regex(/^\/(?!\/)[A-Za-z0-9/_-]{0,120}$/, { error: 'must be an admin app path' })),
  tag: z.string().check(z.regex(/^[A-Za-z0-9_.-]{1,120}$/)),
  l: z.enum(LOCALE_VALUES),
});
export type AdminAlertPayload = z.infer<typeof adminAlertPayloadSchema>;
