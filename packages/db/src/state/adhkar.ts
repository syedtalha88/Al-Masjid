// "Adhkar after salah" (00 §4.11, 07 B16, DECISIONS #104, PHASE_03 T3.14): the masjid turns the Home card on and picks
// an ordered set of verified `dhikr` library entries. The whole set is replaced on each save through the admin `masjids`
// update cell (field allow-list, 02 §4.1); the admin `content_library` cell reads verified entries only, so a draft,
// retired, other-kind or unknown id is refused. It is public (bundle), so the masjid's version is bumped.
import type { UUID } from 'mongodb';

import { type DbHandle, withTransaction } from '../client.ts';
import { contentWrite, StateError, writeAudit } from '../effects.ts';
import { requireOwnMasjid } from '../repos/admin.ts';
import { ADHKAR_MAX } from '../schema/masjids.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';

/** A masjid's adhkar set as the admin saves it. */
export interface AdhkarInput {
  readonly enabled: boolean;
  /** Verified `dhikr` entries, in the order the musalli sees them (≤ {@link ADHKAR_MAX}, no repeats). */
  readonly libraryIds: readonly UUID[];
}

/**
 * Replaces the masjid's "Adhkar after salah" set.
 *
 * @throws StateError MASJID_NOT_FOUND (outside the scope), ADHKAR_INVALID (over {@link ADHKAR_MAX} entries or a repeated
 *   id), LIBRARY_ENTRY_NOT_FOUND (an id that is not a verified `dhikr` entry). Nothing is written on a refusal.
 */
export async function setAdhkar(
  handle: DbHandle,
  scope: Scope,
  input: AdhkarInput & { readonly masjidId: UUID; readonly requestId?: string | undefined },
): Promise<void> {
  requireOwnMasjid(scope, input.masjidId);
  if (scope.kind !== 'admin') throw new StateError('FORBIDDEN');
  const ids = input.libraryIds;
  if (ids.length > ADHKAR_MAX || new Set(ids.map(idText)).size !== ids.length) throw new StateError('ADHKAR_INVALID');

  await withTransaction(handle, scope, async (ctx) => {
    if (ids.length > 0) {
      // The admin cell reads verified entries only.
      const found = await scoped(ctx, 'content_library').count({ _id: { $in: [...ids] }, kind: 'dhikr' });
      if (found !== ids.length) throw new StateError('LIBRARY_ENTRY_NOT_FOUND');
    }
    await contentWrite(ctx, input.masjidId, async (store) => {
      const matched = await scoped(store, 'masjids').updateOne(
        { _id: input.masjidId },
        { $set: { adhkar: { enabled: input.enabled, library_ids: [...ids] } } },
      );
      if (matched !== 1) throw new StateError('MASJID_NOT_FOUND');
    });
    await writeAudit(ctx, {
      action: 'adhkar.update',
      masjidId: input.masjidId,
      targetType: 'masjids',
      targetId: idText(input.masjidId),
      meta: { enabled: input.enabled, count: ids.length },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}
