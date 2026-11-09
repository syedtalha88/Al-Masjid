// Payment profile reads (PHASE_05 T5.2): the admin's B8 "UPI setup / change" status and the Super Admin's C4 queue.
// Both through the policy gateway (admin: own masjids; Super Admin: all). Writes live only in `state/payment.ts`.
import type { Document, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { requireSuper } from '../state/guards.ts';
import { idText } from '../values.ts';
import { requireOwnMasjid } from './admin.ts';
import { need, text } from './read.ts';

export type PaymentRequestStatus = 'pending' | 'approved_on_hold' | 'rejected';

export interface LivePayment {
  readonly vpa: string;
  readonly payeeName: string;
  readonly effectiveAt: string;
}

export interface PaymentRequestRow {
  readonly id: string;
  readonly status: PaymentRequestStatus;
  readonly vpa: string;
  readonly payeeName: string;
  readonly note?: string;
  readonly requestedAt: string;
  readonly reviewedAt?: string;
  readonly effectiveAt?: string;
  readonly rejectReason?: string;
}

const iso = (doc: Document, key: string): string | undefined => {
  const value: unknown = doc[key];
  return value instanceof Date ? value.toISOString() : undefined;
};

const liveOf = (doc: Document): LivePayment => ({
  vpa: need(doc, 'vpa'),
  payeeName: need(doc, 'payee_name'),
  effectiveAt: iso(doc, 'effective_at') ?? iso(doc, 'updated_at') ?? new Date(0).toISOString(),
});

const requestOf = (doc: Document): PaymentRequestRow => {
  const note = text(doc, 'request_note');
  const reviewedAt = iso(doc, 'reviewed_at');
  const effectiveAt = iso(doc, 'effective_at');
  const rejectReason = text(doc, 'reject_reason');
  return {
    id: idText(doc['_id'] as UUID), // a UUID by schema
    status: doc['status'] as PaymentRequestStatus, // the caller's filter
    vpa: need(doc, 'vpa'),
    payeeName: need(doc, 'payee_name'),
    ...(note === undefined ? {} : { note }),
    requestedAt: iso(doc, 'created_at') ?? new Date(0).toISOString(),
    ...(reviewedAt === undefined ? {} : { reviewedAt }),
    ...(effectiveAt === undefined ? {} : { effectiveAt }),
    ...(rejectReason === undefined ? {} : { rejectReason }),
  };
};

/**
 * `GET /masjids/:id/payment` (B8): the live details, and the request to show — the open one, or else the latest
 * rejection decided after the live details went live (so the admin sees why; an older one is history).
 *
 * @throws StateError MASJID_NOT_FOUND outside the admin's masjids.
 */
export async function getAdminPayment(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
): Promise<{ active: LivePayment | null; request: PaymentRequestRow | null }> {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const docs = await scoped({ scope, db }, 'payment_profiles').find(
    { masjid_id: masjidId, status: { $in: ['active', 'pending', 'approved_on_hold', 'rejected'] } },
    { sort: { created_at: -1 }, limit: 20 },
  );
  const active = docs.find((doc) => doc['status'] === 'active');
  const open = docs.find((doc) => doc['status'] === 'pending' || doc['status'] === 'approved_on_hold');
  const rejected = docs.find((doc) => doc['status'] === 'rejected');
  // A rejection decided after the live details went live is news for the admin; an older one is history.
  const liveSince = active ? iso(active, 'effective_at') : undefined;
  const recentRejection =
    rejected && (liveSince === undefined || (iso(rejected, 'reviewed_at') ?? '') >= liveSince) ? rejected : undefined;
  const request = open ?? recentRejection;
  return { active: active ? liveOf(active) : null, request: request ? requestOf(request) : null };
}

export interface SuperPaymentRow extends PaymentRequestRow {
  readonly masjid: { readonly id: string; readonly name: string; readonly city: string };
  readonly requestedBy: { readonly id: string; readonly displayName: string };
  /** The details live now — C4 shows old and new side by side. */
  readonly current: LivePayment | null;
}

/** Most open requests C4 lists at once (oldest first). */
const QUEUE_MAX = 100;

/**
 * `GET /payments/pending` (C4): open requests — pending, and on hold (which the Super Admin can still stop) — oldest
 * first, each with its masjid, the requesting admin and the details live now.
 *
 * @throws StateError FORBIDDEN unless the Super Admin.
 */
export async function listOpenPayments(handle: DbHandle, scope: Scope): Promise<{ requests: SuperPaymentRow[] }> {
  requireSuper(scope);
  const db = await handle.db();
  const ctx = { scope, db };
  const open = await scoped(ctx, 'payment_profiles').find(
    { open: true },
    { sort: { created_at: 1 }, limit: QUEUE_MAX },
  );
  if (open.length === 0) return { requests: [] };
  const masjidIds = open.map((doc) => doc['masjid_id'] as UUID); // UUIDs by schema
  const adminIds = open.map((doc) => doc['requested_by'] as UUID);
  const [masjids, admins, live] = await Promise.all([
    scoped(ctx, 'masjids').find({ _id: { $in: masjidIds } }),
    scoped(ctx, 'admin_users').find({ _id: { $in: adminIds } }),
    scoped(ctx, 'payment_profiles').find({ masjid_id: { $in: masjidIds }, status: 'active' }),
  ]);
  const byId = (docs: Document[]) => new Map(docs.map((doc) => [idText(doc['_id'] as UUID), doc])); // UUIDs by schema
  const masjidMap = byId(masjids);
  const adminMap = byId(admins);
  const liveMap = new Map(live.map((doc) => [idText(doc['masjid_id'] as UUID), doc]));
  return {
    requests: open.map((doc) => {
      const masjidId = idText(doc['masjid_id'] as UUID);
      const adminId = idText(doc['requested_by'] as UUID);
      const masjid = masjidMap.get(masjidId);
      const current = liveMap.get(masjidId);
      return {
        ...requestOf(doc),
        masjid: {
          id: masjidId,
          name: masjid ? need(masjid, 'name') : '',
          city: masjid ? (text(masjid, 'city') ?? '') : '',
        },
        requestedBy: { id: adminId, displayName: text(adminMap.get(adminId) ?? {}, 'display_name') ?? '' },
        current: current ? liveOf(current) : null,
      };
    }),
  };
}
