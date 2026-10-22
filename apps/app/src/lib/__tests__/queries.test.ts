import { useMockNetwork as mockNetwork } from '@mc/shared/testing/msw';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../api/client.ts';
import { PERSISTED_ROOTS, queryKeys } from '../api/keys.ts';
import { bundleQuery, feedQuery, pruneStaleVersions, versionsQuery } from '../api/queries.ts';
import { memoryBackend } from '../device/store.ts';
import { createPersister, createQueryClient, shouldPersistQuery } from '../query/persist.ts';

// T2.3: versions poller → targeted invalidation (a new content version re-targets exactly the changed masjids; old
// versions are pruned), and the persisted cache.

const BASE = 'https://app.test/api/v1';
const A = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const B = '1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e';
const server = mockNetwork();
const api = createApiClient({ base: BASE, credentials: () => undefined, backoff: () => Promise.resolve() });
const suspended = (v: number) => HttpResponse.json({ status: 'suspended', v });

describe('versions → versioned bundle/feed queries', () => {
  it('a changed version fetches only that masjid again and prunes its old version', async () => {
    let version = { [A]: 3, [B]: 7 };
    const bundles: string[] = [];
    server.use(
      http.get(`${BASE}/masjids/versions`, () =>
        HttpResponse.json(Object.fromEntries(Object.entries(version).map(([id, v]) => [id, { v, status: 'active' }]))),
      ),
      http.get(`${BASE}/masjids/:id/bundle`, ({ params, request }) => {
        const v = Number(new URL(request.url).searchParams.get('v'));
        bundles.push(`${String(params['id'])}@${String(v)}`);
        return suspended(v);
      }),
      http.get(`${BASE}/masjids/:id/feed`, () => HttpResponse.json({ items: [], next: null })),
    );
    const client = createQueryClient();
    const load = async () => {
      const versions = await client.query(versionsQuery(api, [B, A]));
      pruneStaleVersions(client, versions);
      for (const id of [A, B]) {
        const v = versions[id]?.v ?? 0;
        await client.query(bundleQuery(api, id, v));
        await client.query(feedQuery(api, id, v, 'brothers'));
      }
    };
    await load();
    expect(bundles).toEqual([`${A}@3`, `${B}@7`]);
    // Same versions: nothing refetched (immutable per version).
    await client.invalidateQueries({ queryKey: queryKeys.versions([A, B]) });
    await load();
    expect(bundles).toHaveLength(2);
    // A changes: only A is fetched again, its v3 queries are pruned.
    version = { [A]: 4, [B]: 7 };
    await client.invalidateQueries({ queryKey: queryKeys.versions([A, B]) });
    await load();
    expect(bundles).toEqual([`${A}@3`, `${B}@7`, `${A}@4`]);
    expect(client.getQueryData(queryKeys.bundle(A, 3))).toBeUndefined();
    expect(client.getQueryData(queryKeys.feed(A, 3, 'brothers'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.bundle(A, 4))).toEqual({ status: 'suspended', v: 4 });
    expect(client.getQueryData(queryKeys.bundle(B, 7))).toBeDefined();
  });

  it('versions keys do not depend on the order of ids; polling is disabled without follows', () => {
    expect(queryKeys.versions([A, B])).toEqual(queryKeys.versions([B, A]));
    expect(versionsQuery(api, []).enabled).toBe(false);
    expect(versionsQuery(api, [A]).refetchInterval).toBe(60_000);
    const client = createQueryClient();
    client.setQueryData(['other', A, 1], 'x');
    expect(pruneStaleVersions(client, { [A]: { v: 9, status: 'active' } })).toBe(0);
  });
});

describe('persisted cache (01 §5.6)', () => {
  it('persists only successful queries of the content roots', () => {
    expect(shouldPersistQuery({ queryKey: ['bundle', A, 1], state: { status: 'success' } })).toBe(true);
    expect(shouldPersistQuery({ queryKey: ['bundle', A, 1], state: { status: 'error' } })).toBe(false);
    expect(shouldPersistQuery({ queryKey: ['serverFollows'], state: { status: 'success' } })).toBe(false);
    expect(PERSISTED_ROOTS.has('device')).toBe(false);
  });

  it('writes throttled, restores only well-formed data, removes on demand', async () => {
    vi.useFakeTimers();
    try {
      const backend = memoryBackend();
      const persister = createPersister(backend, 1000);
      const client = { timestamp: 1, buster: 'r1', clientState: { queries: [], mutations: [] } };
      void persister.persistClient(client);
      void persister.persistClient({ ...client, timestamp: 2 });
      expect(await backend.get('queries')).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1000);
      expect(await backend.get('queries')).toMatchObject({ timestamp: 2 });
      expect(await persister.restoreClient()).toMatchObject({ buster: 'r1' });
      await backend.set('queries', { broken: true });
      expect(await persister.restoreClient()).toBeUndefined();
      await persister.removeClient();
      expect(await backend.get('queries')).toBeUndefined();
      const failing = createPersister({
        get: () => Promise.reject(new Error('x')),
        set: () => Promise.reject(new Error('x')),
        del: () => Promise.reject(new Error('x')),
      });
      expect(await failing.restoreClient()).toBeUndefined();
      await failing.removeClient();
    } finally {
      vi.useRealTimers();
    }
  });
});
