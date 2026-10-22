# PHASE 01 REPORT — Database, security core, passkey auth, Super Admin — **DRAFT (22 Oct 2026)**

> **Waiting for, before AWAITING OWNER VERIFICATION:** the final release on staging (its image digests go in the
> header) and the final phase-verifier / security-reviewer pass (§3). O22 and the staging evidence are done (22 Oct).

**Date:** 22 Oct 2026 · **Commit range:** `9f9fec4..1c9f92d` on `main` (Phase 01 started 16 Oct 2026, DECISIONS #62;
Phase 00 closure items share the range) · **Staging URLs:** app https://app-staging.almasjids.com · admin
https://admin-staging.almasjids.com · **Deployed release:** ⏳ (the final release and its image digests from the
signed manifest go here).

## 1. Summary

The database and security core are in place and proven on staging Atlas. MongoDB has one user per process with
exactly the 02 §4.3 privileges (17/17 checks on staging), and every collection is reached only through a policy
gateway whose 984-cell matrix is tested cell by cell. The schema covers 30 collections and 11 views, with validators
and checksummed migrations. Field encryption, rate limits and the RFC 9457 error contract work end to end.

Admins log in with passkeys only (SimpleWebAuthn, user verification required). Sessions are cookie-based with CSRF
protection, idle expiry and step-up (★) for sensitive actions; a cloned authenticator is detected and revoked.

The Super Admin onboards a masjid end to end: create the masjid, create its admin, share the invite on WhatsApp. The
admin registers on their own phone and accepts the undertaking; the Super Admin activates the masjid, which then
becomes publicly visible. Every action is audited. All admin screens work in English, Hindi, Urdu (RTL) and Telugu.
The owner created the real Super Admin passkey on staging on 22 Oct 2026.

## 2. Tasks

| Task | Status | Key files | Tests / evidence |
|---|---|---|---|
| T1.1 Atlas, DB users/roles, capability verification | ✅ | `packages/db/src/roles.ts`, `infra/vps/atlas-users.sh`, `deploy.sh --verify-roles` | `privileges.int.test.ts` (≈ 500 checks as each user), `roles-local`, `verify-roles` tests; staging 17/17 on 20 and 22 Oct (`evidence/PHASE_01_T1.1_verify-roles_2026-10-22.txt`) |
| T1.2 Schema, validators, migrations | ✅ | `packages/db/src/schema/**`, `packages/db/src/migrations/**` | `migrations.int.test.ts` (rejections, idempotency, lock, checksum, drift fixture); migrations 0001–0007 on staging Atlas |
| T1.3 Data-layer operations & side effects | ✅ | `packages/db/src/effects.ts`, `state/**` | `state.int.test.ts` (limits under concurrency, invite single use, follow-code collisions, version bump) |
| T1.4 Policy layer + full matrix | ✅ | `packages/db/src/policy.ts`, `scoped.ts` | `policy.int.test.ts`: 947 cells attempted + 37 left to MongoDB / DB users = 984; cross-masjid read **and** write denial for every collection; device-vs-device |
| T1.5 DB client layer | ✅ | `packages/db/src/client.ts`, `scope.ts` | `client.int.test.ts` (transient retry commits once; 50 interleaved admin transactions see only their masjid) |
| T1.6 API framework pieces | ✅ | `packages/api/src/http/**` | `rate-limit.test.ts` / `.int.test.ts` (buckets, /64 + opt-in /48, Redis ACL prefixes), problem+json, no input echo |
| T1.7 Field encryption | ✅ | `packages/api/src/crypto/field.ts` | `field-crypto.test.ts` (rotation, tamper, fast-check) |
| T1.8 Passkey auth & sessions | ✅ | `packages/api/src/auth/**`, `routes/admin-passkeys.ts`, `admin-auth.ts` | `admin-passkeys.int.test.ts` (20 cases incl. replay, origin, rpId, UV, counter regression after signature, wrong-purpose tokens), `admin-auth.int.test.ts`; browser e2e `e2e/admin/passkey-flow.spec.ts` |
| T1.9 Bootstrap Super Admin | ✅ | `packages/api/src/jobs/bootstrap-super-admin.ts`, `deploy.sh --bootstrap-super-admin` | bootstrap tests (db, api, deploy); done on staging by the owner 22 Oct (O12) |
| T1.10 Admin app shell & screens | ✅ | `apps/admin/src/**` | `e2e/admin/screens.spec.ts` (15 screens × 4 locales, axe, `dir`), `lighthouse-a11y.spec.ts` (100 on 9 signed-in screens) |
| T1.11 Super Admin: masjids, admins, settings, audit | ✅ | `packages/api/src/routes/super.ts`, `apps/admin/src/routes/super.*` | `super-routes.int.test.ts` (role guard on 22 routes, onboarding, ★ step-up, audit trail of every action — actor, target, masjid), `e2e/admin/onboarding.spec.ts` |
| T1.12 Security review & phase close | ⏳ | — | reviews below; this report |

## 3. Verification results

Local full verify on 22 Oct 2026 (Windows dev PC, recipe in PROGRESS) and CI on GitHub (Linux).

