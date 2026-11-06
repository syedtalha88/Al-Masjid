// Masjid Profile (07 B13, 03 §4 Profile, PHASE_03 T3.10): what an admin may change about the masjid — its photo and the
// Hijri date adjustment — and the "Request change" note for everything else (names, area, address: the Super Admin
// changes those). Writes go through the admin `masjids` update cell, whose field allow-list (`ADMIN_MASJID_FIELDS`)
// refuses any other field, dotted path or operator-shaped key (02 §4.1). Each runs in one transaction with its audit
// entry; the photo and the offset are public fields, so the masjid's version is bumped.
import type { UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';

/** A profile change: a new photo (from the image pipeline, the masjid's own key) and/or the Hijri offset (`null` = the
 * app's global setting). */
export interface MasjidProfilePatch {
  readonly photo?: { readonly key: string; readonly thumbhash: string } | undefined;
  readonly hijriOffset?: number | null | undefined;
}

/**
 * Changes the masjid's photo and/or Hijri offset.
 *
 * @returns the names of the fields that were written (for the response).
 * @throws StateError MASJID_NOT_FOUND (outside the scope), PROFILE_INVALID (another masjid's photo key, an offset outside
 *   −2…+2, nothing to change).
 */
export async function updateMasjidProfile(
  handle: DbHandle,
  scope: Scope,
  input: {
    readonly masjidId: UUID;
    readonly patch: MasjidProfilePatch;
    readonly requestId?: string | undefined;
  },
): Promise<readonly string[]> {
  requireOwnMasjid(scope, input.masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  const { photo, hijriOffset } = input.patch;
  if (photo && !photo.key.startsWith(`m/${idText(input.masjidId)}/`)) throw new StateError('PROFILE_INVALID');
  if (
    hijriOffset !== undefined &&
    hijriOffset !== null &&
    (!Number.isInteger(hijriOffset) || Math.abs(hijriOffset) > 2)
  ) {
    throw new StateError('PROFILE_INVALID');
  }
  const set: Record<string, unknown> = {
    ...(photo ? { photo_key: photo.key, photo_thumbhash: photo.thumbhash } : {}),
    ...(typeof hijriOffset === 'number' ? { hijri_offset: hijriOffset } : {}),
  };
  const unset = hijriOffset === null ? { hijri_offset: '' } : undefined;
  const fields = [...Object.keys(set), ...(unset ? Object.keys(unset) : [])];
  if (fields.length === 0) throw new StateError('PROFILE_INVALID');

  return withTransaction(handle, scope, async (ctx) => {
    await contentWrite(ctx, input.masjidId, async (store) => {
      const matched = await scoped(store, 'masjids').updateOne(
        { _id: input.masjidId },
        { ...(Object.keys(set).length > 0 ? { $set: set } : {}), ...(unset ? { $unset: unset } : {}) },
      );
      if (matched !== 1) throw new StateError('MASJID_NOT_FOUND');
    });
    await writeAudit(ctx, {
      action: 'masjid.profile',
      masjidId: input.masjidId,
      targetType: 'masjids',
      targetId: idText(input.masjidId),
      meta: { fields },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return fields;
  });
}

/**
 * "Request change" (07 B13): the admin's note about names, area or address for the Super Admin, kept as an audit entry
 * (the Super Admin dashboard lists the open ones — `listChangeRequests`). No masjid field changes.
 *
 * @throws StateError MASJID_NOT_FOUND (outside the scope).
 */
export async function requestMasjidChange(
  handle: DbHandle,
  scope: Scope,
  input: { readonly masjidId: UUID; readonly note: string; readonly requestId?: string | undefined },
): Promise<void> {
  requireOwnMasjid(scope, input.masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  await withTransaction(handle, scope, async (ctx) => {
    const masjid = await scoped(ctx, 'masjids').findOne({ _id: input.masjidId });
    if (!masjid) throw new StateError('MASJID_NOT_FOUND');
    await writeAudit(ctx, {
      action: 'masjid.change_request',
      masjidId: input.masjidId,
      targetType: 'masjids',
      targetId: idText(input.masjidId),
      meta: { note: input.note },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}
