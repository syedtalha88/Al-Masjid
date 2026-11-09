// Web push sending (01 §5.3, DECISIONS #9, 04 R7): one adapter over `web-push` — it encrypts the payload (RFC 8291
// aes128gcm) and signs the VAPID JWT (RFC 8292); we POST it ourselves so every request goes only to an allow-listed
// push service host, never follows a redirect, times out, and its answer is classified in one place. Only the worker
// constructs a sender: it is the only process with the VAPID private key.
import { isAllowedPushEndpoint } from '@mc/shared/contracts/push';
import webpush from 'web-push';

/** A stored subscription (02 devices `push_endpoint`, `push_p256dh`, `push_auth`; admin_push_subscriptions). */
export interface PushTarget {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export type PushUrgency = 'normal' | 'high';

/** Delivery hints (RFC 8030 §5.2–5.4). */
export interface PushOptions {
  /** Seconds the push service keeps an undelivered message. */
  readonly ttlS: number;
  readonly urgency: PushUrgency;
  // No `topic`: the `Topic` header reaches FCM / APNs unencrypted, and an item id would reveal which masjid a phone
  // follows (DECISIONS #142 M3). The service worker's notification `tag` collapses on the phone instead.
}

/** What one send came to. */
export type PushOutcome =
  | { readonly kind: 'sent' }
  /** 404 / 410: the subscription is gone — mark it dead (01 §5.3 step 3). */
  | { readonly kind: 'gone'; readonly status: number }
  /** 429 / 5xx / network: try again later (BullMQ backoff); `retryAfterS` from the push service when it said. */
  | { readonly kind: 'retry'; readonly status?: number; readonly retryAfterS?: number }
  /** Any other answer (400, 401/403 VAPID mismatch, 413 payload too large, 3xx): not retried, not pruned — logged. */
  | { readonly kind: 'rejected'; readonly status: number };

/** One HTTP request to a push service. `plaintext` is for test doubles only — real transports never read it. */
export interface PushRequest {
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly plaintext: string;
}

export interface PushResponse {
  readonly status: number;
  readonly retryAfter?: string | null;
}

/** Sends one request; throws on network errors and timeouts (classified as `retry`). */
export type PushTransport = (request: PushRequest) => Promise<PushResponse>;

export interface VapidKeys {
  readonly subject: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

/** A push service's own deadline for one request. */
export const PUSH_REQUEST_TIMEOUT_MS = 10_000;
/** The longest `Retry-After` we honour (a larger one is capped — BullMQ backoff takes over). */
const RETRY_AFTER_MAX_S = 3600;

/**
 * Classifies a push service's answer (01 §5.3 step 3).
 *
 * @param retryAfter - the `Retry-After` header: delay seconds or an HTTP date.
 * @param now - for an HTTP-date `Retry-After`.
 */
export function classifyPushResponse(status: number, retryAfter?: string | null, now = new Date()): PushOutcome {
  if (status >= 200 && status <= 202) return { kind: 'sent' };
  if (status === 404 || status === 410) return { kind: 'gone', status };
  if (status === 429 || (status >= 500 && status <= 599)) {
    const seconds = parseRetryAfter(retryAfter, now);
    return seconds === undefined ? { kind: 'retry', status } : { kind: 'retry', status, retryAfterS: seconds };
  }
  return { kind: 'rejected', status };
}

function parseRetryAfter(value: string | null | undefined, now: Date): number | undefined {
  if (value === undefined || value === null || value.trim() === '') return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed), RETRY_AFTER_MAX_S);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.min(Math.max(0, Math.ceil((at - now.getTime()) / 1000)), RETRY_AFTER_MAX_S);
}

/**
 * The encrypted body and headers of one push (`TTL`, `Urgency`, `Content-Encoding: aes128gcm`, VAPID
 * `Authorization`; never `Topic` — #142). Pure apart from the random key material of the encryption.
 *
 * @throws Error for a subscription whose keys do not decode.
 */
export function buildPushRequest(
  target: PushTarget,
  payload: string,
  options: PushOptions,
  vapid: VapidKeys,
): PushRequest {
  const details = webpush.generateRequestDetails(
    { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
    payload,
    {
      vapidDetails: vapid,
      TTL: options.ttlS,
      urgency: options.urgency,
      contentEncoding: 'aes128gcm',
    },
  );
  const headers: Record<string, string> = {};
  // web-push types its headers as strings, but sets `TTL` and `Content-Length` as numbers at runtime.
  const raw: Readonly<Record<string, string | number>> = details.headers;
  for (const [name, value] of Object.entries(raw)) headers[name] = String(value);
  return { endpoint: target.endpoint, headers, body: new Uint8Array(details.body), plaintext: payload };
}

/** The production transport: `fetch` with no redirects followed and a deadline. */
export const fetchPushTransport: PushTransport = async (request) => {
  const response = await fetch(request.endpoint, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(PUSH_REQUEST_TIMEOUT_MS),
  });
  await response.body?.cancel(); // the body is not used; free the connection
  return { status: response.status, retryAfter: response.headers.get('retry-after') };
};

export interface PushSender {
  /** Sends `payload` (JSON text) to `target`; never throws — every failure is an outcome. */
  send(target: PushTarget, payload: string, options: PushOptions): Promise<PushOutcome>;
}

/**
 * The worker's sender. The endpoint is re-checked against the allow-list before every request (the stored value was
 * checked on subscribe; this keeps a bad row from ever reaching the network).
 */
export function createPushSender(config: {
  readonly vapid: VapidKeys;
  readonly transport?: PushTransport;
}): PushSender {
  const transport = config.transport ?? fetchPushTransport;
  return {
    async send(target, payload, options) {
      if (!isAllowedPushEndpoint(target.endpoint)) return { kind: 'rejected', status: 0 };
      let request: PushRequest;
      try {
        request = buildPushRequest(target, payload, options, config.vapid);
      } catch {
        return { kind: 'rejected', status: 0 }; // undecodable keys: never sendable
      }
      try {
        const response = await transport(request);
        return classifyPushResponse(response.status, response.retryAfter);
      } catch {
        return { kind: 'retry' };
      }
    },
  };
}
