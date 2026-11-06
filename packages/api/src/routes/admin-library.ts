// Masjid admins' Content Library (03 §4 "Library/templates (read)", PHASE_03 T3.4): browse/search and today's
// suggestion, for the Hadith/Ayah publisher and the dua picker (B6/B7); and the masjid's "Adhkar after salah" set (B16,
// T3.14) — verified `dhikr` entries in order. Verified entries only — the repositories read through the admin policy
// cell; another masjid's id answers like an unknown one.
import { type DbHandle, parseId } from '@mc/db';
import { dailyPublishedToday, getAdhkarForAdmin, listLibraryForAdmin, suggestLibraryEntry } from '@mc/db/repos';
import { setAdhkar } from '@mc/db/state';
import {
  adhkarPutSchema,
  adminAdhkarSchema,
  adminLibraryListSchema,
  adminLibraryQuerySchema,
  librarySuggestionQuerySchema,
  librarySuggestionSchema,
} from '@mc/shared/contracts';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';

export interface AdminLibraryRouteDeps {
  readonly db: DbHandle;
}

const Params = z.object({ masjidId: z.string().max(64) });

function masjidIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
  return id;
}

/** Body ids are canonical UUID v4 text (contract), so this never fails for a valid body. */
function libraryIdsOf(texts: readonly string[]): NonNullable<ReturnType<typeof parseId>>[] {
  return texts.map((text) => {
    const id = parseId(text);
    if (!id) throw new ApiProblem(404, 'LIBRARY_ENTRY_NOT_FOUND');
    return id;
  });
}

export function adminLibraryRoutes(deps: AdminLibraryRouteDeps): RouteDefinition[] {
  const { db } = deps;
  const writes = [{ bucket: 'adminWrites', key: 'session' }] as const;
  return [
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/library',
      summary: 'Verified Content Library entries: kind, category and tag chips, search (B6/B7)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params, query: adminLibraryQuerySchema },
      responses: { 200: adminLibraryListSchema },
      handler: async ({ auth, params, query, reply }) => {
        const page = await listLibraryForAdmin(db, auth.scope, masjidIdOf(params.masjidId), {
          ...(query.kind ? { kind: query.kind } : {}),
          ...(query.category ? { category: query.category } : {}),
          ...(query.tag ? { tag: query.tag } : {}),
          ...(query.q ? { q: query.q } : {}),
          ...(query.cursor ? { cursor: query.cursor } : {}),
        });
        return reply(200, { entries: page.rows, ...(page.next ? { next: page.next } : {}) });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/library/suggestion',
      summary:
        "Today's hadith/ayah suggestion — same all day, not one published in the last 60 days — and whether one of the kind went out today (B6)",
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params, query: librarySuggestionQuerySchema },
      responses: { 200: librarySuggestionSchema },
      handler: async ({ auth, params, query, clock, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        const input = { kind: query.kind, now: clock.now() };
        const [entry, publishedToday] = await Promise.all([
          suggestLibraryEntry(db, auth.scope, masjidId, input),
          dailyPublishedToday(db, auth.scope, masjidId, input),
        ]);
        return reply(200, { entry, publishedToday });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/adhkar',
      summary: '"Adhkar after salah": on/off and the verified dhikr entries in order (B16)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminAdhkarSchema },
      handler: async ({ auth, params, reply }) =>
        reply(200, await getAdhkarForAdmin(db, auth.scope, masjidIdOf(params.masjidId))),
    }),
    defineRoute({
      method: 'put',
      path: '/masjids/:masjidId/adhkar',
      summary:
        'Replace the "Adhkar after salah" set — verified dhikr entries only, ≤ 30, in order (followers see it after their next version poll)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: adhkarPutSchema },
      responses: { 200: adminAdhkarSchema },
      handler: async ({ auth, params, body, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        await setAdhkar(db, auth.scope, {
          masjidId,
          enabled: body.enabled,
          libraryIds: libraryIdsOf(body.libraryIds),
          requestId,
        });
        return reply(200, await getAdhkarForAdmin(db, auth.scope, masjidId));
      },
    }),
  ];
}
