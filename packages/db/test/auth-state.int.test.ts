// PHASE_01 T1.8 data layer against a migrated MongoDB: invites read without consuming, registration as one transaction
// (invite + credential + session + audit), uniform invite failures, the 04 §3 sign-counter rule (regression revokes the
// credential and every session), step-up rotation, 04 §4 session lifetimes with a controlled clock, last-seen throttling
// and revocation.
import { randomBytes } from 'node:crypto';

import { Binary, Long, type UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import { createDbHandle, type DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { applyLocalRoles, dropLocalRoles } from '../src/roles-local.ts';
import { adminScope, publicScope, superScope, systemScope } from '../src/scope.ts';
import {
  addAdminToMasjid,
  completeAssertion,
  counterAdvances,
  createAddDeviceInvite,
  createAdmin,
  createInvite,
  createMasjid,
  credentialLabel,
  findLoginCredential,
  INVITE_TTL_MS,
  type InvitePurpose,
  LAST_SEEN_THROTTLE_MS,
  listPasskeys,
  listSessions,
  type NewCredential,
  readInvite,
  recordLoginFailure,
  registerCredential,
  renamePasskey,
  resolveSession,
  revokeSessions,
  SESSION_LIFETIMES,
} from '../src/state/index.ts';
import { createTestDatabase, type TestDatabase, testMongoUri } from '../src/testing/index.ts';
import { newId } from '../src/values.ts';

let test: TestDatabase | undefined;
let handle: DbHandle | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const h = () => {
  if (!handle) throw new Error('no handle');
  return handle;
};
type Raw = { _id: UUID } & Record<string, unknown>;
const raw = (name: string) => t().db.collection<Raw>(name);

const superNow = (adminId: UUID) => superScope(adminId, new Date());
let superId: UUID;

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    throw error;
  }
};

const credential = (overrides: Partial<NewCredential> = {}): NewCredential => ({
  id: randomBytes(32),
  publicKey: randomBytes(77),
  counter: 0,
  transports: ['internal', 'hybrid'],
  backedUp: true,
  deviceType: 'multiDevice',
  label: 'Test phone',
  ...overrides,
});

/** An invited admin of a new masjid, with an open invite. */
async function invitedAdmin(purpose: InvitePurpose = 'register', now = new Date()) {
  const adminId = await createAdmin(h(), superNow(superId), { displayName: 'Test Admin', uiLocale: 'te' });
  const { id: masjidId } = await createMasjid(h(), superNow(superId), {
    name: 'Test Masjid Beta',
    area: 'Test Area',
    city: 'Hyderabad',
    state: 'Telangana',
    address: 'Test address',
    lat: 17.4,
    lng: 78.5,
  });
  await addAdminToMasjid(h(), superNow(superId), { masjidId, adminId, role: 'owner' });
  const inviteHash = randomBytes(32);
  await createInvite(h(), superScope(superId, now), { adminId, purpose, tokenHash: inviteHash, now });
  return { adminId, masjidId, inviteHash };
}

/** A registered admin: invite consumed, one credential, one session. */
async function registeredAdmin() {
  const invited = await invitedAdmin();
  const cred = credential();
  const sessionHash = randomBytes(32);
  const result = await registerCredential(h(), publicScope(), {
    inviteTokenHash: invited.inviteHash,
    credential: cred,
    sessionTokenHash: sessionHash,
    uaSummary: 'Chrome on Android',
  });
  const found = await findLoginCredential(h(), publicScope(), cred.id);
  if (!found) throw new Error('credential not found');
  return { ...invited, ...result, cred, sessionHash, credentialDocId: found.credentialDocId };
}

beforeAll(async () => {
  test = await createTestDatabase('auth_state');
  await runMigrations(t().db, MIGRATIONS);
  handle = createDbHandle({ uri: testMongoUri(), database: t().name, process: 'script', local: true });
  // A Super Admin document (bootstrap is T1.9); the super scope only needs its id.
  superId = (
    await raw('admin_users').insertOne({
      _id: newId(),
      display_name: 'Test Super',
      role: 'super_admin',
      status: 'active',
      ui_locale: 'en',
      user_handle: new Binary(randomBytes(32)),
      undertaking_history: [],
      created_at: new Date(),
      updated_at: new Date(),
    })
  ).insertedId;
});

afterAll(async () => {
  await handle?.close();
  await test?.dispose();
});

