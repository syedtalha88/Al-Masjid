// Masjid admins' Content Library (03 §4 "Library/templates (read)", PHASE_03 T3.4): browse/search and today's
// suggestion, for the Hadith/Ayah publisher and the dua picker (B6/B7). Verified entries only — the repositories read
// through the admin policy cell; another masjid's id answers like an unknown one.
import { type DbHandle, parseId } from '@mc/db';
import { listLibraryForAdmin, suggestLibraryEntry } from '@mc/db/repos';
import {
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

export function adminLibraryRoutes(deps: AdminLibraryRouteDeps): RouteDefinition[] {
  const { db } = deps;
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
      summary: "Today's hadith/ayah suggestion — same all day, not one published in the last 60 days (B6)",
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params, query: librarySuggestionQuerySchema },
      responses: { 200: librarySuggestionSchema },
      handler: async ({ auth, params, query, clock, reply }) => {
        const entry = await suggestLibraryEntry(db, auth.scope, masjidIdOf(params.masjidId), {
          kind: query.kind,
          now: clock.now(),
        });
        return reply(200, { entry });
      },
    }),
  ];
}
