// PHASE_08 contracts (03 §3 reports / grievances, §5 moderation / legal orders / licenses, admin posts): the bounds
// each schema promises at the API boundary — strict bodies, the target id matching its type, safe free text (no
// control or bidi-override characters), required fields, the reference format, statuses and the licence file shape.
import { describe, expect, it } from 'vitest';

import { adminItemListSchema, adminItemSchema } from './admin-items.ts';
import {
  GRIEVANCE_DESCRIPTION_MAX,
  grievanceListSchema,
  grievanceReceivedSchema,
  grievanceRequestSchema,
  resolveGrievanceRequestSchema,
} from './grievances.ts';
import {
  LEGAL_SUMMARY_MAX,
  legalOrderCreateSchema,
  legalOrderListSchema,
  legalOrderPatchSchema,
} from './legal-orders.ts';
import { licensesFileSchema } from './licenses.ts';
import { moderationQueueSchema, moderationResultSchema } from './moderation.ts';
import { reportRequestSchema, reportResponseSchema } from './reports.ts';

const UUID = '0b4c6a1e-8f2d-4c3b-9a7e-5d1f2e3c4b5a';
const NOW = '2026-11-13T06:30:00.000Z';
const FEED_ITEM = {
  publicId: 'seedA0000001',
  masjidId: UUID,
  type: 'dua_request',
  audience: 'everyone',
  isImportant: false,
  publishedAt: NOW,
  dua: { category: 'illness', namePrivate: true },
};

describe('reports (T8.1)', () => {
  const post = { targetType: 'item', targetPublicId: 'seedA0000001', reason: 'misleading', turnstileToken: 't' };

  it('a post by its 12-character public id, a masjid by its UUID — never crossed', () => {
    expect(reportRequestSchema.safeParse(post).success).toBe(true);
    expect(reportRequestSchema.safeParse({ ...post, targetType: 'masjid', targetPublicId: UUID }).success).toBe(true);
    expect(reportRequestSchema.safeParse({ ...post, targetType: 'masjid' }).success).toBe(false);
    expect(reportRequestSchema.safeParse({ ...post, targetPublicId: UUID }).success).toBe(false);
  });

  it('a known reason, optional safe details, a Turnstile token, nothing else', () => {
    expect(reportRequestSchema.safeParse({ ...post, details: 'Line one\nLine two' }).success).toBe(true);
    expect(reportRequestSchema.safeParse({ ...post, reason: 'boring' }).success).toBe(false);
    expect(reportRequestSchema.safeParse({ ...post, details: 'Test ‮ reversed' }).success).toBe(false);
    expect(reportRequestSchema.safeParse({ ...post, turnstileToken: '' }).success).toBe(false);
    expect(reportRequestSchema.safeParse({ ...post, deviceId: UUID }).success).toBe(false);
    expect(reportResponseSchema.safeParse({ received: true }).success).toBe(true);
    expect(reportResponseSchema.safeParse({ received: true, reports: 3 }).success).toBe(false);
  });
});

describe('grievances (T8.4)', () => {
  const request = { category: 'privacy', description: 'Test grievance', turnstileToken: 't' };

  it('a category, a non-empty description up to the limit, an optional contact', () => {
    expect(grievanceRequestSchema.safeParse(request).success).toBe(true);
    expect(grievanceRequestSchema.safeParse({ ...request, contact: 'test@example.invalid' }).success).toBe(true);
    expect(grievanceRequestSchema.safeParse({ ...request, description: '   ' }).success).toBe(false);
    expect(
      grievanceRequestSchema.safeParse({ ...request, description: 'x'.repeat(GRIEVANCE_DESCRIPTION_MAX + 1) }).success,
    ).toBe(false);
    expect(grievanceRequestSchema.safeParse({ ...request, category: 'spam' }).success).toBe(false);
    expect(grievanceRequestSchema.safeParse({ ...request, name: 'Test Person' }).success).toBe(false);
  });

  it('the reference is GR-YYYY-NNNNNN; the tracker never carries the contact; resolve needs a reason', () => {
    expect(grievanceReceivedSchema.safeParse({ publicRef: 'GR-2026-000001' }).success).toBe(true);
    expect(grievanceReceivedSchema.safeParse({ publicRef: 'GR-26-1' }).success).toBe(false);
    const row = {
      id: UUID,
      publicRef: 'GR-2026-000001',
      category: 'privacy',
      description: 'Test grievance',
      hasContact: true,
      status: 'open',
      createdAt: NOW,
      ackDueAt: NOW,
      resolveDueAt: NOW,
      contact: 'test@example.invalid',
    };
    const parsed = grievanceListSchema.parse({ grievances: [row] });
    expect(parsed.grievances[0]).not.toHaveProperty('contact');
    expect(resolveGrievanceRequestSchema.safeParse({ status: 'rejected', resolution: 'Test reason' }).success).toBe(
      true,
    );
    expect(resolveGrievanceRequestSchema.safeParse({ status: 'open', resolution: 'Test reason' }).success).toBe(false);
    expect(resolveGrievanceRequestSchema.safeParse({ status: 'resolved', resolution: '' }).success).toBe(false);
  });
});