describe('invites', () => {
  it('readInvite shows the invite without consuming it; every invalid invite reads as null', async () => {
    const { adminId, inviteHash } = await invitedAdmin();
    const view = await readInvite(h(), publicScope(), { tokenHash: inviteHash });
    expect(view).toMatchObject({
      adminId,
      purpose: 'register',
      adminDisplayName: 'Test Admin',
      uiLocale: 'te',
      masjidNames: ['Test Masjid Beta'],
      existingCredentials: [],
    });
    expect(view?.userHandle).toHaveLength(32);
    expect(await readInvite(h(), publicScope(), { tokenHash: inviteHash })).not.toBeNull(); // still open
    expect(await readInvite(h(), publicScope(), { tokenHash: randomBytes(32) })).toBeNull();
    const later = new Date(Date.now() + INVITE_TTL_MS + 1000);
    expect(await readInvite(h(), publicScope(), { tokenHash: inviteHash, now: later })).toBeNull();
    await raw('admin_users').updateOne({ _id: adminId }, { $set: { status: 'disabled' } });
    expect(await readInvite(h(), publicScope(), { tokenHash: inviteHash })).toBeNull();
    expect(await code(readInvite(h(), adminScope({ adminId, masjids: [] }), { tokenHash: inviteHash }))).toBe(
      'FORBIDDEN',
    );
  });
});

describe('registration (one transaction)', () => {
  it('consumes the invite, stores the credential, activates the admin, opens a session, audits', async () => {
    const r = await registeredAdmin();
    expect(r.role).toBe('masjid_admin');
    expect(await raw('admin_users').findOne({ _id: r.adminId })).toMatchObject({ status: 'active' });
    expect(await raw('admin_invites').findOne({ admin_id: r.adminId })).toMatchObject({ open: false });
    const stored = await raw('webauthn_credentials').findOne({ admin_id: r.adminId }, { promoteLongs: false });
    expect(stored?.['sign_count']).toBeInstanceOf(Long);
    expect(Buffer.from((stored?.['credential_id'] as Binary).buffer).equals(Buffer.from(r.cred.id))).toBe(true);
    const session = await raw('admin_sessions').findOne({ _id: r.sessionId });
    expect(session).toMatchObject({ admin_id: r.adminId, ua_summary: 'Chrome on Android' });
    const life = SESSION_LIFETIMES.masjid_admin;
    const created = (session?.['created_at'] as Date).getTime();
    expect((session?.['idle_expires_at'] as Date).getTime() - created).toBe(life.idleMs);
    expect((session?.['absolute_expires_at'] as Date).getTime() - created).toBe(life.absoluteMs);
    const audit = await raw('audit_log')
      .find({ target_id: r.adminId.toHexString(), action: { $in: ['auth.register', 'invite.consume'] } })
      .toArray();
    expect(audit.map((a) => a['action']).sort()).toEqual(['auth.register', 'invite.consume']);
    expect(audit.find((a) => a['action'] === 'auth.register')).toMatchObject({
      actor_type: 'admin',
      actor_id: r.adminId,
      meta: { credential: credentialLabel(r.cred.id) },
    });
  });

  it('a used invite fails uniformly; concurrent registrations with one invite: exactly one wins', async () => {
    const { inviteHash } = await invitedAdmin();
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        code(
          registerCredential(h(), publicScope(), {
            inviteTokenHash: inviteHash,
            credential: credential(),
            sessionTokenHash: randomBytes(32),
          }),
        ),
      ),
    );
    expect(attempts.filter((a) => a === 'ok')).toHaveLength(1);
    expect(attempts.filter((a) => a === 'INVITE_INVALID')).toHaveLength(3);
  });

  it('expired invite → INVITE_INVALID; a duplicate credential id rolls everything back', async () => {
    const past = new Date(Date.now() - INVITE_TTL_MS - 60_000);
    const expired = await invitedAdmin('register', past);
    expect(
      await code(
        registerCredential(h(), publicScope(), {
          inviteTokenHash: expired.inviteHash,
          credential: credential(),
          sessionTokenHash: randomBytes(32),
        }),
      ),
    ).toBe('INVITE_INVALID');

    const existing = await registeredAdmin();
    const other = await invitedAdmin();
    expect(
      await code(
        registerCredential(h(), publicScope(), {
          inviteTokenHash: other.inviteHash,
          credential: credential({ id: existing.cred.id }),
          sessionTokenHash: randomBytes(32),
        }),
      ),
    ).toBe('CREDENTIAL_EXISTS');
    expect(await raw('admin_invites').findOne({ admin_id: other.adminId })).toMatchObject({ open: true });
    expect(await raw('admin_sessions').countDocuments({ admin_id: other.adminId })).toBe(0);
    expect(await raw('admin_users').findOne({ _id: other.adminId })).toMatchObject({ status: 'invited' });
  });

  it('add_device adds a second passkey (excluded on the next registration); recovery revokes old sessions', async () => {
    const r = await registeredAdmin();
    const addHash = randomBytes(32);
    await createInvite(h(), superNow(superId), { adminId: r.adminId, purpose: 'add_device', tokenHash: addHash });
    const view = await readInvite(h(), publicScope(), { tokenHash: addHash });
    expect(view?.existingCredentials.map((c) => Buffer.from(c.id).toString('hex'))).toEqual([
      Buffer.from(r.cred.id).toString('hex'),
    ]);
    await registerCredential(h(), publicScope(), {
      inviteTokenHash: addHash,
      credential: credential(),
      sessionTokenHash: randomBytes(32),
    });
    expect(await raw('webauthn_credentials').countDocuments({ admin_id: r.adminId })).toBe(2);
    expect(await raw('admin_sessions').countDocuments({ admin_id: r.adminId, revoked_at: { $exists: false } })).toBe(2);

    const recoveryHash = randomBytes(32);
    await createInvite(h(), superNow(superId), { adminId: r.adminId, purpose: 'recovery', tokenHash: recoveryHash });
    const recovered = await registerCredential(h(), publicScope(), {
      inviteTokenHash: recoveryHash,
      credential: credential(),
      sessionTokenHash: randomBytes(32),
    });
    const live = await raw('admin_sessions')
      .find({ admin_id: r.adminId, revoked_at: { $exists: false } })
      .toArray();
    expect(live.map((s) => s._id.toHexString())).toEqual([recovered.sessionId.toHexString()]);
  });
});