| Gate | Result | Numbers |
|---|---|---|
| Typecheck / lint / format | ✅ | 32/32 turbo tasks, 0 warnings, Prettier clean, `i18n:check` passed |
| Unit + component | ✅ | ui 204, shared 140, api 105, i18n 84, config 63 (42 lint-rule tests), db 30, server 27, domain 23, admin 21 — coverage gates met |
| DB policy matrix | ✅ | `db:test` 150/150, 98.1 % lines; matrix 947 attempted + 37 DB-decided = 984 cells |
| DB privileges | ✅ local · ✅ staging | local ≈ 500 checks as each user; staging `--verify-roles` 17/17 (20 Oct, again 22 Oct after O22 — evidence file); Atlas IP list = the VPS only (O21 evidence) |
| Infra | ✅ | Trivy 0 HIGH/CRITICAL with a fix (Caddy builder re-pinned to Go 1.27.3 on 22 Oct); `check.sh` 114 PASS · 0 FAIL · 2 WARN after O22, host layer `aa2d1ac` (22 Oct, evidence file); deploy tests 0 failures |
| API integration | ✅ | 156/156, 99.0 % lines (F41: a Windows-only worker crash needs a re-run now and then) |
| E2E (Pixel 7 / iPhone 14) | ✅ | 142 passed / 26 skipped (Chromium-only features skipped on WebKit); admin auth specs on the test-hooks stack 7 passed (Chromium) / 7 skipped (WebKit has no virtual authenticator); flaky 0 |
| Accessibility | ✅ | axe: 0 violations on every admin screen in 4 locales; Lighthouse a11y 100 on 9 signed-in screens |
| Visual | ✅ | 15 screens × 4 locales (§4) |
| Bundle budgets | ✅ | app `/` 165.4 / 170 kB gz; admin 211.1 / 220 kB; CSS 9.35 / 25 kB; largest lazy chunk < 60 kB |
| Lighthouse (mobile, local stack — the gate) | ✅ | app cold LCP 1.97 s · admin cold 2.27 s · app warm 0.10 s · admin warm 0.80 s; CLS 0 |
| Lighthouse (staging — report only, #85) | ℹ️ | app cold 3.08 s · admin cold 2.58 s · admin warm 1.22 s (simulated Slow 4G; observed LCP 0.89 s) |
| Motion perf traces | ✅ | 2/2, no long task > 50 ms in transitions |
| Semgrep / CodeQL | ✅ | project rules 9/9 rule tests, repo scan 0 findings; CodeQL green |
| phase-verifier | ⏳ | 22 Oct runs: gaps found and fixed (DECISIONS #83, #87); final re-run ⏳ |
| security-reviewer | ✅ so far | V-31 (#80), delta (#82), close (#86), close fixes (#88): 0 HIGH / 0 MEDIUM open — every MEDIUM and LOW fixed or justified there; final pass with the report ⏳ |

Explain / IXSCAN tests for query plans start in Phase 02, with the first read-heavy public routes (#83 h).

## 4. Screenshots

`docs/reports/evidence/PHASE_01_T1.10_screens/<en|hi|ur|te>/` — B1 invite + login, B3 home, B13 account, C1 dashboard,
C2 list / new / detail / edit, C10 settings, C11 audit (Super Admin views), and `flow/` — B1 invite, B2 undertaking,
B3 home, B13 account (masjid admin). Taken by `e2e/admin/screens.spec.ts` on Pixel 7, downscaled 50 %.

Notes:
- Urdu is mirrored correctly. The C11 audit row was bidi-scrambled in Urdu until 22 Oct; it is fixed and re-checked (#87).
- The admin app has no reference images (`docs/design-references` covers the musalli app). It follows the same tokens,
  with the larger admin type scale and targets (07 §Admin).

## 5. Deviations from spec

| # | Deviation |
|---|---|
| #60 | Staging runs on Atlas M0 (free); production M10 with backups is confirmed in Phase 09 |
| #63 | `db:verify-roles` runs on the VPS through `deploy.sh --verify-roles` (in each process's container); roles live in `packages/db/src/roles.ts` |
| #67 | Data-layer state functions + later-phase stubs; reference/delete rules owned by later phases are tested there |
| #70 | Server-side bootstrap = a one-off api-admin container (`deploy.sh --bootstrap-super-admin`) |
| #71 #72 #73 | Super Admin API, admin app foundation and screens as built (undertaking gate, platform WebAuthn client) |
| #76 | CI jobs that start MongoDB run on `ubuntu-22.04` (kernel 7.0.0 on 24.04 — F35) |
| #77 | Counter rule runs after a verified signature; user-handle check |
| #78 | API route tests run as the process's own DB user; no eager `masjid_stats` |
| #79 | VPS → Atlas ≈ 9 ms RTT vs the ≤ 5 ms target (owner accepted) |
| #81 | Admin login IP limit 30 per 10 min (owner) |
| #82 #86 #88 | Review fixes: IPv6 /64 + opt-in /48 keying, `safeText` by Unicode category, capped audit, host journal archived |
| #83 #87 | Phase-verifier gaps; **admin anonymization → Phase 08 T8.7** (retention job, 02 §6) |
| #84 | Follow-ups closed or deferred with triggers |
| #85 | Staging Lighthouse report-only until F42 (Phase 02); the local stack is the hard gate |

## 6. Known limitations / follow-ups

All are deferred with a DECISIONS entry (#74, #80, #84, #87) — PROGRESS "Open follow-ups":
- **Phase 02:** F1 (Node 26), F13, F16, F18, F20, F21, F22, F42.
- **Phase 03:** F38 (b), F39.
- **Phase 04:** F38 (a).
- **Triggered by an event:** F14, F24, F28, F35, F41.
- **With O22:** F36, F37, F40.
- **Human translation review:** 280 strings per locale (hi / ur / te) are machine-drafted (`packages/i18n/review/*.csv`).

## 7. What the owner should test now

`owner/PHASE_TESTING_GUIDE.md` → **Phase 01**, checks 1.2–1.12. Check 1.1 (Super Admin passkey) was done on 22 Oct.
- Use "Test Masjid …" names for anything you create on staging.
- Admin invite links appear only in the app (copy / WhatsApp). Never paste them into chat or tickets.
- Changed from the guide: 1.10 shows the actor type in your language, plus the first 8 characters of the actor's id.