describe('legal orders (T8.5)', () => {
  const order = {
    authority: 'Test Authority',
    referenceNo: 'TEST/1',
    receivedAt: '2026-11-13T12:00:00+05:30',
    targetType: 'items',
    target: 'seedA0000001',
    summary: 'Test summary',
  };

  it('every field required; the received time with its offset; a known target type', () => {
    expect(legalOrderCreateSchema.safeParse(order).success).toBe(true);
    for (const key of Object.keys(order)) {
      const { [key as keyof typeof order]: _dropped, ...rest } = order;
      expect(legalOrderCreateSchema.safeParse(rest).success, key).toBe(false);
    }
    expect(legalOrderCreateSchema.safeParse({ ...order, receivedAt: '13/11/2026 12:00' }).success).toBe(false);
    expect(legalOrderCreateSchema.safeParse({ ...order, targetType: 'devices' }).success).toBe(false);
    expect(legalOrderCreateSchema.safeParse({ ...order, summary: 'x'.repeat(LEGAL_SUMMARY_MAX + 1) }).success).toBe(
      false,
    );
  });

  it('a patch moves the status or adds a note — never empty text, never unknown keys', () => {
    expect(legalOrderPatchSchema.safeParse({ status: 'actioned', note: 'Test note' }).success).toBe(true);
    expect(legalOrderPatchSchema.safeParse({ note: '' }).success).toBe(false);
    expect(legalOrderPatchSchema.safeParse({ status: 'ignored' }).success).toBe(false);
    expect(legalOrderPatchSchema.safeParse({ dueAt: NOW }).success).toBe(false);
    const row = {
      id: UUID,
      authority: 'Test Authority',
      referenceNo: 'TEST/1',
      receivedAt: NOW,
      dueAt: NOW,
      targetType: 'items',
      targetId: 'seedA0000001',
      summary: 'Test summary',
      actionLog: [{ at: NOW, note: 'Test note' }],
      status: 'received',
      hasDocument: false,
      createdAt: NOW,
    };
    expect(legalOrderListSchema.safeParse({ orders: [row] }).success).toBe(true);
  });
});

describe('moderation queue and admin posts (T8.2)', () => {
  it('targets with their reports; results count reports and say whether the purge was queued', () => {
    const target = {
      targetType: 'item',
      targetId: 'seedA0000001',
      masjid: { id: UUID, name: 'Test Masjid', removals90d: 0 },
      urgent: true,
      dueAt: NOW,
      reports: [{ id: UUID, reason: 'private_info', urgent: true, createdAt: NOW, dueAt: NOW }],
      item: FEED_ITEM,
    };
    expect(moderationQueueSchema.safeParse({ targets: [target] }).success).toBe(true);
    expect(
      moderationQueueSchema.safeParse({ targets: [{ ...target, masjid: { ...target.masjid, removals90d: -1 } }] })
        .success,
    ).toBe(false);
    expect(
      moderationResultSchema.safeParse({ publicId: 'seedA0000001', reports: 2, cdnPurgeQueued: false }).success,
    ).toBe(true);
  });

  it('a removed post keeps its status and reason for the masjid', () => {
    const post = { id: UUID, status: 'removed', updatedAt: NOW, removedReason: 'misleading', item: FEED_ITEM };
    expect(adminItemSchema.safeParse(post).success).toBe(true);
    expect(adminItemSchema.safeParse({ ...post, status: 'archived' }).success).toBe(false);
    expect(adminItemListSchema.safeParse({ items: [post], next: null }).success).toBe(true);
  });
});

describe('licenses (T8.6)', () => {
  it('packages with https homepages only, at most 5000', () => {
    const entry = { name: 'test-package', version: '1.0.0', license: 'MIT', homepage: 'https://example.invalid' };
    expect(licensesFileSchema.safeParse({ packages: [entry] }).success).toBe(true);
    expect(licensesFileSchema.safeParse({ packages: [{ ...entry, homepage: 'javascript:alert(1)' }] }).success).toBe(
      false,
    );
    expect(licensesFileSchema.safeParse({ packages: [{ ...entry, homepage: 'http://example.invalid' }] }).success).toBe(
      false,
    );
    expect(licensesFileSchema.safeParse({ packages: Array.from({ length: 5001 }, () => entry) }).success).toBe(false);
  });
});
