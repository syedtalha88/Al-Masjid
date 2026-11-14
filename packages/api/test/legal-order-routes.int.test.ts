// PHASE_08 T8.5 — the legal orders register (C7) through the real app (mc_admin): recording an order needs a step-up,
// resolves its target (a post by its link, a masjid by its follow code), and sets due = received + 3 h; the timer shows
// on the dashboard and the `sla-alerts` job alerts on it (once per threshold) until the order is acted on; status moves
// follow the flow (closed is final); ★ Remove with `legalOrderId` logs the takedown on the order and stops its clock.
// The document: stored bytes are ciphertext (read back through the store), a download without a step-up is 403, with
// one it is the original file; another order's id never opens it; anything not PDF / JPEG / PNG is 415.
// Placeholder text only (10 §Fixtures).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { idText, isId, type newId, parseId } from '@mc/db';
import { SEED_FOLLOW_CODES, seedId, seedPublicId } from '@mc/db/seed';
import { processUserHandle } from '@mc/db/testing';
import { superDashboardSchema } from '@mc/shared/contracts';
import { legalOrderCreatedSchema, legalOrderListSchema } from '@mc/shared/contracts/legal-orders';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { processSlaAlerts } from '../src/jobs/reports/sla-alerts.ts';
import { runDevSeed } from '../src/jobs/seed.ts';
import { filePrivateStore, type PrivateFileStore } from '../src/media/private-store.ts';
import type { JobQueues } from '../src/queue/queues.ts';
import { silentLogger } from './helpers.ts';
import { superHarness } from './super-harness.ts';

const NOW = new Date('2026-11-13T06:30:00Z');
const HOUR = 3_600_000;
const dir = await mkdtemp(join(tmpdir(), 'mc-legal-'));
const stored = new Map<string, Buffer>();
const files = filePrivateStore(dir);
const privateFiles: PrivateFileStore = {
  put: async (key, bytes) => {
    stored.set(key, bytes);
    await files.put(key, bytes);
  },
  get: (key) => files.get(key),
  delete: async (key) => {
    stored.delete(key);
    await files.delete(key);
  },
};
const harness = superHarness('legal-order-routes', NOW, { privateFiles });
const { asSuper, stepUp, clock } = harness;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('Test legal order document body 0123456789')]);
const ORDER = {
  authority: 'Test Authority',
  referenceNo: 'TEST/REF/0001',
  receivedAt: new Date(NOW.getTime() - HOUR).toISOString(),
  targetType: 'items',
  target: `https://app.example.invalid/p/${seedPublicId('alpha', 1)}`,
  summary: 'Test order summary',
} as const;

const create = async (body: Record<string, unknown> = {}) => {
  await stepUp(true);
  return asSuper('post', '/legal-orders').send({ ...ORDER, ...body });
};
type Uuid = ReturnType<typeof newId>;
const orderIdOf = (text: string): Uuid => {
  const id = parseId(text);
  if (!id) throw new Error(`not an id: ${text}`);
  return id;
};
const orders = () =>
  harness
    .db()
    .collection<{ _id: Uuid; document_key?: string; status?: string; received_at?: Date; due_at?: Date }>(
      'legal_orders',
    );
const items = () => harness.db().collection<{ _id: Uuid; status?: string }>('items');
/** Moves an order's clock `ms` into the past (received and due both earlier). */
const shift = async (id: string, ms: number) => {
  const doc = await orders().findOne({ _id: orderIdOf(id) });
  const received = doc?.received_at;
  const due = doc?.due_at;
  if (!received || !due) throw new Error('no order');
  await orders().updateOne(
    { _id: orderIdOf(id) },
    { $set: { received_at: new Date(received.getTime() - ms), due_at: new Date(due.getTime() - ms) } },
  );
};
const list = async () => legalOrderListSchema.parse((await asSuper('get', '/legal-orders')).body).orders;

beforeAll(async () => {
  asSystem = await processUserHandle(harness.testDatabase(), 'mc_system');
  await runDevSeed(asSystem.handle, 'local', NOW);
});
afterAll(async () => {
  await asSystem?.dispose();
  await rm(dir, { recursive: true, force: true });
});

