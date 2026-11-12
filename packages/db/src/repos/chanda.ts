// Weekly chanda reads for B9 (PHASE_05 T5.5): the masjid's settings (shown? week start) and its saved weeks, newest
// first. Through the policy gateway (own masjids only).
import type { UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { StateError } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { requireOwnMasjid } from './admin.ts';
import { need, numberOf, text } from './read.ts';

/** B9 history: about half a year of weeks. */
export const CHANDA_HISTORY_WEEKS = 26;

export interface AdminChanda {
  readonly show: boolean;
  /** 1 = Monday … 7 = Sunday. */
  readonly weekStart: number;
  readonly weeks: { weekStart: string; amountPaise: number; note?: string; updatedAt: string }[];
}

/**
 * `GET /masjids/:id/chanda` (B9): settings and the latest {@link CHANDA_HISTORY_WEEKS} weeks, newest first.
 *
 * @throws StateError MASJID_NOT_FOUND outside the admin's masjids.
 */
export async function getChandaForAdmin(handle: DbHandle, scope: Scope, masjidId: UUID): Promise<AdminChanda> {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const masjid = await scoped({ scope, db }, 'masjids').findOne({ _id: masjidId });
  if (!masjid) throw new StateError('MASJID_NOT_FOUND');
  const docs = await scoped({ scope, db }, 'chanda_weeks').find(
    { masjid_id: masjidId },
    { sort: { week_start: -1 }, limit: CHANDA_HISTORY_WEEKS },
  );
  return {
    show: masjid['show_chanda'] === true,
    weekStart: numberOf(masjid, 'chanda_week_start') ?? 5,
    weeks: docs.map((doc) => {
      const note = text(doc, 'note');
      const updated: unknown = doc['updated_at'];
      return {
        weekStart: need(doc, 'week_start'),
        amountPaise: numberOf(doc, 'amount_paise') ?? 0,
        ...(note === undefined ? {} : { note }),
        updatedAt: updated instanceof Date ? updated.toISOString() : new Date(0).toISOString(),
      };
    }),
  };
}
