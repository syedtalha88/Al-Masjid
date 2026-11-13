// PHASE_08 T8.4 — grievances end to end through both apps: a person files one on api-public (Turnstile, mc_public) and
// gets `GR-<year>-<6 digits>`, sequential; the contact is stored sealed (the database holds ciphertext only —
// acceptance); without a sealing key a contact is refused (503) but the grievance itself is accepted; the Super
// Admin's tracker (C6, mc_admin) lists it without the contact, acknowledges and resolves it; ★ "Show contact" needs a
// step-up, opens it with api-admin's private key and is audited. Fake texts only.
import { generateKeyPairSync } from 'node:crypto';

import { processUserHandle } from '@mc/db/testing';
import { grievanceListSchema, grievanceReceivedSchema } from '@mc/shared/contracts/grievances';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPublicApp } from '../src/app.ts';
import { deviceAuthenticator } from '../src/auth/device.ts';
import { sealKeysFromEnv } from '../src/crypto/seal.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { apiPublicRoutes } from '../src/routes/index.ts';
import { silentLogger } from './helpers.ts';
import { superHarness } from './super-harness.ts';

const NOW = new Date('2026-11-13T06:30:00Z');
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (pem: string | Buffer) => Buffer.from(pem).toString('base64');
const PUBLIC = b64(pair.publicKey.export({ type: 'spki', format: 'pem' }));
const sealKeys = sealKeysFromEnv({
  GRIEVANCE_SEAL_PRIVATE_KEY: b64(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })),
  GRIEVANCE_SEAL_KEY_ID: 'g1',
});
const CONTACT = 'test-person@example.invalid';

const harness = superHarness('grievance-routes', NOW, { sealKeys });
const { asSuper, stepUp, clock } = harness;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const publicApp = (seal: boolean) => {
  if (!asPublic) throw new Error('no mc_public handle');
  const db = asPublic.handle;
  return createPublicApp({
    logger: silentLogger(),
    release: 't',
    trustedProxyMode: 'none',
    clock,
    rateLimiter: memoryRateLimiter(),
    authenticateDevice: deviceAuthenticator({ db, clock }),
    routes: apiPublicRoutes({
      db,
      turnstile: (token) => Promise.resolve(token === 'turnstile-ok'),
      ...(seal ? { grievanceSeal: { publicKey: PUBLIC, keyId: 'g1' } } : {}),
    }),
  }).app;
};
const file = (body: Record<string, unknown>, seal = true) =>
  request(publicApp(seal))
    .post('/api/v1/grievances')
    .send({ category: 'privacy', description: 'Test grievance text', turnstileToken: 'turnstile-ok', ...body });

beforeAll(async () => {
  asPublic = await processUserHandle(harness.testDatabase(), 'mc_public');
});
afterAll(async () => {
  await asPublic?.dispose();
});

describe('grievances (T8.4)', () => {
  it('filing: sequential references per year; the contact is stored sealed, never in plain text', async () => {
    const first = await file({ contact: CONTACT });
    expect(first.status).toBe(201);
    const { publicRef } = grievanceReceivedSchema.parse(first.body);
    expect(publicRef).toBe('GR-2026-000001');
    const second = grievanceReceivedSchema.parse((await file({})).body);
    expect(second.publicRef).toBe('GR-2026-000002');
    const stored = await harness.db().collection('grievances').findOne({ public_ref: publicRef });
    expect(stored).toMatchObject({
      status: 'open',
      category: 'privacy',
      ack_due_at: new Date(NOW.getTime() + 24 * 3_600_000),
      resolve_due_at: new Date(NOW.getTime() + 72 * 3_600_000),
    });
    expect(String(stored?.['contact_enc'])).toMatch(/^s1:g1:/u);
    expect(JSON.stringify(stored)).not.toContain('example.invalid');
  });

  it('refuses: failed Turnstile 403, bad body 400; a contact without a sealing key 503 (no contact stored)', async () => {
    expect((await file({ turnstileToken: 'nope' })).status).toBe(403);
    expect((await file({ category: 'gossip' })).status).toBe(400);
    expect((await file({ description: '' })).status).toBe(400);
    expect((await file({ description: 'x'.repeat(2001) })).status).toBe(400);
    expect((await file({ contact: 'a‮b' })).status).toBe(400);
    const unsealed = await file({ contact: CONTACT }, false);
    expect(unsealed.status).toBe(503);
    expect(unsealed.body).toMatchObject({ code: 'GRIEVANCE_CONTACT_UNAVAILABLE' });
    expect(await harness.db().collection('grievances').countDocuments({})).toBe(2);
  });

  it('C6: listed without the contact; acknowledge, then resolve; ★ Show contact with step-up, audited', async () => {
    const list = grievanceListSchema.parse((await asSuper('get', '/grievances')).body);
    const row = list.grievances.find((entry) => entry.publicRef === 'GR-2026-000001');
    expect(row).toMatchObject({ status: 'open', hasContact: true });
    expect(JSON.stringify(list)).not.toContain('s1:');
    const id = row?.id ?? '';

    await stepUp(false);
    expect((await asSuper('get', `/grievances/${id}/contact`)).status).toBe(403);
    await stepUp(true);
    const contact = await asSuper('get', `/grievances/${id}/contact`);
    expect(contact.status).toBe(200);
    expect(contact.body).toEqual({ contact: CONTACT });
    expect(await harness.db().collection('audit_log').countDocuments({ action: 'grievance.contact' })).toBe(1);

    expect((await asSuper('post', `/grievances/${id}/ack`).send({})).status).toBe(200);
    expect((await asSuper('post', `/grievances/${id}/ack`).send({})).status).toBe(404);
    const resolved = await asSuper('post', `/grievances/${id}/resolve`).send({
      status: 'resolved',
      resolution: 'Placeholder resolution note',
    });
    expect(resolved.status).toBe(200);
    expect(await harness.db().collection('grievances').findOne({ public_ref: 'GR-2026-000001' })).toMatchObject({
      status: 'resolved',
      resolution: 'Placeholder resolution note',
    });
    // No contact left: null, not an error.
    const other = list.grievances.find((entry) => entry.publicRef === 'GR-2026-000002')?.id ?? '';
    expect((await asSuper('get', `/grievances/${other}/contact`)).body).toEqual({ contact: null });
  });
});
