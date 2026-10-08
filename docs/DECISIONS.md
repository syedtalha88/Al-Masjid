# DECISIONS (Architecture Decision Log)

> Binding decisions. Claude Code must follow every **ACCEPTED** entry, must not work around an **OPEN** entry, and must add a new entry (next number) for any non-obvious choice it makes.
> Format: `#n — Title — STATUS` · Context · Decision · Consequences.
> **Revision 2 (8 Oct 2026, before any code was written):** the owner changed the stack to **React (Vite) + Node.js/Express + MongoDB**, self-hosted on a **VPS**. #6, #7, #8 and #9 were rewritten; #19–#26 were added. Every product rule, feature, phase, security and legal requirement is unchanged.

---

### #1 — PWA instead of native apps — ACCEPTED
**Context:** Owner does not do native mobile development. The product must not hit a platform wall later.
**Decision:** Build a PWA. Ship to Google Play as a Trusted Web Activity (Phase 9). Keep the code wrapper-agnostic so Capacitor can be added for the App Store later without rewrites.
**Consequences:** On iOS, push only works after "Add to Home Screen" from Safari (iOS 16.4+), so the app must teach installation. iOS Safari storage is separate from the installed Home Screen app's storage (see #14). No background location (not needed).

### #2 — Musallis have no accounts — ACCEPTED
**Context:** Privacy, DPDP exposure, simplicity, breach impact.
**Decision:** Musalli identity is an anonymous **device record** (random id + hashed secret) holding only: locale, audience preference (brothers/sisters), push subscription, followed masjid ids, mute flags. Nothing else.
**Consequences:** No cross-device sync, no "restore my masjids" — re-scan QR on a new phone. Acceptable.

### #3 — Brothers/Sisters is a content preference, not access control — ACCEPTED
**Context:** Gender is self-declared; it cannot be verified.
**Decision:** Server filters feeds and push targeting by the device's audience preference. UI for admins states that videos are not private.
**Consequences:** A determined person can switch preference. That is acceptable and disclosed.

### #4 — Admin login via passkeys only — ACCEPTED
**Context:** Owner decision. SMS OTP in India needs DLT registration tied to a registered entity; passwords are hard for low-literacy users.
**Decision:** WebAuthn passkeys (discoverable credentials, `userVerification: required`) — works with any phone screen lock (PIN, pattern, face, fingerprint). Onboarding and recovery via single-use invite links issued by the Super Admin. No passwords, no SMS, no email login.
**Consequences:** Admin phones need a screen lock and Android 9+/iOS 16+. Recovery always goes through the Super Admin.

### #5 — Frontend: Vite + React SPA (not Next.js) — ACCEPTED (re-confirmed in Revision 2)
**Context:** App sits behind QR codes (no SEO need). We need app-like stack navigation with interruptible spring transitions and interactive swipe-back, plus a service-worker-first offline shell. The owner asked for "React or Next, whichever is better": for this product React + Vite is better — Next.js's main strengths (SSR, SEO, server components) bring no benefit here, add server load on a VPS, and complicate the offline service-worker shell.
**Decision:** Two Vite + React + TypeScript SPAs (`apps/app`, `apps/admin`) with TanStack Router + TanStack Query + Motion + Tailwind CSS v4 + vite-plugin-pwa (Workbox). Built to static files and served by Caddy behind Cloudflare.
**Consequences:** No SSR. First load is the app shell (budgeted); repeat loads are instant from the service worker.

