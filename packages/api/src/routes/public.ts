// api-public routes (03 §3, PHASE_02 T2.2): config, devices, resolve, follows, versions, bundle, feed, items, Ameen,
// library, templates. Reads go through the public views only (@mc/db/repos), device writes through the device state
// functions; caching per 01 §5.2 — versioned GETs are immutable, a stale or missing `v` is a 302 to the current one,
// and every cacheable masjid response carries `Cache-Tag: m-<masjidId>[, i-<publicId>]` (Cloudflare purge by tag).
// Push subscriptions (Phase 4), reports and grievances (Phase 8) are added by their phases.
import { type DbHandle, idText, parseId, publicScope } from '@mc/db';
import {
  findDuaItemId,
  getAmeenCounts,
  getLibraryEntry,
  getMasjidBundle,
  getMasjidVersions,
  getPublicConfig,
  getPublicItem,
  listFeed,
  listTemplates,
  type PublicAudience,
  resolveMasjidByCode,
} from '@mc/db/repos';
import {
  deleteDevice,
  followMasjid,
  getDeviceRecord,
  listFollows,
  recordAmeen,
  registerDevice,
  setDevicePrefs,
  setFollowMuted,
  unfollowMasjid,
} from '@mc/db/state';
import { normalizeFollowCode } from '@mc/domain/follow-code';
import { addDays, calendarDateInZone } from '@mc/domain/time';
import {
  ameenCountsSchema,
  ameenResponseSchema,
  deviceRecordSchema,
  feedPageSchema,
  followListSchema,
  followPatchRequestSchema,
  followResponseSchema,
  ITEM_TYPE_VALUES,
  itemDetailSchema,
  libraryEntryResponseSchema,
  masjidBundleSchema,
  masjidVersionsSchema,
  publicConfigSchema,
  registerDeviceRequestSchema,
  registerDeviceResponseSchema,
  resolveMasjidResponseSchema,
  templateListSchema,
  updateDeviceRequestSchema,
} from '@mc/shared/contracts';
import type { Response } from 'express';
import { z } from 'zod';

import { deviceSecretHash, newDeviceSecret } from '../auth/device.ts';
import type { TurnstileVerifier } from '../auth/turnstile.ts';
import { defineRoute, redirectSchema, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';

export interface PublicRouteDeps {
  readonly db: DbHandle;
  readonly turnstile: TurnstileVerifier;
}

/** Mount point of these routes (01 §2) — redirects name full paths. */
const PREFIX = '/api/v1';

/** 01 §5.2 cache policy. */
export const CACHE = {
  immutable: 'public, max-age=31536000, immutable',
  redirect: 'public, s-maxage=15',
  versions: 'public, s-maxage=15, stale-while-revalidate=60',
  config: 'public, s-maxage=60',
  resolve: 'public, s-maxage=300',
  library: 'public, s-maxage=86400',
  templates: 'public, s-maxage=3600',
  ameens: 'public, s-maxage=30, stale-while-revalidate=60',
} as const;
const versioned = (status: number) => (status === 302 ? CACHE.redirect : CACHE.immutable);

const IdText = z.string().max(64);
const VersionText = z.string().regex(/^\d{1,15}$/);
const MAX_VERSION_IDS = 20;
const MAX_AMEEN_IDS = 30;

/** A UUID from a route parameter; anything else is the resource's uniform 404. */
function idOr404(text: string, code: 'MASJID_NOT_FOUND' | 'NOT_FOUND') {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, code);
  return id;
}

/** Comma-separated list → distinct values (order kept); a malformed entry is a validation failure. */
function listParam(value: string | undefined, max: number, valid: (item: string) => boolean): string[] {
  if (value === undefined || value === '') return [];
  const items = [...new Set(value.split(','))];
  if (items.length > max || !items.every(valid)) {
    throw new ApiProblem(400, 'VALIDATION_FAILED', undefined, [{ path: 'query', code: 'invalid_list' }]);
  }
  return items;
}

/** `everyone` plus the device's choice (DECISIONS #3); without `aud`, only items for everyone. */
const audiencesFor = (aud: 'brothers' | 'sisters' | undefined): PublicAudience[] =>
  aud ? ['everyone', aud] : ['everyone'];

/** The same URL with `v` replaced by the current version (other parameters kept, in a stable order). */
function versionedUrl(path: string, query: Readonly<Record<string, string | undefined>>, v: number): string {
  const params = new URLSearchParams({ v: String(v) });
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (key !== 'v' && value !== undefined) params.set(key, value);
  }
  return `${PREFIX}${path}?${params.toString()}`;
}

