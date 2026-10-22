// PHASE_02 T2.2 / 01 §8: the hot public queries — feed pages (plain, by type, by audience, next page), bundle parts,
// versions and resolve — run THROUGH THE VIEWS as mc_public on 100k items and must use an index: `IXSCAN`, no
// `COLLSCAN`, documents examined ≤ 2 × returned (`explain('executionStats')`). The order is the views' own (migration
// 0008): callers never pass a sort.
import { Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';

type Raw = { _id: UUID } & Record<string, unknown>;

const ITEMS = 100_000;
const MASJIDS = 20;
const TYPES = ['announcement', 'daily_content', 'dua_request', 'timing_update'] as const;
const AUDIENCES = ['everyone', 'everyone', 'everyone', 'brothers', 'sisters'] as const;

let test: TestDatabase | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const masjidIds = Array.from({ length: MASJIDS }, () => new UUID());
const target = masjidIds[0] ?? new UUID();

interface Plan {
  readonly stages: Set<string>;
  readonly examined: number;
  readonly returned: number;
}

/** Stage names and counters of a find/aggregate explain on a view (the plan sits under `$cursor` or `stages`). */
function readPlan(explain: Record<string, unknown>, returned: number): Plan {
  const stages = new Set<string>();
  let examined = 0;
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const inner of value) walk(inner);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const node = value as Record<string, unknown>; // explain output is plain nested JSON
    if (typeof node['stage'] === 'string') stages.add(node['stage']);
    if (typeof node['totalDocsExamined'] === 'number') examined = Math.max(examined, node['totalDocsExamined']);
    for (const inner of Object.values(node)) walk(inner);
  };
  walk(explain);
  return { stages, examined, returned };
}

async function explainFind(
  view: string,
  filter: Record<string, unknown>,
  options: { sort?: Record<string, 1 | -1>; limit?: number } = {},
): Promise<Plan> {
  if (!asPublic) throw new Error('no mc_public handle');
  const db = await asPublic.handle.db();
  const cursor = () => {
    const found = db.collection(view).find(filter);
    if (options.sort) found.sort(options.sort);
    if (options.limit) found.limit(options.limit);
    return found;
  };
  const returned = (await cursor().toArray()).length;
  return readPlan(await cursor().explain('executionStats'), returned);
}

const expectIndexed = (plan: Plan, label: string) => {
  expect([...plan.stages], label).toContain('IXSCAN');
  expect([...plan.stages], label).not.toContain('COLLSCAN');
  expect(plan.returned, label).toBeGreaterThan(0);
  expect(plan.examined, `${label}: examined ${String(plan.examined)} for ${String(plan.returned)}`).toBeLessThanOrEqual(
    2 * plan.returned,
  );
};

beforeAll(async () => {
  test = await createTestDatabase('perf');
  await runMigrations(t().db, MIGRATIONS);
  asPublic = await processUserHandle(t(), 'mc_public');
  const now = Date.now();
  await t()
    .db.collection<Raw>('masjids')
    .insertMany(
      masjidIds.map((id, index) => ({
        _id: id,
        follow_code: `PERF${String(index).padStart(4, '0')}`,
        name: `Perf Masjid ${String(index)}`,
        status: index === 1 ? 'suspended' : 'active',
        content_version: Long.fromNumber(index + 1),
      })),
      { bypassDocumentValidation: true },
    );
  await t()
    .db.collection<Raw>('masjid_timings')
    .insertMany(
      masjidIds.map((id) => ({ _id: id, prayers: {}, jumuah: [], masjid_visible: true })),
      { bypassDocumentValidation: true },
    );
  await t()
    .db.collection<Raw>('special_timings')
    .insertMany(
      masjidIds.flatMap((id) =>
        Array.from({ length: 30 }, (_, day) => ({
          _id: new UUID(),
          masjid_id: id,
          type: 'other',
          date: `2026-${String(9 + Math.floor(day / 28)).padStart(2, '0')}-${String((day % 28) + 1).padStart(2, '0')}`,
          times: [{ time: '07:00' }],
          masjid_visible: true,
        })),
      ),
      { bypassDocumentValidation: true },
    );
  const batch = 10_000;
  for (let start = 0; start < ITEMS; start += batch) {
    await t()
      .db.collection<Raw>('items')
      .insertMany(
        Array.from({ length: batch }, (_, offset) => {
          const index = start + offset;
          return {
            _id: new UUID(),
            public_id: `perf${String(index).padStart(8, '0')}`,
            // A third of all items belong to the masjid under test; the rest spread over the others.
            masjid_id: index % 3 === 0 ? target : (masjidIds[1 + (index % (MASJIDS - 1))] ?? target),
            type: TYPES[index % TYPES.length],
            audience: AUDIENCES[index % AUDIENCES.length],
            status: index % 50 === 0 ? 'deleted' : 'published',
            masjid_visible: true,
            published_at: new Date(now - index * 60_000),
          };
        }),
        { bypassDocumentValidation: true },
      );
  }
}, 120_000);

afterAll(async () => {
  await asPublic?.dispose();
  await test?.dispose();
});

describe('hot public queries through the views use an index (100k items)', () => {
  it('feed page (everyone + one audience)', async () => {
    const plan = await explainFind(
      'v_pub_items',
      { masjid_id: target, audience: { $in: ['everyone', 'brothers'] } },
      { limit: 31 },
    );
    expectIndexed(plan, 'feed');
    expect(plan.returned).toBe(31);
  });

  it('feed page filtered by type', async () => {
    const plan = await explainFind(
      'v_pub_items',
      { masjid_id: target, type: 'dua_request', audience: { $in: ['everyone', 'sisters'] } },
      { limit: 31 },
    );
    expectIndexed(plan, 'feed by type');
  });

  it('next feed page (keyset cursor)', async () => {
    const [first] =
      (await (
        await asPublic?.handle.db()
      )
        ?.collection('v_pub_items')
        .find({ masjid_id: target, audience: { $in: ['everyone', 'brothers'] } })
        .skip(500)
        .limit(1)
        .toArray()) ?? [];
    const at: unknown = first?.['published_at'];
    const id: unknown = first?.['_id'];
    if (!(at instanceof Date) || !(id instanceof UUID)) throw new Error('no cursor item');
    const plan = await explainFind(
      'v_pub_items',
      {
        masjid_id: target,
        audience: { $in: ['everyone', 'brothers'] },
        published_at: { $lte: at },
        $or: [{ published_at: { $lt: at } }, { _id: { $lt: id } }],
      },
      { limit: 31 },
    );
    expectIndexed(plan, 'feed next page');
  });

  it('item by public id, versions, resolve, bundle parts', async () => {
    expectIndexed(await explainFind('v_pub_items', { public_id: 'perf00000003' }), 'item');
    expectIndexed(await explainFind('v_pub_masjid_status', { _id: { $in: masjidIds } }), 'versions');
    expectIndexed(await explainFind('v_pub_masjids', { follow_code: 'PERF0005' }), 'resolve');
    expectIndexed(await explainFind('v_pub_masjids', { _id: target }), 'bundle masjid');
    expectIndexed(await explainFind('v_pub_timings', { _id: target }), 'bundle timings');
    expectIndexed(
      await explainFind('v_pub_special_timings', { masjid_id: target, date: { $gte: '2026-10-01' } }),
      'bundle special dates',
    );
  });
});
