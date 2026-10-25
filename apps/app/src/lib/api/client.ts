// The musalli app's API client (03 §7): one typed function per api-public endpoint, built on `requestJson` (every
// body validated with the shared contracts). Device auth header injection, 10 s timeout, GET retried twice with jitter
// (never on 4xx), the server clock offset from each fresh response's `Date` header (00 §7 drift correction), and
// whether the server answered at all (the offline banner, 01 §5.6).
import { serverClockOffset } from '@mc/domain/time';
import {
  type AmeenCounts,
  ameenCountsSchema,
  ameenResponseSchema,
  type DeviceRecord,
  deviceRecordSchema,
  type FeedPage,
  feedPageSchema,
  type FollowList,
  followListSchema,
  followResponseSchema,
  type ItemDetail,
  itemDetailSchema,
  type ItemType,
  type LibraryEntry,
  libraryEntryResponseSchema,
  type MasjidBundle,
  masjidBundleSchema,
  type MasjidSummary,
  type MasjidVersions,
  masjidVersionsSchema,
  type PublicConfig,
  publicConfigSchema,
  type RegisterDeviceRequest,
  type RegisterDeviceResponse,
  registerDeviceResponseSchema,
  resolveMasjidResponseSchema,
  type TemplateList,
  templateListSchema,
  type UpdateDeviceRequest,
} from '@mc/shared/contracts/public';
import { NetworkError, ProblemError, requestJson, ResponseError } from '@mc/shared/http';
import * as z from 'zod/mini';

import { SW_SOURCE_HEADER } from '../sw-protocol.ts';

/** 03 §7: client timeout (uploads excluded — none in this app). */
export const API_TIMEOUT_MS = 10_000;
const GET_RETRIES = 2;

export interface DeviceCredentials {
  readonly deviceId: string;
  readonly secret: string;
}

export interface ApiClientOptions {
  /** e.g. `/api/v1` (same origin) — `VITE_PUBLIC_API_BASE`. */
  readonly base: string;
  /** Current device credentials, if registered. */
  readonly credentials: () => DeviceCredentials | undefined;
  /** A device request answered 401 `DEVICE_AUTH_REQUIRED`: the device must register again. */
  readonly onAuthLost?: () => void;
  /** Server-clock offset (ms; `null` when unusable) of each response whose `Date` is from now ({@link freshDate}). */
  readonly onServerTime?: (offsetMs: number | null) => void;
  /**
   * `true` when the server answered (any status), `false` when a request got no answer (network failure, timeout, or
   * the service worker fell back to its cache). Answers from the worker's cache of immutable responses say neither.
   */
  readonly onReachability?: (reachable: boolean) => void;
  readonly fetch?: typeof fetch;
  /** Backoff before retry `attempt` (1-based); default 300–600 ms × attempt with jitter. */
  readonly backoff?: (attempt: number) => Promise<void>;
}

/** Retry a GET only when no answer arrived, or the server failed (5xx) — never on 4xx (03 §7). */
const retryable = (error: unknown): boolean =>
  (error instanceof NetworkError && error.reason !== 'aborted') ||
  ((error instanceof ProblemError || error instanceof ResponseError) && error.status >= 500);

/**
 * Whether a response's `Date` says when the server answered: not from the service worker's cache (it marks those), not
 * aged in a shared cache (`Age`), and not browser-cacheable (`max-age` — an HTTP-cache hit keeps its original `Date`,
 * so a bundle cached days ago would move the app's clock by days).
 */
export const freshDate = (headers: Headers): boolean =>
  headers.get(SW_SOURCE_HEADER) === null &&
  Number(headers.get('age') ?? 0) === 0 &&
  !/(?:^|[\s,])max-age=[1-9]/i.test(headers.get('cache-control') ?? '');

const defaultBackoff = (attempt: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, attempt * (300 + Math.random() * 300));
  });

export type FeedParams = {
  readonly v: number;
  readonly aud: 'brothers' | 'sisters';
  readonly type?: ItemType;
  readonly cursor?: string;
  readonly limit?: number;
};