const cacheTag = (res: Response, ...tags: string[]) => {
  res.set('Cache-Tag', tags.join(', '));
};

/**
 * api-public feature routes.
 *
 * @param deps - the process's database handle (mc_public) and Turnstile verifier.
 */
export function publicRoutes(deps: PublicRouteDeps): RouteDefinition[] {
  const { db } = deps;
  const current = async (masjidId: ReturnType<typeof idOr404>) => {
    const version = (await getMasjidVersions(db, [masjidId])).get(idText(masjidId));
    if (!version) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
    return version;
  };

  return [
    defineRoute({
      method: 'get',
      path: '/config',
      summary: 'Public settings: Hijri offset, banners, legal versions, grievance officer',
      tags: ['public'],
      auth: 'none',
      cacheControl: CACHE.config,
      responses: { 200: publicConfigSchema },
      handler: async ({ reply }) => reply(200, await getPublicConfig(db)),
    }),

    // --- devices ---------------------------------------------------------------------------------------------------
    defineRoute({
      method: 'post',
      path: '/devices',
      summary: 'Register a device (Turnstile); the secret is returned once',
      tags: ['devices'],
      auth: 'none',
      rateLimit: [{ bucket: 'deviceRegisterIp', key: 'ip' }],
      request: { body: registerDeviceRequestSchema },
      responses: { 201: registerDeviceResponseSchema },
      handler: async ({ body, clock, reply }) => {
        if (!(await deps.turnstile(body.turnstileToken))) throw new ApiProblem(403, 'TURNSTILE_FAILED');
        const secret = newDeviceSecret();
        const id = await registerDevice(db, publicScope(), {
          secretHash: deviceSecretHash(secret),
          locale: body.locale,
          audiencePref: body.audiencePref,
          platform: body.platform,
          privacyVersion: body.privacyVersion,
          now: clock.now(),
        });
        return reply(201, { deviceId: idText(id), secret });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/devices/me',
      summary: 'What the server stores about this device (05 §4)',
      tags: ['devices'],
      auth: 'device',
      rateLimit: [{ bucket: 'deviceSelf', key: 'device' }],
      responses: { 200: deviceRecordSchema },
      handler: async ({ auth, reply }) => {
        const record = await getDeviceRecord(db, auth.scope);
        return reply(200, {
          ...record,
          deviceId: idText(record.deviceId),
          createdAt: record.createdAt.toISOString(),
          lastSeenAt: record.lastSeenAt.toISOString(),
        });
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/devices/me',
      summary: 'Change language, brother/sister choice or accepted privacy version',
      tags: ['devices'],
      auth: 'device',
      rateLimit: [{ bucket: 'deviceSelf', key: 'device' }],
      request: { body: updateDeviceRequestSchema },
      responses: { 204: z.object({}) },
      handler: async ({ auth, body, reply }) => {
        await setDevicePrefs(db, auth.scope, {
          ...(body.locale ? { locale: body.locale } : {}),
          ...(body.audiencePref ? { audiencePref: body.audiencePref } : {}),
          ...(body.privacyVersion ? { privacyVersion: body.privacyVersion } : {}),
        });
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/devices/me',
      summary: 'Clear all data: delete the device, its follows and Ameens',
      tags: ['devices'],
      auth: 'device',
      rateLimit: [{ bucket: 'deviceSelf', key: 'device' }],
      responses: { 204: z.object({}) },
      handler: async ({ auth, reply }) => {
        await deleteDevice(db, auth.scope);
        return reply(204, {});
      },
    }),

    // --- masjids & follows -----------------------------------------------------------------------------------------
    defineRoute({
      method: 'get',
      path: '/masjids/resolve/:code',
      summary: 'Follow code → masjid summary (uniform 404 for anything not active)',
      tags: ['masjids'],
      auth: 'device_optional',
      rateLimit: [{ bucket: 'codeResolve', key: 'device_or_ip' }],
      cacheControl: CACHE.resolve,
      request: { params: z.object({ code: z.string().max(32) }) },
      responses: { 200: resolveMasjidResponseSchema },
      handler: async ({ params, reply }) => {
        const code = normalizeFollowCode(params.code);
        const masjid = code ? await resolveMasjidByCode(db, code) : null;
        if (!masjid) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
        return reply(200, { masjid });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/devices/me/follows',
      summary: 'The server copy of this device’s follows',
      tags: ['follows'],
      auth: 'device',
      rateLimit: [{ bucket: 'deviceSelf', key: 'device' }],
      responses: { 200: followListSchema },
      handler: async ({ auth, reply }) => {
        const follows = await listFollows(db, auth.scope);
        return reply(200, {
          follows: follows.map((follow) => ({
            masjidId: idText(follow.masjidId),
            muted: follow.muted,
            followedAt: follow.followedAt.toISOString(),
          })),
        });
      },
    }),
    defineRoute({
      method: 'put',
      path: '/devices/me/follows/:masjidId',
      summary: 'Follow a masjid (idempotent; 409 FOLLOW_LIMIT_REACHED at 20)',
      tags: ['follows'],
      auth: 'device',
      rateLimit: [{ bucket: 'follow', key: 'device' }],
      request: { params: z.object({ masjidId: IdText }) },
      responses: { 200: followResponseSchema },
      handler: async ({ auth, params, reply }) => {
        const status = await followMasjid(db, auth.scope, idOr404(params.masjidId, 'MASJID_NOT_FOUND'));
        return reply(200, { status });
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/devices/me/follows/:masjidId',
      summary: 'Mute or unmute push for a followed masjid',
      tags: ['follows'],
      auth: 'device',
      rateLimit: [{ bucket: 'follow', key: 'device' }],
      request: { params: z.object({ masjidId: IdText }), body: followPatchRequestSchema },
      responses: { 204: z.object({}) },
      handler: async ({ auth, params, body, reply }) => {
        const found = await setFollowMuted(db, auth.scope, idOr404(params.masjidId, 'MASJID_NOT_FOUND'), body.muted);
        if (!found) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/devices/me/follows/:masjidId',
      summary: 'Unfollow a masjid (idempotent)',
      tags: ['follows'],
      auth: 'device',
      rateLimit: [{ bucket: 'follow', key: 'device' }],
      request: { params: z.object({ masjidId: IdText }) },
      responses: { 204: z.object({}) },
      handler: async ({ auth, params, reply }) => {
        await unfollowMasjid(db, auth.scope, idOr404(params.masjidId, 'MASJID_NOT_FOUND'));
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/versions',
      summary: 'Content version and status of up to 20 masjids',
      tags: ['masjids'],
      auth: 'none',
      rateLimit: [{ bucket: 'publicReads', key: 'ip' }],
      cacheControl: CACHE.versions,
      request: {
        query: z.object({
          ids: z
            .string()
            .max(MAX_VERSION_IDS * 37)
            .optional(),
        }),
      },
      responses: { 200: masjidVersionsSchema },
      handler: async ({ query, reply }) => {
        const ids = listParam(query.ids, MAX_VERSION_IDS, (item) => parseId(item) !== undefined).map((item) =>
          idOr404(item, 'NOT_FOUND'),
        );
        return reply(200, Object.fromEntries(await getMasjidVersions(db, ids)));
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:id/bundle',
      summary: 'A masjid’s profile, raw timings, special dates and Ramadan settings (immutable per version)',
      tags: ['masjids'],
      auth: 'none',
      cacheControl: versioned,
      request: { params: z.object({ id: IdText }), query: z.object({ v: VersionText.optional() }) },
      responses: { 200: masjidBundleSchema, 302: redirectSchema },
      handler: async ({ params, query, clock, res, reply }) => {
        const id = idOr404(params.id, 'MASJID_NOT_FOUND');
        const { v } = await current(id);
        if (query.v !== String(v))
          return reply(302, { location: versionedUrl(`/masjids/${idText(id)}/bundle`, query, v) });
        const bundle = await getMasjidBundle(db, id, addDays(calendarDateInZone(clock.now()), -7));
        if (!bundle) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
        cacheTag(res, `m-${idText(id)}`);
        return reply(200, bundle);
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:id/feed',
      summary: 'Published items of a masjid, newest first (≤ 30 per page; immutable per version)',
      tags: ['feed'],
      auth: 'none',
      cacheControl: versioned,
      request: {
        params: z.object({ id: IdText }),
        query: z.object({
          v: VersionText.optional(),
          type: z.enum(ITEM_TYPE_VALUES).optional(),
          aud: z.enum(['brothers', 'sisters']).optional(),
          cursor: z.string().max(200).optional(),
          limit: z
            .string()
            .regex(/^\d{1,2}$/)
            .optional(),
        }),
      },
      responses: { 200: feedPageSchema, 302: redirectSchema },
      handler: async ({ params, query, res, reply }) => {
        const id = idOr404(params.id, 'MASJID_NOT_FOUND');
        const version = await current(id);
        if (query.v !== String(version.v)) {
          return reply(302, { location: versionedUrl(`/masjids/${idText(id)}/feed`, query, version.v) });
        }
        // A suspended masjid disappears from feeds (00 §4.1).
        const page =
          version.status === 'active'
            ? await listFeed(db, id, {
                ...(query.type ? { type: query.type } : {}),
                audiences: audiencesFor(query.aud),
                ...(query.cursor ? { cursor: query.cursor } : {}),
                ...(query.limit ? { limit: Number(query.limit) } : {}),
              })
            : { items: [], next: null };
        cacheTag(res, `m-${idText(id)}`);
        return reply(200, page);
      },
    }),

    // --- items -------------------------------------------------------------------------------------------------------
    defineRoute({
      method: 'get',
      path: '/items/:publicId',
      summary: 'A published item with its library content and masjid (immutable per version)',
      tags: ['feed'],
      auth: 'none',
      cacheControl: versioned,
      request: {
        params: z.object({ publicId: z.string().max(32) }),
        query: z.object({ v: VersionText.optional(), aud: z.enum(['brothers', 'sisters']).optional() }),
      },
      responses: { 200: itemDetailSchema, 302: redirectSchema },
      handler: async ({ params, query, res, reply }) => {
        const found = /^[A-Za-z0-9_-]{12}$/.test(params.publicId)
          ? await getPublicItem(db, params.publicId, audiencesFor(query.aud))
          : null;
        if (!found) throw new ApiProblem(404, 'ITEM_NOT_FOUND');
        const { v } = await current(found.masjidId);
        if (query.v !== String(v)) {
          return reply(302, { location: versionedUrl(`/items/${params.publicId}`, query, v) });
        }
        cacheTag(res, `m-${idText(found.masjidId)}`, `i-${params.publicId}`);
        return reply(200, { item: found.item, masjid: found.masjid });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/items/:publicId/ameen',
      summary: 'Say Ameen on a dua request (once per device; idempotent)',
      tags: ['feed'],
      auth: 'device',
      rateLimit: [{ bucket: 'ameen', key: 'device' }],
      request: { params: z.object({ publicId: z.string().max(32) }) },
      responses: { 200: ameenResponseSchema },
      handler: async ({ auth, params, reply }) => {
        const itemId = /^[A-Za-z0-9_-]{12}$/.test(params.publicId) ? await findDuaItemId(db, params.publicId) : null;
        if (!itemId) throw new ApiProblem(404, 'ITEM_NOT_FOUND');
        return reply(200, { count: await recordAmeen(db, auth.scope, itemId) });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/ameens',
      summary: 'Live Ameen counts of up to 30 dua requests (kept out of immutable responses)',
      tags: ['feed'],
      auth: 'none',
      rateLimit: [{ bucket: 'publicReads', key: 'ip' }],
      cacheControl: CACHE.ameens,
      request: {
        query: z.object({
          items: z
            .string()
            .max(MAX_AMEEN_IDS * 13)
            .optional(),
        }),
      },
      responses: { 200: ameenCountsSchema },
      handler: async ({ query, reply }) => {
        const ids = listParam(query.items, MAX_AMEEN_IDS, (item) => /^[A-Za-z0-9_-]{12}$/.test(item));
        return reply(200, { counts: Object.fromEntries(await getAmeenCounts(db, ids)) });
      },
    }),

    // --- library & templates -----------------------------------------------------------------------------------------
    defineRoute({
      method: 'get',
      path: '/library/:id',
      summary: 'A verified library entry',
      tags: ['library'],
      auth: 'none',
      cacheControl: CACHE.library,
      request: { params: z.object({ id: IdText }) },
      responses: { 200: libraryEntryResponseSchema },
      handler: async ({ params, reply }) => {
        const entry = await getLibraryEntry(db, idOr404(params.id, 'NOT_FOUND'));
        if (!entry) throw new ApiProblem(404, 'NOT_FOUND');
        return reply(200, { entry });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/templates',
      summary: 'Active notice templates in all four languages',
      tags: ['library'],
      auth: 'none',
      cacheControl: CACHE.templates,
      responses: { 200: templateListSchema },
      handler: async ({ reply }) => reply(200, { templates: await listTemplates(db) }),
    }),
  ];
}
