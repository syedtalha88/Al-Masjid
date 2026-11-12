// Donation campaign reads for B8 (PHASE_05 T5.3): the masjid's campaigns, active first, newest first, with their
// amounts as the masjid reported them. Through the policy gateway (own masjids only).
import type { Document, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { requireOwnMasjid } from './admin.ts';
import { need, numberOf, text } from './read.ts';

export type CampaignStatus = 'active' | 'completed' | 'closed';
export type CampaignPurposeValue = 'renovation' | 'repair' | 'utilities' | 'welfare' | 'other';

export interface AdminCampaignRow {
  readonly id: string;
  readonly publicId: string;
  readonly title: string;
  readonly description?: string;
  readonly purpose: CampaignPurposeValue;
  readonly status: CampaignStatus;
  readonly targetPaise: number;
  readonly receivedPaise: number;
  readonly receivedUpdatedAt?: string;
  readonly startsOn: string;
  readonly endsOn?: string;
  readonly cover?: { readonly key: string; readonly thumbhash: string };
  readonly publishedAt: string;
}

const STATUS_ORDER: Readonly<Record<CampaignStatus, number>> = { active: 0, completed: 1, closed: 2 };
const iso = (value: unknown): string | undefined => (value instanceof Date ? value.toISOString() : undefined);

/** One campaign item as B8 lists it. */
export function campaignRowOf(item: Document): AdminCampaignRow {
  const detail = (item['campaign'] ?? {}) as Document; // by schema
  const description = text(item, 'body');
  const receivedUpdatedAt = iso(detail['received_updated_at']);
  const endsOn = text(detail, 'ends_on');
  const coverKey = text(detail, 'cover_key');
  return {
    id: idText(item['_id'] as UUID), // a UUID by schema
    publicId: need(item, 'public_id'),
    title: text(item, 'title') ?? '',
    ...(description === undefined ? {} : { description }),
    purpose: detail['purpose'] as CampaignPurposeValue, // enum by schema
    status: detail['status'] as CampaignStatus, // enum by schema
    targetPaise: numberOf(detail, 'target_paise') ?? 0,
    receivedPaise: numberOf(detail, 'received_paise') ?? 0,
    ...(receivedUpdatedAt === undefined ? {} : { receivedUpdatedAt }),
    startsOn: need(detail, 'starts_on'),
    ...(endsOn === undefined ? {} : { endsOn }),
    ...(coverKey === undefined ? {} : { cover: { key: coverKey, thumbhash: text(detail, 'cover_thumbhash') ?? '' } }),
    publishedAt: iso(item['published_at']) ?? new Date(0).toISOString(),
  };
}

/**
 * `GET /masjids/:id/campaigns` (B8): published campaigns — active, then completed, then closed; newest first in each.
 *
 * @throws StateError MASJID_NOT_FOUND outside the admin's masjids.
 */
export async function listCampaignsForAdmin(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
): Promise<{ campaigns: AdminCampaignRow[] }> {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const docs = await scoped({ scope, db }, 'items').find(
    { masjid_id: masjidId, type: 'campaign', status: 'published' },
    { sort: { published_at: -1 }, limit: 50 },
  );
  const rows = docs.map(campaignRowOf);
  rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]); // stable: newest first within a status
  return { campaigns: rows };
}
