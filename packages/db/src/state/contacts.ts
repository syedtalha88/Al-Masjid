// Ilm contacts (00 §4.12, 07 B17, DECISIONS #104, PHASE_03 T3.16): volunteers the masjid lists for Islamic questions,
// each for brothers or for sisters, only with the admin's confirmation that the person agreed (05 §2 — name and
// WhatsApp number become visible to app users). Every write is one transaction with the version bump (followers
// refetch the bundle, which carries the contacts) and the audit entry — without the name or number. The bump also
// serializes concurrent adds, so the 10-contact limit holds under parallel requests.
import type { UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import { numberOf } from '../repos/read.ts';
import type { AUDIENCE_PREF } from '../schema/enums.ts';
import { CONTACTS_MAX, E164_PATTERN } from '../schema/sections.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText, newId } from '../values.ts';

/** A contact as the admin saves it (the contracts checked lengths and the number). */
export interface ContactInput {
  readonly name: string;
  readonly role?: string | undefined;
  readonly topics?: string | undefined;
  /** E.164 ("+91…"). */
  readonly whatsapp: string;
  readonly audience: (typeof AUDIENCE_PREF)[number];
  /** "This person agreed to be listed" — must be true on every save. */
  readonly consentConfirmed: boolean;
}

interface WriteOptions {
  readonly masjidId: UUID;
  readonly requestId?: string | undefined;
  readonly now?: Date | undefined;
}

const OPTIONAL = ['role', 'topics'] as const;
const E164 = new RegExp(E164_PATTERN);

/** The stored fields of a contact, and the optional ones it does not have (to `$unset` on a replacement). */
function fieldsOf(contact: ContactInput) {
  if (!contact.consentConfirmed || !E164.test(contact.whatsapp)) throw new StateError('CONTACT_INVALID');
  const set = {
    name: contact.name,
    ...(contact.role === undefined ? {} : { role: contact.role }),
    ...(contact.topics === undefined ? {} : { topics: contact.topics }),
    whatsapp: contact.whatsapp,
    audience: contact.audience,
    consent_confirmed: true,
  };
  const unset = Object.fromEntries(OPTIONAL.filter((name) => !(name in set)).map((name) => [name, '']));
  return { set, unset };
}

function adminOf(scope: Scope, masjidId: UUID): UUID {
  requireOwnMasjid(scope, masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  return scope.adminId;
}

/** The masjid inside the transaction (`MASJID_NOT_FOUND` outside the scope). */
async function ownMasjidVisible(ctx: TxContext, masjidId: UUID): Promise<boolean> {
  const masjid = await scoped(ctx, 'masjids').findOne({ _id: masjidId });
  if (!masjid) throw new StateError('MASJID_NOT_FOUND');
  return masjid['status'] === 'active';
}

const auditMeta = (contact: ContactInput) => ({ audience: contact.audience, consent_confirmed: true });

/**
 * Adds an Ilm contact at the end of the masjid's list.
 *
 * @returns the new contact's id.
 * @throws StateError MASJID_NOT_FOUND (outside the scope), CONTACT_INVALID (no consent, or a number not in E.164),
 *   CONTACT_LIMIT_REACHED (10 active).
 */
export async function addContact(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly contact: ContactInput },
): Promise<{ id: string }> {
  const adminId = adminOf(scope, input.masjidId);
  const now = input.now ?? new Date();
  const { set } = fieldsOf(input.contact);
  return withTransaction(handle, scope, async (ctx) => {
    const visible = await ownMasjidVisible(ctx, input.masjidId);
    const id = newId();
    await contentWrite(ctx, input.masjidId, async (content) => {
      const store = scoped(content, 'masjid_contacts');
      const active = { masjid_id: input.masjidId, status: 'active' };
      if ((await store.count(active)) >= CONTACTS_MAX) throw new StateError('CONTACT_LIMIT_REACHED');
      const [last] = await store.find(active, { sort: { sort: -1 }, limit: 1 });
      await store.insertOne({
        _id: id,
        masjid_id: input.masjidId,
        ...set,
        sort: last ? (numberOf(last, 'sort') ?? 0) + 1 : 0,
        status: 'active',
        masjid_visible: visible,
        created_by: adminId,
        created_at: now,
        updated_at: now,
      });
    });
    await writeAudit(ctx, {
      action: 'contact.create',
      masjidId: input.masjidId,
      targetType: 'masjid_contacts',
      targetId: idText(id),
      meta: auditMeta(input.contact),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return { id: idText(id) };
  });
}

/**
 * Replaces a contact (its place stays; a role or topics left out is removed). The consent is confirmed again with
 * every save.
 *
 * @throws StateError MASJID_NOT_FOUND, CONTACT_NOT_FOUND (unknown or deleted), CONTACT_INVALID.
 */
export async function updateContact(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly id: UUID; readonly contact: ContactInput },
): Promise<void> {
  adminOf(scope, input.masjidId);
  const now = input.now ?? new Date();
  const { set, unset } = fieldsOf(input.contact);
  await withTransaction(handle, scope, async (ctx) => {
    await ownMasjidVisible(ctx, input.masjidId);
    await contentWrite(ctx, input.masjidId, async (content) => {
      const matched = await scoped(content, 'masjid_contacts').updateOne(
        { _id: input.id, masjid_id: input.masjidId, status: 'active' },
        { $set: { ...set, updated_at: now }, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) },
      );
      if (matched !== 1) throw new StateError('CONTACT_NOT_FOUND');
    });
    await writeAudit(ctx, {
      action: 'contact.update',
      masjidId: input.masjidId,
      targetType: 'masjid_contacts',
      targetId: idText(input.id),
      meta: auditMeta(input.contact),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}

/**
 * Removes a contact (`status: 'deleted'` + `deleted_at` — gone for followers after their next poll; purged 30 days
 * later by `retention`, 02 §6). Also how a person's "remove me" request is carried out (05 §2).
 *
 * @throws StateError MASJID_NOT_FOUND, CONTACT_NOT_FOUND (unknown or already deleted).
 */
export async function deleteContact(
  handle: DbHandle,
  scope: Scope,
  input: WriteOptions & { readonly id: UUID },
): Promise<void> {
  adminOf(scope, input.masjidId);
  const now = input.now ?? new Date();
  await withTransaction(handle, scope, async (ctx) => {
    await ownMasjidVisible(ctx, input.masjidId);
    await contentWrite(ctx, input.masjidId, async (content) => {
      const matched = await scoped(content, 'masjid_contacts').updateOne(
        { _id: input.id, masjid_id: input.masjidId, status: 'active' },
        { $set: { status: 'deleted', deleted_at: now, updated_at: now } },
      );
      if (matched !== 1) throw new StateError('CONTACT_NOT_FOUND');
    });
    await writeAudit(ctx, {
      action: 'contact.delete',
      masjidId: input.masjidId,
      targetType: 'masjid_contacts',
      targetId: idText(input.id),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}
