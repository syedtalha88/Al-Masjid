# PHASE 01 — Database, Security Core, Passkey Auth & Super Admin

## Goal
The complete MongoDB database (all collections with validators and indexes, the public views, the per-process database users/roles, the policy layer and the data-layer side effects) is in place and proven by tests; masjid admins and the Super Admin can log in with passkeys; the Super Admin can onboard masjids and admins end-to-end (create masjid → invite admin → admin registers passkey → accepts undertaking → Super Admin activates). Everything is audited.

## Read before starting
`CLAUDE.md` · `docs/DECISIONS.md` (#6, #7, #20, #22, #25, #26) · `docs/00_PRODUCT_SPEC.md` §2, §3.1–3.2, §5 · `docs/01_ARCHITECTURE.md` §5.1, §5.8, §5.9, §6, §7 · `docs/02_DATA_MODEL.md` (all) · `docs/03_API_SPEC.md` §0–2, §4 (Auth), §5 (Masjids, Admins, Settings, Audit) · `docs/04_SECURITY.md` §2–6, §10, §12.2 · `docs/05_LEGAL_COMPLIANCE_IMPLEMENTATION.md` §1–2 · `docs/07_SCREEN_SPECS.md` B1–B3, B13 (account part), C1–C2, C10–C11.

## Owner prerequisites
- MongoDB Atlas account (MFA on); create project `mc-staging` with a cluster in **AWS ap-south-1 (Mumbai)**. Tier: the cheapest tier that supports **custom roles, views and transactions** (Claude Code verifies in T1.1 and tells the owner before anything paid is created). Production project is created in Phase 9.
- Atlas **Network Access**: add the staging VPS static IP (Claude Code gives exact steps).
- Cloudflare Turnstile site keys (used from Phase 2; create now).
- The owner's phone(s) for the first Super Admin passkey on staging.
- (Redis needs no account — it runs on the VPS.)

## Out of scope
Musalli app features, content creation, push sending, payments, videos.

---

## Tasks

### T1.1 — Atlas, DB users/roles & capability verification
**Do:** `infra/mongo/roles.ts` = single source of the custom roles and users from `02 §4.3` (`mc_public`, `mc_admin`, `mc_system`, `mc_migrator`), with (a) a local applier using `createRole`/`createUser` for the Docker MongoDB (wired into `pnpm db:reset`) and (b) an Atlas applier using the Atlas Admin API / `atlas` CLI (or, if not automatable on the chosen tier, a generated step-by-step checklist for the owner with the exact privileges). Passwords: 32+ random chars generated on the server/locally, never printed in the transcript; written straight into the per-process env files. **Verify on staging Atlas and record in DECISIONS:** (1) custom roles with collection-level privileges work on the chosen tier, (2) a role granting `find` on a **view** works without privileges on its source collection, (3) multi-document transactions work, (4) IP access list restricts to the VPS IP. If (2) fails, write an OPEN decision with the fallback from `01 §5.1` before continuing.
**Acceptance:** [ ] `pnpm db:start`, `db:reset`, `db:test` work locally. [ ] Connecting as each local user can do exactly what 02 §4.3 allows (privilege tests). [ ] `pnpm db:verify-roles --env staging` passes against Atlas. [ ] Verification results recorded in DECISIONS.

### T1.2 — Schema, validators, migrations
**Do:** Zod document schemas for **every** collection in `02 §2` (including collections used by later phases, so the policy matrix is complete from day one) in `packages/db/src/schema/`; generator producing `$jsonSchema` validators (`bsonType`s: UUID binary, `long` for money/bytes/versions, `int` for small ints, `date`, pattern-checked date/time strings, `maxLength`, enums, `additionalProperties: false`, type-specific `oneOf` for `items` and `masjid_timings`). Migration runner (`packages/db/migrations`, `_migrations` + lock document, checksum verification, idempotent) and migrations that create collections with validators, **all indexes in 02** (unique, partial, compound, text, keyset), and the **views in 02 §4.2**. Seed the `app_settings` global document. One migration per logical area; no data in schema migrations. `pnpm db:schema:check` drift check.
**Acceptance:** [ ] Every field/validator/index/view in 02 exists (tests read `listCollections`/`listIndexes`). [ ] India bounding box, VPA regex, length limits, money as int64 (a `double` amount is rejected), unknown fields rejected — each proven by an insert that fails with a validation error. [ ] Running migrations twice changes nothing. [ ] Drift check fails when a validator is changed by hand (fixture).

### T1.3 — Data-layer operations & side effects
**Do:** `packages/db/src/effects.ts` and `state/**` from `02 §3` and `§5` that this phase needs (`bumpMasjidVersion` via `contentWrite`, `genFollowCode`, `consumeInvite`, admin-limit, visibility mirror, audit write helper) + stubs with the correct signatures that throw `NotImplementedError` for later-phase state functions (each later phase replaces its stubs). Every state function asserts its scope and writes `audit_log` inside the same transaction.
**Acceptance:** [ ] `mc_admin` cannot update/delete `audit_log` or `campaign_amount_history` (privilege test). [ ] Version bump happens for each content collection (meta-test enumerating content-writing repository methods). [ ] Follow limit 20 and admin limit 5 enforced, including under concurrent requests (parallel test). [ ] `genFollowCode` produces valid Crockford codes and retries on duplicate key (forced collision test). [ ] Every reference & delete rule in 02 §5 has a test (the parts owned by later phases are added in those phases).

### T1.4 — Policy layer + full matrix tests
**Do:** `packages/db/src/policy.ts` implementing every cell of `02 §4.1` (filters, projections, writable-field allow-lists, deny-by-default) and the typed scopes (`publicScope`, `deviceScope`, `adminScope`, `superScope`, `hookScope`, `systemScope`). Repositories per aggregate that accept only typed arguments and always call the policy layer; the `$`/`.` key guard. Test helpers to "act as" each scope (public, device X, owner of A, editor of A, admin of B, super admin, disabled admin). A generated checklist test asserts every (collection × scope × operation) cell has at least one test.
**Acceptance:** [ ] 100% matrix coverage. [ ] Cross-masjid access denied for every collection (including crafted ids and injected filter attempts). [ ] Disabled admin has no access. [ ] Admin updates with non-allow-listed fields (`status`, `follow_code`, `content_version`, quotas, counters) are rejected.

### T1.5 — DB client layer
**Do:** `packages/db`: one `MongoClient` per process (lazy, module-scoped; options from `01 §5.1`; reads the process's own URI only), `withScope`/`withTransaction` helpers (driver `withTransaction`, majority concerns, transient-error retry), `toInt64`/UUID mappers, health ping, graceful close. ESLint + Semgrep restrictions on `systemScope`, `hookScope` and `mongodb` imports.
**Acceptance:** [ ] Integration test: a query run with `adminScope(adminOfB)` cannot read masjid A's data even when the caller passes A's ids directly to the repository. [ ] Scopes never leak between requests (concurrent requests test). [ ] Transaction retry on a simulated transient error commits exactly once.

### T1.6 — API framework pieces
**Do:** Rate limiter abstraction (`rate-limiter-flexible` Redis implementation + in-memory implementation for unit tests) with bucket config from `03 §2`; Redis ACL users per process (`infra/compose` ACL file) and key prefixes; Zod validation in `defineRoute` producing problem+json with field errors; shared `ApiError` codes list (`packages/shared/src/errors.ts`) + i18n keys for each; health endpoints now check MongoDB + Redis; OpenAPI generation + committed snapshot + CI diff.
**Acceptance:** [ ] 429 with `Retry-After` (test). [ ] Validation errors map to codes, never echo raw input in `detail`. [ ] Each Redis ACL user cannot touch another process's key prefix (test).

### T1.7 — Field encryption
**Do:** `packages/api/src/crypto/field.ts`: AES-256-GCM with random 96-bit IV, key ring (`FIELD_ENCRYPTION_KEY_ID` → key), output `v1:<keyId>:<iv>:<ciphertext+tag>` (base64url); decrypt supports old key ids. Constant-time token compare + SHA-256 hashing helpers with pepper.
**Acceptance:** [ ] Round-trip, tamper detection, key rotation tests; fast-check property tests.

### T1.8 — Passkey authentication & sessions
**Do:** Implement every Auth endpoint in `03 §4` using SimpleWebAuthn (verify current API). Challenge store in Redis (`GETDEL`). Invite validation (uniform 404s). Registration consumes invite atomically with credential insert (one MongoDB transaction). Login (discoverable). Step-up. Sessions per `04 §4` (cookie attrs, idle/absolute expiry per role, rotation, last_seen throttling, revoke). CSRF middleware (Origin + `X-MC-CSRF`). Counter regression handling (revoke credential + audit + Super Admin alert hook — the push part lands in Phase 4; log + dashboard flag now). Audit events: `auth.register`, `auth.login`, `auth.login_failed` (no identifiers beyond credential id hash), `auth.step_up`, `auth.logout`, `session.revoke`.
**Acceptance:**
- [ ] E2E (Chromium virtual authenticator, UV true): invite → register → logout → login → step-up → logout.
- [ ] Invite reuse, expired invite, wrong purpose → uniform failure.
- [ ] Challenge replay → rejected. Wrong origin/rpId → rejected. `uv=false` → rejected.
- [ ] Cookie flags asserted in e2e; session expires after idle (clock-controlled test).
- [ ] Missing CSRF header / foreign Origin → 403.
- [ ] Revoking sessions logs the admin out on next request.

### T1.9 — Bootstrap Super Admin
**Do:** `scripts/bootstrap-super-admin.ts` per `04 §3` (runs with the system DB user — locally via `pnpm`, on servers via `docker compose run --rm worker node dist/scripts/bootstrap-super-admin.js`; prints one-time invite URL; refuses if one exists unless `--force-additional`). Document in README and `docs/runbooks/DEPLOY.md`. Recommend owner registers **two** passkeys (phone + second device) — "Add device" flow (`invite_purpose: add_device`) available to logged-in admins from Account settings.
**Acceptance:** [ ] Script tested against local DB; idempotency/refusal tested.

### T1.10 — Admin app shell & screens
**Do:** Admin routes and screens B1 (Invite, Login), B2 (Undertaking — text from a `packages/i18n/legal/<locale>/undertaking.md` **DRAFT**), B3 (Admin Home with tiles as placeholders that open "Coming soon" screens — tiles must already have final icons/labels/colors), B13 account section (language, sessions list + revoke, passkeys list + label edit + "Add another device", logout, logout all). Admin type scale. Session-expired handling (redirect to Login with friendly message). Masjid switcher.
**Acceptance:** [ ] All screens in 4 locales with screenshots; Urdu RTL correct. [ ] Undertaking must be accepted before any admin write (API enforces with `UNDERTAKING_REQUIRED`). [ ] Lighthouse a11y ≥ 95 on admin screens.

### T1.11 — Super Admin: masjids, admins, settings, audit
**Do:** Super routes (responsive with sidebar ≥ 1024px): C1 Dashboard (pending activations + stats only for now), C2 Masjids (list/search/filter, create/edit form with all fields — coordinates input accepts decimal lat/lng **or** a pasted Google Maps URL parsed for coordinates (`@lat,lng`, `q=lat,lng`, `ll=`), validated inside India; names in 4 scripts; calc method; madhab; Hijri offset; quotas), activate (requires ≥ 1 active admin who accepted undertaking — Phase 3 adds "timings configured" requirement), suspend/unsuspend with reason (★ step-up), delete (★, soft with retention) — all status changes through the masjid state functions so the visibility mirror (02 §5) is applied. Admins: create with display name, optional phone (encrypted), UI locale, role → returns invite URL with copy + "Share on WhatsApp" button (`https://wa.me/?text=` with localized message) ; re-invite; revoke sessions ★; revoke passkeys ★; remove from masjid ★; view phone ★ (audited). C10 Settings (global Hijri offset, default quotas, support WhatsApp number, grievance officer details, legal versions — kill switches added Phase 8). C11 Audit log (filters, pagination, expandable meta; CSV export ★).
**Acceptance:** [ ] Full onboarding e2e: create masjid → create admin → open invite in new browser context → register passkey → accept undertaking → super activates → masjid status active (and visible through `v_pub_masjids`). [ ] Every action appears in the audit log with correct actor/target. [ ] Non-super admin hitting `/api/super/*` → 403 (integration matrix).

### T1.12 — Security review & phase close
**Do:** Run `/finish-phase 01`. Additional checks: no secrets in logs during auth flows (log capture test), invite tokens never logged, `systemScope` only in jobs/scripts and `hookScope` only in hooks, `db:verify-roles` against staging green, Atlas IP access list contains only the staging VPS IP.

---

## Phase exit criteria
Policy matrix 100% and DB-privilege tests green (local + staging); auth e2e green on Chromium; integration authz matrix green; onboarding e2e green; budgets for admin app met; phase-verifier PASS; security-reviewer no HIGH/MEDIUM; report + owner guide Phase 01 handed over with the staging Super Admin invite URL delivered **privately** (never committed).