### #6 — Backend: Node.js + Express 5 API on a VPS (Docker) + MongoDB Atlas (Mumbai) — ACCEPTED (Revision 2; replaces "Hono on Vercel + Supabase Postgres")
**Context:** Owner decision to use Express + Node + MongoDB and to host on a VPS.
**Decision:**
- API: **Express 5** (TypeScript) in `packages/api`, built into two separate HTTP processes — `api-public` (serves `app.<domain>/api/v1/*`) and `api-admin` (serves `admin.<domain>/api/admin/*`, `/api/super/*`, `/api/hooks/*`) — plus a **`worker`** process for background jobs (#9). All run as Docker containers via Docker Compose on a Linux VPS in **Mumbai** (#21).
- Database: **MongoDB Atlas**, AWS region **ap-south-1 (Mumbai)**, replica set (multi-document transactions used for every multi-write operation). Production tier **M10 or higher** with **Continuous Cloud Backup (point-in-time restore)**; staging may use a cheaper tier if it supports custom roles and transactions (verify in T1.1). Access restricted by **IP access list = the VPS static IPs only**, TLS required, SCRAM-SHA-256 users per process (#7).
- Driver: official **`mongodb` Node.js driver** (no Mongoose — #25).
- Same-origin API: Caddy routes `/api/*` on each origin to its API container, so cookies stay first-party and **no CORS** is needed (unchanged from the original design).
**Why not self-host MongoDB on the VPS:** backups/PITR, encryption at rest, patching, monitoring and replica-set failover would all become the owner's job — the most likely way a volunteer project loses data or gets breached. Atlas also keeps data in Mumbai. (Self-hosting remains possible later without code changes — only the connection string changes.)
**Consequences:** There is no Postgres row-level security; authorization is enforced by the scheme in #20. MongoDB has no triggers in our design; everything triggers used to do is done inside the same transaction by the data-access layer (02 §5).

### #7 — The public API process has no privileged credentials — ACCEPTED (Revision 2)
**Decision:** Three processes, three credential sets:
- `api-public` → MongoDB user **`mc_public`** (read access only to the public **views**; write access only to device-owned collections — 02 §4), Redis ACL user limited to its rate-limit key prefix. It has **no** S3, Bunny API key (only the playback token-signing key), VAPID-private, Cloudflare-purge, session-pepper, field-encryption or admin/system DB credentials.
- `api-admin` → MongoDB user **`mc_admin`** (no access to `devices` or push endpoints; append-only on audit/history collections), Redis ACL user for its rate-limit/challenge prefixes + job enqueueing, S3, Bunny API key.
- `worker` → MongoDB user **`mc_system`** (only process allowed to purge/retention), VAPID private key, Cloudflare purge token.
A boot-time assertion in each process refuses to start if a variable that process must not have is present.
**Consequences:** A compromise of the public API cannot read unpublished/admin data, write admin data, send pushes, or bypass the policy layer's DB-level limits.

### #8 — Content-versioned caching for scale — ACCEPTED
**Decision:** Each masjid has `content_version`. Clients poll a tiny versions endpoint (short CDN TTL), then fetch masjid bundles/feeds with `?v=<version>` (long, immutable CDN TTL). Publishing bumps the version; push payloads carry it. The CDN is **Cloudflare** in front of the VPS (#21), honoring our `Cache-Control`/`s-maxage` headers via Cache Rules.
**Consequences:** Lakhs of users are served mostly from the CDN; MongoDB and the VPS see little read load.

### #9 — Background jobs & push fan-out via BullMQ (Redis on the VPS) with a MongoDB outbox — ACCEPTED (Revision 2; replaces Upstash QStash)
**Context:** On a VPS we can run a long-lived worker; an external HTTP job service is no longer needed.
**Decision:** Publishing writes a `notification_jobs` document (**outbox**, status `pending`) in the same MongoDB transaction as the content; after commit the API enqueues a BullMQ job (job id = notification job id, so duplicates are impossible). The `worker` process runs fan-out and send-batch processors with retries/backoff, sends Web Push (VAPID) in batches, prunes dead subscriptions, and runs all scheduled jobs (BullMQ job schedulers). An **outbox sweeper** re-enqueues `pending` jobs older than 2 minutes, so a lost Redis queue never loses a notification (MongoDB is the source of truth).
**Consequences:** Fewer vendors and accounts; job state survives Redis restarts; Redis must be private (no public port), password + ACL protected, AOF persistence on.

### #10 — Video via Bunny Stream (TUS upload, HLS playback) + optional YouTube link — ACCEPTED
**Decision:** Direct resumable uploads from the admin's phone to Bunny Stream using server-issued short-lived signatures; HLS playback with token auth; renditions 360p/480p/720p only. Admin may instead paste a YouTube link (rendered via a privacy-friendly click-to-load embed).
**Consequences:** Running cost scales with storage/views; per-masjid quotas enforced.

### #11 — We never touch money — ACCEPTED
**Decision:** UPI `upi://pay` deep link + QR generated by us from the masjid's VPA and payee name. Admin-uploaded QR images are not accepted (an admin may scan their QR in the admin app to extract the VPA). Amount received is **reported** by the admin and labelled as such. Any VPA change requires Super Admin approval + 24h hold + follower notice.

### #12 — No machine translation of admin free text — ACCEPTED
**Decision:** Notice templates are pre-translated (human-reviewed) into all 4 languages. Free text is shown in the language the admin typed it. Religious content comes only from the curated, scholar-verified Content Library.

### #13 — Light theme only in v1; tokens dark-ready — ACCEPTED
**Decision:** Ship the light theme matching the references. All colors are semantic tokens so a dark theme can be added later without touching components.

### #14 — iOS Safari vs Home Screen storage split — ACCEPTED
**Context:** On iOS, a QR scanned with the system camera opens Safari, whose storage is separate from the installed Home Screen web app.
**Decision:** The in-app **Scan** button (center tab) is the primary way to add masjids. The `/m/:code` landing page detects iOS non-standalone and shows: "Open the Masjid Connect app on your home screen and tap Scan" (+ install guide if not installed). Every masjid also has an 8-character **follow code** for manual entry.

### #15 — Prayer strip shows Jamaat times — ACCEPTED
**Context:** References show one time per prayer on Home; for a masjid app, the congregation (jamaat) time is what people act on.
**Decision:** Home/My Masjids/Masjid Detail strips show **Jamaat** time; countdown targets jamaat. Prayer Timings screen shows both Adhan and Jamaat columns (as in reference). On Fridays, Dhuhr slot shows Jumu'ah (first jamaat).

### #16 — Owner-rejected improvements — ACCEPTED
Not building: (1) khutbah language field, (5) janaza priority alerts, (7) per-category notification preferences. A simple **per-masjid mute** toggle is still provided (the "Notifications" button on Masjid Detail in the reference).

### #17 — No third-party analytics in v1 — ACCEPTED
**Decision:** No tracking SDKs. Only server-side aggregate counters (followers per masjid, views per item, push delivery stats). Error monitoring (Sentry) with PII scrubbing and `sendDefaultPii: false`, disclosed in the privacy policy.

### #18 — No third-party brand logos — ACCEPTED
**Context:** Reference 2 shows GPay/PhonePe/Paytm logos.
**Decision:** Do not ship third-party trademarks. Use generic copy ("Pay with any UPI app") and our own icons.

### #19 — Stack change record (Revision 2) — ACCEPTED
| Concern | Before (Revision 1) | Now (Revision 2) |
|---|---|---|
| Frontend | Vite + React SPAs | **unchanged** |
| API framework | Hono on Vercel functions | **Express 5** (TypeScript) in Docker on a VPS |
| Database | Supabase Postgres + RLS + Drizzle | **MongoDB Atlas (Mumbai)** + official driver + policy layer (#20) |
| Schema source of truth | SQL migrations | **Zod document schemas** in `packages/db/src/schema` → generated `$jsonSchema` validators + indexes applied by versioned migrations (02) |
| DB tests | pgTAP | **Policy-matrix + DB-privilege tests** with Vitest against a real MongoDB (Docker) (10) |
| Jobs | Upstash QStash | **BullMQ** + MongoDB outbox (#9) |
| Rate limits / challenges | Upstash Redis | **Redis 7+ on the VPS** (private network, ACL users) |
| Image storage | Supabase Storage | **AWS S3 ap-south-1** (public media bucket behind Cloudflare; private bucket for legal documents) (#23) |
| Hosting / CDN / firewall | Vercel (bom1), Vercel CDN & Firewall | **VPS (Mumbai) + Docker Compose + Caddy + Cloudflare** (#21) |
| Backups | Supabase PITR | **Atlas Continuous Cloud Backup (PITR)** + VPS snapshots |
Unchanged: Turnstile, Sentry, Bunny Stream, web-push/VAPID, SimpleWebAuthn, all product rules.

### #20 — Authorization without row-level security — ACCEPTED
**Context:** Revision 1 enforced tenant isolation twice: API checks + Postgres RLS. MongoDB has no row-level security, so we must not quietly drop the second layer.
**Decision:** Four layers, all required:
1. **API service checks** (membership, role, ownership, state) — unchanged.
2. **Policy layer** in `packages/db`: the *only* code allowed to touch collections. Every repository call takes a typed **Scope** (`public`, `device(id)`, `masjidAdmin(id, masjids, roles)`, `superAdmin(id)`, `system`) and the policy table (02 §4) **injects** the tenant filter, projection and field allow-list into every read and write. Missing policy cell ⇒ deny. Raw driver access outside `packages/db` is blocked by ESLint + Semgrep.
3. **Database-enforced least privilege**: separate MongoDB users per process (#7) with **custom roles granting per-collection actions**; append-only collections (`audit_log`, `campaign_amount_history`) get `insert`+`find` only for non-system users; the public user reads **only views** that pre-filter published/active data and remove private fields (02 §4.2).
4. **Tests for every cell** of the matrix (allowed and denied), plus DB-privilege tests that connect as each MongoDB user and prove forbidden operations fail with `Unauthorized` — the equivalent of the old pgTAP suite (10 §1).
**Consequences:** Cross-tenant isolation for admins is enforced in code (layer 2) rather than in the database engine; layers 3–4 and the import ban compensate. Any new collection or repository method must add its policy cells and tests in the same commit.

### #21 — Hosting: VPS + Docker Compose + Caddy + Cloudflare — ACCEPTED
**Decision:**
- One VPS per environment (staging, production), Ubuntu LTS, in **Mumbai** (same region as Atlas for ~1–2 ms DB latency). Suggested providers with a Mumbai region: AWS Lightsail/EC2, Vultr, Akamai/Linode, DigitalOcean (Bangalore is acceptable if Mumbai isn't offered; measure DB latency). Owner picks; Claude Code verifies latency in T0.14/T1.1.
- Docker Compose services: `caddy` (static SPA files + reverse proxy + security headers for static files), `api-public` (×2 replicas), `api-admin` (×2), `worker` (×1–2), `redis`. Containers run as non-root with read-only root filesystems.
- **Cloudflare** (free plan is enough to start) in front of both origins: DNS, TLS, CDN caching of versioned API responses, WAF/rate-limit rules, DDoS protection, "Under Attack" mode for incidents. Origin accepts HTTPS only from Cloudflare IP ranges (firewall) with **Authenticated Origin Pulls**; Cloudflare SSL mode **Full (strict)** with a Cloudflare Origin CA certificate on Caddy.
- CI/CD: GitHub Actions builds images → GHCR (pinned by digest) → deploy over SSH (`docker compose pull && up -d` with rolling restart and health checks). Production deploys and migrations need manual approval. Rollback = redeploy previous image digest.
**Consequences:** No per-PR preview URLs (Vercel had them); every phase is verified on the **staging** VPS. The owner pays a fixed monthly VPS cost instead of usage-based hosting. Horizontal scaling later = more VPS nodes behind a Cloudflare load balancer (APIs are stateless).

### #22 — IDs — ACCEPTED
**Decision:** All document `_id`s are **UUID v4** stored as BSON Binary subtype 4 (`new UUID()` from the driver), so ids in URLs are not guessable or time-ordered (R6). Exception: `audit_log` uses ObjectId (ordered append). Public item ids stay the 12-char random `public_id`.

### #23 — Object storage: AWS S3 (ap-south-1) — ACCEPTED
**Decision:** Processed images go to a **public media bucket** served as `media.<domain>` through Cloudflare (bucket policy only allows reads via Cloudflare / the CDN path; objects are content-hashed and immutable). Legal-order documents go to a **separate private bucket** (Block Public Access on, SSE encryption, 5-minute presigned GET URLs, Super Admin only). Only `api-admin` (write) and `worker` (delete) have S3 credentials, each an IAM user scoped to the exact bucket/prefix and actions. Local dev and tests use a filesystem adapter with the same interface.
**Consequences:** One more account (AWS) with MFA; cost is very low at our image volumes.

### #24 — Logging & CERT-In retention on a VPS — ACCEPTED
**Decision:** pino JSON logs to stdout → Docker `local` log driver with rotation → shipped daily (encrypted) to a private S3 bucket in ap-south-1 with a 200-day lifecycle rule, guaranteeing ≥ 180 days. A hosted log search tool can be added in Phase 9 if the owner wants (must keep data in India or be documented). NTP: `systemd-timesyncd`/chrony enabled on the VPS (CERT-In).

### #25 — Official MongoDB driver, not Mongoose — ACCEPTED
**Context:** We need one schema source of truth, exact control over every filter (security), explicit transactions, and no hidden casting.
**Decision:** Use the official `mongodb` driver. Document shapes are Zod schemas (`packages/db/src/schema`) from which TypeScript types and MongoDB `$jsonSchema` validators are generated. Repositories map between API objects and documents.
**Consequences:** Slightly more code than an ODM, but no second schema definition to drift, and NoSQL-injection-safe by construction (02 §0).

### #26 — MongoDB data-modelling choices — ACCEPTED
**Decision:** (a) Item type details are **embedded** in the `items` document (`items.announcement`, `items.dua`, `items.campaign`, …) instead of 1:1 tables. (b) A masjid's five prayer schedules + Jumu'ah jamaats live in **one** `masjid_timings` document (atomic save, optimistic concurrency via `rev`). (c) Counters that public traffic changes live in separate collections (`ameen_counters`, `masjid_stats`) so the public DB user never needs write access to `items` or `masjids`. (d) `device_follows` carries denormalized `audience_pref`, `locale` and `push_active` copied from the device (kept in sync in the same transaction) so audience counts and push fan-out are single index scans. (e) A `masjid_visible` flag is mirrored onto public-facing child documents so the public views can filter without joins.
**Consequences:** All such denormalized fields are written only by the data-access layer inside transactions and are covered by consistency tests.

### #32 — Phase 0 toolchain versions & substitutions — ACCEPTED (9 Oct 2026, T0.1)
**Context:** CLAUDE.md §4.2 requires checking current docs and pinning versions; CLAUDE.md §6 bans packages with no release in 18 months.
**Decision (pinned exact):**
- **Node 24** (`.nvmrc` 24, `engines >=24.15 <25`); it is the Active LTS today. Move to **Node 26** after it enters LTS on 28 Oct 2026 (one-line change + Docker base image) — tracked in PROGRESS follow-ups.
- **pnpm 12.10.1**. pnpm 11+ reads install settings only from `pnpm-workspace.yaml` (`.npmrc` is auth/registry only), so `saveExact`, `strictPeerDependencies`, `engineStrict` live there. `onlyBuiltDependencies` was removed in pnpm 11 and replaced by **`allowBuilds`** (+ `strictDepBuilds: true`): every package's install script must be explicitly allowed. **`minimumReleaseAge: 1440`** (no version younger than 24 h; supply-chain hygiene, R9).
- **TypeScript 6.0.3, not 7.x:** `typescript-eslint` 8.71 supports `typescript <6.1`, and the type-aware `strict-type-checked` lint is mandatory. Renovate holds TS `<6.1` until typescript-eslint supports newer.
- **ESLint 10.12** (flat config) + `typescript-eslint` 8.71.1 + `eslint-plugin-react-hooks` 7.1.1.
- **`eslint-plugin-jsx-a11y-x` 0.2.0 instead of `eslint-plugin-jsx-a11y`:** the original has had no release since Oct 2024 (breaks the 18-month rule) and doesn't support ESLint 10. The `-x` package is the maintained es-tooling (e18e) fork with the same rules.
- **Import order:** `eslint-plugin-simple-import-sort` (no module resolution needed, autofix).
- **Git hooks:** **lefthook** 2.1.17 instead of Husky + lint-staged. It stages fixed files itself, so lint-staged is unnecessary. Pre-commit: gitleaks (staged, redacted) → prettier → eslint; commit-msg: Conventional Commits check.
- **Custom lint rules** in `packages/config/src/eslint-plugin`: `mc/no-physical-direction` (Tailwind classes + `style` objects), `mc/no-adhoc-motion` (numeric `transition` values, `animate()` timing options, Tailwind `duration-*`/`delay-*`/`ease-[…]`; off in `packages/ui/src/motion/**`), `mc/no-raw-routes` (`router.<verb>`/`app.<verb>` outside `packages/api/src/http/define-route.ts`). Import bans use `no-restricted-imports` (+ `no-restricted-syntax` for dynamic `import('mongodb')`).
- **Module system:** all TS uses `module: preserve` + `moduleResolution: bundler`; workspace packages export their TS source; apps are bundled by Vite and the server by a bundler (T0.4), so no `.js` import suffixes.
**Consequences:** Two "spec says X" items differ in name only (lefthook vs Husky/lint-staged; `allowBuilds` vs `onlyBuiltDependencies`). Behaviour matches the spec.

### #33 — API HTTP layer details (T0.4) — ACCEPTED (9 Oct 2026)
**Decision:**
- **Permissions-Policy without `interest-cohort=()`** (04 §7 lists it). FLoC was abandoned; current browsers no longer recognise the feature and log a console error for it, which would also cost Lighthouse "Best Practices" points. All other directives unchanged. Applies to Caddy static headers too (T0.5).
- **HSTS sent without `preload`** until OPEN #29 is decided (`max-age=63072000; includeSubDomains`).
- API responses emit **only** the 04 §7 headers: helmet's extra defaults (`Origin-Agent-Cluster`, `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Permitted-Cross-Domain-Policies`, `X-XSS-Protection`) are off; ETags are off (versioned caching uses `?v=`, 01 §5.2).
- **`defineRoute()` handlers return `reply(status, body)`**: only declared statuses compile, bodies are typed per status. Responses are validated against their schema at runtime; undeclared fields are stripped (no accidental leaks), and a contract violation is a 500 (never a 400).
- **Error mapping:** request validation → 400 `VALIDATION_FAILED` with field paths (from `defineRoute`); `$`/`.` keys anywhere → 400 `UNSAFE_INPUT`; non-JSON body → 415; malformed JSON → 400 `INVALID_JSON`; > 32 kB → 413; CORS preflight → 403 `CORS_NOT_ALLOWED`; everything else (including a stray `ZodError` from server-side parsing) → 500 `INTERNAL_ERROR` with no details. Problem `type` = `urn:masjid-connect:problem:<code>`.
- **Access log** allow-list: request id, method, path **without** query string, status, duration. No headers, bodies, query strings or IPs.
- **`trust proxy` = 1** (Caddy). The client IP for coarse rate limits comes only from `CF-Connecting-IP` when `TRUSTED_PROXY_MODE=cloudflare` (validated with `net.isIP`), else the socket address.

### #34 — Server build & process entrypoints (T0.4) — ACCEPTED (9 Oct 2026)
**Decision:**
- **tsdown 0.23** (rolldown) builds `apps/server` into one ESM file per process (`dist/{public,admin,worker,migrate}.mjs`). Workspace packages export TypeScript source, and Node's built-in type stripping refuses `.ts` under `node_modules`, so the server must be bundled; tsup is in maintenance mode and recommends tsdown. `@mc/*` and their pure-JS deps (express, pino, zod, helmet…) are bundled; packages listed in `apps/server` `dependencies` stay external — **bullmq** (loads Lua scripts from its own files) and **ioredis** — and are installed in the image by `pnpm deploy --prod`. Source maps are built for Sentry upload only, never shipped (T0.13).
- **BullMQ 6** with **ioredis 6** (`maxRetriesPerRequest: null`, BullMQ `prefix: 'bull'`, never ioredis `keyPrefix`). Redis must run with `maxmemory-policy noeviction` (BullMQ requirement) — set in the compose Redis config.
- `msgpackr-extract` (optional native accelerator pulled in by BullMQ) is **denied** in `allowBuilds`; the pure-JS path is used, keeping native builds out of images. `esbuild` (used by tsx) is allowed.
- Worker heartbeat key `bull:mc:heartbeat:worker` (inside the worker's `bull:*` ACL), refreshed every 10 s with a 30 s TTL; the container healthcheck reads it.
- **`RELEASE`** (git SHA) is an optional env var baked into the image (default `dev`), used by health, logs and Sentry. It is not in `.env.example` because the project's `.env.*` deny rule blocks Claude Code from editing that file after creation (see PROGRESS follow-up F3).
- Entrypoints only compose: validate env (`bootEnv` → exit 1 with a name-only list), build the app, start the server, and drain on the first SIGTERM/SIGINT (exit 0; a second signal exits 1).

---

## OPEN

### #27 — How CI (and the owner) reach the VPS over SSH — OPEN (raised 9 Oct 2026, Phase 00)
**Context:** 04 §12.2 allows SSH only from the owner's IP(s) or a WireGuard/Tailscale tunnel. `deploy-staging.yml` (T0.3/T0.14) deploys over SSH from GitHub-hosted runners, whose IP ranges are huge and change often. Home broadband in India usually has a dynamic or CGNAT IP, so an IP allow-list for the owner is fragile too.
**Options:**
- (a) **Tailscale** (free personal plan) on the VPS; CI joins the tailnet for one job with the official GitHub Action and an ephemeral, tag-scoped auth key; the owner SSHes over Tailscale. Port 22 is closed to the public internet. *New third-party service, MFA required.*
- (b) **Pull-based deploy:** CI only pushes the image digest to GHCR and writes a release manifest; a systemd timer on the VPS pulls and deploys it. No inbound SSH from CI. The owner still needs (a) or an IP allow-list for their own SSH.
- (c) Allow SSH from GitHub's published Actions IP ranges. Not recommended: thousands of ranges, effectively public SSH.
**Recommendation:** (a) Tailscale. It solves both the CI and the owner's dynamic-IP problems, and SSH never faces the internet.

### #28 — GitHub plan for a private repo with enforced checks — OPEN (raised 9 Oct 2026, Phase 00)
**Context:** T0.3 requires that "a PR with a failing test is blocked" (branch protection with required checks), and 04 §12.1 requires `main` to be protected. On GitHub Free, protected branches/rulesets are enforced only on **public** repos; private repos need GitHub Pro/Team. Free private repos also have limited Actions minutes and GHCR storage, which this CI pipeline (compose stack + e2e on 2 devices + Lighthouse + Trivy) will consume quickly.
**Options:** (a) GitHub **Pro** for the owner's account (small monthly fee; verify current price and limits); (b) make the repo **public** (enforced protection and free Actions minutes on standard runners; the specs become public, and security does not depend on them being secret); (c) stay on Free private and accept unenforced checks (the acceptance criterion cannot be met).
**Recommendation:** (a) for now. Reconsider (b) at launch if the owner wants the project open source.

### #29 — HSTS `preload` directive — OPEN (raised 9 Oct 2026, Phase 00)
**Context:** 04 §7 specifies `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`. Once a header carries `preload`, **anyone** can submit the domain to the browser preload list, and removal takes months. It then applies to *every* subdomain of `<domain>`, including any future non-HTTPS use. An A+ grade does not require `preload`.
**Options:** (a) send `max-age=63072000; includeSubDomains` now; add `preload` and submit deliberately in Phase 9 once the domain plan is final; (b) send `preload` from Phase 0 as written.
**Recommendation:** (a).

### #30 — "Lighthouse installable checks" no longer exist — OPEN (raised 9 Oct 2026, Phase 00)
**Context:** T0.11's acceptance criterion is "Lighthouse 'installable' checks pass for both apps". Lighthouse has dropped its PWA category (installability is no longer part of the standard report). The criterion cannot be met as written.
**Options:** (a) replace it with: Playwright (Chromium) calls the DevTools Protocol `Page.getInstallabilityErrors` and asserts an empty list for both apps, plus a manifest-schema unit test (required fields, icon sizes/purposes, `id`, `scope`, `start_url`) and the owner's manual install check (guide 0.10); (b) pin an old Lighthouse version that still has the PWA category (not recommended: stale tool, conflicts with the Lighthouse CI budgets).
**Recommendation:** (a).

### #31 — E2E test hooks vs. production images — OPEN (raised 9 Oct 2026, Phase 00)
**Context:** 10 §3 / T0.12 say test hooks (`/api/test/*`) exist only when `APP_ENV=local` and `NODE_ENV=test`, and a build check proves they are absent from production images. 10 §7 runs e2e "against the full stack via compose" in CI, using the server image that was just built and Trivy-scanned. E2E needs the hooks, so it cannot use the exact production image.
**Options:** (a) one Dockerfile with a shared build stage and two final targets: `runtime` (shipped, scanned, hooks excluded) and `runtime-test` (same build output + the hooks module). E2E runs on `runtime-test`; a CI check asserts that `runtime` contains no hook code or routes; (b) run e2e against `tsx`/Vite dev processes instead of images (weaker: doesn't test the real Caddy/headers path).
**Recommendation:** (a).
