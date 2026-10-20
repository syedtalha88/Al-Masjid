// Rate limits (03 §2, PHASE_01 T1.6): `rate-limiter-flexible` on Redis — keys under the process's own ACL prefix
// (`rl:pub:` for api-public, `rl:adm:` for api-admin; 04 §12.2) — with an in-memory limiter per process as insurance
// when Redis is unreachable (limits still hold, per process, and the API stays up). Unit tests use the memory
// implementation. Exceeding a bucket → 429 `RATE_LIMITED` with `Retry-After`.
import { createHash } from 'node:crypto';

import type { Request } from 'express';
import type { Redis } from 'ioredis';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';

import { clientIp, rateLimitIpKey, type TrustedProxyMode } from './client-ip.ts';
import { ApiProblem } from './problem.ts';

/** One bucket: `points` requests per `durationSec` seconds. */
export interface RateLimitBucket {
  readonly points: number;
  readonly durationSec: number;
}

const HOUR = 3600;
const DAY = 24 * HOUR;

/** 03 §2. "…/IP" buckets are coarse (CGNAT) secondary keys next to a device/session/credential bucket. */
export const RATE_LIMITS = {
  deviceRegister: { points: 5, durationSec: HOUR }, // per Turnstile-verified client
  deviceRegisterIp: { points: 300, durationSec: HOUR },
  codeResolve: { points: 30, durationSec: 60 }, // per device, or IP without one
  follow: { points: 60, durationSec: HOUR },
  ameen: { points: 120, durationSec: HOUR },
  reports: { points: 10, durationSec: DAY },
  grievancesIp: { points: 5, durationSec: DAY },
  adminLoginIp: { points: 30, durationSec: 600 }, // DECISIONS #81 (owner: onboarding several admins on one Wi-Fi)
  adminLoginCredential: { points: 20, durationSec: HOUR },
  adminWrites: { points: 120, durationSec: HOUR }, // per session
  adminUploads: { points: 30, durationSec: HOUR }, // per masjid
  superWrites: { points: 600, durationSec: HOUR }, // per session
} as const satisfies Readonly<Record<string, RateLimitBucket>>;

export type BucketName = keyof typeof RATE_LIMITS;

export type RateLimitDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSec: number };

/** Counts one request of `key` against `bucket`. */
export interface RateLimiter {
  consume(bucket: BucketName, key: string): Promise<RateLimitDecision>;
}

/** Redis key prefixes the ACL users may write (04 §12.2). */
export type RateLimitPrefix = 'rl:pub:' | 'rl:adm:';

/**
 * Keys are hashed before they reach the store: an IP or a session id never sits in Redis in clear text (03 §0 —
 * client IPs are never stored). 16 bytes of SHA-256 keep distinct clients distinct.
 */
const hashKey = (key: string): string => createHash('sha256').update(key).digest('base64url').slice(0, 22);

type Limiter = RateLimiterMemory | RateLimiterRedis;

async function decide(limiter: Limiter, key: string): Promise<RateLimitDecision> {
  try {
    await limiter.consume(hashKey(key));
    return { allowed: true };
  } catch (rejection) {
    // A limit rejection is a RateLimiterRes; anything else (a store error without insurance) is a real error.
    if (rejection instanceof RateLimiterRes) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(rejection.msBeforeNext / 1000)) };
    }
    throw rejection;
  }
}

function build(make: (name: BucketName, bucket: RateLimitBucket) => Limiter): RateLimiter {
  const limiters = new Map<BucketName, Limiter>();
  for (const [name, bucket] of Object.entries(RATE_LIMITS) as [BucketName, RateLimitBucket][]) {
    limiters.set(name, make(name, bucket)); // entries of the literal above
  }
  return {
    consume(bucket, key) {
      const limiter = limiters.get(bucket);
      if (!limiter) throw new Error(`unknown rate-limit bucket ${bucket}`);
      return decide(limiter, key);
    },
  };
}

/**
 * In-memory limiter (unit tests; also the per-process insurance behind the Redis limiter).
 *
 * @param buckets - override bucket sizes (tests); defaults to 03 §2.
 */
export function memoryRateLimiter(buckets: Partial<Record<BucketName, RateLimitBucket>> = {}): RateLimiter {
  return build((name, bucket) => new RateLimiterMemory({ keyPrefix: name, ...pointsOf(buckets[name] ?? bucket) }));
}

