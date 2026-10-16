import { randomBytes } from 'node:crypto';

import { createDbHandle, type DbHandle, publicScope } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { readInvite } from '@mc/db/state';
import { createTestDatabase, type TestDatabase, testMongoUri } from '@mc/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashToken } from '../src/crypto/field.ts';
import { bootstrapSuperAdminInvite, parseBootstrapArgs } from '../src/jobs/bootstrap-super-admin.ts';

// PHASE_01 T1.9: CLI arguments, and the printed link — token only in the fragment, hashed with the pepper exactly as
// api-admin hashes it when the link is opened.
let test: TestDatabase | undefined;
let handle: DbHandle | undefined;

beforeAll(async () => {
  test = await createTestDatabase('bootstrap_api');
  await runMigrations(test.db, MIGRATIONS);
  handle = createDbHandle({ uri: testMongoUri(), database: test.name, process: 'script', local: true });
});

afterAll(async () => {
  await handle?.close();
  await test?.dispose();
});

describe('parseBootstrapArgs', () => {
  it('reads --name, --locale and --force-additional; rejects everything else', () => {
    expect(parseBootstrapArgs(['--name', ' Test Owner '])).toEqual({
      displayName: 'Test Owner',
      uiLocale: 'en',
      force: false,
    });
    expect(parseBootstrapArgs(['--name', 'A', '--locale', 'ur', '--force-additional'])).toEqual({
      displayName: 'A',
      uiLocale: 'ur',
      force: true,
    });
    expect(parseBootstrapArgs([])).toEqual({ error: '--name is required' });
    expect(parseBootstrapArgs(['--name'])).toEqual({ error: '--name is required' });
    expect(parseBootstrapArgs(['--name', 'x'.repeat(81)])).toEqual({ error: '--name is longer than 80 characters' });
    expect(parseBootstrapArgs(['--name', 'A', '--locale', 'fr'])).toEqual({ error: 'bad --locale' });
    expect(parseBootstrapArgs(['--name', 'A', '--yes'])).toEqual({ error: 'unknown argument --yes' });
  });
});

describe('bootstrapSuperAdminInvite', () => {
  it('prints <ADMIN_ORIGIN>/invite#<token>; the stored hash is SHA-256(token‖pepper)', async () => {
    if (!handle) throw new Error('no handle');
    const pepper = randomBytes(32);
    const { inviteUrl } = await bootstrapSuperAdminInvite(handle, {
      displayName: 'Test Owner',
      uiLocale: 'en',
      force: false,
      adminOrigin: 'https://admin.test',
      pepper,
    });
    const url = new URL(inviteUrl);
    expect(`${url.origin}${url.pathname}${url.search}`).toBe('https://admin.test/invite');
    const token = url.hash.slice(1);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await readInvite(handle, publicScope(), { tokenHash: hashToken(token, pepper) })).toMatchObject({
      adminDisplayName: 'Test Owner',
      purpose: 'register',
    });
    expect(await readInvite(handle, publicScope(), { tokenHash: hashToken(token, randomBytes(32)) })).toBeNull();
  });
});
