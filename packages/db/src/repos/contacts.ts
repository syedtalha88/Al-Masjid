// Ilm contact reads (03 §3 bundle `contacts`, §4 `GET /contacts`, PHASE_03 T3.16): the musalli's list through
// `v_pub_contacts` (both audiences — the app shows the device's own) and the admin's B17 list through the admin cells.
import type { Document, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { AUDIENCE_PREF } from '../schema/enums.ts';
import { publicScope, type Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { requireOwnMasjid } from './admin.ts';
import { compact, idOf, need, oneOf, text } from './read.ts';

/** A contact as both apps read it (`ilmContactSchema`). */
const contactOf = (doc: Document) =>
  compact({
    id: idOf(doc),
    name: need(doc, 'name'),
    role: text(doc, 'role'),
    topics: text(doc, 'topics'),
    whatsapp: need(doc, 'whatsapp'),
    audience: oneOf(doc, 'audience', AUDIENCE_PREF),
  });
export type ContactRow = ReturnType<typeof contactOf>;

/**
 * The bundle's `contacts`: a visible masjid's active contacts, brothers' first, each audience in the masjid's order.
 *
 * @returns `[]` for a masjid without contacts (and for unknown or hidden masjids — the caller checks those).
 */
export async function getPublicContacts(handle: DbHandle, masjidId: UUID): Promise<ContactRow[]> {
  const db = await handle.db();
  const docs = await scoped({ scope: publicScope(), db }, 'v_pub_contacts').find({ masjid_id: masjidId }); // view sorts
  return docs.map(contactOf);
}

/**
 * B17: the masjid's active contacts in the same order.
 *
 * @throws StateError MASJID_NOT_FOUND for a masjid outside the scope.
 */
export async function listContactsForAdmin(handle: DbHandle, scope: Scope, masjidId: UUID) {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const docs = await scoped({ scope, db }, 'masjid_contacts').find(
    { masjid_id: masjidId, status: 'active' },
    { sort: { audience: 1, sort: 1, _id: 1 } },
  );
  return { contacts: docs.map(contactOf) };
}