/**
 * Redis limiter for a process. Keys: `<prefix><bucket>:<hash>`; TTL = the bucket's window. The ioredis client should
 * be created with `enableOfflineQueue: false` so a Redis outage fails fast into the in-memory insurance limiter.
 *
 * @param prefix - the process's ACL key prefix (`rl:pub:` / `rl:adm:`).
 */
export function redisRateLimiter(
  redis: Redis,
  prefix: RateLimitPrefix,
  buckets: Partial<Record<BucketName, RateLimitBucket>> = {},
): RateLimiter {
  return build((name, bucket) => {
    const size = pointsOf(buckets[name] ?? bucket);
    return new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: `${prefix}${name}`,
      ...size,
      insuranceLimiter: new RateLimiterMemory({ keyPrefix: `insurance:${name}`, ...size }),
    });
  });
}

/**
 * Deletes every rate-limit counter under `prefix` — for the e2e test hooks only (several auth specs share one client
 * IP within a 10-minute window). Never wired outside test-hook mode.
 *
 * @returns how many counters were deleted.
 */
export async function clearRedisRateLimits(redis: Redis, prefix: RateLimitPrefix): Promise<number> {
  let deleted = 0;
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
    cursor = next;
    if (keys.length > 0) deleted += await redis.del(...keys);
  } while (cursor !== '0');
  return deleted;
}

const pointsOf = (bucket: RateLimitBucket) => ({ points: bucket.points, duration: bucket.durationSec });

/** How a route names the client a bucket counts. */
export type RateLimitKey = 'ip' | 'session' | ((req: Request) => string | undefined);

/** One rate-limit rule of a route (`defineRoute({ rateLimit: [...] })`). */
export interface RateLimitRule {
  readonly bucket: BucketName;
  readonly key: RateLimitKey;
}

const LIMITER = 'rateLimiter';
const PROXY_MODE = 'trustedProxyMode';

/** Stores the process's limiter and proxy mode on the app (read by {@link enforceRateLimits}). */
export function installRateLimiter(
  locals: Record<string, unknown>,
  limiter: RateLimiter | undefined,
  mode: TrustedProxyMode,
): void {
  if (limiter) locals[LIMITER] = limiter;
  locals[PROXY_MODE] = mode;
}

const isLimiter = (value: unknown): value is RateLimiter =>
  typeof value === 'object' && value !== null && typeof (value as { consume?: unknown }).consume === 'function';

/**
 * Applies a route's rules in order (middleware step 6, 03 §0). A rule whose key is unavailable (no device id yet) is
 * skipped — routes pair such rules with an IP rule. A route that declares limits on an app without a limiter fails
 * closed (500), so a wiring mistake can never disable rate limiting silently.
 *
 * @throws ApiProblem 429 `RATE_LIMITED` (with `Retry-After`) when a bucket is exhausted.
 */
export async function enforceRateLimits(
  req: Request,
  rules: readonly RateLimitRule[],
  sessionKey?: string,
): Promise<void> {
  if (rules.length === 0) return;
  const limiter: unknown = req.app.locals[LIMITER];
  if (!isLimiter(limiter)) throw new Error('route declares rate limits but the app has no rate limiter');
  const mode = req.app.locals[PROXY_MODE] === 'cloudflare' ? 'cloudflare' : 'none';
  for (const rule of rules) {
    const ip = rule.key === 'ip' ? clientIp(req, mode) : null;
    const key = rule.key === 'ip' ? ip && rateLimitIpKey(ip) : rule.key === 'session' ? sessionKey : rule.key(req);
    if (key === undefined || key === null) continue;
    const decision = await limiter.consume(rule.bucket, key);
    if (!decision.allowed) {
      throw new ApiProblem(429, 'RATE_LIMITED', undefined, undefined, {
        'Retry-After': String(decision.retryAfterSec),
      });
    }
  }
}

/**
 * Counts one event against `bucket` from inside a handler — for limits that may only count some outcomes (e.g.
 * failed passkey assertions per credential, security review L3). Apps without a limiter (unit tests) allow everything.
 *
 * @returns whether the event was within the limit.
 */
export async function consumeInHandler(req: Request, bucket: BucketName, key: string): Promise<boolean> {
  const limiter: unknown = req.app.locals[LIMITER];
  if (!isLimiter(limiter)) return true;
  return (await limiter.consume(bucket, key)).allowed;
}