describe('login and the sign counter (04 §3)', () => {
  it('counterAdvances: 0 always accepted, otherwise strictly increasing', () => {
    expect(counterAdvances(0, 0)).toBe(true);
    expect(counterAdvances(0, 5)).toBe(true);
    expect(counterAdvances(5, 6)).toBe(true);
    expect(counterAdvances(5, 5)).toBe(false);
    expect(counterAdvances(5, 2)).toBe(false);
  });

  it('login opens a new session and stores the counter; counter 0 (synced passkey) logs in repeatedly', async () => {
    const r = await registeredAdmin();
    for (let i = 0; i < 2; i += 1) {
      const login = await completeAssertion(h(), publicScope(), {
        credentialDocId: r.credentialDocId,
        newCounter: 0,
        sessionTokenHash: randomBytes(32),
      });
      expect(login.adminId.equals(r.adminId)).toBe(true);
    }
    expect(await raw('admin_sessions').countDocuments({ admin_id: r.adminId })).toBe(3);
    await completeAssertion(h(), publicScope(), {
      credentialDocId: r.credentialDocId,
      newCounter: 7,
      sessionTokenHash: randomBytes(32),
    });
    const found = await findLoginCredential(h(), publicScope(), r.cred.id);
    expect(found?.counter).toBe(7);
    expect(await raw('audit_log').countDocuments({ action: 'auth.login', actor_id: r.adminId })).toBe(3);
    // The owner's user handle, for the discoverable-login userHandle check (WebAuthn §7.2 step 6).
    const owner = await raw('admin_users').findOne({ _id: r.adminId });
    const handleBytes: unknown = owner?.['user_handle'];
    expect(handleBytes).toBeInstanceOf(Binary);
    expect(Buffer.from(found?.userHandle ?? []).equals(Buffer.from((handleBytes as Binary).buffer))).toBe(true); // checked above
  });

  it('a counter going backwards revokes the credential and all sessions, audits, and refuses', async () => {
    const r = await registeredAdmin();
    await completeAssertion(h(), publicScope(), {
      credentialDocId: r.credentialDocId,
      newCounter: 10,
      sessionTokenHash: randomBytes(32),
    });
    expect(
      await code(
        completeAssertion(h(), publicScope(), {
          credentialDocId: r.credentialDocId,
          newCounter: 10,
          sessionTokenHash: randomBytes(32),
        }),
      ),
    ).toBe('COUNTER_REGRESSION');
    expect(await raw('webauthn_credentials').findOne({ _id: r.credentialDocId })).toMatchObject({
      revoked_at: expect.any(Date) as unknown,
    });
    expect(await raw('admin_sessions').countDocuments({ admin_id: r.adminId, revoked_at: { $exists: false } })).toBe(0);
    expect(
      await raw('audit_log').findOne({ action: 'credential.revoke', target_id: r.adminId.toHexString() }),
    ).toMatchObject({ actor_type: 'system', meta: { reason: 'counter_regression' } });
    expect(await findLoginCredential(h(), publicScope(), r.cred.id)).toBeNull();
    expect(await resolveSession(h(), publicScope(), { tokenHash: r.sessionHash })).toBeNull();
  });

  it('disabled admins cannot log in; failures are audited by credential hash only', async () => {
    const r = await registeredAdmin();
    await raw('admin_users').updateOne({ _id: r.adminId }, { $set: { status: 'disabled' } });
    expect(await findLoginCredential(h(), publicScope(), r.cred.id)).toBeNull();
    expect(
      await code(
        completeAssertion(h(), publicScope(), {
          credentialDocId: r.credentialDocId,
          newCounter: 1,
          sessionTokenHash: randomBytes(32),
        }),
      ),
    ).toBe('CREDENTIAL_REVOKED');
    await recordLoginFailure(h(), publicScope(), { credentialId: r.cred.id, requestId: 'req-1' });
    const failure = await raw('audit_log').findOne({ action: 'auth.login_failed', request_id: 'req-1' });
    expect(failure).toMatchObject({ actor_type: 'system', meta: { credential_hash: credentialLabel(r.cred.id) } });
    expect(failure).not.toHaveProperty('actor_id');
    expect(failure).not.toHaveProperty('target_id');
  });
});

