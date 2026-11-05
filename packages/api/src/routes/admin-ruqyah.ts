// The masjid's Ruqyah section (03 §4 "Ruqyah", 07 B15, PHASE_03 T3.15): list, add, replace, delete and order. Entries
// are verified library entries, text the masjid enters, or recordings from `POST /audio` with the ownership tick. The
// repositories re-resolve the masjid under the session's scope, so another masjid answers like an unknown one.
import { type DbHandle, parseId } from '@mc/db';
import { listRuqyahForAdmin } from '@mc/db/repos';
import {
  addRuqyahEntry,
  deleteRuqyahEntry,
  orderRuqyahEntries,
  type RuqyahEntryInput,
  updateRuqyahEntry,
} from '@mc/db/state';
import {
  adminRuqyahListSchema,
  ruqyahOrderSchema,
  type RuqyahSave,
  ruqyahSavedSchema,
  ruqyahSaveSchema,
} from '@mc/shared/contracts';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';

export interface AdminRuqyahRouteDeps {
  readonly db: DbHandle;
}

const Params = z.object({ masjidId: z.string().max(64) });
const EntryParams = z.object({ masjidId: z.string().max(64), id: z.string().max(64) });
const Empty = z.object({});

function masjidIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
  return id;
}

/** An entry id from the path or the order body; a malformed one answers like an unknown entry. */
function entryIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'RUQYAH_NOT_FOUND');
  return id;
}

/** The body as the data layer takes it (the library id as a UUID, the instruction with its language). */
function entryOf(body: RuqyahSave): RuqyahEntryInput {
  const common = { category: body.category, title: body.title, instructions: body.instructions };
  switch (body.source) {
    case 'library': {
      const libraryId = parseId(body.libraryId);
      if (!libraryId) throw new ApiProblem(404, 'LIBRARY_ENTRY_NOT_FOUND');
      return { ...common, source: 'library', libraryId };
    }
    case 'text':
      return { ...common, source: 'text', text: body.text };
    case 'audio':
      return { ...common, source: 'audio', audio: body.audio };
  }
}

export function adminRuqyahRoutes(deps: AdminRuqyahRouteDeps): RouteDefinition[] {
  const { db } = deps;
  const writes = [{ bucket: 'adminWrites', key: 'session' }] as const;
  return [
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/ruqyah',
      summary: 'Ruqyah entries in the masjid’s order, library content expanded (B15)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminRuqyahListSchema },
      handler: async ({ auth, params, reply }) =>
        reply(200, await listRuqyahForAdmin(db, auth.scope, masjidIdOf(params.masjidId))),
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/ruqyah',
      summary:
        'Add a Ruqyah entry at the end: a verified library entry, the masjid’s own text, or a recording with the ownership tick (≤ 50)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: ruqyahSaveSchema },
      responses: { 201: ruqyahSavedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) =>
        reply(
          201,
          await addRuqyahEntry(db, auth.scope, {
            masjidId: masjidIdOf(params.masjidId),
            entry: entryOf(body),
            now: clock.now(),
            requestId,
          }),
        ),
    }),
    defineRoute({
      method: 'patch',
      path: '/masjids/:masjidId/ruqyah/:id',
      summary: 'Replace a Ruqyah entry (its place stays; a title, instruction or reference left out is removed)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: EntryParams, body: ruqyahSaveSchema },
      responses: { 200: ruqyahSavedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const id = entryIdOf(params.id);
        await updateRuqyahEntry(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          id,
          entry: entryOf(body),
          now: clock.now(),
          requestId,
        });
        return reply(200, { id: params.id.toLowerCase() });
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/masjids/:masjidId/ruqyah/:id',
      summary: 'Delete a Ruqyah entry (followers stop seeing it after their next version poll)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: EntryParams },
      responses: { 204: Empty },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        await deleteRuqyahEntry(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          id: entryIdOf(params.id),
          now: clock.now(),
          requestId,
        });
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'put',
      path: '/masjids/:masjidId/ruqyah/order',
      summary: 'Put the Ruqyah entries in a new order — every active entry exactly once',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: ruqyahOrderSchema },
      responses: { 200: adminRuqyahListSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        await orderRuqyahEntries(db, auth.scope, {
          masjidId,
          ids: body.ids.map(entryIdOf),
          now: clock.now(),
          requestId,
        });
        return reply(200, await listRuqyahForAdmin(db, auth.scope, masjidId));
      },
    }),
  ];
}
