// Cloudinary's monthly usage for the Stats screen and the 70 / 90 % alerts (PHASE_08 T8.10): Admin API
// `GET https://api.cloudinary.com/v1_1/<cloud>/usage`, Basic auth with the API key and secret (checked against
// Cloudinary's Admin API docs, 13 Nov 2026 — rate limit 500+ calls an hour; we call once an hour). The documented sample
// answer has no `credits` object although credit-based plans report one, so it is optional: without it, the highest
// `used_percent` of storage, bandwidth and transformations stands in.
import type { CloudinaryStats } from '@mc/db/state';
import { z } from 'zod';

const CLOUDINARY_API = 'https://api.cloudinary.com/v1_1';
const TIMEOUT_MS = 20_000;

const percentOf = z.object({ used_percent: z.number().min(0).optional() }).optional();
const usageSchema = z.object({
  plan: z.string().max(80).optional(),
  credits: z.object({ usage: z.number().min(0), limit: z.number().min(0), used_percent: z.number().min(0) }).optional(),
  storage: percentOf,
  bandwidth: percentOf,
  transformations: percentOf,
});

/** Turns the Admin API answer into the snapshot's numbers. @throws ZodError when the answer is not usage. */
export function parseCloudinaryUsage(body: unknown): CloudinaryStats {
  const usage = usageSchema.parse(body);
  const fallback = Math.max(
    0,
    usage.storage?.used_percent ?? 0,
    usage.bandwidth?.used_percent ?? 0,
    usage.transformations?.used_percent ?? 0,
  );
  const usedPercent = Math.round((usage.credits?.used_percent ?? fallback) * 100) / 100;
  return {
    usedPercent,
    ...(usage.credits ? { credits: { usage: usage.credits.usage, limit: usage.credits.limit } } : {}),
    ...(usage.plan ? { plan: usage.plan } : {}),
  };
}

export interface CloudinaryUsageConfig {
  readonly cloudName: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  /** Injectable for tests. */
  readonly fetch?: typeof fetch;
}

/**
 * A reader of the account's usage (worker only — it holds the API secret). Only the fixed API host is called (04 §6).
 *
 * @throws Error on a non-2xx answer (status only — never the body) or an unexpected answer.
 */
export function cloudinaryUsageReader(config: CloudinaryUsageConfig): () => Promise<CloudinaryStats> {
  const call = config.fetch ?? fetch;
  const auth = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
  return async () => {
    const response = await call(`${CLOUDINARY_API}/${encodeURIComponent(config.cloudName)}/usage`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`cloudinary usage failed with HTTP ${String(response.status)}`);
    return parseCloudinaryUsage(await response.json());
  };
}
