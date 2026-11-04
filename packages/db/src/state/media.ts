// Uploaded images and voice notes (PHASE_03 T3.6, T3.13, 05 §2): every stored photo or recording is audited with the admin's confirmation that the masjid
// may publish it — the record a copyright or takedown request is answered from.
import type { UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import type { Scope } from '../scope.ts';

export type ImagePurpose = 'announcement' | 'campaign' | 'masjid';

/**
 * Records that an admin stored `key` for one of their masjids (after it was sanitized and stored).
 *
 * @throws StateError MASJID_NOT_FOUND for a masjid outside the scope.
 */
export async function recordImageUpload(
  handle: DbHandle,
  scope: Scope,
  input: { readonly masjidId: UUID; readonly key: string; readonly purpose: ImagePurpose; readonly requestId?: string },
): Promise<void> {
  requireOwnMasjid(scope, input.masjidId);
  await withTransaction(handle, scope, (ctx) =>
    writeAudit(ctx, {
      action: 'image.upload',
      masjidId: input.masjidId,
      targetType: 'image',
      // The key is m/<masjid>/<image id>; the masjid is masjid_id, so the target is the image id (≤ 64 chars).
      targetId: input.key.slice(input.key.lastIndexOf('/') + 1),
      meta: { purpose: input.purpose, rights_confirmed: true },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    }),
  );
}

/**
 * Records that an admin stored the voice note `key` for one of their masjids (T3.13, 04 R14) with its length.
 *
 * @throws StateError MASJID_NOT_FOUND for a masjid outside the scope.
 */
export async function recordAudioUpload(
  handle: DbHandle,
  scope: Scope,
  input: { readonly masjidId: UUID; readonly key: string; readonly durationS: number; readonly requestId?: string },
): Promise<void> {
  requireOwnMasjid(scope, input.masjidId);
  await withTransaction(handle, scope, (ctx) =>
    writeAudit(ctx, {
      action: 'audio.upload',
      masjidId: input.masjidId,
      targetType: 'audio',
      // The key is m/<masjid>/a/<recording id>; the masjid is masjid_id, so the target is the recording id.
      targetId: input.key.slice(input.key.lastIndexOf('/') + 1),
      meta: { duration_s: input.durationS, rights_confirmed: true },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    }),
  );
}