describe('sessions (04 §4)', () => {
  it('step-up rotates the token and sets step_up_at; only on the credential owner’s live session', async () => {
    const r = await registeredAdmin();
    const rotatedHash = randomBytes(32);
    const now = new Date();
    const stepped = await completeAssertion(h(), publicScope(), {
      credentialDocId: r.credentialDocId,
      newCounter: 0,
      sessionTokenHash: rotatedHash,
      stepUpSessionId: r.sessionId,
      now,
    });
    expect(stepped.sessionId.equals(r.sessionId)).toBe(true);
    expect(await resolveSession(h(), publicScope(), { tokenHash: r.sessionHash })).toBeNull(); // old token dead
    expect(await resolveSession(h(), publicScope(), { tokenHash: rotatedHash })).toMatchObject({ stepUpAt: now });
    const other = await registeredAdmin();
    expect(
      await code(
        completeAssertion(h(), publicScope(), {
          credentialDocId: r.credentialDocId,
          newCounter: 0,
          sessionTokenHash: randomBytes(32),
          stepUpSessionId: other.sessionId,
        }),
      ),
    ).toBe('SESSION_INVALID');
  });

  it('idle and absolute expiry with a controlled clock; last_seen written at most every 5 minutes', async () => {
    const r = await registeredAdmin();
    const start = (await raw('admin_sessions').findOne({ _id: r.sessionId }))?.['created_at'] as Date;
    const at = (ms: number) => new Date(start.getTime() + ms);
    const life = SESSION_LIFETIMES.masjid_admin;
    const seen = async () => (await raw('admin_sessions').findOne({ _id: r.sessionId }))?.['last_seen_at'] as Date;

    expect(await resolveSession(h(), publicScope(), { tokenHash: r.sessionHash, now: at(60_000) })).toMatchObject({
      adminId: r.adminId,
      role: 'masjid_admin',
      masjids: [{ id: r.masjidId, role: 'owner' }],
      undertakingCurrent: false,
    });
    expect((await seen()).getTime()).toBe(start.getTime()); // < 5 min: not written
    await resolveSession(h(), publicScope(), { tokenHash: r.sessionHash, now: at(LAST_SEEN_THROTTLE_MS) });
    expect((await seen()).getTime()).toBe(at(LAST_SEEN_THROTTLE_MS).getTime());
    // Idle: 7 days after the last write → gone.
    expect(
      await resolveSession(h(), publicScope(), {
        tokenHash: r.sessionHash,
        now: at(LAST_SEEN_THROTTLE_MS + life.idleMs),
      }),
    ).toBeNull();

    // Absolute: kept alive every 6 days, still dies at 30 days.
    const s = await registeredAdmin();
    const s0 = (await raw('admin_sessions').findOne({ _id: s.sessionId }))?.['created_at'] as Date;
    for (let day = 6; day < 30; day += 6) {
      const now = new Date(s0.getTime() + day * 86_400_000);
      expect(await resolveSession(h(), publicScope(), { tokenHash: s.sessionHash, now })).not.toBeNull();
    }
    expect(
      await resolveSession(h(), publicScope(), {
        tokenHash: s.sessionHash,
        now: new Date(s0.getTime() + life.absoluteMs),
      }),
    ).toBeNull();
  });

  it('super admin sessions: idle 30 min, absolute 12 h', async () => {
    const r = await registeredAdmin();
    await raw('admin_users').updateOne({ _id: r.adminId }, { $set: { role: 'super_admin' } });
    const login = await completeAssertion(h(), publicScope(), {
      credentialDocId: r.credentialDocId,
      newCounter: 0,
      sessionTokenHash: randomBytes(32),
    });
    const session = await raw('admin_sessions').findOne({ _id: login.sessionId });
    const created = (session?.['created_at'] as Date).getTime();
    expect((session?.['idle_expires_at'] as Date).getTime() - created).toBe(30 * 60_000);
    expect((session?.['absolute_expires_at'] as Date).getTime() - created).toBe(12 * 3_600_000);
  });

  it('revocation: own sessions only (other ids revoke nothing), logout audited, list never shows token hashes', async () => {
    const r = await registeredAdmin();
    const second = await completeAssertion(h(), publicScope(), {
      credentialDocId: r.credentialDocId,
      newCounter: 0,
      sessionTokenHash: randomBytes(32),
    });
    const me = adminScope({ adminId: r.adminId, masjids: [{ id: r.masjidId, role: 'owner' }] });
    const listed = await listSessions(h(), me);
    expect(listed).toHaveLength(2);
    expect(JSON.stringify(listed)).not.toContain('token');
    const stranger = await registeredAdmin();
    expect(await revokeSessions(h(), me, { sessionId: stranger.sessionId, reason: 'revoked_by_admin' })).toBe(0);
    expect(await resolveSession(h(), publicScope(), { tokenHash: stranger.sessionHash })).not.toBeNull();
    expect(await revokeSessions(h(), me, { sessionId: second.sessionId, reason: 'revoked_by_admin' })).toBe(1);
    expect(await revokeSessions(h(), me, { sessionId: r.sessionId, reason: 'logout' })).toBe(1);
    expect(await resolveSession(h(), publicScope(), { tokenHash: r.sessionHash })).toBeNull();
    expect(await raw('audit_log').countDocuments({ action: 'auth.logout', actor_id: r.adminId })).toBe(1);
    expect(await code(revokeSessions(h(), publicScope(), { reason: 'logout' }))).toBe('FORBIDDEN');
    expect(await code(listSessions(h(), systemScope()))).toBe('FORBIDDEN');
  });
});