describe('legal orders (T8.5)', () => {
  it('recording needs a step-up; the target resolves; due = received + 3 h; audited', async () => {
    await stepUp(false);
    expect((await asSuper('post', '/legal-orders').send(ORDER)).status).toBe(403);
    const created = await create();
    expect(created.status).toBe(201);
    const { id, dueAt } = legalOrderCreatedSchema.parse(created.body);
    expect(dueAt).toBe(new Date(NOW.getTime() + 2 * HOUR).toISOString());
    const itemId: unknown = (
      await harness
        .db()
        .collection('items')
        .findOne({ public_id: seedPublicId('alpha', 1) })
    )?.['_id'];
    if (!isId(itemId)) throw new Error('no seed item');
    const [row] = (await list()).filter((order) => order.id === id);
    expect(row).toMatchObject({
      status: 'received',
      targetType: 'items',
      targetId: idText(itemId),
      hasDocument: false,
    });
    expect(row?.actionLog).toHaveLength(1);
    const audit = await harness.db().collection('audit_log').findOne({ action: 'legal_order.create', target_id: id });
    expect(audit?.['meta']).toEqual({ target_type: 'items' });

    // A masjid by its follow code (any case, with a dash); unknown targets and a future received time are refused.
    const code = SEED_FOLLOW_CODES.alpha;
    const masjid = await create({
      targetType: 'masjids',
      target: `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase(),
    });
    expect(masjid.status).toBe(201);
    const masjidRow = (await list()).find((order) => order.id === legalOrderCreatedSchema.parse(masjid.body).id);
    expect(masjidRow?.targetId).toBe(idText(seedId('masjid-alpha')));
    expect((await create({ target: 'https://app.example.invalid/p/AAAAAAAAAAAA' })).status).toBe(404);
    expect((await create({ receivedAt: new Date(NOW.getTime() + 10 * 60_000).toISOString() })).status).toBe(400);
  });

  it('the timer is on the dashboard and the SLA job alerts once per threshold until the order is acted on', async () => {
    const { id } = legalOrderCreatedSchema.parse((await create({ targetType: 'other', target: 'Outside link' })).body);
    const dashboard = superDashboardSchema.parse((await asSuper('get', '/dashboard')).body);
    expect(dashboard.sla.some((timer) => timer.kind === 'legal_order' && timer.id === id)).toBe(true);

    const sent: string[] = [];
    const queues = {
      enqueue: (_name: string, _data: unknown, options: { jobId: string }) => {
        sent.push(options.jobId);
        return Promise.resolve();
      },
    } as unknown as JobQueues; // only `enqueue` is used by the job
    const system = asSystem;
    if (!system) throw new Error('no mc_system handle');
    const run = () => processSlaAlerts({ db: system.handle, queues, clock, logger: silentLogger() });
    // Received an hour ago, 3 h clock: 33 % → nothing for this order yet.
    await run();
    expect(sent.filter((job) => job.includes(id))).toEqual([]);
    await shift(id, 30 * 60_000); // 50 % (the session would time out if the clock moved instead)
    await run();
    await run();
    expect(sent.filter((job) => job.includes(id))).toEqual([`alert.sla.legal_order.${id}.50`]);
    // Acted on: the clock stops — no more alerts, not on the dashboard.
    await stepUp(true);
    expect((await asSuper('patch', `/legal-orders/${id}`).send({ status: 'actioned' })).status).toBe(200);
    await shift(id, 3 * HOUR);
    await run();
    expect(sent.filter((job) => job.includes(id))).toHaveLength(1);
    const after = superDashboardSchema.parse((await asSuper('get', '/dashboard')).body);
    expect(after.sla.some((timer) => timer.id === id)).toBe(false);
  });

  it('status flow: notes and action taken are logged; closed is final; a no-op patch is refused', async () => {
    const { id } = legalOrderCreatedSchema.parse((await create()).body);
    await stepUp(true);
    const patch = (body: Record<string, unknown>) => asSuper('patch', `/legal-orders/${id}`).send(body);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ status: 'contested', note: 'Test note' })).status).toBe(200);
    expect((await patch({ actionTaken: 'Test action' })).status).toBe(200);
    expect((await patch({ status: 'closed' })).status).toBe(200);
    expect((await patch({ status: 'actioned' })).status).toBe(409);
    const row = (await list()).find((order) => order.id === id);
    expect(row).toMatchObject({ status: 'closed', actionTaken: 'Test action' });
    expect(row?.actionLog.map((entry) => entry.note)).toEqual([
      'Order recorded',
      'Status: received → contested',
      'Test note',
      'Action taken updated',
      'Status: contested → closed',
    ]);
    // Closed is final for its document too: no upload, nothing left behind in storage (#180 L5).
    const files = stored.size;
    const upload = await asSuper('post', `/legal-orders/${id}/document`).attach('file', PDF, 'late.pdf');
    expect(upload.body).toMatchObject({ status: 404, code: 'LEGAL_ORDER_NOT_FOUND' });
    expect(stored.size).toBe(files);
    await stepUp(false);
    expect((await patch({ note: 'Test' })).status).toBe(403);
  });

  it('★ Remove with a legal order: logged on the order, which becomes actioned; a closed order is refused', async () => {
    const { id } = legalOrderCreatedSchema.parse((await create({ target: seedPublicId('alpha', 3) })).body);
    const itemId: unknown = (
      await harness
        .db()
        .collection('items')
        .findOne({ public_id: seedPublicId('alpha', 3) })
    )?.['_id'];
    if (!isId(itemId)) throw new Error('no seed item');
    await stepUp(true);
    const removed = await asSuper('post', `/items/${idText(itemId)}/remove`).send({
      category: 'legal_order',
      legalOrderId: id,
    });
    expect(removed.status).toBe(200);
    const row = (await list()).find((order) => order.id === id);
    expect(row?.status).toBe('actioned');
    expect(row?.actionLog.at(-1)?.note).toBe(`Post ${seedPublicId('alpha', 3)} removed`);
    const audit = await harness
      .db()
      .collection('audit_log')
      .findOne({ action: 'item.remove', target_id: idText(itemId) });
    expect(audit?.['meta']).toMatchObject({ category: 'legal_order', legal_order: id });

    // A closed order cannot be linked (the removal is refused as a whole).
    await asSuper('patch', `/legal-orders/${id}`).send({ status: 'closed' });
    const other: unknown = (
      await harness
        .db()
        .collection('items')
        .findOne({ public_id: seedPublicId('alpha', 4) })
    )?.['_id'];
    if (!isId(other)) throw new Error('no seed item');
    const refused = await asSuper('post', `/items/${idText(other)}/remove`).send({
      category: 'legal_order',
      legalOrderId: id,
    });
    expect(refused.status).toBe(404);
    expect((await items().findOne({ _id: other }))?.status).toBe('published');
  });

  it('document: ciphertext at rest; ★ download decrypts it; no step-up → 403; wrong types → 415', async () => {
    const { id } = legalOrderCreatedSchema.parse((await create()).body);
    await stepUp(true);
    const upload = await asSuper('post', `/legal-orders/${id}/document`).attach('file', PDF, 'order.pdf');
    expect(upload.status).toBe(201);
    const key = (await orders().findOne({ _id: orderIdOf(id) }))?.document_key;
    expect(typeof key).toBe('string');
    const raw = stored.get(String(key));
    expect(raw?.subarray(0, 4).toString('ascii')).toBe('MCF2');
    expect(raw?.includes(Buffer.from('Test legal order document'))).toBe(false);
    expect(raw?.includes(Buffer.from('%PDF'))).toBe(false);

    const download = await asSuper('get', `/legal-orders/${id}/document`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          done(null, Buffer.concat(chunks));
        });
      });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toMatch(/^application\/pdf/u);
    expect(download.headers['content-disposition']).toBe('attachment; filename="legal-order-TEST-REF-0001.pdf"');
    expect(download.headers['cache-control']).toBe('no-store');
    expect(Buffer.compare(download.body as Buffer, PDF)).toBe(0);
    const read = await harness
      .db()
      .collection('audit_log')
      .findOne({ action: 'legal_order.document_read', target_id: id });
    expect(read).not.toBeNull();

    // Replacing the document deletes the old copy.
    expect((await asSuper('post', `/legal-orders/${id}/document`).attach('file', PDF, 'again.pdf')).status).toBe(201);
    expect(stored.has(String(key))).toBe(false);

    // The ciphertext is bound to its order: the same stored file linked to another order never opens there.
    const { id: otherId } = legalOrderCreatedSchema.parse((await create()).body);
    const current = (await orders().findOne({ _id: orderIdOf(id) }))?.document_key;
    await orders().updateOne({ _id: orderIdOf(otherId) }, { $set: { document_key: String(current) } });
    await stepUp(true);
    expect((await asSuper('get', `/legal-orders/${otherId}/document`)).status).toBe(500);

    expect(
      (await asSuper('post', `/legal-orders/${id}/document`).attach('file', Buffer.from('plain text'), 'a.pdf')).status,
    ).toBe(415);
    await stepUp(false);
    expect((await asSuper('get', `/legal-orders/${id}/document`)).status).toBe(403);
    expect((await asSuper('post', `/legal-orders/${id}/document`).attach('file', PDF, 'order.pdf')).status).toBe(403);
  });
});