/** Creates the client. All functions throw `RequestError`s from `@mc/shared/http`. */
export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const backoff = options.backoff ?? defaultBackoff;
  // Records whether the server answered, and the server clock offset of every fresh response.
  const timedFetch: typeof fetch = async (input, init) => {
    const sentAt = Date.now();
    const response = await doFetch(input, init);
    const source = response.headers.get(SW_SOURCE_HEADER);
    if (source === null) options.onReachability?.(true);
    else if (source === 'fallback') options.onReachability?.(false);
    if (freshDate(response.headers)) {
      options.onServerTime?.(serverClockOffset(response.headers.get('date'), sentAt, Date.now()));
    }
    return response;
  };

  async function call<T>(
    path: string,
    schema: z.ZodMiniType<T>,
    init: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: unknown;
      device?: boolean;
      /** Device auth with these credentials instead of the current ones (a queued "Clear all data"). */
      as?: DeviceCredentials;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = {};
    if (init.device) {
      const credentials = init.as ?? options.credentials();
      if (!credentials) throw new ProblemError(NOT_REGISTERED, undefined);
      headers['Authorization'] = `Device ${credentials.deviceId}.${credentials.secret}`;
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await requestJson(`${options.base}${path}`, {
          schema,
          method,
          headers,
          timeoutMs: API_TIMEOUT_MS,
          fetch: timedFetch,
          ...(init.body === undefined ? {} : { body: init.body }),
          ...(init.signal ? { signal: init.signal } : {}),
        });
      } catch (error) {
        if (error instanceof NetworkError && error.reason !== 'aborted') options.onReachability?.(false);
        if (error instanceof ProblemError && error.problem.code === 'DEVICE_AUTH_REQUIRED' && init.device && !init.as) {
          options.onAuthLost?.();
        }
        if (method !== 'GET' || attempt >= GET_RETRIES || !retryable(error)) throw error;
        await backoff(attempt + 1);
      }
    }
  }

  const empty = z.undefined();
  const enc = encodeURIComponent;
  const query = (params: Readonly<Record<string, string | number | undefined>>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
    const text = search.toString();
    return text ? `?${text}` : '';
  };

  return {
    config: (signal?: AbortSignal): Promise<PublicConfig> =>
      call('/config', publicConfigSchema, signal ? { signal } : {}),
    register: (body: RegisterDeviceRequest): Promise<RegisterDeviceResponse> =>
      call('/devices', registerDeviceResponseSchema, { method: 'POST', body }),
    me: (): Promise<DeviceRecord> => call('/devices/me', deviceRecordSchema, { device: true }),
    updateMe: (body: UpdateDeviceRequest): Promise<undefined> =>
      call('/devices/me', empty, { method: 'PATCH', body, device: true }),
    /** Clear all data (05 §4); `as` deletes a former device whose deletion was queued offline. */
    deleteMe: (as?: DeviceCredentials): Promise<undefined> =>
      call('/devices/me', empty, { method: 'DELETE', device: true, ...(as ? { as } : {}) }),
    resolve: async (code: string, signal?: AbortSignal): Promise<MasjidSummary> =>
      (await call(`/masjids/resolve/${enc(code)}`, resolveMasjidResponseSchema, signal ? { signal } : {})).masjid,
    follows: (): Promise<FollowList> => call('/devices/me/follows', followListSchema, { device: true }),
    follow: async (masjidId: string): Promise<'followed' | 'already'> =>
      (await call(`/devices/me/follows/${enc(masjidId)}`, followResponseSchema, { method: 'PUT', device: true }))
        .status,
    mute: (masjidId: string, muted: boolean): Promise<undefined> =>
      call(`/devices/me/follows/${enc(masjidId)}`, empty, { method: 'PATCH', body: { muted }, device: true }),
    unfollow: (masjidId: string): Promise<undefined> =>
      call(`/devices/me/follows/${enc(masjidId)}`, empty, { method: 'DELETE', device: true }),
    /** Ids are sorted so every device asks the CDN for the same URL (01 §5.2). */
    versions: (ids: readonly string[], signal?: AbortSignal): Promise<MasjidVersions> =>
      call(
        `/masjids/versions${query({ ids: [...ids].sort().join(',') })}`,
        masjidVersionsSchema,
        signal ? { signal } : {},
      ),
    bundle: (masjidId: string, v: number, signal?: AbortSignal): Promise<MasjidBundle> =>
      call(`/masjids/${enc(masjidId)}/bundle${query({ v })}`, masjidBundleSchema, signal ? { signal } : {}),
    feed: (masjidId: string, params: FeedParams, signal?: AbortSignal): Promise<FeedPage> =>
      call(
        `/masjids/${enc(masjidId)}/feed${query({ v: params.v, aud: params.aud, type: params.type, cursor: params.cursor, limit: params.limit })}`,
        feedPageSchema,
        signal ? { signal } : {},
      ),
    item: (
      publicId: string,
      params: { v?: number; aud: 'brothers' | 'sisters' },
      signal?: AbortSignal,
    ): Promise<ItemDetail> =>
      call(
        `/items/${enc(publicId)}${query({ v: params.v, aud: params.aud })}`,
        itemDetailSchema,
        signal ? { signal } : {},
      ),
    ameen: async (publicId: string): Promise<number> =>
      (await call(`/items/${enc(publicId)}/ameen`, ameenResponseSchema, { method: 'POST', device: true })).count,
    ameenCounts: (publicIds: readonly string[], signal?: AbortSignal): Promise<AmeenCounts> =>
      call(`/ameens${query({ items: [...publicIds].sort().join(',') })}`, ameenCountsSchema, signal ? { signal } : {}),
    library: async (id: string, signal?: AbortSignal): Promise<LibraryEntry> =>
      (await call(`/library/${enc(id)}`, libraryEntryResponseSchema, signal ? { signal } : {})).entry,
    templates: (signal?: AbortSignal): Promise<TemplateList> =>
      call('/templates', templateListSchema, signal ? { signal } : {}),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Thrown locally (no request) when a device call is attempted before registration. */
const NOT_REGISTERED = {
  type: 'urn:masjid-connect:problem:device-auth-required',
  title: 'Device not registered',
  status: 401,
  code: 'DEVICE_AUTH_REQUIRED',
} as const;

/** True for the API's "this device must register (again)" answer, or a device call before registration. */
export const isAuthLost = (error: unknown): boolean =>
  error instanceof ProblemError && error.problem.code === 'DEVICE_AUTH_REQUIRED';

/** True for problems with this code. */
export const isProblem = (error: unknown, code: string): boolean =>
  error instanceof ProblemError && error.problem.code === code;