describe('own passkeys and "Add another device" (B13)', () => {
  it('lists only own unrevoked passkeys without key material; renames own only; self add_device invite', async () => {
    const r = await registeredAdmin();
    const me = adminScope({ adminId: r.adminId, masjids: [] });
    const passkeys = await listPasskeys(h(), me);
    expect(passkeys).toEqual([
      expect.objectContaining({
        id: r.credentialDocId,
        label: 'Test phone',
        deviceType: 'multiDevice',
        backedUp: true,
      }),
    ]);
    expect(JSON.stringify(passkeys)).not.toMatch(/public_key|credential_id/);
    expect(await renamePasskey(h(), me, { passkeyId: r.credentialDocId, label: 'Redmi 12' })).toBe(true);
    const other = await registeredAdmin();
    expect(await renamePasskey(h(), me, { passkeyId: other.credentialDocId, label: 'mine now' })).toBe(false);
    expect((await listPasskeys(h(), adminScope({ adminId: other.adminId, masjids: [] })))[0]?.label).toBe('Test phone');

    const first = randomBytes(32);
    const second = randomBytes(32);
    // A new passkey outlives session revocation: only right after a step-up on the caller's own session (H1).
    const stepUpAt = (at: Date) => raw('admin_sessions').updateOne({ _id: r.sessionId }, { $set: { step_up_at: at } });
    expect(await code(createAddDeviceInvite(h(), me, { tokenHash: first, sessionId: r.sessionId }))).toBe(
      'STEP_UP_REQUIRED',
    );
    await stepUpAt(new Date(Date.now() - 6 * 60 * 1000)); // stale
    expect(await code(createAddDeviceInvite(h(), me, { tokenHash: first, sessionId: r.sessionId }))).toBe(
      'STEP_UP_REQUIRED',
    );
    await raw('admin_sessions').updateOne({ _id: other.sessionId }, { $set: { step_up_at: new Date() } });
    expect(await code(createAddDeviceInvite(h(), me, { tokenHash: first, sessionId: other.sessionId }))).toBe(
      'STEP_UP_REQUIRED',
    ); // someone else's stepped-up session does not count
    await stepUpAt(new Date());
    await createAddDeviceInvite(h(), me, { tokenHash: first, sessionId: r.sessionId });
    await createAddDeviceInvite(h(), me, { tokenHash: second, sessionId: r.sessionId });
    expect(await readInvite(h(), publicScope(), { tokenHash: first })).toBeNull(); // superseded
    const view = await readInvite(h(), publicScope(), { tokenHash: second });
    expect(view).toMatchObject({ adminId: r.adminId, purpose: 'add_device' });
    expect(view?.existingCredentials).toHaveLength(1);
    expect(
      await code(createAddDeviceInvite(h(), publicScope(), { tokenHash: randomBytes(32), sessionId: r.sessionId })),
    ).toBe('FORBIDDEN');
    expect(await code(listPasskeys(h(), publicScope()))).toBe('FORBIDDEN');
  });
});

