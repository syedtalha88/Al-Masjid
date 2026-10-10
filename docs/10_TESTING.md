# 10 — Testing & Verification Strategy

> "Proper testing and verification at each step and phase" means: every task ships with automated tests, every phase passes the full gate, and the owner runs the manual checklist (`owner/PHASE_TESTING_GUIDE.md`).

## 1. Test pyramid & tools

| Layer | Tool | Scope | Location |
|---|---|---|---|
| Static | `tsc --noEmit`, ESLint (zero warnings), Prettier check | everything | – |
| Unit | Vitest | `packages/domain` (100% branches on prayer/hijri/qibla/upi/money/followCode), `packages/shared` schemas, API services (with mocked repositories), env/boot assertions, utilities | `**/*.test.ts` next to code |
| Property-based | `fast-check` with Vitest | follow codes, UPI parse/build round-trip, money formatting, Zod schemas reject garbage, prayer time monotonicity | same |
| Component | Vitest + Testing Library + `@testing-library/user-event` + jsdom | UI components & feature components (render, a11y roles, interactions, i18n, RTL) | `__tests__/` |
| DB — policy matrix | Vitest against real MongoDB (Docker, replica set + auth) | every (collection × scope × operation) cell allowed **and** denied; state functions; field allow-lists; side effects (version bump, counters, mirrors); validators reject bad documents; indexes exist; migrations idempotent | `packages/db/test/policy/**` |
| DB — privileges | Vitest connecting **as each MongoDB user** (`mc_public`, `mc_admin`, `mc_system`, `mc_migrator`) | every forbidden action → `Unauthorized`; views expose only listed fields; append-only collections | `packages/db/test/privileges/**` (+ `scripts/db-verify-roles.ts` for staging Atlas) |
| DB — performance | Vitest + `explain('executionStats')` on a seeded large dataset | hot queries use `IXSCAN`, no `COLLSCAN`, docs examined ≤ 2× returned | `packages/db/test/perf/**` |
| API integration | Vitest + Supertest against `createPublicApp()` / `createAdminApp()` + real MongoDB + Redis (Docker) | every endpoint: happy path, validation errors, authz matrix, NoSQL-injection payloads, rate limits, idempotency, cache headers | `packages/api/test/**` |
| Jobs | Vitest + real Redis + BullMQ + mock push/Cloudinary/YouTube-oEmbed/Cloudflare adapters | fan-out recipients, retries, idempotency, schedules, outbox sweeper, retention | `packages/api/test/jobs/**` |
| Contract | OpenAPI snapshot diff | breaking changes flagged | CI |
| E2E | Playwright | critical journeys on **Pixel 7 (Chromium)** and **iPhone 14 (WebKit)** device profiles; offline; i18n; RTL | `e2e/**` |
| Visual regression | Playwright screenshots | key screens × 4 locales, compared to baselines; reviewed against design references | `e2e/visual/**` |
| Accessibility | `@axe-core/playwright` | every e2e page state; zero serious/critical violations | e2e |
| Performance | Lighthouse CI (mobile, simulated slow 4G, 4× CPU) + `size-limit` | budgets in 01 §9 | CI |
| Motion perf | Playwright + Chrome trace (Performance API long tasks) during transitions | no long task > 50 ms on the 5 main transitions, 4× CPU throttle | `e2e/perf/**` |
| Security | Semgrep, CodeQL, gitleaks, osv-scanner, Trivy (images + config), hadolint, ZAP baseline (nightly), CSP violation listener in e2e | | CI |
| Infra | `infra/vps/check.sh` (hardening checklist), header/cache-rule checks against staging, container healthchecks | ports, firewall, origin-pull enforcement, Cloudflare cache behaviour | CI (staging job) + phase reports |
| Load | k6 (Phase 4/9) | read endpoints at 2,000 rps through Cloudflare, origin cache-miss capacity, push fan-out 50k | `load/` |

## 2. Coverage gates (CI fails below)
- `packages/domain`: 100% lines & branches.
- `packages/shared`: ≥ 95% lines.
- `packages/api`: ≥ 90% lines, ≥ 85% branches.
- `apps/*` feature hooks/utils: ≥ 80% lines (components covered via e2e + component tests).
- `packages/db`: ≥ 95% lines; policy matrix: 100% of cells (enforced by a generated checklist test that counts policy cells vs tests); DB privileges: 100% of the 02 §4.3 table.

## 3. Rules
- Tests are deterministic: fixed clock (`vi.setSystemTime` + an injectable `Clock` in services/jobs), fixed time zone `Asia/Kolkata` (`TZ=Asia/Kolkata` in test env), seeded randomness, no external network (MSW for client tests; Cloudinary/YouTube-oEmbed/push/Cloudflare/Turnstile adapters mocked in API/job tests with contract-shaped fakes). MongoDB and Redis are **real** (Docker) — each test file uses its own database name / Redis key prefix so files run in parallel.
- No `.only`, no unexplained `.skip` (CI greps).
- Each bug fixed gets a regression test first.
- E2E uses **dev-only test hooks** (e.g. `/api/test/seed`, `/api/test/clock`, `/api/test/run-job`) registered only when `APP_ENV=local` **and** `NODE_ENV=test`; a build check ensures they are absent from production bundles, images and route tables.
- Passkeys in e2e: Playwright with Chromium **virtual authenticator** (CDP `WebAuthn.addVirtualAuthenticator`, `hasUserVerification: true`, `isUserVerified: true`). WebKit e2e skips passkey ceremonies and uses a test-only session injection hook.
- Push in e2e: assert outbox document + BullMQ job enqueued + payload built; actual delivery verified manually on devices (owner guide) and with a local web-push receiver test harness.

