// The masjid's Ilm contacts (03 §4 "Ilm contacts", 07 B17, PHASE_03 T3.16): list, add, replace and delete. Every save
// carries `consentConfirmed: true` — the admin's statement that the person agreed to be listed (05 §2). The repositories
// re-resolve the masjid under the session's scope, so another masjid answers like an unknown one.
import { type DbHandle, parseId } from '@mc/db';
import { listContactsForAdmin } from '@mc/db/repos';
import { addContact, type ContactInput, deleteContact, updateContact } from '@mc/db/state';
import { adminContactListSchema, type ContactSave, contactSavedSchema, contactSaveSchema } from '@mc/shared/contracts';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';

export interface AdminContactRouteDeps {
  readonly db: DbHandle;
}

const Params = z.object({ masjidId: z.string().max(64) });
const ContactParams = z.object({ masjidId: z.string().max(64), id: z.string().max(64) });
const Empty = z.object({});

function masjidIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
  return id;
}

/** A contact id from the path; a malformed one answers like an unknown contact. */
function contactIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'CONTACT_NOT_FOUND');
  return id;
}

const contactOf = (body: ContactSave): ContactInput => ({
  name: body.name,
  role: body.role,
  topics: body.topics,
  whatsapp: body.whatsapp,
  audience: body.audience,
  consentConfirmed: body.consentConfirmed,
});

export function adminContactRoutes(deps: AdminContactRouteDeps): RouteDefinition[] {
  const { db } = deps;
  const writes = [{ bucket: 'adminWrites', key: 'session' }] as const;
  return [
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/contacts',
      summary: 'Ilm contacts, brothers’ first, each audience in the masjid’s order (B17)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminContactListSchema },
      handler: async ({ auth, params, reply }) =>
        reply(200, await listContactsForAdmin(db, auth.scope, masjidIdOf(params.masjidId))),
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/contacts',
      summary: 'Add an Ilm contact — only with `consentConfirmed: true` (≤ 10)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: contactSaveSchema },
      responses: { 201: contactSavedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) =>
        reply(
          201,
          await addContact(db, auth.scope, {
            masjidId: masjidIdOf(params.masjidId),
            contact: contactOf(body),
            now: clock.now(),
            requestId,
          }),
        ),
    }),
    defineRoute({
      method: 'patch',
      path: '/masjids/:masjidId/contacts/:id',
      summary: 'Replace an Ilm contact (consent confirmed again; a role or topics left out is removed)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: ContactParams, body: contactSaveSchema },
      responses: { 200: contactSavedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        await updateContact(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          id: contactIdOf(params.id),
          contact: contactOf(body),
          now: clock.now(),
          requestId,
        });
        return reply(200, { id: params.id.toLowerCase() });
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/masjids/:masjidId/contacts/:id',
      summary: 'Remove an Ilm contact (followers stop seeing it after their next version poll)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: ContactParams },
      responses: { 204: Empty },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        await deleteContact(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          id: contactIdOf(params.id),
          now: clock.now(),
          requestId,
        });
        return reply(204, {});
      },
    }),
  ];
}