describe('the whole flow as mc_admin (the api-admin database user, 02 §4.3)', () => {
  const login = `mc_admin_t${randomBytes(3).toString('hex')}`;
  const password = randomBytes(24).toString('base64url');
  let asAdmin: DbHandle | undefined;

  beforeAll(async () => {
    await applyLocalRoles(t().client, t().name, [{ user: 'mc_admin', login, password }]);
    const url = new URL(testMongoUri());
    url.username = login;
    url.password = password;
    asAdmin = createDbHandle({ uri: url.toString(), database: t().name, process: 'api-admin', local: true });
  });

  afterAll(async () => {
    await asAdmin?.close();
    await dropLocalRoles(t().client, t().name, [login]);
  });

  it('invite → register → login → step-up → resolve → logout succeeds with only mc_admin privileges', async () => {
    if (!asAdmin) throw new Error('no mc_admin handle');
    const { adminId, inviteHash } = await invitedAdmin();
    expect(await readInvite(asAdmin, publicScope(), { tokenHash: inviteHash })).not.toBeNull();
    const cred = credential();
    const registered = await registerCredential(asAdmin, publicScope(), {
      inviteTokenHash: inviteHash,
      credential: cred,
      sessionTokenHash: randomBytes(32),
    });
    const found = await findLoginCredential(asAdmin, publicScope(), cred.id);
    if (!found) throw new Error('credential not found as mc_admin');
    const sessionHash = randomBytes(32);
    const login2 = await completeAssertion(asAdmin, publicScope(), {
      credentialDocId: found.credentialDocId,
      newCounter: 1,
      sessionTokenHash: sessionHash,
    });
    const steppedHash = randomBytes(32);
    await completeAssertion(asAdmin, publicScope(), {
      credentialDocId: found.credentialDocId,
      newCounter: 2,
      sessionTokenHash: steppedHash,
      stepUpSessionId: login2.sessionId,
    });
    const resolved = await resolveSession(asAdmin, publicScope(), { tokenHash: steppedHash });
    expect(resolved?.adminId.equals(adminId)).toBe(true);
    await recordLoginFailure(asAdmin, publicScope(), { credentialId: randomBytes(16) });
    const me = adminScope({ adminId, masjids: [] });
    expect(await revokeSessions(asAdmin, me, { reason: 'logout' })).toBe(2);
    expect(registered.adminId.equals(adminId)).toBe(true);
  });
});