## 4. Domain test oracles (must exist)
- **Prayer times**: golden files for Hyderabad, Delhi, Mumbai, Chennai, Kolkata, Srinagar, Thiruvananthapuram for 6 dates (solstices, equinoxes, Ramadan date) generated by an **independent reference implementation or published tables** — Claude Code must document the source of each golden value in the fixture file. Tolerance ±1 minute.
- **Qibla bearing**: same 7 cities, cross-checked against 2 independent calculators; tolerance ±0.5°.
- **Hijri**: known Umm al-Qura conversions + offset behaviour + after-Maghrib rollover.
- **UPI**: valid/invalid VPA corpus; URI build escapes (`&`, `=`, spaces, Unicode payee names); parse of real-world-shaped QR payloads (synthetic, not real VPAs).
- **Follow code**: ambiguity mapping (O→0, I/L→1), checksum-free length/charset validation, collision retry.

## 5. Fixtures — RELIGIOUS CONTENT POLICY
Never use real Quran/hadith/dua text in fixtures, seeds, stories, or tests. Use these placeholders verbatim:
```
arabic:          "نص تجريبي للعرض فقط"               // "sample text for display only"
transliteration: "Sample transliteration — DEV ONLY"
translation.en:  "Sample translation text for development. Not a real hadith."
translation.hi:  "विकास के लिए नमूना अनुवाद। यह वास्तविक हदीस नहीं है।"
translation.ur:  "ترقی کے لیے نمونہ ترجمہ۔ یہ اصل حدیث نہیں ہے۔"
translation.te:  "అభివృద్ధి కోసం నమూనా అనువాదం. ఇది నిజమైన హదీస్ కాదు."
reference:       "DEV-SAMPLE-001"
source_name:     "Development fixture"
source_license:  "N/A — not for production"
```
Seed masjids use obviously fake names ("Test Masjid Alpha", "Test Masjid Beta"), fake VPAs (`testmasjid@okexample` — invalid handle domain on purpose for prod checks), coordinates of real cities (fine), fake admin names. A production-build check fails if `DEV-SAMPLE` or `Test Masjid` appears in production data migrations.

## 6. Critical E2E journeys (grow per phase; all must pass on both device profiles)
1. First run: language → brother/sister → privacy → follow via `/m/:code` → Home shows countdown.
2. Scan flow with mocked camera feed (fake QR video via `--use-file-for-fake-video-capture` on Chromium).
3. Follow 2 masjids → Updates merges feeds in time order → filter chips.
4. Offline: load, go offline, reload → Home/timings/feed render from cache; offline banner.
5. Locale switch to Urdu → RTL mirrored; screenshots match baseline.
6. Admin: invite → register passkey → undertaking → set timings → musalli sees update after version poll.
7. Admin notice from template → musalli in Telugu sees Telugu text.
8. Dua request → musalli Ameen (count increments once).
9. Campaign → UPI deep link has correct params; QR sheet shows payee name; VPA change request → super approve → hold → activation (clock-advanced) → followers' bundle updated.
10. Bayan from a YouTube link (mock oEmbed) → published with copied thumbnail → sisters-only hidden for brothers; no request to YouTube before Play is tapped.
11. Report → moderation remove → item gone for musalli within one version poll.
12. Clear all data → device deleted server-side.

## 7. CI pipeline (GitHub Actions `ci.yml`)
```
install (pnpm, cache) →
  [parallel] typecheck · lint · format-check · i18n:check · unit+component (coverage) · semgrep · gitleaks · osv · hadolint
→ services: docker compose -f infra/compose/docker-compose.dev.yml up -d (mongo replset+auth, redis)
→ db: migrate (fresh) → migrate again (idempotent) → roles/views → db:schema:check (drift) → policy matrix + privilege + explain tests
→ api + jobs integration (against same local MongoDB/Redis)
→ build both apps (production mode) → bundle secret scan → size-limit → legal DRAFT banner check (prod only)
→ build server image → Trivy scan → run full stack via compose (caddy + apis + worker) for e2e
→ e2e (Playwright, 2 device profiles, sharded) + axe + CSP listener + visual
→ Lighthouse CI on the built stack
```
On `main`: `deploy-staging.yml` pushes images to GHCR and deploys to the staging VPS, then runs header/cache-rule checks and a smoke test against staging.
Nightly (`nightly.yml`): ZAP baseline vs staging, full visual suite, dependency audit, Trivy re-scan of deployed digests, Lighthouse on staging, retention job dry-run on staging, `db:verify-roles` against staging Atlas.

## 8. Phase gate checklist (Claude Code fills in the phase report)
- [ ] All tasks ticked; phase-verifier PASS; security-reviewer no HIGH/MEDIUM.
- [ ] `pnpm verify` green; coverage gates met.
- [ ] Budgets met (numbers in report).
- [ ] Screenshots (4 locales) attached for new screens; compared with `docs/design-references`.
- [ ] Staging deployed; URL in report.
- [ ] Owner manual checklist handed over.
