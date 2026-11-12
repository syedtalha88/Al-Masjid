// Needy people reads (03 §3 `GET /masjids/:id/beneficiaries`, §4 `GET /beneficiaries`, PHASE_05 T5.8): the musalli's
// list ONLY through `v_pub_beneficiaries` (listed people of a visible masjid, least-funded first, public fields — the
// private phone / note is in no view) and the admin's B19 list through the admin cells (`private_enc` hidden there
// too; only whether something private is stored).
import type { Document, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { BENEFICIARIES_ACTIVE_MAX } from '../schema/beneficiaries.ts';
import { BENEFICIARY_CATEGORY, BENEFICIARY_STATUS, LOCALE } from '../schema/enums.ts';
import { publicScope, type Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { requireOwnMasjid } from './admin.ts';
import { compact, idOf, iso, need, numberOf, oneOf } from './read.ts';

/** The fields both apps show. */
const personOf = (doc: Document) =>
  compact({
    publicId: need(doc, 'public_id'),
    displayName: need(doc, 'display_name'),
    category: oneOf(doc, 'category', BENEFICIARY_CATEGORY),
    reason: need(doc, 'reason'),
    reasonLocale: oneOf(doc, 'reason_locale', LOCALE),
    vpa: need(doc, 'vpa'),
    payeeName: need(doc, 'payee_name'),
    capPaise: numberOf(doc, 'cap_paise') ?? 0,
    receivedPaise: numberOf(doc, 'received_paise') ?? 0,
    receivedUpdatedAt: iso(doc, 'received_updated_at'),
    fundedPermille: numberOf(doc, 'funded_permille') ?? 0,
    zakatEligible: doc['zakat_eligible'] === true,
  });
export type PublicBeneficiary = ReturnType<typeof personOf>;

/**
 * A23: a visible masjid's listed people, least-funded first, then oldest.
 *
 * @param zakatOnly - only people the masjid marked zakat-eligible.
 * @returns `[]` for a masjid without listed people (and for unknown or hidden masjids — the caller checks those).
 */
export async function listPublicBeneficiaries(
  handle: DbHandle,
  masjidId: UUID,
  zakatOnly = false,
): Promise<PublicBeneficiary[]> {
  const db = await handle.db();
  const docs = await scoped({ scope: publicScope(), db }, 'v_pub_beneficiaries').find(
    { masjid_id: masjidId, ...(zakatOnly ? { zakat_eligible: true } : {}) },
    { limit: BENEFICIARIES_ACTIVE_MAX }, // the view sorts
  );
  return docs.map(personOf);
}

/** The bundle's `sections.needy`: how many people a visible masjid lists (the Masjid Detail row shows when > 0). */
export async function countPublicBeneficiaries(handle: DbHandle, masjidId: UUID): Promise<number> {
  const db = await handle.db();
  return scoped({ scope: publicScope(), db }, 'v_pub_beneficiaries').count({ masjid_id: masjidId });
}

const STATUS_ORDER: Readonly<Record<(typeof BENEFICIARY_STATUS)[number], number>> = {
  active: 0,
  fulfilled: 1,
  closed: 2,
  deleted: 3,
};

/**
 * B19: the masjid's people — active (least-funded first), then fulfilled, then closed; deleted ones are not listed.
 * `hasPrivate` says whether a private phone / note is stored (the text itself only through
 * `readBeneficiaryPrivate`, audited).
 *
 * @throws StateError MASJID_NOT_FOUND for a masjid outside the scope.
 */
export async function listBeneficiariesForAdmin(handle: DbHandle, scope: Scope, masjidId: UUID) {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const docs = await scoped({ scope, db }, 'beneficiaries').find(
    { masjid_id: masjidId, status: { $in: ['active', 'fulfilled', 'closed'] } },
    { sort: { funded_permille: 1, created_at: 1 }, limit: 500 },
  );
  // `private_enc` is hidden from the read above (02 §4.1) — presence is checked separately, never the value.
  const withPrivate = await db
    .collection<{ _id: UUID }>('beneficiaries')
    .find({ masjid_id: masjidId, private_enc: { $exists: true } }, { projection: { _id: 1 } })
    .toArray();
  const hasPrivate = new Set(withPrivate.map((doc) => idText(doc._id)));
  const people = docs.map((doc) => ({
    id: idOf(doc),
    ...personOf(doc),
    status: oneOf(doc, 'status', BENEFICIARY_STATUS),
    hasPrivate: hasPrivate.has(idOf(doc)),
    createdAt: iso(doc, 'created_at') ?? new Date(0).toISOString(),
  }));
  people.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]); // stable: least-funded first within a status
  return { people };
}
export type AdminBeneficiary = Awaited<ReturnType<typeof listBeneficiariesForAdmin>>['people'][number];
