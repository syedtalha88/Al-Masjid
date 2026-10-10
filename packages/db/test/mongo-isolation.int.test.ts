import { describe, expect, it } from 'vitest';

import { createTestDatabase } from '../src/testing/mongo.ts';
import { useTestDatabase } from '../src/testing/vitest.ts';

// T0.12: every integration test file gets its own MongoDB database on the Docker replica set, so files
// run in parallel without seeing each other's data, and nothing is left behind.
const database = useTestDatabase(import.meta.url);

describe('per-file test databases', () => {
  it('reads and writes in its own database on the replica set', async () => {
    const { db, name } = database();
    await db.collection('things').insertOne({ value: 1 });
    expect(await db.collection('things').countDocuments()).toBe(1);
    const hello = await db.admin().command({ hello: 1 });
    expect(hello['setName']).toBeTruthy(); // transactions need a replica set
    expect(name).toMatch(/^test_/);
  });

  it('another database never sees this file’s data, and dispose drops it', async () => {
    const other = await createTestDatabase('other');
    try {
      expect(await other.db.collection('things').countDocuments()).toBe(0);
      await other.db.collection('things').insertOne({ value: 2 });
    } finally {
      await other.dispose();
    }
    const names = (await database().client.db().admin().listDatabases({ nameOnly: true })).databases.map(
      (entry) => entry.name,
    );
    expect(names).not.toContain(other.name);
    expect(await database().db.collection('things').countDocuments()).toBe(1);
  });
});
