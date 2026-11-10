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

### #10 — Video via Bunny Stream (TUS upload, HLS playback) + optional YouTube link — SUPERSEDED by #39 (10 Oct 2026)
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
| Image storage | Supabase Storage | ~~AWS S3 ap-south-1 (#23)~~ → **Cloudinary** (free plan) behind our own `media.<domain>` + Cloudflare cache (#40) |
| Hosting / CDN / firewall | Vercel (bom1), Vercel CDN & Firewall | **VPS (Mumbai) + Docker Compose + Caddy + Cloudflare** (#21) |
| Backups | Supabase PITR | **Atlas Continuous Cloud Backup (PITR)** + VPS snapshots |
Unchanged: Turnstile, Sentry, web-push/VAPID, SimpleWebAuthn, all product rules. (Bunny Stream later replaced by YouTube links — #39.)

### #20 — Authorization without row-level security — ACCEPTED
**Context:** Revision 1 enforced tenant isolation twice: API checks + Postgres RLS. MongoDB has no row-level security, so we must not quietly drop the second layer.
**Decision:** Four layers, all required:
1. **API service checks** (membership, role, ownership, state) — unchanged.
2. **Policy layer** in `packages/db`: the *only* code allowed to touch collections. Every repository call takes a typed **Scope** (`public`, `device(id)`, `masjidAdmin(id, masjids, roles)`, `superAdmin(id)`, `system`) and the policy table (02 §4) **injects** the tenant filter, projection and field allow-list into every read and write. Missing policy cell ⇒ deny. Raw driver access outside `packages/db` is blocked by ESLint + Semgrep.
3. **Database-enforced least privilege**: separate MongoDB users per process (#7) with **custom roles granting per-collection actions**; append-only collections (`audit_log`, `campaign_amount_history`) get `insert`+`find` only for non-system users; the public user reads **only views** that pre-filter published/active data and remove private fields (02 §4.2).
4. **Tests for every cell** of the matrix (allowed and denied), plus DB-privilege tests that connect as each MongoDB user and prove forbidden operations fail with `Unauthorized` — the equivalent of the old pgTAP suite (10 §1).
**Consequences:** Cross-tenant isolation for admins is enforced in code (layer 2) rather than in the database engine; layers 3–4 and the import ban compensate. Any new collection or repository method must add its policy cells and tests in the same commit.

### #21 — Hosting: VPS + Docker Compose + Caddy + Cloudflare — ACCEPTED (amended by #42: one VPS for staging + production)
**Decision:**
- One VPS per environment (staging, production), Ubuntu LTS, in **Mumbai** (same region as Atlas for ~1–2 ms DB latency). Suggested providers with a Mumbai region: AWS Lightsail/EC2, Vultr, Akamai/Linode, DigitalOcean (Bangalore is acceptable if Mumbai isn't offered; measure DB latency). Owner picks; Claude Code verifies latency in T0.14/T1.1.
- Docker Compose services: `caddy` (static SPA files + reverse proxy + security headers for static files), `api-public` (×2 replicas), `api-admin` (×2), `worker` (×1–2), `redis`. Containers run as non-root with read-only root filesystems.
- **Cloudflare** (free plan is enough to start) in front of both origins: DNS, TLS, CDN caching of versioned API responses, WAF/rate-limit rules, DDoS protection, "Under Attack" mode for incidents. Origin accepts HTTPS only from Cloudflare IP ranges (firewall) with **Authenticated Origin Pulls**; Cloudflare SSL mode **Full (strict)** with a Cloudflare Origin CA certificate on Caddy.
- CI/CD: GitHub Actions builds images → GHCR (pinned by digest) → deploy over SSH (`docker compose pull && up -d` with rolling restart and health checks). Production deploys and migrations need manual approval. Rollback = redeploy previous image digest.
**Consequences:** No per-PR preview URLs (Vercel had them); every phase is verified on the **staging** VPS. The owner pays a fixed monthly VPS cost instead of usage-based hosting. Horizontal scaling later = more VPS nodes behind a Cloudflare load balancer (APIs are stateless).

### #22 — IDs — ACCEPTED
**Decision:** All document `_id`s are **UUID v4** stored as BSON Binary subtype 4 (`new UUID()` from the driver), so ids in URLs are not guessable or time-ordered (R6). Exception: `audit_log` uses ObjectId (ordered append). Public item ids stay the 12-char random `public_id`.

### #23 — Object storage: AWS S3 (ap-south-1) — SUPERSEDED by #40 (10 Oct 2026)
**Decision:** Processed images go to a **public media bucket** served as `media.<domain>` through Cloudflare (bucket policy only allows reads via Cloudflare / the CDN path; objects are content-hashed and immutable). Legal-order documents go to a **separate private bucket** (Block Public Access on, SSE encryption, 5-minute presigned GET URLs, Super Admin only). Only `api-admin` (write) and `worker` (delete) have S3 credentials, each an IAM user scoped to the exact bucket/prefix and actions. Local dev and tests use a filesystem adapter with the same interface.
**Consequences:** One more account (AWS) with MFA; cost is very low at our image volumes.

### #24 — Logging & CERT-In retention on a VPS — SUPERSEDED by #40 (log archive part; 10 Oct 2026)
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
- **`RELEASE`** (git SHA) is an optional env var baked into the image (default `dev`), used by health, logs and Sentry. Documented in `.env.example` ("set by the image").
- Entrypoints only compose: validate env (`bootEnv` → exit 1 with a name-only list), build the app, start the server, and drain on the first SIGTERM/SIGINT (exit 0; a second signal exits 1).

### #37 — Containers & local infrastructure (T0.4) — ACCEPTED (9 Oct 2026)
**Decision:**
- **Images pinned by digest:** build `node:24.21.0-trixie-slim`; server runtime **`gcr.io/distroless/nodejs24-debian13:nonroot`** (no shell/package manager, uid 65532); `caddy:2.11.7-alpine`; `mongo:8.0.32-noble` (the 8.0 major line Atlas runs; not the 8.x rapid releases); `redis:8.10.2-alpine`. One server image for all four processes (command selects `dist/{public,admin,worker,migrate}.mjs`); `pnpm deploy --prod` ships only `dist/` + `bullmq`/`ioredis` (workspace packages are bundled, so `@mc/api`/`@mc/shared` are devDependencies of `apps/server`). Image ≈ 235 MB.
- **Caddy runs non-root (uid 1000) on 8443/8080** with all capabilities dropped; the host maps 443→8443 (and 80→8080) on the VPS. Our `infra/docker/caddy.Dockerfile` strips the official binary's `cap_net_bind_service` file capability (exec of a file-capability binary is refused under `no-new-privileges` + `cap_drop: ALL`). Caddy `admin off`; a loopback-only `:8081/healthz` serves the container healthcheck. One `Caddyfile` for all environments, configured by env (`APP_HOST`, `ADMIN_HOST`, `CADDY_TLS=local|origin`, upstreams). Static security headers/CSP are completed in T0.5.
- **Healthchecks:** `node dist/healthcheck.mjs <process>` (APIs: local `/health`; worker: Redis heartbeat key). Compose waits on them.
- **Local dev MongoDB on host port 27018** (owner's PC runs a separate MongoDB Windows service on 27017). Single-node replica set `rs0` with auth + keyfile (copied into the container with mode 400 at start); clients use `directConnection=true`.
- **Redis**: config without secrets (`infra/compose/redis.conf`: ACL file, `noeviction`, AOF); ACL users `rl_public`, `admin`, `worker` (key-prefix + channel scoped, `-@dangerous -@admin +info`) and `health` (PING only); default user off. Verified by `pnpm --filter @mc/server verify:local` (11 checks).
- **Local production-like stack** (`pnpm stack:up`): dev MongoDB/Redis + built images + Caddy at `https://app.localhost:8443` / `https://admin.localhost:8443` (Caddy internal CA; browsers warn locally). Both compose files share project `mc-dev`; `up` never uses `--remove-orphans` (it would remove the other file's services).
- `prepare` installs git hooks only when `.git` exists (Docker/CI-without-git builds skip it).
- **Playwright 1.63** with projects `pixel-7` (Chromium) and `iphone-14` (WebKit) per 10 §1; the `runtime-test` image target (DECISIONS #31) is added with the test hooks in T0.12.

### #27 — VPS access: self-hosted WireGuard + pull-based deploys — ACCEPTED (owner, 9 Oct 2026)
**Context:** 04 §12.2 allows SSH only from the owner's IP(s) or a WireGuard/Tailscale tunnel. GitHub-hosted runners have huge, changing IP ranges, and Indian home broadband usually has a dynamic/CGNAT IP. The owner's constraint: **no external service that may start charging later.**
**Decision:**
- **Owner SSH over WireGuard** (open source, self-hosted on the VPS, no third-party account). UDP port for WireGuard is open; TCP 22 is reachable **only** through the tunnel. The owner's PC/phone hold WireGuard client configs generated during T0.14.
- **Pull-based deploys — CI never connects to the VPS.** CI builds images, pushes them to GHCR by digest, and publishes a signed release manifest (digests per service) for the environment. A systemd timer on the VPS (as the restricted `deploy` user) polls for a new manifest, verifies it, runs `infra/vps/deploy.sh` (pull by digest → migrate if needed → rolling restart with health waits → smoke checks), and records the result in `deploy/releases.log`. Production manifests are published only by the `deploy-prod` workflow, which requires manual approval in the GitHub `production` environment.
- Rejected: Tailscale (third-party account; free tier could change), opening SSH to GitHub's IP ranges (effectively public SSH).
**Consequences:** No deploy secrets that grant access to the VPS live in GitHub. Deploy latency = poll interval (~1 min). `deploy-staging.yml` publishes instead of SSHing; T0.14 implements the VPS side. Rollback = publish/pin the previous manifest.

### #28 — Public GitHub repository — ACCEPTED (owner, 9 Oct 2026)
**Decision:** The code lives in the owner's **public** repo `github.com/syedtalha88/Al-Masjid`. Branch protection/rulesets with required checks are enforced on public repos on GitHub Free; standard Actions runners and public GHCR images are free.
**Consequences:** Specs and code are public. Security never depends on secrecy of the code: secrets live only in VPS env files / GitHub environment secrets, gitleaks runs pre-commit and in CI, and the security-reviewer checks every phase. Container images on GHCR are public (they contain no secrets — env is injected at runtime).

### #29 — HSTS without `preload` until launch — ACCEPTED (owner: "whichever is better", 9 Oct 2026)
**Decision:** Send `Strict-Transport-Security: max-age=63072000; includeSubDomains` from Phase 0. Add `preload` and submit to the preload list deliberately in Phase 9, once the domain plan is final. (A+ grades don't require it.)

### #30 — Installability verified without Lighthouse's PWA category — ACCEPTED (owner, 9 Oct 2026)
**Decision:** T0.11's "Lighthouse installable checks" is replaced by: Playwright (Chromium) calls the DevTools Protocol `Page.getInstallabilityErrors` and asserts an empty list for both apps; a manifest-schema unit test (required fields, icon sizes/purposes, `id`, `scope`, `start_url`); and the owner's manual install check (guide 0.10). Free, no extra tools.

### #31 — Two image targets: `runtime` and `runtime-test` — ACCEPTED (owner, 9 Oct 2026)
**Decision:** One Dockerfile with a shared build stage and two final targets: `runtime` (shipped, Trivy-scanned, test hooks excluded) and `runtime-test` (same build output + the test-hooks module, used only by CI e2e). A CI check asserts the `runtime` image contains no test-hook code or routes.

### #35 — Owner choices: Sentry, branding — ACCEPTED (owner, 9 Oct 2026)
**Decision:** Sentry is wired in (T0.13) but stays a no-op until the owner creates a free Sentry account and adds DSNs. Branding confirmed for now: name "Masjid Connect", home-screen label "Masjid" (admin: "Masjid Admin"), placeholder brand mark (green rounded square, white dome glyph).
**Cost note (owner asked to avoid services that charge later):** free — Cloudflare (free plan), GitHub (public repo), Sentry (free plan), WireGuard. Paid by design in the existing plan (01 §11): the VPS, MongoDB Atlas production (M10 + backup), Bunny Stream (usage-based), AWS S3 (small), the domain. Cheaper alternatives (self-hosted MongoDB, YouTube-only videos) are to be decided before Phase 1 / Phase 6.

### #36 — SPA scaffolds (T0.4) — ACCEPTED (9 Oct 2026)
**Decision:**
- **`@vitejs/plugin-react` 6 (Oxc) instead of the SWC plugin** named in 01 §4. With Vite 8 (rolldown), the official plugin transforms JSX with Oxc — no Babel, no native SWC binary to install — and is the Vite team's default. Behaviour for us is identical (JSX + Fast Refresh).
- **Vite 8.3, React 19.3, TanStack Router 1.170 (file-based, `autoCodeSplitting`), TanStack Query 5.104.** `src/routeTree.gen.ts` is generated by the router plugin and committed (typecheck runs before any build in CI); it is excluded from lint/format.
- **`erasableSyntaxOnly: true`** in the shared tsconfig: Vite 8 loads workspace TypeScript in its config through Node's type stripping, which rejects non-erasable syntax (constructor parameter properties, enums, namespaces). The compiler now forbids that syntax everywhere.
- Build env: Vite `envPrefix = VITE_PUBLIC_` and `parseClientEnv()` runs when the config loads, so a non-public `VITE_*` variable or a missing/invalid public one fails the build/dev server.
- `index.html` has no inline script/style and no hard-coded brand values: `%MC_APP_NAME%`/`%MC_THEME_COLOR%` are filled from `brand.ts` by a tiny Vite plugin. `modulePreload.polyfill` off (no inline polyfill — CSP); build source maps `hidden` (for Sentry upload only).
- Dev ports: app 5173 → `/api` proxy to api-public 8787; admin 5174 → api-admin 8788.

### #38 — i18n runtime & formatting details (T0.7) — ACCEPTED (9 Oct 2026)
**Decision:**
- **Libraries (09 §2):** i18next 26.4, react-i18next 17.0, i18next-icu 2.5 + intl-messageformat 12.1 (ICU plurals/select). `@mc/i18n` is a runtime dependency of both apps. **Bundle impact (measured from the source map):** ≈ 89 KB minified / ≈ 29 KB gzip of the initial JS (i18next 42 KB, ICU parser + skeleton parser 26 KB, rest small). Musalli `/` initial JS is now 130.8 KB gzip of the 170 KB budget. Follow-up F14: precompile ICU messages to ASTs at build time to drop the parser (~8 KB gzip) if the budget gets tight.
- **Lazy namespaces:** each `locales/<lng>/<ns>.json` is its own chunk via `import.meta.glob` + a 20-line i18next backend (no `i18next-http-backend`), so a device downloads only its language. Keys are typed from the English JSON (`CustomTypeOptions`), so a wrong key fails typecheck — no generated `.d.ts` needed.
- **Pre-paint `<html lang dir>` (09 §5, F7):** an external classic script `/boot.js` (emitted by the `mcLocaleBoot()` Vite plugin, first element in `<head>`, served `no-cache` by Caddy) reads the `mc.locale` localStorage mirror → browser languages → `en`. External file, not inline, so the CSP needs no `'unsafe-inline'`/hash. It is the serialized source of `bootDocumentLocale()`; a test runs it in an empty VM realm to prove it is self-contained.
- **Money always uses `en-IN` grouping** (`₹1,00,000`) in every locale: `ur-IN` would group as `₹100,000`, contradicting 09 §4.
- **Times:** the space before AM/PM is normalized to one U+00A0 no-break space in every locale (ICU emits U+202F for `en-IN` but U+0020 for the others), so "AM" never wraps alone and output is identical across ICU versions.
- **`i18n:check` measures length in grapheme clusters** (`Intl.Segmenter`), not code points: Indic vowel signs, viramas and anusvara join their base letter, so code-point counts overstated Telugu/Hindi by ~2×. `maxLength` in `meta/<ns>.json` is a soft UI-space hint per key.
- **Review flow:** `review/<locale>.csv` (namespace,key,en,draft,reviewed). A row keeps `reviewed=yes` only while its draft is unchanged; `i18n:check` fails if a CSV is stale. Unreviewed counts are printed, not a failure (owner decides — 09 §3). `glossary.md` holds draft native-script forms of the 09 §3 terms, awaiting the owner's translators.

### #39 — Bayan videos are YouTube links only (no video hosting) — ACCEPTED (owner, 10 Oct 2026)
**Context:** The owner wants no services that can start charging. Bunny Stream (#10) bills per GB stored and delivered — the largest variable cost in 01 §11.
**Decision:**
- Masjid admins upload bayans to **their own YouTube channel** (Unlisted or Public) and paste the link in the admin app. We host no video: no Bunny, no TUS upload, no HLS/hls.js, no Bunny webhook or `hookScope('bunny')`, no video storage quotas.
- **Link → embed:** `api-admin` accepts only `https://` links on `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`, `www.youtube-nocookie.com` in the forms `/watch?v=`, `youtu.be/<id>`, `/shorts/<id>`, `/live/<id>`, `/embed/<id>`; extracts the 11-character id (`[A-Za-z0-9_-]{11}`) and an optional start time (`t`/`start`, seconds or `1h2m3s`). Only the id + start seconds are stored — never the pasted URL. The app builds the player URL itself: `https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0&playsinline=1[&start=n]`. Anything else (playlists without a video, channels, other hosts, look-alike domains) is rejected with a friendly error (04 §6).
- **Check before publish:** the server calls YouTube oEmbed (fixed host, validated id — no SSRF) to get the title and to refuse private / deleted / embedding-disabled videos (behaviour verified against current docs in Phase 6).
- **Privacy (CLAUDE.md §2.1):** when the admin publishes, `api-admin` copies the thumbnail once (`i.ytimg.com/vi/<id>/hqdefault.jpg`, fixed host), runs it through the normal image pipeline and stores it in Cloudinary (#40). Musalli phones show that thumbnail with a play button (facade) and contact YouTube **only after the user taps Play**. CSP: `frame-src https://www.youtube-nocookie.com` only; no Google script loads before the tap.
- **Audience (brothers / sisters / everyone)** stays and is enforced server-side like every other item. Limitation accepted by the owner: anyone who has the YouTube link can watch an Unlisted video outside our app. When an admin picks "sisters only", the app warns them of this and advises Unlisted.
- **Moderation / takedown:** removing a bayan hides it everywhere in our app (05 §9); the video itself lives on the masjid's YouTube channel, outside our control — the takedown response says so.
- Videos are online-only; YouTube's own player is used (no custom controls). The 90 KB player chunk budget no longer applies; the facade is a few KB.
**Consequences:** Zero video cost and a much smaller Phase 6. Admins need a YouTube account. Product spec §4.3, 01 §5.4, 02 (items.video), 03 (videos), 04 §6–7, 07 A12/B10 and PHASE_06 are rewritten to match.

### #40 — Images and private files on Cloudinary; logs stay on the VPS — ACCEPTED (owner, 10 Oct 2026)
**Context:** Owner replaced AWS S3 (#23) with Cloudinary to stay on free services. Cloudinary Free plan (checked 10 Oct 2026): $0, no credit card, 25 credits/month (1 credit = 1 GB storage **or** 1 GB image bandwidth **or** 1,000 transformations). Without a card on file it cannot bill us; exceeding the credits degrades service, so usage must stay well inside them. Free-plan data location could not be confirmed (likely outside India).
**Decision:**
- **Images:** `api-admin` still sanitizes every upload itself (busboy 10 MB limit → magic-byte check → `sharp` decode with pixel limit → strip all metadata incl. GPS → re-encode → thumbhash), then uploads **one sanitized master** to Cloudinary with a server-side signed upload under `m/<masjidId>/<random-uuid>`. Originals never leave our server unsanitized.
- **Delivery through our own domain:** `media.<domain>` (Caddy route → `res.cloudinary.com`, path allow-list) behind Cloudflare with `Cache-Control: public, max-age=31536000, immutable`. Most views are served from Cloudflare's free cache, so Cloudinary bandwidth ≈ cache misses only; musalli IPs never reach Cloudinary; CSP `img-src` stays our own origins. Cloudinary **strict transformations ON** with six named transformations (480/960/1440 × AVIF/WebP, explicit formats — not `f_auto`, because the Cloudflare free cache does not vary on `Accept`).
- **Legal-order documents** (Super Admin only): encrypted server-side with AES-256-GCM (`FIELD_ENCRYPTION_KEY`, key id stored) **before** upload, stored as Cloudinary `raw` + `authenticated` assets; downloaded and decrypted only inside `api-admin` and streamed to the Super Admin. No signed URL ever reaches a browser. Cloudinary only ever holds ciphertext, so its storage location does not expose content.
- **Logs (CERT-In, replaces #24's S3 archive):** pino → Docker `local` driver with rotation → daily compressed archive on the VPS (`/var/log/masjid-connect/archive`, mode 600) kept **200 days** (≥ 180 required), encrypted to a public key (the private key stays with the owner offline), deleted by a systemd timer after 200 days; included in VPS backups. Logs stay in India (Mumbai VPS).
- **Credentials:** `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` only in `api-admin` (upload) and `worker` (retention deletes + usage check), each with its **own API key** so one can be revoked alone (the free plan has no per-key permission scopes — accepted). `api-public` holds no Cloudinary secret (forbidden-variable boot assertion). Deletes also invalidate the CDN copy and purge Cloudflare.
- **Budget guard:** the worker reads Cloudinary's usage daily; the Super Admin dashboard shows credits used and alerts at 70% and 90%. Image uploads stay rate-limited per masjid (03 §3).
- Local dev/tests: the filesystem adapter with the same interface (no Cloudinary account needed locally).
**Consequences:** No AWS account. One more account (Cloudinary) with MFA. VPS disk now holds the log archive (sized in T0.14). 01 §2/§5.5/§7/§11, 02, 04, 05, 10 and the phase files are updated to match.

### #41 — Design tokens, type scale & fonts (T0.6) — ACCEPTED (10 Oct 2026)
**Decision:**
- **Tailwind CSS 4.3** via `@tailwindcss/vite`. Tokens live in `packages/ui/src/tokens/tokens.ts` (single source); `pnpm --filter @mc/ui generate` writes `tokens.css` (`@theme static` with the default color, font, text, tracking, leading, radius, shadow, ease and animate namespaces set to `initial`, so raw palette classes do not exist) and `type.css`. A unit test fails when a generated file is stale; generated CSS is excluded from Prettier. Spacing stays the 4-pt multiplier (`--spacing: 0.25rem`).
- **Type scale as `type-*` utilities** (`type-headline`, `type-time-large`…), each setting size + line height + weight + tracking together, because Tailwind documents no weight/tracking companions for `--text-*`. Locale and admin adjustments (06 §3) are CSS variables on `<html>`: `:lang(hi|te)` line-height × 1.12 and no tracking; `:lang(ur)` +2px with line-height ≥ 1.9; `[data-app=admin]` +2px everywhere. Arabic (`type-arabic-*`) is never scaled by locale.
- **Contrast (closes F8):** six sampled colors darkened minimally (same hue) to pass WCAG AA on every background they are used on: text-tertiary `#8A938E→#676F6A`, danger `#C93C3C→#C43636`, rose `#B4475A→#AD4456`, info `#2E6BE6→#2363E5`, heart `#D64550→#CB2D39`, facilities `#9A6A00→#926500`. `test/tokens.test.ts` checks every text/background pair (26) at ≥ 4.5:1.
- **Fonts (09 §6):** Fontsource 5.3 files, but only the subsets we use are declared (our own `@font-face`, `unicode-range` copied from upstream by the generator): Inter latin, Noto Sans Devanagari/Telugu script subsets, Noto Nastaliq Urdu arabic, Amiri arabic 400/700. Locale stacks: Inter first (Latin, times, amounts), then the locale's script font, then system fonts. `/boot.js` preloads the active locale's fonts (Inter + Devanagari/Telugu); Nastaliq is not preloaded (Urdu shows the system font first) and Amiri loads only when Arabic text renders. E2E proves each locale downloads only its own fonts.
- **No Inter latin-ext (85 KB):** it is needed mostly for "₹", which the system fallback renders.
- **Fallback metrics:** Capsize-generated `Inter Fallback: Arial/Roboto` faces (size-adjust/ascent/descent overrides) **restricted to Inter's Latin `unicode-range`** — unrestricted, Arial's Arabic glyphs would have drawn Urdu text instead of Nastaliq (caught by the e2e). Measured CLS ≤ 0.01 for all four locales (Chromium Layout Instability API; Lighthouse CI arrives with T0.12).
- **Budget deviation (01 §9 "fonts on first load ≤ 120 KB"):** met for `en` (48 KB) and `ur` (48 KB first, Nastaliq 239 KB lazy ≤ 350 KB). `hi` = 48 + 121 KB and `te` = 48 + 124 KB ≈ 170 KB: the Devanagari/Telugu variable fonts alone exceed 120 KB, and static weights would be larger. Accepted per-locale budget: ≤ 180 KB for `hi`/`te`. Cheaper later options if needed: `local()` system Noto first (Android ships it), or a custom glyph subset.
- **Apps:** new runtime dependency `@mc/ui` (workspace) — JS impact 0 KB today (`/` initial JS unchanged at 130.81 KB gz); CSS 3.6 KB gz. Icons: 5 custom prayer icons + masjid glyph/tile on Phosphor's 256-grid/1.5px stroke, 3 illustrations (< 4 KB each, tested); all colored by token classes.

### #42 — One VPS hosts staging and production — ACCEPTED (owner, 10 Oct 2026; amends #21)
**Context:** Owner has one Hostinger VPS (Mumbai, 4 vCPU / 16 GB, Ubuntu 24.04, static IPv4) and wants no second server. #21 assumed one VPS per environment.
**Decision:** Staging and production run as two **separate Docker Compose projects** on the same host, isolated as far as one machine allows:
- separate Compose project names, networks, Redis containers (own ACL passwords), env directories (`/etc/masjid-connect/staging/`, `/etc/masjid-connect/production/`, mode 600), images pinned by digest, and deploy users/keys; no shared volumes;
- separate MongoDB Atlas projects/users and Cloudinary folders + API keys, so a staging credential never opens production data;
- one host Caddy is not shared: each project has its own Caddy bound to distinct internal ports, fronted by a small host-level router (or one Caddy with strictly separate site blocks — chosen in T0.14), all behind Cloudflare with Authenticated Origin Pulls;
- per-project CPU/memory limits so a staging load test cannot starve production; staging is stopped during production incidents if needed;
- hostnames: `app.almasjids.com`, `admin.almasjids.com`, `media.almasjids.com` (production) and `app-staging.`, `admin-staging.`, `media-staging.` (staging).
**Consequences / accepted risk:** a host-level compromise (e.g. via a staging container escape or a leaked staging deploy key) reaches production too, and kernel/Docker upgrades restart both. Mitigations above; the deploy runbook (T0.14) and the Phase 9 hardening review re-check this. Owner can add a second VPS later without code changes.

### #43 — Motion foundation (T0.8) — ACCEPTED (10 Oct 2026)
**Decision:**
- **Motion 14.0** (`motion/react`, `m.*` from `motion/react-m`). 14.0 only removed internal APIs; the springs (`visualDuration` + `bounce`), `LazyMotion`, `MotionConfig` used here are unchanged (checked against motion.dev docs and the changelog). Root `MotionProvider` = `LazyMotion strict` with **lazily loaded** `domAnimation` (own chunk, 15.8 KB gz) + `MotionConfig reducedMotion="user"` as a safety net + our `{reduced, lite}` context.
- **Measured cost:** `LazyMotion` at the root pulls Motion's shared runtime into the initial JS (+9.7 KB gz: `/` 131.2 → 141.2 KB). Verified by experiment that neither `MotionConfig` nor `strict` causes it and that a root without Motion is back to 131.2 KB. Deferring `LazyMotion` itself would remount the whole app when it arrives, so it stays; tracked under F15.
- **Tokens** (`packages/ui/src/motion/tokens.ts`) exactly per 08 §2, plus `tween.countUp` / `drawCircle` / `drawCheck` for 08 §5.7–5.8. The generator turns every spring into CSS (`motion.css`, Motion's `spring()` → `linear()` easing, cubic-bezier fallback first) so CSS-only transitions share the same physics.
- **Press feedback is CSS, not JS:** `Pressable` sets `data-pressed` synchronously on `pointerdown` (same frame; compositor-only scale with the `spring.snappy` curve), releases on ≥ 8 px movement or `pointercancel`, long-press 500 ms, and keeps native `<button>` activation for keyboard/screen readers. No animation engine needed for taps.
- **Reduced motion:** `useReducedMotionPref` (live `matchMedia`); every moving presence goes through `motionOrFade()` → `tween.fade` crossfade. `SuccessCheck` appears drawn, `CountUp` shows the final value, `DigitRoll` crossfades.
- **Lite motion:** `hardwareConcurrency ≤ 4` and (`deviceMemory ≤ 3` or unknown), or ≥ 3 dropped-frame bursts (a frame ≥ 50 ms; consecutive slow frames = one burst; only measured while something animates via `trackMotion()`, never while the page is hidden).
- **Haptics:** 08 §7 patterns via `navigator.vibrate`; setting "Vibration" default on, in memory until the device store exists (F16).
- **Lint:** `mc/no-adhoc-motion` now also rejects hard-coded CSS timings in inline styles (`transition: 'opacity 300ms'`, `cubic-bezier(…)`).

### #44 — Navigation system (T0.9) — ACCEPTED (10 Oct 2026)
**Decision:**
- **Browser history is the single source of truth.** TanStack Router keeps owning URLs, history, code splitting and matching; a pure reducer (`packages/ui/src/navigation/model.ts`, unit-tested incl. a 200-step random sequence) turns every location change — our push/back, Android back, browser back/forward, deep links — into per-tab stacks + one transition. Entries are identified by history-entry keys (`mcKey` → TanStack `__TSR_key`); re-targeting an existing screen (tab tap, re-tap → pop to root, deep-link back onto a synthetic root) pushes/replaces with that key.
- **Screens are rendered by the navigator, not `<Outlet>`.** The root route renders `StackNavigator`; each stack entry renders its route's (code-split) component from its own frozen location, so covered screens keep their content during and after transitions. Consequence: **screens read params/search with `useScreen()`**, never the router's `useParams`/`useSearch` (those follow the current URL). The router's window scroll restoration is off; each screen has its own scroll container, kept while mounted (max 3 per stack) and cached when unmounted.
- **Back follows history** (web/PWA behaviour): back from a tab you switched to returns to the previous tab's screen. Re-tapping the active tab pops to its root and scrolls to top.
- **Animations are Motion springs on MotionValues** (amended 10 Oct 2026, owner rule "quality over bundle size", PROGRESS F19; the first T0.9 version used CSS transitions). `packages/ui/src/navigation/driver.ts` gives every animated layer property (screen x, dim, tab fade, modal y, app scale/radius) a `MotionValue` written straight to the element's style, so React never re-renders during a transition or gesture. Interrupting continues from the current position **and velocity**; asking for the target a running animation already heads to joins it (a swipe release followed by its `popstate` does not restart the spring). Moving layers get `will-change` and `data-animating` only while they move (08 §9; e2e waits on `data-animating`).
- **Motion 14 ignores velocity on `visualDuration`/`bounce` springs** (time-defined springs drop inherited and explicit velocity — verified in `motion-dom` 14.0.0 source). Navigation therefore uses `springPhysics(spring.smooth)`: the same token converted to stiffness/damping/mass with Motion's own formula; a unit test proves the curves are identical and that velocity is honoured. Other tokens stay in `visualDuration` form.
- **Swipe release** hands the finger's velocity to the springs (top screen, parallax and dim, each in its own units). New: a flick back towards the edge (< −500 px/s) cancels even past 35 %; a drag that activates while the screen is still springing grabs it where it is (no jump). Fixed while extracting the pure `swipeRelease()`: when the finger paused before lifting, velocity was measured from the *oldest* sample (a slow drag could commit as a flick); it now uses the latest one.
- **Cost:** `/` initial JS 149.0 → 162.1 KB gz (+13.1 KB, Motion's animation engine) — accepted under the owner rule (10–20 KB is fine). Reduced motion → crossfades; lite motion → no modal background scale/dim (unchanged).
- **Swipe-back** starts on a 24 px leading-edge strip (`touch-action: pan-y`, pointer captured on down; right edge in RTL), activates after 10 px horizontal movement (vertical wins otherwise), commits on > 500 px/s or > 35 % — velocity from the last 100 ms, ignored when measured over < 10 ms.
- **iOS:** in Safari (browser) a `popstate` we did not cause is applied without our animation (Safari already animated its own edge swipe). In the installed app we assume iOS provides no back swipe, so ours is used — **to be confirmed on the owner's iPhone once staging exists (PROGRESS F17)**.
- **Focus/a11y:** after push focus moves to the new screen's `<h1>`; after pop it returns to the control that opened the screen (or the title — WebKit does not focus tapped buttons); covered screens, inactive tabs and the app under a modal are `inert` + `aria-hidden`; axe (WCAG 2.1 AA) clean on a tab root, a pushed screen and the modal.
- **Performance:** screens are memoized (a navigation re-renders only screens whose state changed); tab-root/modal code is preloaded when idle, pushed screens on press. Under 4× CPU throttling push/pop shows no long task > 50 ms after the first visit of a route (first-time chunk evaluation excluded). Perf specs run alone: `pnpm test:perf` (Playwright `perf` project, one worker).
- **Icons:** tab/back/close/scan icons drawn by us on Phosphor's grid (the `@phosphor-icons/*` packages last released 17 months ago — CLAUDE.md §6 dependency rule).
- **Initial JS:** `/` = 149.0 KB gz at T0.9 (navigator + 6 placeholder routes + tab bar ≈ 7.8 KB over T0.8); 162.1 KB after the Motion amendment above. Tracked in F15.

### #45 — Component library (T0.10) — ACCEPTED (11 Oct 2026; showcase on staging: amended by #58)
**Decision:**
- **Where:** `@mc/ui/components` (06 §6 generic + controls + overlays + feedback), `@mc/ui/icons` (our glyphs on Phosphor's grid — DECISIONS #44), `NavBar`/`ScanFab` in `@mc/ui/navigation`. `AppShell` (06 §6) is the existing `StackNavigator` + `TabBar` pair — no separate component. TabBar items take a `badge` count (Updates).
- **Motion:** everything that moves under a finger or must keep velocity uses the navigator's MotionValue driver (`navigation/driver.ts`: Sheet, Toast, TabPanels swipe, Dialog, OfflineBanner); sliding selection indicators (tab underline, segmented thumb, switch thumb) are compositor CSS transitions on the generated spring curves (they re-target smoothly; no velocity needed). Loop/feedback timings (`loop.*`, `feedback.*`) are tokens generated into `motion.css` (spin, shimmer, shake, ripple, image fade).
- **Overlays are native modal `<dialog>`s** (`showModal`): inert background, Esc via `cancel` (animated close), plus an explicit Tab wrap (Chrome lets Tab leave a modal to the browser UI). A browser-forced close keeps React state in sync. Sheet: `content`/`full` snaps, rubber band `d^0.7`, release → nearest snap by velocity projection (0.2 s) or dismiss (≥ 1200 px/s), finger velocity handed to the spring; scroll hand-off via a non-passive `touchmove` at scrollTop 0. Android back does **not** close sheets/dialogs yet (PROGRESS F21).
- **Accessibility:** labels name controls, descriptions are `aria-describedby` (never part of the name); radio groups for SegmentedControl/ChipGroup/RadioCard (arrow keys mirrored in RTL), ARIA tabs for UnderlineTabs, `spinbutton`s for TimeWheel, `alertdialog` with Cancel focused for destructive dialogs. Switch off-track uses `text-tertiary/80` (3.3:1, WCAG 1.4.11). Admin sizes come from CSS variables (`--mc-hit` 44/56, `--mc-control-*`, `--mc-wheel-row`), not a second component set.
- **Dates and times:** `@mc/domain/time` (calendar dates, wall clock, IST "today", month grids — test-first); calendar formatters (`calendarMonth`, `weekdayShort`, `calendarDate`) in `@mc/i18n` format at UTC midnight so no zone shifts a day.
- **ThumbHash vendored** into `@mc/domain/thumbhash` (MIT, attribution in the file) instead of depending on `thumbhash` (no release since March 2023 — CLAUDE.md §6). Verified byte-identical to 0.1.1 on 200 random images. `Image` paints the hash on a `<canvas>` (no data: URL).
- **Showcase** at `/_dev/showcase` in both apps, dev builds only: the route lazily imports `@mc/ui/showcase` behind `import.meta.env.DEV`, so production builds contain no showcase code and the path renders not-found (the route path string itself remains in the route tree — removing it would mean rewriting the committed `routeTree.gen.ts` per build). `pnpm check:dist` fails a production build containing showcase markup or any 10 §5 dev fixture. Showcase chrome is English dev tooling; sample text is a dev-only per-locale fixture (fake masjid names, 10 §5 placeholders). Its reduced/lite toggles override JS-driven motion only (`MotionPrefsOverride`); CSS-only motion follows the OS setting.
- **Deviations (documented, not built):** OfflineBanner overlays the top instead of pushing content down via transform (08 §5.10); NumberPad amount width does not animate with `layout` (needs `domMax`); chip-filtered list re-sorting (08 §5.2) belongs to the lists in Phase 2.

---

### #46 — PWA baseline (T0.11) — ACCEPTED (11 Oct 2026)
**Decision:**
- **vite-plugin-pwa 1.3.0** (May 2026; supports Vite 8, Workbox 7.4.1) — not the 8-day-old 2.0.0 major; Renovate moves us later. `injectManifest` with our own service workers (`apps/*/src/sw/sw.ts`, own `tsconfig.json` with the WebWorker lib); Workbox modules are build-time dev dependencies bundled into `sw.js` (8.8 KB gz), never into the app. Registration is ours (`@mc/ui/pwa` `useServiceWorker`), not the plugin's virtual module. Shared build setup: `@mc/ui/vite` `mcPwa({ app })`.
- **Manifest** emitted from `webManifest()` (`@mc/shared/pwa`, unit-tested — DECISIONS #30): `id`/`scope` `/`, `start_url` `/?source=pwa`, standalone, portrait, canvas colors, 192/512 any + maskable, 96 monochrome badge; the musalli app adds `launch_handler: focus-existing` and shortcuts (Qibla, Updates — routes arrive in Phases 2/7). Name/colors only from `BRAND`; the admin mark uses primary-900 so the two installed apps differ.
- **Icons and launch screens** are rendered from one SVG (`@mc/shared/brand-mark`) by `pnpm pwa:assets` with Playwright's Chromium (no image toolchain dependency) and committed. Ten iPhone launch screens (`apple-touch-startup-image` with device media queries).
- **Caching (01 §5.6):** precache = the shell (JS/CSS/HTML, Inter, icons, manifest, offline page). Per-locale chunks and script fonts are runtime CacheFirst, so a phone stores only its own locale; on the first visit the page hands the worker the asset URLs it already loaded (`CACHE_URLS`) so offline works without another reload. Musalli SW also routes media images (CacheFirst 300/30 d), versioned API GETs (CacheFirst) and the versions endpoint (NetworkFirst 3 s). Admin SW has no API route at all (verified in e2e: no `/api` URL in any cache).
- **Update flow:** a new worker waits; `useServiceWorker` exposes `updateAvailable`, the persistent toast's Refresh posts `SKIP_WAITING`, and the page reloads only on the resulting `controllerchange` after that tap. Checks for updates hourly and on returning to the foreground. Release id stamped as `<meta name="mc-release">` (`MC_RELEASE`, reused by Sentry in T0.13).
- **Offline page** (`offline.html`, generated at build): the app stylesheet + the offline message in all four languages from the i18n catalogs; no inline script/style (CSP). `AppSurfaces` (offline banner + update toast) is mounted in both apps inside a `ToastProvider`.
- **Caddy:** `offline.html` no-cache, `.webmanifest` served as `application/manifest+json`, icons/splash 1 day.
- **Token exemption (verifier V-14, 14 Oct 2026):** the generated `apps/*/public/icons/favicon.svg` contain literal hex colours — a browser icon cannot read CSS variables. They are generated from `@mc/shared/brand` colours by `pnpm pwa:assets` (never hand-edited), so the T0.6 "no raw hex in `apps/**`" rule exempts generated `.svg` icons; `no-raw-colors.test.ts` keeps covering every source file.
- **Tests:** Chromium refuses service workers on a self-signed origin even with `ignoreHTTPSErrors`, so the Pixel 7 project launches with `--ignore-certificate-errors` (test browsers only). Installability (CDP), admin-no-API, offline reload and the two-build update flow run on Chromium; Playwright's WebKit is not used for service-worker lifecycle checks — the owner's iPhone install check (guide 0.10) covers iOS.

### #47 — Phase 00 exit JS budget raised to 220 KB — ACCEPTED (owner, 13 Oct 2026)
**Context:** PHASE_00 exit criteria set the musalli initial JS (shell, showcase excluded) at ≤ 120 KB gz. Measured 163.2 KB after T0.11: react-dom ≈ 43 %, router, i18n ≈ 29 KB (#38), Motion runtime + animation engine ≈ 23 KB (#43, #44 — kept under the owner's "quality over bundle size" rule). T0.13 adds the Sentry browser SDK.
**Decision:** For **Phase 00 only**, the exit budget for `/` initial JS is **≤ 220 KB gz**; `pnpm size` enforces 220 KB until Phase 00 is DONE. From Phase 01 the 01 §9 budget (≤ 170 KB) applies again, so anything Phase 00 adds above 170 KB must be removed or deferred (lazy Sentry, ICU precompile F14, deferring non-shell code) before Phase 01 closes. All other 01 §9 budgets are unchanged.
**Consequences:** F15 closed for Phase 00; follow-up F23 tracks the return to 170 KB in Phase 01.
**Closed 16 Oct 2026 (F23):** `/` measures 165.4 KB gz after T1.1–T1.12; `pnpm size` enforces 170 KB again.

### #48 — Testing infrastructure (T0.12) — ACCEPTED (13 Oct 2026)
**Decision:**
- **Vitest 5** via `@mc/config/vitest` (`mcVitest`): TZ `Asia/Kolkata`, `*.test.ts` unit vs `*.int.test.ts` integration (`pnpm test:int`, Docker MongoDB/Redis; each file gets its own `test_*` database via `@mc/db/testing` and its own Redis key prefix via `@mc/api/testing`), coverage gates per 10 §2 (proof: `docs/reports/evidence/PHASE_00_T0.12_coverage-gate-proof.txt`). Injectable `Clock` (`@mc/shared/clock`: `systemClock`, `ManualClock`, `ShiftableClock`).
- **MSW 2.15.0, not 3.x:** Vitest 5's `@vitest/mocker` declares an MSW `^2` peer and `strictPeerDependencies` is on. MSW's postinstall (copies the browser worker into `public/`) is denied in `allowBuilds`; we use `msw/node` only. `useMockNetwork()` (`@mc/shared/testing/msw`) fails any request without a handler. First client under test: `requestJson` (`@mc/shared/http`) + the problem+json wire contract (`@mc/shared/contracts`, now also asserted by every API problem test).
- **`@testing-library/user-event` 14.6.7** (14.6.8 was < 24 h old — `minimumReleaseAge`) for component journeys (keyboard-only, RTL, pointer).
- **Playwright base = `@mc/config/playwright`** (01 §3 "playwright base"); every spec imports `test`/`expect` from it: an automatic CSP-violation guard (DOM `securitypolicyviolation` + console), `expectAxeClean()` (WCAG 2.1 A/AA, waits for `data-animating` to clear, fails on **any** violation — stricter than 10 §1's serious/critical), `appLocale` option (`test.use({ appLocale: 'ur' })`), `capture()` per-locale screenshots (`test-results/screens/<device>/<locale>/`), and `perfTrace` + `expectSmooth()` for 08 §8 (Chromium trace → long tasks > 50 ms **with attribution**, visible dropped frames < 5 % using Chromium's `affects_smoothness`, zero layouts forced inside `requestAnimationFrame`). The trace analyzer is pure and unit-tested; event names were checked against a real trace.
- **`page.waitForFunction` does not await async predicates** (verified: a Promise is truthy, the wait returns at once). This made the T0.11 offline spec fail ≈ 1 run in 2 under parallel load; fixed with `expect.poll`, and `no-restricted-syntax` now rejects async `waitForFunction` predicates everywhere.
- **Bundle budgets: size-limit 14.2 + `@size-limit/file`, gzip** (`.size-limit.js`): initial JS = the entry + its modulepreloads read from each `dist/index.html` (no hard-coded hashes), initial CSS, and every other JS chunk individually (≤ 60 kB). Limits: musalli 220 kB for Phase 00 (#47), admin 220 kB, CSS 25 kB.
- **Lighthouse 13.5 directly instead of `@lhci/cli`:** the latest LHCI (0.15.1, June 2025) pins Lighthouse 12.6 and brings Express 4, inquirer 6 and yargs 15. `pnpm lhci` (`scripts/lighthouse.ts`) runs Lighthouse's default mobile profile (Moto G class, simulated Slow 4G, 4× CPU) with Playwright's Chromium: 3 cold runs + 3 warm runs (storage kept → service worker) per app; medians checked by `@mc/config/lighthouse` against 01 §9 (Perf ≥ 90, A11y ≥ 95, BP ≥ 95, LCP ≤ 2.5 s cold / ≤ 1.0 s warm, CLS ≤ 0.05, **TBT ≤ 200 ms as the lab stand-in for INP**). Reports in `.lighthouseci/`. Nothing is uploaded anywhere.
- **Test hooks (10 §3, #31):** routes live in `@mc/api/test-hooks`, declared with `defineRoute`, mounted under each API's own prefix — `/api/v1/test/*` and `/api/admin/test/*` (not a shared `/api/test/*`, which Caddy would have to route specially) — and never registered in OpenAPI. The server build emits them as an extra tsdown entry (sharing chunks, so `ApiProblem`/Zod instances are the host's) and moves it to `dist-test/`; the build fails if any `dist/` bundle contains hook code. Entrypoints load `dist/test-hooks.mjs` only when `APP_ENV=local` **and** `NODE_ENV=test` **and** the file exists. `runtime-test` image = `runtime` + that file + `NODE_ENV=test` (`pnpm stack:up:test`); `pnpm check:image` inspects an image with its own Node (distroless has no shell). First hook: the clock (`ShiftableClock`: real time + offset); seed / run-job / session-injection hooks arrive with the features that need them.
**Consequences:** CI (T0.3) must: build both images and run `check:image` on each, run e2e against the `runtime-test` stack with `E2E_TEST_HOOKS=1` plus the shipped-stack absence check, start and warm the Vite dev server before the showcase spec (a cold dev server compiling on demand failed one Sheet test once), and run `pnpm size` / `pnpm lhci` after the production builds.

### #49 — CI/CD pipeline and supply-chain policy (T0.3) — ACCEPTED (14 Oct 2026)
**Decision:**
- **Workflows:** `ci.yml` (push to `main` and `ci/**`, every PR): `static` (typecheck, lint, format, i18n), `unit` (coverage gates), `security`, `integration` (Docker MongoDB/Redis + the 11 local service security checks), `build-e2e` (production builds → `check:dist` → bundle secret scan → `pnpm size` → shipped stack → `check:image` + Trivy images → e2e on Pixel 7 + iPhone 14 → motion perf → Lighthouse → runtime-test stack → hooks e2e). `codeql.yml` (security-extended), `nightly.yml` (fresh advisories, Trivy, perf ×3, ZAP + Lighthouse on staging once it exists), `deploy-staging.yml`, `deploy-prod.yml`.
- **Least trust in CI:** only GitHub's own actions (`actions/*`, `github/codeql-action`), pinned by commit SHA; every scanner runs as a Docker image pinned by digest (gitleaks 8.30.1, Semgrep 1.180.0, osv-scanner 2.7.0, hadolint 2.15.1, Trivy 0.75.0, actionlint 1.7.12, ZAP 2.17.0) instead of third-party actions. Default token `contents: read`; `packages: write` only in the deploy jobs, `security-events: write` only for CodeQL; `persist-credentials: false`. pnpm via corepack (exact `packageManager` version, as in the Dockerfile). Renovate updates action SHAs and — via a regex manager — the `name:tag@sha256` images in workflow env and Dockerfile ARGs.
- **Failure diagnostics as annotations** (`scripts/ci-annotate.mjs`): raw job logs need a GitHub login; annotations are public, so failing compose steps publish `ps`/`logs` there.
- **Semgrep:** `p/owasp-top-ten` + project rules in `.semgrep/` (no `dangerouslySetInnerHTML`, no `$where`/`$function`/`$accumulator`, the `mongodb`/`systemScope`/`hookScope` import bans, routes only via `defineRoute`, no `console.log`) with `semgrep test` fixtures. Three registry rules are excluded: npm's release-age setting (npm is not used — pnpm 12 ignores install settings in `.npmrc`), Renovate's per-rule release age (set once globally), and pnpm's release age, which wants more than our **3 days** (the delay Renovate itself recommends for npm).
- **pnpm supply-chain policy:** `minimumReleaseAge` 1 → 3 days (matches Renovate), `blockExoticSubdeps: true`, **`trustPolicy: no-downgrade`** (install fails when a package's provenance weakens — the account-takeover pattern). Three locked versions failed the trust check and were reviewed; they are excluded **per exact version** (build/test-time only, pulled in by official parents): `@trickfilm400/rollup-plugin-off-main-thread@3.0.0-pre1` (workbox-build 7.4.1), `chromium-bidi@157.0.8090-0` (Lighthouse → puppeteer-core), `semver@6.3.1`.
- **Trivy policy:** HIGH/CRITICAL **with a fix available** fail (`--ignore-unfixed`); config scan of `infra/`. Found on day one: the official Caddy 2.11.7 binary (Go 1.26.8, x/net 0.59.0) has 4 HIGH DoS CVEs → we compile the same Caddy release with xcaddy in Caddy's builder image (Go 1.27.2) and `x/net` 0.60.0; back to the official binary when a release includes the fixes (PROGRESS F24).
- **Images:** server `runtime` (shipped) / `runtime-test` (e2e); Caddy `base` (local stack, dist mounted) / `runtime` (staging/production: both PWAs built inside Docker with the environment's `VITE_PUBLIC_*` build args, maps removed, `check-dist` + bundle scan inside the build). GHCR names `ghcr.io/syedtalha88/al-masjid-server` and `…/al-masjid-web`.
- **Deploys (#27):** `deploy-staging` is a reusable workflow called by CI's last job (`release-staging`) on pushes to this repository's `main`, after all five jobs passed — **not** via `workflow_run`, which also fires for fork PRs whose branch is named `main` and would build untrusted code with `packages: write` (caught by Semgrep). It builds from that commit: push both images, write the release manifest (digests) as artifact + run summary. `deploy-prod` is manual behind the `production` environment's required reviewer and promotes the staging server image by digest (never rebuilt). Signing and publishing the manifest for the VPS to pull, and the VPS side, are T0.14 (PROGRESS F25).
- **CI e2e runs one Playwright worker:** gesture specs replay finger movements in real time; two workers on the shared 4-vCPU runner distorted them (Sheet drag). Linux WebKit focuses clicked buttons (WebKit on Windows/macOS/iOS does not), so the focus-restore spec now records whether the opener had focus instead of assuming it per engine — reproduced locally with the official Playwright image (`*.localhost` always resolves to the container's own loopback, so a small TCP forwarder points it at Caddy).
- **Found by CI on Linux:** the Redis ACL file (mode 600, host user) is unreadable for the container's `redis` user through a bind mount — Docker Desktop hid it; it is now copied in as `redis:redis 400` before start, like the MongoDB keyfile.
**Consequences:** The owner must enable branch protection with the required checks (instructions in the Phase 00 report). Main stays deployable: nothing merges without all five CI jobs green.

### #50 — Security headers, CSP and Trusted Types (T0.5) — ACCEPTED (14 Oct 2026)
**Decision:**
- **Where:** Caddy sets the 04 §7 set on everything it serves itself (SPA, `offline.html`, assets, manifest, `boot.js`) through snippets inside the SPA handler, so proxied API responses keep the Express set (`default-src 'none'; frame-ancestors 'none'`, T0.4). Caddy's own `/api/*` 404 uses the API set. `Server` is removed. Hosts come from env: `MEDIA_ORIGIN` (img-src) and `CSP_CONNECT_EXTRA` (extra connect-src, e.g. the Sentry ingest host in T0.13; empty by default).
- **Per origin:** the musalli CSP allows `https://challenges.cloudflare.com` (Turnstile: script, connect, frame) and `https://www.youtube-nocookie.com` (frame, DECISIONS #39). The admin CSP drops both (`script-src 'self'`, `frame-src 'none'`) — 04 §7 "minus YouTube/Turnstile where unused"; revisit if an admin preview embeds YouTube (Phase 6) or admin login uses Turnstile (Phase 1). No `'unsafe-inline'` / `'unsafe-eval'` anywhere; the built HTML has no inline script, style, `style=""` or `on*=` (e2e checks).
- **Deviations from the 04 §7 text:** HSTS without `preload` (#29), no `interest-cohort` (#33), and `trusted-types default` **without `dompurify`** — we ship no DOMPurify (CLAUDE.md §2: no user HTML anywhere), so allowing that policy name would only widen the surface.
- **Trusted Types:** `@mc/ui/security` installs the `default` policy as the first module each app evaluates. It allows exactly one script URL — same-origin `/sw.js` without query (the service-worker registration, the only sink the apps use) — and rejects every HTML/script value: throws (naming the sink) in dev, returns `null` in production so the browser blocks the sink and fires `securitypolicyviolation` (to be reported to Sentry in T0.13 — PROGRESS F26). Unit-tested with a fake factory; e2e proves an `innerHTML` assignment is blocked and reported in Chromium **and** WebKit.
- **Testing under CSP:** the T0.12 CSP guard now fails any spec with a violation; the full suite (99 e2e, showcase 19, perf, Lighthouse 99/100/100) passes. Playwright injects a `<style>` while screenshotting; Chromium exempts it from the page CSP, WebKit reports it — the `capture()` helper drops exactly those inline-style reports raised during its own screenshot.
- **Grades:** securityheaders.com and Mozilla Observatory need a public URL → verified on staging in T0.14 (owner guide 0.2).

### #51 — Lighthouse in CI: warm-start TBT reported, not gated — ACCEPTED (Claude Code during the owner-authorised autonomous session, 14 Oct 2026 — **approved by the owner, 14 Oct 2026**)
**Context:** On CI, the warm (service-worker) Lighthouse runs measured app TBT 208 ms (median of 5) and once admin 253 ms, while cold loads measure 0–24 ms and the same warm runs locally measure 3–106 ms. The CI machine is not slower (benchmarkIndex 3141 vs 2655–2988 locally). A warm start evaluates the whole bundle in one burst (two to three ~60–80 ms tasks in `index-*.js` locally), which sometimes exceeds 50 ms per task by more on the runner.
**Decision:**
- 01 §9 defines the warm budget as **LCP ≤ 1.0 s** only; gating warm TBT ≤ 200 ms was extra strictness added in #48. The warm gate now matches the spec: LCP ≤ 1.0 s, CLS ≤ 0.05 and the category scores (Performance ≥ 90 still applies). **Cold-load TBT ≤ 200 ms (the INP proxy) stays gated.**
- Warm TBT is still measured and printed with the longest tasks of the worst run per page (script + duration), and every run prints Lighthouse's `benchmarkIndex`, so a regression is visible. CI takes the median of 5 runs and stops the Vite dev server before measuring.
**Update (same session):** the long-task diagnostics show the worst local warm spike (admin, TBT 270 ms) is an **"Unattributable" 372 ms task** — browser work without a script, not our bundle (whose longest task was 59 ms). A perf trace with attribution then showed what it is: the **re-layout after the web font loads** (`BeginRemoteFontLoad` → `Layout` 52–80 ms at 4× CPU), only on the first warm load (font strategy, #41) — options are listed in F27 for the owner.
**Consequences:** PROGRESS F27 — split the initial bundle's work so a warm start has no task above ~50 ms on CI (e.g. defer non-shell modules, ICU precompile F14), then re-gate warm TBT ≤ 200 ms. If the owner prefers the strict gate now, revert this entry: CI will be red on some runs until F27 is done.

### #52 — Observability baseline (T0.13) — ACCEPTED (Claude Code during the owner-authorised autonomous session, 14 Oct 2026 — **approved by the owner, 14 Oct 2026**)
**Decision:**
- **Sentry SDK 11.6.0** (`@sentry/browser`, `@sentry/node`) — 11.7.0 was younger than the 3-day release age. v11 merged `@sentry/node-core` into `@sentry/node` and no longer takes over OpenTelemetry. **v11 collects cookies, bodies, headers, query params and user info unless told otherwise** (`sendDefaultPii` was removed), so every SDK passes `SENTRY_DATA_COLLECTION` (`@mc/shared/observability`) with every field off.
- **Scrubber** (`scrubEvent`, same module, 22 tests incl. a fast-check property): drops `user` and request cookies/headers/body/query/env, keeps URLs without query or fragment, redacts sensitive keys anywhere (authorization, cookie, password, token, session, email, phone, vpa, push keys…), and replaces emails, phone-like numbers, IPv4/IPv6, UUIDs, JWTs, `Bearer`/`Device` credentials, `user:pass@` and long opaque tokens in every string. Sentry's structural fields (event/trace/span ids, release) pass unchanged. Runs as `beforeSend`, `beforeBreadcrumb` and (server) `beforeSendSpan`.
- **Browser (`@mc/ui/observability`):** off without `VITE_PUBLIC_SENTRY_DSN` — nothing installed, nothing downloaded (e2e proves it). With a DSN, errors, unhandled rejections and CSP / Trusted Types violations are buffered from the start (closes F26) and a small lazy module (`sentry.ts`, named imports: 31 kB gz; a namespace `import('@sentry/browser')` pulled 139.5 kB) loads when idle. No session pings (`BrowserSession` removed), no client reports, no browser tracing. Release = `<meta name="mc-release">`, environment from the host name, tag `app`/`admin`. Screen boundaries and the router's error component report caught errors. Initial JS +0.5 kB (app 165.0 kB, admin 163.3 kB).
- **Server (`apps/server/src/sentry.ts`):** off without `SENTRY_DSN`. `@sentry/node` stays outside the bundle (like BullMQ). `serverName` = process name (not the container host), tag `process`, errors 100 %, traces 5 % (01 §10). The API reports only unexpected 500s through a `reportError` hook in the error mapper (`packages/api` has no Sentry dependency), tagged with the request id; the worker reports heartbeat failures; every process flushes on shutdown.
- **Source maps:** both Dockerfiles move maps (with their bundles) into export-only stages (`server-maps`, `web-maps`) right after building — the served/shipped images contain **0** maps (checked), Caddy also answers 404 for `*.map` (e2e). `deploy-staging` uploads them with `getsentry/sentry-cli` 3.8.0 (pinned by digest, release-based, `--url-prefix /app/dist` and `~/assets`) only when `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` exist; otherwise it prints a notice.
- **Logs:** pino redaction extended with passkey material (`credential`, `attestationObject`, `clientDataJSON`, `authenticatorData`, `signature`, `userHandle`), `email`, `vpa`, `pepper` (CLAUDE.md §6). Every container uses Docker's `local` log driver, 5 × 10 MB; the VPS-wide default and the 200-day archive come with T0.14 (#40).
- **Two Sentry projects suggested** (free plan): `mc-web` (app + admin, DSN is public by design) and `mc-server` (all processes). The owner must enable **"Prevent Storing of IP Addresses"** and **Data Scrubber** in both projects — Sentry still sees the sender's IP at ingest; that setting keeps it from being stored (CLAUDE.md §2.1). When a DSN is set, Caddy's `CSP_CONNECT_EXTRA` must list the Sentry ingest host or the browser SDK's requests are blocked by the CSP.
**Consequences:** PROGRESS F28 — once the owner creates the Sentry projects: verify one test event end to end (arrives scrubbed, stack trace resolves through the uploaded maps, no CSP block).

### #53 — Phase 00 pinned versions (snapshot) — ACCEPTED (14 Oct 2026, T0.15)
**Decision:** The major libraries as pinned at the end of Phase 00 work (exact versions, `saveExact`; Renovate proposes updates weekly, 3-day minimum age, trust policy — #49). Reasons for the non-obvious picks are in the entries named.
| Area | Pinned |
|---|---|
| Runtime | Node 24 (`>=24.15 <25`; Node 26 after 28 Oct 2026 — F1) · pnpm 12.10.1 · Turborepo 2.11.7 (#32) |
| Language & lint | TypeScript 6.0.3 (held < 6.1 for typescript-eslint — #32) · ESLint 10.12.0 · typescript-eslint 8.71.1 · Prettier 3.9.9 |
| Front end | React 19.3.0 · Vite 8.3.3 · TanStack Router 1.170.41 / Query 5.104.1 (#36) · Tailwind CSS 4.3.3 (#41) · Motion 14.0.0 (#43, #44) · vite-plugin-pwa 1.3.0 (#46) · i18next 26.4.2 / react-i18next 17.0.16 (#38) |
| Server | Express 5.2.1 · helmet 8.3.0 · pino 10.4.0 · Zod 4.6.5 · BullMQ 6.3.11 / ioredis 6.0.0 (#34) · mongodb driver 7.6.0 · tsdown 0.23.0 (#34) |
| Observability | Sentry 11.6.0 (`@sentry/browser`, `@sentry/node` — #52) |
| Testing | Vitest 5.0.3 · Playwright 1.63.0 · @axe-core/playwright 4.13.0 · MSW 2.15.0 (#48) · fast-check 4.10.2 · Lighthouse 13.5.0 · size-limit 14.2.0 (#48) |
| Images (by digest) | node 24.21.0-trixie-slim · distroless nodejs24-debian13 · Caddy 2.11.7 built from source (#49) · mongo 8.0.32 · redis 8.10.2 (#37) |
| CI scanners (by digest) | gitleaks 8.30.1 · Semgrep 1.180.0 · osv-scanner 2.7.0 · hadolint 2.15.1 · Trivy 0.75.0 · actionlint 1.7.12 · ZAP 2.17.0 · sentry-cli 3.8.0 (#49, #52) |
**Pending:** the iOS swipe-back finding T0.15 also asks for needs the owner's iPhone on staging (PROGRESS F17, after T0.14).

### #54 — One VPS: an SNI router in front of the per-environment Caddies — ACCEPTED (Claude Code during the owner-authorised autonomous session, 14 Oct 2026 — **approved by the owner, 14 Oct 2026**)
**Context:** #42 left open how staging and production (separate Compose projects) share the VPS's port 443: "a small host-level router, or one Caddy with strictly separate site blocks — chosen in T0.14".
**Decision:** A third Compose project `mc-edge` runs **HAProxy in TCP mode** (official `haproxy` Alpine image, pinned by digest, non-root, read-only) that routes TLS connections by **SNI** to `mc-staging`'s or `mc-production`'s web container and closes anything else. It never decrypts, holds no certificates or keys, and needs no change to our Caddyfile: each environment's Caddy keeps terminating TLS with its own Cloudflare Origin CA certificate and enforcing Authenticated Origin Pulls (`CADDY_TLS=origin`). Port 80 is not opened (Cloudflare redirects to HTTPS and connects to the origin on 443 only).
**Why not one shared Caddy:** it would hold both environments' certificates and route plaintext for both — a staging config mistake could expose production traffic; the TCP router keeps the environments' TLS and headers fully separate. **Why HAProxy:** standard SNI routing without plugins (Caddy needs the non-standard layer4 module for this), tiny, well-audited.
**Consequences:** one extra small container; the edge is a single point of failure for both environments (as the host is anyway — #42). Plan: `docs/runbooks/T0.14_STAGING_SESSION_PLAN.md`.

### #55 — Release delivery to the VPS: SSH-signed manifests on a GitHub pre-release — ACCEPTED (Claude Code during the owner-authorised autonomous session, 14 Oct 2026 — **approved by the owner, 14 Oct 2026**; closes the design part of PROGRESS F25)
**Context:** #27 requires pull deploys with a *signed* release manifest and no external service that may start charging; the VPS needs a place to fetch manifests from without credentials.
**Decision:**
- **Signature:** OpenSSH's built-in file signing (`ssh-keygen -Y sign`, namespace `masjid-connect-release`), verified on the VPS with `ssh-keygen -Y verify` against `/etc/masjid-connect/<env>/allowed_signers`. No extra tools, no external signing service, no account. **One key per environment**, generated on the server; the private key is stored only as a GitHub *environment* secret (`staging` / `production` — the latter behind the owner's required approval) and then deleted from the server.
- **Delivery:** the release job uploads `release-manifest.json` + `.sig` to a fixed GitHub **pre-release** per environment (`staging-current`, `production-current`), replacing the assets each time (`gh release upload --clobber`, `contents: write` only in that job). The VPS fetches both with plain `curl` from the public download URLs every minute (no API token, no rate-limited API calls).
- The VPS deploys only when the signature verifies and the manifest names a different release; every deploy is appended to `deploy/releases.log` together with the full manifest, so rollback re-deploys a previous verified manifest.
- Rejected: Sigstore/cosign keyless (an external public service — free today, but the owner prefers none) and an OCI artifact in GHCR (needs `oras` on the server).
**Consequences:** prepared 14 Oct 2026 — CI signing + upload step in `deploy-staging.yml` (dormant until the staging key secret exists; the manifest stays a workflow artifact meanwhile) and `infra/vps/deploy.sh` (fetch → `ssh-keygen -Y verify` → environment/commit/registry-digest checks → `docker compose` pull/up --wait → in-project smoke checks → `releases.log`; `--check-only`; `--rollback` pins the release it leaves so the timer does not redeploy it). The verification half is tested in CI (`infra/vps/test/deploy-verify.test.sh`, 9 cases incl. tampering, wrong key, wrong environment, foreign registry, tag instead of digest). The keys are created on the server with the owner in T0.14; the docker half runs for the first time there.

### #56 — VPS deploys run as a root systemd timer, not a `deploy` user — ACCEPTED (Claude Code during the owner-authorised autonomous session, 14 Oct 2026 — **approved by the owner, 14 Oct 2026**; amends #27)
**Context:** #27 and 04 §12.1 describe a restricted `deploy` user whose SSH key may only run the deploy script — written for SSH-from-CI deploys. With pull deploys (#27) there is no SSH key and no network entry point at all. Meanwhile 04 §12.2 requires the secret env files to be **600 root**, and `docker compose` reads `env_file`s as the user who runs it; membership of the `docker` group is root-equivalent anyway.
**Decision:** `mc-deploy@<env>.timer` runs `/opt/masjid-connect/infra/vps/deploy.sh <env>` **as root** every minute. The script comes from a root-owned git checkout that `deploy.sh` moves to the **signed release commit** before deploying (compose files, Caddy/Redis config and scripts always match the images; git verifies every object against the SHA). No user can log in to deploy; the only way to change what runs is a correctly signed manifest (#55). Other units: `mc-cloudflare-ips.timer` (weekly), `mc-docker-user-firewall.service` (after Docker starts), `mc-log-archive.timer` (daily, `age`-encrypted to the owner's public key, 200 days — #40).
**Provisioning** (`infra/vps/provision.sh`) is staged so it cannot lock the owner out: `base` keeps port 22 open; `lockdown` closes it and **refuses to run unless the current SSH session already arrives through WireGuard**. SSH config is validated with `sshd -t` before reload; Docker's apt key fingerprint is checked before it is trusted.
**Consequences:** the T0.14 session plan and `check.sh` reflect this; tested locally: firewall script (privileged Ubuntu container), log archive (encrypt → decrypt, retention, refusal of a bad key), unit syntax (`systemd-analyze verify`), shellcheck on every script. `provision.sh` itself runs for the first time on the server with the owner.

### #57 — Authenticated Origin Pulls: zone-level with our own CA, not the global certificate — ACCEPTED (14 Oct 2026, T0.14 with the owner)
**Context:** `infra/cloudflare/README.md` planned Cloudflare's downloadable origin-pull CA. Cloudflare's docs (checked 14 Oct 2026) call that **global** AOP certificate "shared across all Cloudflare accounts": it proves a request comes from Cloudflare, not from *our* zone — anyone could proxy their own Cloudflare zone to our IP and pass both the IP allow-list and the client-certificate check. **Zone-level** AOP uses a certificate the customer uploads ("exclusive to your account"); available on the Free plan.
**Decision:** zone-level AOP. On the VPS (root, `/etc/masjid-connect/aop/`, 700): RSA-2048 CA (10 years; `ca.key` stays there, root 600, only for renewals) and an RSA-2048 client certificate (2 years, `basicConstraints CA:FALSE`, `extendedKeyUsage clientAuth`), uploaded to Cloudflare with its key; the key is then deleted from the server. Caddy's `trust_pool` = our CA (`certs/cloudflare-origin-pull-ca.pem`). The `certs/` directory is `root:1000 750`, files `640` — Caddy runs as uid 1000 in the web container (fixes `provision.sh`, which made it root 700).
**Consequences:** renewal every 2 years (Cloudflare e-mails 30 and 14 days before expiry; DEPLOY runbook). Generation tested in ubuntu:24.04 (`openssl verify -purpose sslclient` OK). Production uses the same zone-level certificate (same zone).

### #59 — VPS layout after the Phase 00 security review: host scripts apart from release checkouts — ACCEPTED (14 Oct 2026; amends #42, #56)
**Context:** security review S-H1 — with one shared checkout, every staging release (auto-signed from `main`) moved the code that root timers, the production deploy and production bind mounts used, so `main` + the staging key = root over production; deploys could also race. S-H3 — recreated containers lost their logs.
**Decision:**
- **Host layer** (`/usr/local/lib/masjid-connect`, root-owned): `deploy.sh`, `cloudflare-ips.sh`, `log-archive.sh`, `check.sh`, `make-env.sh`, the edge router config + compose file, and the systemd units — installed **only** by `provision.sh host <reviewed commit SHA>` (also run by `base`, which now needs `--ref`). Never from a release.
- **Release layer**: one checkout per environment (`/srv/masjid-connect/<env>`), moved only by that environment's signed releases. Its compose file must pass a **hardening policy** in `deploy.sh` before it runs (every service read-only, `cap_drop: ALL`, `no-new-privileges`, no `privileged`/`cap_add`/devices/published ports/host namespaces, bind mounts only from the environment's config directory or its own `infra/`).
- One host-wide **deploy lock** (`flock`); **replay protection** (a manifest must be newer than every deployed one — S-M1); **rolling replacement** of api-public, api-admin and web (new containers healthy before the old ones drain — PHASE_00 T0.14 step 4); HAProxy `server-template` for the two web containers during a roll.
- **Logs**: archived hourly per container from the last archived timestamp, and by `deploy.sh` right before it removes any container (production refuses to remove a container whose logs could not be archived).
- **Firewall**: the Cloudflare-only rule matches only traffic **arriving on the public interface** (S-H2 — container egress to :443 is untouched), is applied **before Docker starts** (S-M5) and again after; containers cannot reach the cloud metadata address (S-L8).
**Residual risk (accepted for staging + production on one host, #42):** a malicious staging compose file is limited by the policy above, but staging still runs containers on the production host. Revisit before launch (Phase 9): a separate production VPS removes this entirely.
**Owner impact:** the server needs `provision.sh host <sha>` once (it migrates the 14 Oct layout) — part of owner list O1.

### #58 — Component showcase on staging: a staging-only build flag — ACCEPTED (owner chose option A, 15 Oct 2026; implemented 16 Oct 2026, T0.14; amends #45)
**Context:** PHASE_00 T0.14 ("showcase reachable on staging only") and owner checks 0.3–0.5 (showcase on the phone via the staging links) vs #45 (showcase in dev builds only). Staging runs production builds. Options were A (build flag set only by `deploy-staging.yml`), B (owner checks against `pnpm dev` on the PC over Wi-Fi), C (a separate showcase host).
**Decision (A):**
- Client variable `VITE_PUBLIC_SHOWCASE` (`true`/`false`, empty = unset; `packages/shared/src/env.ts`, documented in `.env.example`). The `/_dev/showcase` route in both apps loads the showcase when `import.meta.env.DEV || import.meta.env.VITE_PUBLIC_SHOWCASE === 'true'` — dot access, so Vite replaces it at build time and every other build drops the import.
- Set **only** in `deploy-staging.yml` (hard-coded `'true'`, not a GitHub variable). `deploy-prod.yml` passes `--build-arg VITE_PUBLIC_SHOWCASE=` (empty) explicitly, so no environment variable can switch it on in production.
- `check:dist` stays strict by default (CI, `pnpm verify`, production image). The web image runs `check-dist --allow-showcase` only when the flag is `true`; that mode requires the showcase to be present **and** every dev-only marker to sit in a lazy JS chunk that neither `index.html` nor the service-worker precache references. The precache ignores `assets/Showcase-*.js` — a normal staging visit never downloads it; initial JS is unchanged.
**Verified (16 Oct 2026):** builds without the flag: strict check passes, no showcase chunk. With the flag: strict check fails (5 markers × 2 apps, all in `Showcase-*.js`), `--allow-showcase` passes; planting the chunk name in `sw.js` makes it fail. Staging-style web image built locally (`docker buildx … --target runtime`): both checks + bundle scan pass. Showcase e2e through the Caddy stack under the real CSP/Trusted Types: 17 passed (Pixel 7 + iPhone 14, 4 locales, axe, sheet gestures); admin showcase renders with no console/CSP errors on both engines.
**Found on the way:** (1) An unset GitHub variable reaches the Docker build as `""` and Vite keeps empty variables, so the first staging web image would have failed on `VITE_PUBLIC_SENTRY_DSN=""` (not an https URL). Optional client variables now treat `""` as unset (unit tested). (2) Chromium (Playwright 1.63) reports Playwright's own screenshot `<style>` as "Applying inline style violates …" when the `style` option is used — the e2e CSP guard's screenshot filter only knew WebKit's wording; extended (the app itself raises no violation).

### #60 — MongoDB for staging and production (PROGRESS F10) — ACCEPTED (owner, 16 Oct 2026: "go with the free one for now")
**Context:** Phase 01 needs a MongoDB replica set with custom roles (#20), views, `$jsonSchema` validators and multi-document transactions. F10 assumed Atlas's free tier could not do this. **Checked against the Atlas docs on 16 Oct 2026:** Free (M0) and Flex clusters **do** support custom roles (created through the Atlas UI/Admin API — `createRole`/`createUser` commands are blocked on *every* Atlas tier, so our design creates users and roles through Atlas anyway); `collMod`, `createIndexes`, `create` (views, validators) are not on the unsupported list; transactions work on any replica set. Limits: M0 = 512 MB, 100 ops/s, 10 GB transfer per 7 days, no backups/auditing; Flex = 5 GB, 500 ops/s, one daily snapshot, **no continuous backup / point-in-time restore, no auditing**, $8–30/month. Dedicated M10 = $0.08/h ≈ $57/month base (US list price; Mumbai shown in the Atlas console may be slightly higher) + Continuous Cloud Backup (storage-based, small at our size).
**Options:**
- **A (recommended): staging on Atlas M0 Free (Mumbai, ₹0); production on Atlas M10 + Continuous Cloud Backup from Phase 9 only** (≈ $60–70/month ≈ ₹5,000–6,000, plus GST if charged). Staging data is tiny and test-only; production needs point-in-time restore and auditing (#6), which only dedicated tiers offer. Nothing is paid before launch.
- **B:** staging on Atlas Flex ($8–30/month) — more headroom than M0, still no PITR; not needed for staging traffic.
- **C:** self-hosted MongoDB on the VPS for staging (₹0) — works, but staging then differs from production (Atlas user/role management, TLS, limits), so Atlas-specific problems would first appear in production. Self-hosting production was rejected in #6 (backups, encryption at rest, patching become the owner's job).
**Decision:** **A for staging — Atlas M0 Free in Mumbai (ap-south-1), ₹0.** If staging outgrows M0 (100 ops/s, 512 MB), move it to Flex. Production stays planned as M10 + Continuous Cloud Backup and is confirmed with the owner (price from the Atlas console) when it is created in Phase 9. Closes PROGRESS F10. Accounts/cluster: owner, with Claude Code at the start of Phase 01 (O8).

### #61 — The environment's compose file is part of the reviewed host layer, not of a release — ACCEPTED (16 Oct 2026, Phase 00 security review H1; amends #59)
**Context:** #59 ran each release's own compose file (checked out at the signed commit) behind a deny-list policy. The Phase 00 re-review (16 Oct 2026) showed the deny-list can be bypassed by a release: a named volume with `driver_opts` bind-mounting `/`, `secrets:`/`configs:`/`env_file:` reading production files, joining `mc-edge-production` to take production traffic, foreign images, `seccomp:unconfined`, `build:`. Any signed staging release (= any push to `main`) could have become root on the host that also runs production.
**Decision:**
- `docker-compose.vps.yml` and `redis.conf` are installed into `/usr/local/lib/masjid-connect/compose/` by `provision.sh host <reviewed sha>` only, like the other host scripts. `deploy.sh` no longer clones or checks out anything; a release supplies **only** signed image digests. The per-environment checkouts in `/srv/masjid-connect` are removed.
- The manifest carries `hostLayer: {compose, redis}` (sha256 at the release commit). `deploy.sh` refuses a release whose hashes differ from the installed files and prints the `provision.sh host <release>` to run; manifests without hashes (before 16 Oct) deploy with a warning.
- The compose policy stays as defence in depth and became stricter: images must be the release's digests or the pinned Redis; no `secrets`/`configs`/`build`/`sysctls`/host `uts`/`cgroup`; `security_opt` exactly `no-new-privileges:true`; no root user; named volumes without driver options; the only external network is this environment's edge network; bind mounts only from the environment's config directory or the host-layer compose directory.
- Tests: one deploy test per bypass (11 policy cases), host-layer mismatch and old-manifest cases; the policy run against the real rendered compose file (passes) and against the named-volume bypass rendered by real Docker Compose (refused).
**Consequences:** a change to the compose file or `redis.conf` now needs the owner's `provision.sh host <sha>` before the release that uses it deploys (the deploy says so). Still recommended before production goes live (Phase 9): one Cloudflare Origin CA certificate **per environment** limited to its own host names, so even a misrouted connection could never terminate the other environment's TLS.

### #62 — Phase 01 starts before Phase 00's formal close; closure items run alongside — ACCEPTED (owner, 16 Oct 2026, option B)
**Context:** CLAUDE.md §3/§5 start a phase only after the previous one is DONE (report, verifier + security review clean, owner verification). On 16 Oct 2026 the owner reviewed staging (phone checks, `check.sh` 100 PASS · 0 FAIL, A+, rollback/auto-deploy demos) and said: "I'm already happy with the output — close Phase 0 as soon as possible and start Phase 1" (option B). The Phase 00 re-review had just found 1 HIGH (fixed: #61), 1 MEDIUM (owner setting) and LOW/report items.
**Decision:** Phase 00 is **accepted by the owner** (16 Oct 2026). Phase 01 starts now. These closure items stay tracked in PROGRESS ("Phase 00 closure") and are finished alongside Phase 01, before Phase 01 itself can be DONE:
- owner: staging environment deployment branches = `main` (review M1); host layer `dfac60e` installed (#61, F33, F34) + `check.sh` output; production environment admin-bypass off (L8); Cloudflare Browser Cache TTL "Respect Existing Headers" (L3); variables `STAGING_APP_URL`/`STAGING_ADMIN_URL` (V-20); iPhone swipe-back answer (F17); design notes; branch ruleset + failing-PR proof (0.15/0.16, last);
- Claude Code: the security review's LOW items (L1, L2, L4–L7, L9, S-L7, S-L9, S-L13) fixed or justified; nightly staging spec accepting `Server: cloudflare` (V-20); `Via` header (V-30); raw-route lint (V-25); font budgets (V-8); userns-remap decision (V-24); deferral entries for F13/F18/F20/F22/F31 (V-26); visual comparison table (V-6); VPS → ap-south-1 latency, measured once the Atlas cluster exists (V-21); stale docs (V-27); `pnpm verify` starting the dev server for the showcase spec; the final Phase 00 report (V-22) and a last verifier/security-reviewer run.
**Consequences:** Phase 01 work and Phase 00 closure commits are interleaved; Phase 01 cannot be marked DONE while any item above is open.

### #63 — Database users & roles: one TypeScript source, local + Atlas appliers (PHASE_01 T1.1) — ACCEPTED (Claude Code, owner-authorised autopilot session, 16 Oct 2026)
**Decision:**
- **Single source:** `packages/db/src/roles.ts` (with the namespace list in `collections.ts`) instead of `infra/mongo/roles.ts`: it is typed, unit-tested against an independent transcription of 02 §4.3, and importable by tests and scripts (`infra/` is not a workspace package). `infra/mongo/atlas-roles.json` is generated from it (`pnpm db:roles:atlas`; a unit test fails when it is stale) for the VPS.
- **Local applier:** `createRole`/`createUser` (SCRAM-SHA-256) per login and database, idempotent (update on re-run); `pnpm db:reset` drops the dev database and applies the four users with the passwords from `.env.local.compose`; refuses any non-localhost URI.
- **Atlas applier:** `createRole`/`createUser` are blocked on every Atlas tier, so `infra/vps/atlas-users.sh` (host layer) calls the Atlas Administration API v2 (checked 16 Oct 2026: service-account OAuth token `POST /api/oauth/token`, `POST|PATCH /groups/{id}/customDBRoles/roles`, `POST|PATCH /groups/{id}/databaseUsers`, `Accept: application/vnd.atlas.2023-01-01+json`, action names `FIND`… per "Custom Role Actions"). Run once by the owner on the VPS with a **temporary service account** (Atlas recommends service accounts; API keys are legacy): it prompts for the client secret without echo, keeps the token off the command line, generates 40-character passwords on the server, writes each connection string only into its process's env file (600 root; `migrate.env` is created with `NODE_ENV`, `APP_ENV`, `MONGODB_DB_NAME`), prints no secret, and re-runs rotate all passwords. Users are scoped to the cluster (`scopes: CLUSTER`). Tested against a mock Atlas API in CI (13 checks).
- **Privilege proof:** `packages/db/test/privileges.int.test.ts` connects as each user to a real MongoDB and checks every (user × collection × CRUD) cell plus view access (≈ 500 checks); capability checks (2) view without source privilege and (3) transactions pass locally. Staging verification uses `connectionStatus` (`showPrivileges`) + read-only probes — no writes to staging data — once the views exist (T1.2).
- **Coverage gate for packages/db** (10 §2, 95 % lines) is enforced on the integration run (`test:int --coverage`: unit + integration tests), because almost all of this package needs MongoDB (`@mc/config/vitest` option `coverageRun: 'integration'`).
- **Staging verification result (owner, 20 Oct 2026, release `58aa924`, `deploy.sh staging --verify-roles`): 17/17 PASS.** `mc_public` 31, `mc_admin` 78, `mc_system` 125, `mc_migrator` 254 privileges in `masjid_connect`, each matching 02 §4.3. None has privileges on any other database. `mc_public` reads a view without privileges on its source (capability 2). A read-only transaction commits for all four (capability 3). The IP access list (only the server's /32) was confirmed on the owner's Atlas screen. T1.1 complete.

### #64 — Schema DSL, frozen migration snapshots, drift check (PHASE_01 T1.2) — ACCEPTED (Claude Code, owner-authorised autopilot session, 16 Oct 2026)
**Decision:**
- **One definition per collection, two outputs:** `packages/db/src/schema/dsl.ts` field builders yield both the Zod schema (data layer) and the MongoDB `$jsonSchema` fragment, instead of deriving validators from Zod internals. They express what Zod cannot say about BSON: `long` (money in paise, versions), UUID `binData`, ObjectId, int vs double. Cross-field rules (items: exactly the detail object of the type; prayers: adhan/jamaat mode rules) are written once per side — validator `oneOf`/`allOf`, Zod `superRefine` — and both sides are tested with the same cases.
- **Validators:** `validationLevel: strict`, `validationAction: error`, `additionalProperties: false` at every level; optional = absent (null rejected). Coordinates accept `double` or `int` (a whole degree serialises as int).
- **Migrations:** one per area (0001–0005), views (0006), seed (0007). Schema migrations apply a **frozen snapshot** in canonical Extended JSON (`pnpm db:migration:snapshot <id>`, refuses to overwrite); the checksum is the snapshot's sha256, so an applied migration can never silently change — a schema change is a new migration. Runner: `_migrations` + expiring lock document, ordered, idempotent (`collMod` for existing collections/views, index replaced when its definition changed). Runs as `mc_migrator` (its 02 §4.3 privileges are sufficient — proven in tests).
- **Drift:** `pnpm db:schema:check` compares validators (read with `promoteLongs: false` so int64 bounds compare exactly), validation level/action, indexes (including unexpected ones) and view pipelines with the current schema.
- **Seed:** `app_settings` "global" is inserted once (`$setOnInsert`); the grievance officer and support contact are clearly marked placeholders ("NOT SET") until the Super Admin sets them in C10 (T1.11) — they must be real before launch (05 §2).
- **Deploys:** the host-layer compose file gains a `migrate` service (profile, migrator credential only, outbound only); `deploy.sh` runs it before the rolling update — a failure leaves the running release untouched. Staging without `migrate.env` (Atlas users not set up yet) skips with a warning; production refuses.

### #65 — Scopes, client and the policy gateway (PHASE_01 T1.4/T1.5) — ACCEPTED (Claude Code, owner-authorised autopilot session, 16 Oct 2026)
**Decision:**
- **Order:** T1.5 (client, scopes, transactions) and T1.4 (policy) were built before T1.3 (state functions), which need both.
- **Scopes** (`src/scope.ts`) are frozen objects with a private brand; `isScope()` rejects look-alikes, and the policy layer refuses an unbranded "scope" for every operation. Admin memberships are deduplicated and frozen. The API builds an admin scope only for an ACTIVE admin (02 §3) — a disabled admin never gets one (enforced in the session layer, T1.8); at the data layer an admin with no memberships sees no masjid data (tested).
- **Client** (`src/client.ts`): one lazily connecting `MongoClient` per process with the 01 §5.1 options; concurrent first callers share one connect; a failed connect can be retried; `ping()` never throws (health). `withTransaction` = driver `session.withTransaction` with majority read/write concern and primary reads; the callback must be re-runnable (the driver retries it on `TransientTransactionError` — proven: retried once, committed once).
- **Policy gateway** (`src/policy.ts` + `src/scoped.ts`): one cell per (namespace × scope × operation) from 02 §4.1; the tenant filter is `$and`-ed into every query (a caller's `$or`/crafted ids cannot widen it — another tenant's id simply matches nothing), inserted documents must lie inside the tenant, updates are limited to the cell's writable fields (+ `updated_at`) and to `$set/$unset/$inc/$push/$pull/$setOnInsert/$addToSet`, hidden fields are projected out, removed items are redacted for admins, and operator-shaped keys in written data are refused. Super Admin status/deletion/follow-code/counter changes are not generic writes (state functions, T1.3). The matrix test drives all 41 × 6 × 4 = 984 cells through the gateway against an independent transcription of 02 §4.1.
- **Typed repositories per aggregate** are built on `scoped()` with the features that use them (auth T1.8, masjids/admins/settings/audit T1.11); repositories accept typed values only — never a raw filter from a request.

### #66 — Field encryption and token helpers (PHASE_01 T1.7) — ACCEPTED (16 Oct 2026)
**Decision:** `packages/api/src/crypto/field.ts` (Node `crypto`, no dependency): AES-256-GCM, random 96-bit IV per value, 128-bit tag, key ring = current `FIELD_ENCRYPTION_KEY_ID` + `FIELD_ENCRYPTION_OLD_KEYS`; output `v1:<keyId>:<iv>:<ciphertext+tag>` in base64url (matches the database validator's pattern). **Beyond the spec:** every value is bound to its field (`context`, e.g. `admin_users.phone_enc`, as GCM associated data), so a ciphertext copied into another field or document type never decrypts there. All decryption failures raise the same `FieldCryptoError("cannot decrypt field")` (no oracle). `needsReEncryption` flags values under old keys for a rotation job; dropping a key from the ring makes its values unreadable (tested — keep old keys until re-encrypted). Tokens: 32 random bytes base64url; stored as `SHA-256(token || SESSION_PEPPER)` (04 §4); `tokensEqual` is constant-time. Tests include fast-check properties (round trip, any single-character tamper detected, pepper dependence).

### #67 — State functions, content writes and side effects (PHASE_01 T1.3) — ACCEPTED (Claude Code, owner-authorised autopilot session, 16 Oct 2026)
**Decision:**
- **Where:** `packages/db/src/effects.ts` (`contentWrite`, `bumpMasjidVersion`, `writeAudit`, `genFollowCode`/`withFollowCode`, `StateError`, `NotImplementedError`) and `src/state/**` (`createMasjid`, `changeMasjidStatus`, `createAdmin`, `addAdminToMasjid`, `removeAdminFromMasjid`, `createInvite`, `consumeInvite`, `followMasjid`, `unfollowMasjid`; later-phase stubs with their final signatures). Each asserts its scope (Super Admin ★ actions need a step-up younger than 5 minutes), runs in one transaction and writes its audit entry in it.
- **Version bump enforced by the gateway, not by convention:** a non-system write through `scoped()` to a `CONTENT_COLLECTIONS` namespace (`masjids` updates, items, masjid_timings, special_timings, chanda_weeks, payment_profiles) is refused unless it runs inside `contentWrite(ctx, masjidId, fn)`, which confines it to that masjid and bumps `content_version` (int64) in the same transaction. This replaces the "meta-test enumerating repository methods": a repository method that forgets the bump cannot write at all (tested per collection). `masjids` insert is excluded (createMasjid starts at version 1).
- **Security fix found by the tests:** the first version merged the contentWrite masjid into the tenant filter with an object spread, so the confinement could overwrite the tenant's `masjid_id` condition (an admin of A writing inside `contentWrite(B)` would have reached B). The two filters are now combined with `$and` and the insert check understands `$and`; the cross-masjid isolation test covers it.
- **Limits:** admin limit 5 and follow limit 20 are conditional `$inc` in the same transaction as the insert (8 parallel adds → exactly 5; 25 parallel follows → exactly 20; 5 parallel follows of one masjid → one follow, counted once). A duplicate follow is idempotent (`already`), a duplicate membership is `ALREADY_MEMBER` with the counter rolled back.
- **Follow codes:** 8 Crockford base-32 characters from 40 random bits; a duplicate key aborts the transaction, so the retry wraps the whole transaction (5 attempts → `FOLLOW_CODE_EXHAUSTED`; forced-collision test).
- **Invites:** a new invite closes the previous open one (same purpose); consumption is one `findOneAndUpdate` (open, unused, unexpired) so exactly one of concurrent consumers wins; every failure is the same `INVITE_INVALID` (04 R3). Consumption runs in public scope (before a session exists) and audits the invitee as actor.
- **Activation rule:** a masjid can be activated only with at least one ACTIVE member admin who accepted the current `undertaking_version` from app_settings.
- **Audit:** actions come from an allow-list, `meta` keys from an allow-list and ≤ 4 KB; public/hook scopes cannot be actors unless the state function names one.
- **Validated fixtures:** partial test documents are fine for inserts with `bypassDocumentValidation`, but later updates are validated — fixtures that a state function updates are complete documents.

### #68 — Rate limits, error codes and health checks (PHASE_01 T1.6) — ACCEPTED (Claude Code, owner-authorised autopilot session, 16 Oct 2026)
**Decision:**
- **Library:** `rate-limiter-flexible` **11.2.1** (ISC, server-only, in `packages/api` — no client bundle impact). 11.2.2 was 3 days old, so the month-old release was pinned; Renovate moves it on. The 03 §2 buckets are constants in `http/rate-limit.ts`; routes declare `rateLimit: [{ bucket, key }]` in `defineRoute`, applied after auth and **before validation** (03 §0 order — invalid requests count too).
- **Keys:** `<rl:pub:|rl:adm:><bucket>:<hash>`, the hash being 128 bits of SHA-256 of the device/session/credential id or IP, so no IP or session id is ever stored in Redis in clear text (03 §0 "never stored"). TTL = the bucket window.
- **Redis outage:** each limiter has an in-memory insurance limiter (same bucket, per process). Chosen over failing closed (an outage would take the API down) and failing open (no limits at all): limits still hold per process. A route that declares limits on an app without a limiter answers 500 — wiring mistakes cannot silently disable limiting.
- **429:** `RATE_LIMITED` problem+json with `Retry-After` in seconds (`ApiProblem` can now carry headers).
- **Error codes:** `packages/shared/src/errors.ts` (`API_ERRORS`: code → status); `PROBLEM_CODES` is derived from it. 16 Phase-1 codes added (auth, step-up, invites, limits, state rules, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`) with English + draft hi/ur/te messages (in the review CSVs). Messages carry no numbers (limits may change; 09 §2). A test keeps the code list and `errors.json` identical.
- **Health:** `{ok, service, version, db, redis}`; each ping has a 2 s timeout; 200 when both are up, else **503**. Consequence: while Atlas or Redis is unreachable the containers report unhealthy — a deploy then stops instead of rolling into an outage (nothing auto-restarts on unhealthy, so no restart loop). `unchecked` appears only in tests that build an app without probes; the entrypoints always pass both (`apps/server/src/connections.ts`), and the e2e stack test now requires `db`/`redis` = `ok`.
- **Redis ACL test:** `pnpm setup:local` also writes `REDIS_URL_TEST_RL_PUBLIC/_ADMIN/_WORKER` (local Docker only) into `.env.local.test`; the integration test proves each process user reaches only its own prefixes and none of FLUSHALL/CONFIG/KEYS, and that `rl_public` can run the limiter's Lua under `rl:pub:`.
- **OpenAPI:** generation + committed snapshot + CI diff already existed (Phase 0); regenerated for the health contract.

### #69 — Admin sessions, CSRF guard and the auth data layer (PHASE_01 T1.8, part 1) — ACCEPTED (Claude Code, owner-authorised autopilot session, 16 Oct 2026)
**Decision:**
- **Data layer** (`packages/db/src/state/auth.ts`): the only code that touches `webauthn_credentials`, `admin_invites` and `admin_sessions` (02 §4.1). Registration = ONE transaction (consume invite → insert credential → activate admin → insert session → audit `invite.consume` + `auth.register`); a duplicate credential id rolls all of it back. `recovery` invites also revoke the admin's existing sessions (old passkeys are revoked by the Super Admin, T1.11). Sign counter (04 §3): stored 0 always accepted, otherwise strictly increasing; a regression revokes the credential and every session of that admin, audits `credential.revoke` (actor `system`) and is refused — the refusal is raised after the transaction so the revocation commits. Login creates a new session; step-up rotates the existing session's token and sets `step_up_at`. Sessions (04 §4): masjid admin idle 7 d / absolute 30 d, Super Admin 30 min / 12 h; `last_seen_at` + idle expiry written at most every 5 min and never past the absolute expiry; dead, revoked or non-active-admin sessions resolve to nothing. Failed logins are audited by a 16-character hash of the credential id only. The whole flow is tested as the real `mc_admin` database user.
- **API:** `__Host-mc_sess` cookie (Secure, HttpOnly, SameSite=Strict, Path=/, no Domain); a duplicated or non-token-shaped cookie is ignored. Origin/CSRF guard (03 §1) on every unsafe api-admin request **before routing** (so unknown routes cannot be probed), exact `ADMIN_ORIGIN` + `X-MC-CSRF: 1`; without a configured origin it refuses everything. `defineRoute({ auth })`: `none | session | super | super_step_up` → 401 `SESSION_REQUIRED`, 403 `FORBIDDEN`, 403 `STEP_UP_REQUIRED`; the handler receives the session and the DB scope built from server-side memberships. Rate-limit key `session` = the session id. Challenge store: Redis `GETDEL` under `chal:<purpose>:<sha256(binding)>`, 5-minute TTL (the api-public user cannot touch it — tested). One `adminRoutes()` list feeds both the entrypoint and `openapi.json`.
- **Field encryption hardening (T1.7 follow-up):** `decryptField` accepts only canonical base64url. Node ignores the unused low bits of the last character, so different strings decoded to the same ciphertext; nothing could be forged (GCM authenticates the bytes), but exactly one stored form is now accepted. Found by the existing fast-check tamper property (failing seed 1338087395), now also a deterministic test.
- **Coverage:** `packages/api` now gates coverage on the integration run (like `packages/db`): lines 98.8 %, branches 89.4 %.
- **On hold:** registration/login/step-up options + verify need `@simplewebauthn/server` (named in 01 §4). The owner declined the install prompt during the autopilot session, so the dependency waits for the owner (owner list A6); the e2e with a virtual authenticator needs the admin screens (T1.10).

### #71 — Super Admin API and the undertaking gate (PHASE_01 T1.10/T1.11, API part) — ACCEPTED (Claude Code, owner-authorised autopilot session, 16 Oct 2026)
**Decision:**
- **`/api/super` router** on api-admin with a router-level guard (04 §5): every request under it — known route or not — is authenticated and refused unless the session belongs to a Super Admin (401 / 403 `FORBIDDEN`); routes add `super_step_up` for ★ actions. Tested for all 21 routes plus an unknown path, as anonymous and as a masjid admin.
- **Endpoints (03 §5, Phase 1 part):** dashboard; masjids list/search/create/detail/edit/quotas/activate/★suspend/★unsuspend/★delete (unsuspend is ★ per the phase file, stricter than 03); admins create (one transaction: admin + membership + invite — a refusal at the 5-admin limit leaves no orphan), list, ★re-invite, ★revoke sessions, ★revoke passkeys, ★remove from masjid, ★phone view (decrypted in the API, audited in the data layer); settings get/patch; audit list with filters + ★CSV export (≤ 10 000 rows, cells starting with `= + - @` prefixed with `'` against spreadsheet formula injection). Invite links are `ADMIN_ORIGIN/invite#<token>` everywhere (DECISIONS #70 note).
- **Undertaking gate (T1.10):** `resolveSession` reports whether the admin accepted the CURRENT `app_settings.undertaking_version`; any non-GET route answers 403 `UNDERTAKING_REQUIRED` to a masjid admin who has not, except routes marked `undertaking: 'exempt'` (accept it, logout, end sessions). `POST /auth/undertaking {version}` refuses an outdated version (`UNDERTAKING_VERSION_MISMATCH`). Super Admins are not gated.
- **State errors → API codes** in one place (the error mapper): only client-facing refusals are mapped; internal ones stay 500. New codes: `UNDERTAKING_REQUIRED`, `UNDERTAKING_VERSION_MISMATCH`, `ADMIN_NOT_FOUND`, `NOTHING_TO_UPDATE`, `INVALID_CURSOR` (4 locales; drafts in review CSVs).
- **Typed read repositories** (`@mc/db/repos`, the T1.4 remainder for these aggregates): masjid list (literal case-insensitive search — user text never becomes a regex), masjid detail with admins (phone presence only), audit list, settings, dashboard — all through `scoped()`; opaque base64url cursors validated on the way in.
- **Smaller:** `keyRingFromEnv` accepts the parsed old-key pairs from `@mc/shared/env` (type mismatch found while wiring); `RouteContext.requestId` is always a string (the middleware always sets it).

### #72 — Admin app foundation: session gate, platform WebAuthn client, shared auth contracts (PHASE_01 T1.10) — ACCEPTED (Claude Code, owner-authorised autopilot session, 16 Oct 2026)
**Decision:**
- **Session gate** in front of the router: `/invite#<token>` → invite flow (the token is read from the fragment once and removed from the address bar and history); no session → Login; current undertaking not accepted → Undertaking; otherwise the app with the admin in context. A 401 from any query or mutation drops the cached admin, so an expired or revoked session lands on Login with "You were logged out".
- **No `@simplewebauthn/browser`** (deviation from 01 §4, which names it): the admin app talks to `navigator.credentials` directly — about 150 lines converting base64url JSON options and credentials, unit-tested, mapping browser errors to plain-language messages (cancelled / no screen lock / unsupported). Reason: the platform API is enough on the target browsers, it adds no dependency or bundle weight, and the security-relevant part (verification) is on the server, which still uses SimpleWebAuthn (owner O13). The client calls the 03 §4 endpoints; until those server routes exist, Login and "Create my login" show the friendly failure message.
- **Shared contracts:** the admin-auth request/response schemas moved to `packages/shared/src/contracts/admin-auth.ts` (03 header) — the API validates its responses with them and the PWA parses with the same schemas. `/auth/me` also returns the accepted undertaking version (B13).
- **Undertaking text:** `packages/i18n/legal/<locale>/undertaking.md` — front matter (`version`, `status: draft`) + a plain bullet list, parsed by a tiny parser (no markdown library), one lazy chunk per locale. Version `draft-1` = the seeded `app_settings.undertaking_version`; the client sends the version it displayed. Hindi/Urdu use "करूँगा/करूँगी"-style gendered pairs in the DRAFT — translators to decide.
- **i18n:** new `admin` namespace (en + hi/ur/te drafts in the review CSVs). Apps load `common` + `errors` by default; the admin app adds `admin` through `I18nProvider namespaces`, so the musalli app never downloads admin strings.
- **Home (B3):** the ten tiles in their final order/icons/colors open "Coming soon" until their phases; switcher sheet when the admin has several masjids (choice remembered in `localStorage` as a convenience only); Super Admins get a console entry (screens follow with T1.11). Followers chip, today strip and quota pill wait for their data (Phase 3/4).
- **Account (B13 part):** language, logins (rename, "Add another phone" link with copy + WhatsApp share), logged-in devices (log out one), log out, log out everywhere (confirm dialog), accepted undertaking version. Language changes are local to the device for now (no endpoint to store `ui_locale` yet).
- **New icons** drawn on the shared 256-grid stroke: play-circle, chart-bar, crescent, list, gear, fingerprint, sign-out, device, globe, shield-check, user-circle; `AdminTile` in `@mc/ui/admin`.
- **Screens verified** by Playwright screenshots in English and Urdu (RTL) against the local stack (sessions created directly in the local dev database for the screenshots, since passkey login is not wired yet).

### #73 — Super Admin screens (PHASE_01 T1.11 UI) — ACCEPTED (Claude Code, owner-authorised autopilot session, 16 Oct 2026)
**Decision:**
- **Layout:** the Super Admin screens live in the admin app's stack under `/super/*`; from 1024px a sidebar (Dashboard · Masjids · Settings · Audit log) sits next to the content, on phones the dashboard lists the sections. Same tokens and components as the rest of the app. The `super` strings form their own i18n namespace, loaded only when a Super Admin opens these screens.
- **★ step-up in the client:** a ★ call that answers `STEP_UP_REQUIRED` opens a small "Confirm it's you" dialog; its Confirm tap runs the passkey assertion (browsers — notably Safari — only allow the passkey prompt right after a tap, and the tap that started the action was used by the request), then the action is retried once. Closing the dialog cancels silently.
- **C2 masjids:** literal search + status chips + "Show more"; create/edit share one form; the location field takes typed coordinates or a pasted Google Maps link (`@lat,lng`, `q=`/`query=`/`ll=`/`destination=`, `!3d…!4d…` place pins — `@mc/domain/geo`, unit-tested), shows what it read and refuses places outside India (short `maps.app.goo.gl` links carry no coordinates and are not resolved — that would need a network call). Edits send only changed fields. Masjid page: profile facts, status actions (activate; ★ suspend/unsuspend with a reason; ★ delete with an optional reason), daily notification quota, admins with a per-admin sheet (★ new login link — `register` for invited admins, `add_device` otherwise —, ★ lost-phone recovery link, ★ log out everywhere, ★ remove all logins, ★ remove from masjid, ★ show phone). New links open a sheet with copy + WhatsApp share; they are never stored client-side.
- **C10 settings / C11 audit:** settings send only changed fields; audit list filters by action (identifiers shown as written — they are log keys), rows expand to their details, ★ CSV export downloads the current filter.
- **Contracts:** every `/api/super` schema moved to `packages/shared/src/contracts/super.ts` (API and PWA share them); a test keeps the copied enums and India bounds equal to `@mc/db/schema`.
- **Found while testing:** i18next treats an interpolation value named `lng` as the language option — the location hint placeholders are `{latitude}`/`{longitude}` for that reason.

### #74 — Phase 00 closure decisions: userns-remap, deferrals, Cloudflare NEL (re-review V-24, V-26, L4) — ACCEPTED (Claude Code, owner-authorised autopilot session, 16 Oct 2026)
**Decision:**
- **Docker user-namespace remapping (V-24): not enabled in v1.** 04 §12.2 asks for it "where compatible". Remapping moves container uids into a subordinate range, so every bind-mounted host file would need re-owned uids (origin certificates root:1000 640, the Redis ACL file uid 999, the env files read by the services) and the release/rollback scripts would have to know the mapping — a source of lock-outs during deploys. The containers already run as non-root users with `cap_drop: ALL`, `no-new-privileges`, read-only root filesystems, the default seccomp profile and no Docker socket, behind the Cloudflare-only firewall. `check.sh` keeps reporting it as a note (not a failure). **Revisit in Phase 9** (production hardening) together with the move to a dedicated production host.
- **Deferrals (V-26):** F13 (Hijri month-name fallback) → Phase 2 T2.1; F18 (placeholder screens) → Phase 2, replaced by the real musalli screens; **F20 (real low-end Android performance)** → Phase 2 — the owner's Poco F7 is not a ₹8,000 phone, so the measurement waits for a low-end test device (owner to borrow or buy one, see owner list), the throttled CI perf spec stays the gate meanwhile; **F22 (icon design pass)** → before the Phase 2 screens, now also covering the admin icons drawn in Phase 01 (play, chart, crescent, list, gear, fingerprint, sign-out, device, globe, shield, user); F31 (staging placeholders) → Atlas done (Phase 01), Turnstile with the owner (O8, needed in Phase 2), Cloudinary keys and the Cloudflare purge token in Phase 3.
- **Logging (S-L7):** HAProxy logs at `info` (one line per connection — time, SNI backend, duration, bytes; the client address is Cloudflare's edge). Caddy keeps **no access log**: the APIs log every request themselves with token-like path segments redacted, and a Caddy access log would add full URLs and request headers for static files of little forensic value. The encrypted 200-day archive lives on the VPS; 05 §2 also says it is "included in VPS backups" — that needs the VPS provider's backup feature enabled (owner item O18).
- **Edge networks (S-L9):** the router keeps a separate `ingress` network for the published port; the edge networks to the environments' `web` containers are `internal`, so Caddy has no route to the internet (verified locally: published port works, router → web works, web → internet blocked). The router's healthcheck now also requires the frontend to be listening. Existing networks must be recreated once on the server (DEPLOY.md §8).
- **Cloudflare NEL / Report-To (L4):** Cloudflare adds Network Error Logging headers, so browsers may send connection-error reports (URL, client IP as seen by Cloudflare) to Cloudflare. No content or identifiers of ours are included, and Cloudflare already processes every request as our CDN (05 data processors). Owner checks whether the zone lets it be switched off; otherwise the privacy notice (Phase 9 legal texts) names it under Cloudflare. The nightly spec now fails on any script not served from our own origin (Cloudflare's injected beacon was found re-enabled once).

### #75 — iOS swipe-back confirmed on the owner's phones (F17, closes T0.15) — ACCEPTED (owner, 20 Oct 2026)
**Context:** DECISIONS #44 assumed that iOS gives no native back swipe in the installed app (so our own edge swipe runs) and that in Safari a `popstate` we did not cause is applied without our animation (Safari already animated its own swipe). F17 asked the owner to confirm on a real iPhone.
**Result and decision:** owner, 20 Oct 2026, after the step-by-step phone checks (swipe-back in Safari and the installed app, screen readers): "mobile testing is working fine". The #44 platform rule stays as built; T0.15 is complete.

### #70 — Where the server-side Super Admin bootstrap runs (PHASE_01 T1.9) — ACCEPTED: option A (owner, 19 Oct 2026: "do the best one")
**Conflict:** 04 §3 / the phase file run the bootstrap in the **worker** container (system DB user). The script must store the invite as `SHA-256(token ‖ SESSION_PEPPER)` (02 §2, 04 §4) so that api-admin recognises the link — but 01 §7 and `packages/shared/src/env.ts` forbid `SESSION_PEPPER` in the worker. Both cannot hold.
**Options:**
- **A (recommended):** run it in a one-off **api-admin** container: `docker compose run --rm api-admin /nodejs/bin/node dist/bootstrap-super-admin.mjs --name "…"`. It already holds `SESSION_PEPPER` and `mc_admin`, whose privileges (insert `admin_users`, `admin_invites`, `audit_log`) are exactly what the bootstrap writes — no new credential anywhere; the code still acts with `systemScope()` (audit actor `system`). Deviation: 04 §3 names the system user; 04 §3 is updated.
- **B:** a dedicated `bootstrap` one-off service/env file holding `MONGODB_URI_SYSTEM` + `SESSION_PEPPER` (new process in `env.ts`, `make-env.sh`, compose profile). Matches 04 §3 literally, but adds a second place where the pepper lives and owner steps on the VPS.
- **C:** allow `SESSION_PEPPER` in the worker. Not recommended: widens the worker's secrets for a once-only task.
**Built meanwhile (works with every option):** `bootstrapSuperAdmin` (system scope only; refuses while a non-disabled Super Admin exists unless `--force-additional`), `bootstrapSuperAdminInvite` (`packages/api/src/jobs/`, link `ADMIN_ORIGIN/invite#<token>` — fragment, so the token never reaches a server log or Referer), local CLI `pnpm bootstrap:super-admin` (tested against the local database: created once, refused the second time). Only the server entry waits for this answer.
**Decision (19 Oct 2026):** option A. `apps/server/src/bootstrap-super-admin.ts` → `dist/bootstrap-super-admin.mjs` in the server image; `deploy.sh <env> --bootstrap-super-admin --name "…" [--locale …] [--force-additional]` runs it with `compose run --rm --no-deps -T api-admin` against the current verified release (arguments passed verbatim, other modes refuse extra arguments — 3 new cases in `deploy-verify.test.sh`). Verified locally as `mc_admin`: refused while a Super Admin exists, created with `--force-additional`, bad arguments exit 2. 04 §3, PHASE_01 T1.9 and DEPLOY.md §7 updated. The owner runs it on the server (the link appears only in their SSH session).

### #76 — CI jobs that start MongoDB run on `ubuntu-22.04` (runner kernel 7.0.0) — ACCEPTED (20 Oct 2026)
**Context:** from GitHub's runner image `ubuntu24/20261018.339` (released 19 Oct 2026, rolled out over 19–20 Oct) the `ubuntu-24.04` (and `ubuntu-26.04`) runners use kernel `7.0.0-1017-azure`. MongoDB 8.x stops at startup on kernels 6.19–7.0.13 (`"MongoDB cannot start: Linux kernel versions 6.19 and newer has a known incompatibility…"`, SERVER-121912): kernel 6.19 changed rseq behaviour and broke TCMalloc. The kernel side is fixed in 7.0.14 / 7.1, and MongoDB 8.0.30+ lifts the block on those kernels (SERVER-125742; our 8.0.32 has it). An open ticket (SERVER-136848) says the check ignores Ubuntu's patch level, so a patched Ubuntu 7.0.0 kernel may still be refused. This is why CI went red from `b0e8077` (one job), then every job that starts MongoDB. It looked like a flake because jobs landed on old and new images during the rollout. Found with the new `mongo logs` / `runner` annotations. Not reproducible on the dev PC (Docker Desktop's WSL kernel is older).
**Decision:** the three jobs that start MongoDB (CI `integration`, CI `build-e2e`, Nightly `images-perf`) run on `ubuntu-22.04` (`ubuntu22/20261018.327`, kernel `6.8.0-1070-azure`). Every other job stays on 24.04. The MongoDB version stays the same as Atlas (8.0). We rejected the `GLIBC_TUNABLES=glibc.pthread.rseq=0` workaround because it is reported to crash later with memory corruption. We also rejected MongoDB 7.0 in CI, which would test against a different server than Atlas runs. No e2e test compares pixel screenshots, so the older image's fonts don't affect results.
**Not affected:** staging/production use Atlas (MongoDB manages its hosts). The VPS runs no MongoDB.
**Revert (PROGRESS F35):** go back to `ubuntu-24.04` when its image ships kernel ≥ 7.0.14 and MongoDB starts on it, or before GitHub retires `ubuntu-22.04` (Ubuntu 22.04 standard support ends April 2027), whichever comes first. If 22.04 goes before the kernel is fixed, run MongoDB in a VM on the runner. A local Linux dev machine or WSL kernel ≥ 6.19 hits the same block.

### #77 — Passkey ceremonies: SimpleWebAuthn wrapper, counter rule after the signature, user-handle check (PHASE_01 T1.8 part 2) — ACCEPTED (Claude Code, 20 Oct 2026)
**Decision:**
- **One wrapper** (`packages/api/src/auth/webauthn.ts`) is the only importer of `@simplewebauthn/server` 14.0.3 (API checked against the installed package's types and source, 20 Oct 2026). It sets the 04 §3 settings once: ES256 (-7) + RS256 (-257) offered and accepted; `residentKey: 'required'`; `userVerification: 'required'`, with `requireUserVerification: true` so the `uv` flag is checked, not just requested; `attestation: 'none'`; exact `ADMIN_ORIGIN` and `RP_ID`. Our challenge goes to the library as bytes, because a string would be re-encoded as UTF-8 and no longer match the stored base64url. Failures come back as a reason, never as an exception. Logged reasons keep the library's message but replace every quoted value with `"…"` (the messages quote received origins and challenges).
- **Sign counter after the signature.** The library compares counters *before* it verifies the signature. If its error counted as a regression, anyone who knows a credential id could send a forged low-counter assertion and get the credential and all its owner's sessions revoked (a lock-out attack). So the library gets counter 0 (its check is off) and returns the received counter. The 04 §3 rule (`counterAdvances`, revoke + audit on regression) runs in `completeAssertion` only after a verified signature. Tested both ways: a real regression revokes; a forged low-counter assertion revokes nothing.
- **User handle (WebAuthn §7.2 step 6).** A discoverable login must return a `userHandle` equal to the credential owner's 32-byte handle (`findLoginCredential` now returns it). The library does not check this.
- **Routes** (`routes/admin-passkeys.ts`). `register/options` returns a uniform 404 `INVITE_INVALID` for any invalid invite; its challenge is bound to the invite's token hash. `register/verify` takes the challenge first, then verifies, then calls `registerCredential` (one transaction, which re-checks the invite). `login/options` binds the challenge to a fresh `__Host-mc_chal` cookie (5 min); `login/verify` always clears that cookie. Step-up challenges are bound to the session id, and the passkey must belong to the session's admin. Every verification failure is the same 401 `PASSKEY_FAILED`; a duplicate credential id is also a 401, and the transaction rolls back. Failed logins and step-ups are audited as `auth.login_failed` with only the credential hash. Rate limits per 03 §2: IP buckets on login/register, plus the 20/h per-credential bucket keyed on the *claimed* id. Step-up writes no content, so like logout it is exempt from the undertaking gate. Cookie `Max-Age` is the role's absolute lifetime (30 d / 12 h); the server enforces idle and absolute expiry.
- **Contracts.** The credential JSON is validated with Zod, keeping only what the verifiers read (`id`, `rawId`, `type`, `response`), all base64url, with bounds (credential id ≤ 1023 bytes). `clientExtensionResults` is dropped; the library does not read it.
- **AAGUID** is stored only when it is not all zeros (`parseAaguid`: any UUID version, since authenticator models are not v4).
- **e2e.** A software authenticator for API tests (`packages/api/test/soft-authenticator.ts`) produces real P-256 attestations and assertions, with switches for each failure. The browser spec (`e2e/admin/passkey-flow.spec.ts`) uses Chromium's virtual authenticator against the runtime-test stack. A new seed hook, `POST /api/admin/test/super-admin-invite`, gets api-admin's own DB handle and pepper. It is mounted only in test-hook mode, i.e. the runtime-test image with `APP_ENV=local` + `NODE_ENV=test` (DECISIONS #31). For that, the entrypoint now opens its connections before loading the hooks.

### #78 — API route tests run as the process's own database user; no eager `masjid_stats` (PHASE_01 T1.11) — ACCEPTED (Claude Code, 20 Oct 2026)
**Found by the onboarding e2e (20 Oct 2026):** creating a masjid in the real admin app gave a 500. `createMasjid` inserted a `masjid_stats` document, but 02 §4.3 lets `mc_admin` only *read* `masjid_stats` (inserts belong to `mc_public` / `mc_system`). The data-layer and API integration tests had connected with the test root user, so no test hit the privilege. The same 500 would have happened on staging at the first masjid.
**Decision:**
- **Fix in the code, not the roles:** `createMasjid` no longer creates `masjid_stats`. The first follow creates it (the existing `mc_public` upsert), and every reader already treats a missing document as zero. This keeps 02 §4.3 least-privilege as written.
- **Tests run with production privileges:** `@mc/db/testing` gains `processUserHandle(test, user)`, a temporary login with exactly that 02 §4.3 role. The api-admin route suites (`super-routes`, `admin-passkeys`, `admin-auth`, `log-hygiene`) now run their routes through `mc_admin`. Raw test setup and assertions still use the root connection. Run as `mc_admin`, `super-routes` failed exactly like the app did (500 on create, 5/5 red); after the fix it passes. New api-public route suites (Phase 2) use `mc_public` the same way.

### #80 — Security review V-31 (Phase 00 closure + Phase 01 so far): fixes and LOW justifications — ACCEPTED (Claude Code, 20 Oct 2026)
**Review:** `security-reviewer`, scope `69ca205..b9eb751`, 20 Oct 2026: 1 HIGH, 3 MEDIUM, 10 LOW. It confirmed #77 (the counter rule runs after the signature; no path revokes on an unverified assertion), the challenge binding, uniform failures, cookies, the CSRF guard, the test-hook gating (#31) and the earlier fixes (S-H2, S-L5/L8/L11, S-M1, L5/L9, #61).
**Fixed:**
- **H1** — "Add another device" now needs a fresh step-up. A passkey survives every session revocation, so an unlocked phone or XSS could otherwise plant a permanent login. New route auth `session_step_up` (any role, step-up in the last 5 min). `createAddDeviceInvite` re-checks `step_up_at` on the caller's own session document. The account screen runs it through the "Confirm it's you" dialog (`StepUpProvider` moved to `features/auth`). Tests: none / stale / someone else's session → STEP_UP_REQUIRED; API 403 without a step-up.
- **M1** — Two parts:
  - IP rate-limit buckets count IPv6 by **/64** (`rateLimitIpKey`; IPv4-mapped addresses count as IPv4). Rotating addresses inside one /64 hits the limit (test).
  - Failed assertions are audited only for **known** credentials, capped by the 20/h credential bucket. Unknown ids are only logged, so an anonymous flood writes no audit documents (the Atlas M0 storage risk).
- **M2** — The policy layer gains value checks (`Cell.check`, on insert and update). Generic item writes (admin and Super) can never:
  - set `status: removed`;
  - touch `purge_after` / `removed_at` / `removed_reason` (the IT Rules 3(1)(g) evidence clock);
  - update a removed item (no un-removing).

  Takedown, restore and purge stay state functions (Phase 8) and the retention job. Tested with crafted payloads.
- **M3** — `safeText` (@mc/shared) for every free-text contract field. It applies NFC and trim, and refuses control characters, bidi embedding / override / isolate characters, ZWSP and an inner BOM. ZWJ / ZWNJ (Indic scripts) and LRM / RLM (Urdu) stay allowed. Tested with fast-check.
- **L1** — The split, image and shipped-image checks look for every hook route path, not only `/test/clock`.
- **L3** — The per-credential limit counts failures only, so it never blocks a valid assertion. Anyone who knows a credential id from `excludeCredentials` could otherwise lock its owner out.
- **L4** — `createInvite` (★) re-checks the step-up and that the admin exists.
- **L5** — Transport names are limited to 20 characters and filtered to the WebAuthn list (no 500).
- **L6** — No `SCAN` for the API Redis users (`rl_public` everywhere, `admin` on the VPS). Locally `admin` keeps it for the e2e reset hook; the worker keeps it for BullMQ. The VPS picks this up at its next `make-env.sh` run (PROGRESS F37).
- **L9** — The ★ audit CSV export writes `audit.export` (filters, row count).
- **L10** — Nested Super Admin request objects are strict.

**Justified, not changed:**
- **L7** — `repos/super.ts` reads phone *presence* with the raw collection. It projects only `_id` over ids already scoped to the masjid and never returns the field. It becomes a named policy exception when Phase 8 reworks admin reads.
- **L8** — Two simultaneous assertions from a counter-based security key can revoke it, because of the regression rule. Synced phone passkeys report 0 and never trigger it. Recovery is a new login link (DEPLOY.md §6 row).
- **L10 (credential JSON)** — Stays non-strict on purpose: browsers add members, and only the verified fields are kept.
- **H1 follow-ups (F38)** — Two parts follow later:
  - a push alert to the Super Admin when a passkey is added to a Super Admin account (04 R4), with Phase 4 push;
  - self-service "remove this passkey" (step-up, never the last one), with B13 in Phase 3.

  Until then: step-up is required, and the Super Admin can revoke all passkeys of an admin.
- **L2** — Decided by the owner (#81).

### #81 — Admin login IP limit: 10 per 10 min may block a Super Admin onboarding several imams on one Wi-Fi (review L2) — ACCEPTED: option A (owner, 20 Oct 2026)
**Now:** 03 §2 "admin login options/verify 10 / 10 min / IP". Opening an invite, registration options and registration verify all count, so one connection allows about **3 new admins (or 5 logins) per 10 minutes**. Indian mobile IPv4 (Jio/Airtel CGNAT) shares one address between many people. IPv6 now counts by /64 (#80).
**Options:** **A (recommended)** — raise the IP bucket to **30 / 10 min**. The real protection is elsewhere: invite tokens are 256-bit, signatures can't be guessed, the per-credential failure cap applies, and failures by unknown ids write nothing. **B** — keep 10 / 10 min, and the Super Admin onboards in batches. **C** — exempt `GET /auth/invite/:token` from the bucket (it changes nothing) and keep 10.
**Decision (owner, 20 Oct 2026 — "I accept all, do which is best"):** option A. `adminLoginIp` = 30 / 10 min (`packages/api/src/http/rate-limit.ts`, the bucket-table test, 03 §2 updated).

### #79 — Staging VPS → Atlas latency ≈ 9 ms vs. the ≤ 5 ms target (PHASE_00 T0.14 step 5, closure V-21) — ACCEPTED: option A (owner, 20 Oct 2026)
**Measured (O9, 20 Oct 2026):** `curl` `time_connect` to each shard: ≈ 9 ms network round trip once DNS is cached (≈ 170–200 ms on the first, uncached lookup). PHASE_00 T0.14 targets ≤ 5 ms; DECISIONS #21 expected about 1–2 ms in the same region. The cause is that the Hostinger Mumbai VPS and AWS ap-south-1 (Atlas M0) are different data centres.
**Impact:** the drivers keep pooled connections (01 §5.1), so the ~9 ms is paid per round trip, not per connection set-up. A typical API request makes 1–3 queries, so it adds roughly 10–30 ms. That fits the API latency budgets, but every extra sequential query costs 9 ms.
**Options:** A (recommended) — accept ≈ 9 ms for staging and re-measure in Phase 9 against production (M10). If production is still above 5 ms, choose then between keeping it and moving the VPS. B — look for a VPS in the same AWS region now (paid, a move, out of scope for v1).
**Decision (owner, 20 Oct 2026 — "I accept all, do which is best"):** option A. ≈ 9 ms accepted for staging; Phase 9 re-measures production (M10) and decides then.

### #82 — Delta security review of the #80 fixes (`b9eb751..9fe1f18`) — ACCEPTED (Claude Code, 22 Oct 2026; LOWs in progress)
**Review:** security-reviewer, 22 Oct 2026: 0 HIGH, 2 MEDIUM, 12 LOW. It verified as correct: H1 (session_step_up + the
DB re-check), M1/L3 (/64 keying incl. mapped IPv4, failure-only credential counting), M2 for $set / $setOnInsert / $unset /
dotted paths / updateMany / insert / pipeline updates, M3 order of normalization, L4, L5, L6 (-scan), L9, L10, #81, and the
test-hook gating.
**Fixed:** **M-A** — the build / image hook checks searched single-quoted paths, but the bundler writes `"…"`, so they never
matched (also the older `/test/clock` check). Now one shared matcher for any quote style
(`apps/server/scripts/hook-code.mjs`), with tests against the real build. **M-B** — an upsert through the gateway only checked
the update cell, so a crafted filter could insert a removed / purge-marked item or a document outside the tenant. Upserts now
derive the seeded document (full query incl. the fence; `$eq` and one-value `$in` seed, as in MongoDB; `$set` /
`$setOnInsert`) and must pass the insert cell's tenant and value checks; a field seeded twice is refused. (An admin's
own-masjid fence + contentWrite() masjid seed `masjid_id` twice — MongoDB refuses such upserts itself, so admin
repositories insert.)
**LOW (L-1 … L-12), done 22 Oct 2026:** **Fixed** — L-1 (`rateLimitIpKey`: zone ids stripped, embedded IPv4 only after
`:`, anything unreadable and a request without a client IP count under one shared key — never per address, never
skipped); L-2 (every `ip` rule also counts an IPv6 client's /48 in a 10× wide sibling of the bucket); L-3 (`safeText`
refuses by category: Cc, Cf, Cs, Co, Zl, Zp except ZWNJ / ZWJ / LRM / RLM / ALM; tests for U+2028/2029/2060/00AD, tags,
private use, lone surrogates; the bootstrap CLI `--name` uses the same rule); L-4 (raw input over 4 × max refused before
NFC; OpenAPI shows the real min/maxLength); L-5 (`-randomkey` for `rl_public` / `admin` in both ACL generators, tested);
L-7 (the first failure over a credential's hourly cap writes one audit entry with `meta.capped` + a `passkey.failure_cap`
warning, later ones only the info log); L-10 (`assertWritable` checks every operator / path / value on its own); L-11
(comment fixed; a future `stepUpAt` is refused, as `requireSuper` already did); L-12 (CSV export at most exactly 10 000
rows, tested). **Justified** — **L-6** (the login path of a known credential takes longer than that of an unknown one —
a Redis count and an audit write — so timing tells whether a credential id exists): credential ids are ≥ 16 random
bytes chosen by the authenticator, never shown in the UI, and only reach a client through its own passkey ceremony;
knowing that one exists gives nothing without the private key, and every attempt is still bounded by the IP (/64 and
/48) and per-credential limits. Padding every path to the slowest would only add latency. **L-8** (the Super Admin cell
on `items` is "all" in policy): that is 02 §4.1 by design (Super Admin = platform operator), the value checks (#80 M2)
still apply, and `mc_admin` has no `remove` privilege on `items` (02 §4.3, privilege tests), so no API path can
hard-delete an item. **L-9** → PROGRESS F39 (item delete / undelete as a state function that sets / clears
`purge_after`, Phase 3, where items are first written).

### #83 — Phase-verifier gaps of 22 Oct 2026 (Phase 01 close) — ACCEPTED (Claude Code, 22 Oct 2026)
**(a) Isolation tests added** (`policy.int.test.ts`): an admin of another masjid reads none of masjid C's admin users,
`masjid_stats`, `ameen_counters`, `v_admin_follow_audience` or `admin_push_subscriptions` (and deletes none), and writes
nothing of C in `special_timings`, `chanda_weeks`, `campaign_amount_history`, `masjids`. **Found a real gap:** the admin
`insert` cell of `audit_log` had no tenant rule, so an admin scope could write an entry stamped with another masjid's id
(it would show in that masjid's audit view). The cell now requires actor = the admin and `masjid_id` ∈ the admin's
masjids or absent (`matchesTenant` treats `null` in `$in` as "missing", as MongoDB does). **(b)** A disabled admin's
live session: `resolveSession` → null, `/auth/me` and a write → 401 (data layer + API). **(c)** The tautological
`client.int.test.ts` case is now 50 interleaved transactions of admins of 5 masjids reading through the gateway (each
sees only its own masjid); plus an API test with 24 interleaved api-admin requests from admins of two masjids, as
`mc_admin`. **(d)** One API test runs every T1.11 Super Admin action with its own request id and checks the stored entry:
actor type + id, target, masjid. `settings.update` now carries a target (`settings` / `global`); `audit.export` has none
by design (it reads, it changes no record); the db `updateSettings` test now asserts its entries. **(e)** Log capture of
a successful login + step-up through the routes: the four requests are logged, and no challenge, challenge cookie,
credential id, assertion part or (rotated) session token appears. **(f) Admin anonymization deferred to Phase 08 T8.7**:
02 §6 makes it a retention action ("removed admin users, 1 year after removal → anonymize"), and the retention job is
T8.7; Phase 01 has no route that removes an admin from the platform (only from a masjid, which T1.11 tests). The
PROGRESS T1.3 note that T1.11 has it was wrong and is corrected. **(g)** The matrix test counts only cells it really
attempts (947 = 984 − 37 left to MongoDB / the DB users for the system scope). **(h)** Namespace, dynamic, `require` and
`export *` imports of `@mc/db` are refused wherever a scope is restricted (ESLint `no-restricted-syntax`, tested) and
Semgrep matches member access through them (rule fixtures); `log-archive.sh` skips Compose one-off containers, so an
hourly run can never archive the one-time Super Admin invite link printed by `--bootstrap-super-admin` (host layer —
ships with F36/F37); explain / IXSCAN tests are Phase 2 (first read-heavy public routes) — stated in the report.

### #84 — Open follow-ups at the Phase 01 close: each closed or deferred with a trigger — ACCEPTED (Claude Code; owner accepted 22 Oct 2026)
The phase-verifier (22 Oct) listed follow-ups without a recorded deferral. Each now has one (PROGRESS keeps the rows):
**F1** Node 26 — trigger date 28 Oct 2026 (Active LTS); first task of the first session after it (Phase 02).
**F14** ICU precompile — only if `pnpm size` nears the 170 kB budget (165.4 kB today). **F16** haptics setting and
**F21** back closes sheets — Phase 02, with the first Settings screen / the first screens that open sheets.
**F24** Caddy from source — until an official Caddy release has the fixes (Trivy tells); the builder is re-pinned
whenever Trivy flags its Go (done 22 Oct 2026: Go 1.27.3, CVE-2026-111943). **F27 closed**: the owner chose `swap`
(15 Oct); 01 §9 gates warm loads by LCP only, warm TBT stays measured and printed (staging 20 Oct: app warm TBT
146 ms); the real-device smoothness check is F20 (owner O16, Phase 02). **F28** Sentry — when the owner creates the
projects (optional guide item 0.18). **F35** runner image — trigger: a 24.04 image with kernel ≥ 7.0.14, at the latest
before `ubuntu-22.04` is retired. **F36 / F37 / F40** — host-layer changes; they need one `provision.sh host <sha>` +
`make-env.sh staging --force` by the owner (PROGRESS O22, together with the L-5 RANDOMKEY ACL line). Until then the
staging API Redis users can still run SCAN / RANDOMKEY: Redis is reachable only on the internal Docker network, the
users are the APIs' own, and rate-limit keys are hashed, so key names reveal no client. **F39** — Phase 03.

### #85 — Staging Lighthouse misses the 01 §9 LCP budgets while the local gate passes (PROGRESS handoff item 4) — ACCEPTED: option A (owner, 22 Oct 2026: "do whichever is best"; Claude Code recommended A)
**Measured (22 Oct 2026, `pnpm lhci`, same tool and settings as CI):** from the dev PC in India against staging — app
cold LCP **3.08 s**, admin cold **2.58 s**, admin warm **1.22 s** (app warm 94 ms); against the local stack on the same
PC a minute later — app cold **1.97 s**, admin cold **2.27 s**, admin warm **0.80 s**. The US Nightly runner (20 Oct)
saw 2.95 / 3.37 / 1.23 s, so the gap is **not** geography. Real (observed, unthrottled) app LCP on staging: **0.89 s**.
**Why:** Lighthouse simulates Slow 4G (Lantern): every request in the critical chain costs ≈ 150 ms RTT + 560 ms
request latency + the origin's *observed* server time (Cloudflare edge ≈ 110 ms, local Caddy ≈ 1 ms). The musalli start
is 4 levels deep — `index.js` → i18n namespace chunks (I18nProvider suspends) → route chunks (the router mounts only
then) → tab-root chunks — so each level costs staging far more than localhost. Admin warm: the first admin screen waits
for `/auth/me`, which the service worker must never cache (04), and one simulated API round trip is ≈ 0.7 s; a warm
LCP ≤ 1.0 s is out of reach while the shell waits for the live session check.
**Options:**
- **A (recommended):** the local production-like stack stays the hard 01 §9 gate (CI + `pnpm verify`, green today);
  the Nightly staging Lighthouse becomes **report-only** (numbers printed, no red) until Phase 02 T2.x, where the start
  chain is flattened anyway with the real home screen: start i18n + the first route in parallel from `main.tsx`,
  `modulepreload` the active locale's chunks from `/boot.js`, and the admin shell paints the last-known screen from the
  device while `/auth/me` revalidates. Then staging is gated again with the same budgets.
- **B:** keep the staging gate red and flatten the chain now in Phase 01 (≈ half a day on placeholder screens that
  Phase 02 replaces); admin warm still needs A's shell change.
- **C:** separate, looser staging budgets (e.g. cold 3.0 s, warm 1.5 s) permanently.
**Recommendation: A** — the budget is enforced where it measures our code, the real fix lands with the real screens,
and staging gets the same budgets back in Phase 02.
**Implemented (22 Oct 2026):** `LHCI_REPORT_ONLY=1` in the Nightly staging step (misses → warnings, exit 0); CI and
`pnpm verify` keep the hard gate on the local stack. Phase 02 work + re-gating staging: PROGRESS F42.

### #86 — Security review of the Phase 01 close fixes (`70f7583..4c5d5ec`) — ACCEPTED (Claude Code, 22 Oct 2026)
**Review:** security-reviewer, 22 Oct 2026: 0 HIGH, 0 MEDIUM, 5 LOW, all fixed. **L1** the raw-length cap did not stop
`normalize()` (Zod 4 checks continue by default) → `abort: true`, test spies `String.prototype.normalize`. **L2** blank-
looking letters passed `safeText` (U+3164 as a whole name) → Cn, Hangul fillers, U+034F, U+17B4/5, U+2800, variation
selectors except FE0E/FE0F refused; a required field needs a letter or digit (`safeText` is for names and labels, not
Phase 3 content bodies — Cf includes Arabic number signs). **L3** the /48 sibling applied to every IP bucket → opt-in
(`wide: true`, only `adminLoginIp`); every refusal logs `{ bucket, width }` without key or IP (since #88 L5: on the
request's own access-log line, not a separate `rate_limit.refused` line). **L4**
remaining ways around the scope bans → ESLint refuses re-exporting `systemScope` / `hookScope` and computed `import()`
/ `require` in server code; Semgrep matches re-exports by regex (its `export … from` patterns match every statement in
1.180). **L5** the one-off filter relied on `oneoff=False` → only an explicit `True` is skipped; the hourly run now also
archives the host journal (SSH / sudo auth events, deploy runs with migrations — 05 §5), encrypted like the rest.
**Informational:** a CSV export cut at 10 000 rows records `truncated: true` in its audit entry; staging's Redis ACL
waits for O22; "Pseudo IPv4: Off" belongs in the Cloudflare checklist (it is off — default — and keeps IPv6 /64 keys).

### #87 — Phase-verifier re-run of 22 Oct 2026: fixes and one deferral — ACCEPTED (Claude Code, 22 Oct 2026)
**Fixed:** (1) **C11 audit row in Urdu** was bidi-scrambled ("از 22 · super_admin a9853910 ،اکتوبر … am 07:03") and
formatted the time with a fixed `en-IN`: the actor type is now translated (`audit.actorType.*`, 4 locales — drafts in
the review CSVs), the id is isolated in `<Bdi>`, and the time goes through the locale's `<Time>` from the new
`wallClockInZone()` (`@mc/domain/time`, tested). The contract types `actorType` as the 02 enum. Action codes stay
as written: they are log identifiers (as in the filter list). (2) Cross-tenant writes now tested for `masjid_timings`
(insert / update into C), another admin's `admin_users` row, another admin's `admin_push_subscriptions`, and
device-vs-device updates / deletes / inserts on `devices`, `device_follows`, `ameens`. (3) **T1.8 "wrong purpose"**:
every invite purpose (register / add_device / recovery) goes through the one registration ceremony and the purpose is
server-stored, never chosen by the client — so a wrong purpose means a token or challenge used in the wrong ceremony.
Challenge binding was tested; now also a session token, a challenge cookie and a login challenge presented as an
invite get the same uniform 404 as an unknown invite, and a consumed invite cannot be reused. (4) A test fixture used
a widely known real phone number → `+919000000003`. **Deferred: F41** (the Windows-only native worker abort in local
`test:int`, ≈ 1 in 5 runs, no message, report or WER event; Linux CI never) — re-check after the Node 26 move (F1); if
it persists, a minimal repro for Node / libuv. Workaround in the verify recipe: re-run the package. It hides no test
result: a crashed file reports as failed, never as passed.

### #88 — Security review of the close fixes (`4c5d5ec..1c9f92d`) — ACCEPTED (Claude Code, 22 Oct 2026)
**Review:** security-reviewer, 22 Oct 2026: 0 HIGH, 0 MEDIUM, 5 LOW — all fixed. **L1** remaining ways around the scope
bans → ESLint also refuses aliased `systemScope` / `hookScope` imports, default exports of them, `createRequire`
(import or member) and `getBuiltinModule` in server code, and — the realistic risk — any import from `jobs/` in API
code outside `jobs/` (a job helper may run as systemScope inside); only `apps/server` entrypoints and the test hooks may
import job code (lint-rule tests for each case). Semgrep keeps its re-export rule; ESLint is the gate for the rest (CI +
pre-commit). Copying a scope into an object or a second variable is still possible on purpose — the per-process
database user remains the boundary, and code review the backstop. **L2** `log-archive.sh`: retention runs first; a failed
journal step removes its partial file, keeps its state and fails the run (`check.sh` marker); missing `journalctl` fails
loudly; new `infra/vps/test/log-archive.test.sh` (9 cases, in CI). **L3** an `actor_type` outside the enum is refused
loudly by `listAudit` (drift) instead of being relabelled `system` — audit rows are evidence; any future enum change
needs a migration of the old rows. **L4** the masjid detail RESPONSE no longer uses the request rules (`safeText`) for
`nameI18n` — plain strings out, rules only in; Mongolian free variation selectors (U+180B–180D, U+180F) refused.
**L5** a rate-limit refusal rides on the request's own access-log line (`rateLimit: { bucket, width }`), no second line
per refusal (tested, no IP in the logs). Noted: sudo command lines reach the archived journal for 200 days — never put
a secret on a sudo command line (DEPLOY.md).

### #89 — Final phase-verifier and security review of Phase 01 — ACCEPTED (Claude Code, 22 Oct 2026)
**Security review (`1c9f92d..e11e7b1`):** 0 HIGH, 0 MEDIUM, 3 LOW — fixed: a lazy `import()` of a `jobs/` path is refused
(no-restricted-imports never sees `import()`); only the worker, bootstrap CLI and test-hook files may import job code
(not `admin.ts` / `public.ts`, the internet-facing processes); PHASE_04 T4.1 now puts the queue definitions and the
enqueue helper in `packages/api/src/queue/**`, outside `jobs/`. Justified: the host-journal archive file has no
same-second name guard — two runs within one second cannot happen while the lock serialises them; not worth another
host-layer update. No secret, token, invite link or phone number in any evidence file. **Phase-verifier:** N1 — the
device `audit_log` insert cell was unrestricted (same class as #83 a): a device now writes entries only as itself
(`actor_type: 'device'`, its own id), and an admin only as `admin` (no `super_admin` / `system` stamp) — tested.
N2 — `writeAudit` (whose explicit-actor form skips the gateway) is no longer exported from `@mc/db`. N3 — Lighthouse
accessibility now also audits B1 invite and B2 undertaking (11 admin screens, all 100); invite tokens are never printed.
Report corrections R1–R9 applied.

### #90 — Domain logic for Phase 02: prayer, Hijri, follow codes, time, money, countdown (PHASE_02 T2.1) — ACCEPTED (Claude Code, 22 Oct 2026)
**Decision:**
- **`adhan` 4.4.6** (MIT, released 31 Aug 2026 — maintained again after 4.4.3 in 2022) is a runtime dependency of
  `@mc/domain`, so it ships in the musalli app: ≈ 15 KB minified / **≈ 5 KB gzip** (measured on the package's own
  minified ESM bundle). Named in 01 §4; no other new dependency.
- **Methods:** `karachi`→Karachi (adhan adds a 1-minute Dhuhr safety margin), `mwl`, `isna`→NorthAmerica, `egypt`,
  `umm_al_qura` (Isha = Maghrib + 90 min). **`other_custom` calculates like Karachi:** 02 §2 stores no custom angles;
  the admin customises per prayer (± minutes on a calculated adhan, or manual times). Adding stored angles later would
  need a schema migration and a DECISIONS entry.
- **Golden oracle (10 §4):** the Aladhan prayer-times API (its own PrayTimes-derived implementation, not adhan-js),
  7 cities × 6 dates (both Ramadans, both equinoxes, both solstices), Karachi + Hanafi, each request URL recorded in
  `packages/domain/test/fixtures/prayer-golden.json` (queried 22 Oct 2026). All 252 times within ±1 min (Dhuhr +1 =
  adhan's Karachi margin; the rest is second rounding). Hijri oracle: Aladhan `gToH?calendarMethod=UAQ`, 6 dates.
- **Resolution rules:** an offset jamaat never passes 23:59 (00 §4.2, Isha); incomplete stored settings resolve to the
  calculated adhan / no jamaat instead of throwing (the validators already prevent them). **Fridays:** the strip's
  Dhuhr cell shows the first Jumu'ah jamaat (DECISIONS #15) and the countdown runs to each Jumu'ah jamaat in turn.
  "Jamaat now" lasts 10 minutes, then the next jamaat (after Isha: tomorrow's Fajr). Sehri = *calculated* Fajr −
  precaution, Iftar = *calculated sunset* + precaution — the admin's adhan adjustments do not move them.
- **Countdown:** minutes are rounded **up** ("at most N minutes to go"); "Starts in N min" when fewer than 10 are left.
- **Hijri:** numbers from Intl Umm al-Qura (`null` — line hidden — when the engine lacks the calendar instead of a
  silent Gregorian fallback); offset −2…+2 in days; the day advances at Maghrib in IST. **F13:** month names and the
  day/month/year order come from our locale files (`common:hijri.*`, drafts in the review CSVs) — Intl's are English
  in Telugu and oddly ordered in Hindi. The i18n `format.hijri()` Intl stub is removed (no caller).
- **Clock drift (00 §7):** offset = server `Date` (+0.5 s for second truncation) − midpoint of the request; ignored for
  a malformed header, a round trip > 30 s or one that went backwards; applied only above 2 minutes.
- **Follow codes:** one encoder (`followCodeFromBytes`) shared by the client and `@mc/db`'s generator; input
  normalisation also strips Unicode dashes/spaces (codes pasted from chats). Scanned QR: exact app origin, `https:`,
  no credentials, path `/m/<code>` (query/fragment ignored) or a bare 8-character code.
- **Money:** pure Indian grouping/formatting (identical to Intl `en-IN`, property-tested) so count-up frames need no
  Intl; `parseRupees` accepts only unambiguous input (Indian or ungrouped digits, ≤ 2 decimals, Latin digits).

### #91 — Public API details (PHASE_02 T2.2) — ACCEPTED (Claude Code, 22 Oct 2026)
**Decision:**
- **Views carry the order (migration 0008):** a caller's sort runs after a view's projection stages and cannot use the
  index (explain on 100k items: 26,000 documents examined for a 31-item feed page). `v_pub_items` now sorts newest first
  and `v_pub_special_timings` by date *inside* the view, before the projection, so the caller's `$match` and `$limit`
  move into the index scan (31 examined for 31 returned). Callers never pass a sort on these views. Keyset pages use
  `published_at ≤ cursor` (index bound) plus the `_id` tie-break as a filter. View names and privileges are unchanged
  (no Atlas role change); `pnpm db:test` explain tests cover feed (plain / by type / next page), item, versions,
  resolve and every bundle query.
- **Ameen counts are live, not versioned:** they change without a content-version bump, so they are kept out of the
  immutable item/feed responses. New endpoint **`GET /ameens?items=<publicId,…>`** (≤ 30, `s-maxage=30,
  stale-while-revalidate=60`). `recordAmeen` relies on the unique index (mc_public may insert but never read `ameens` —
  found by running the tests as the real user): a duplicate rolls the transaction back and returns the current count.
- **New endpoint `GET /devices/me`** — exactly the stored device fields (05 §4 "what we store", A15 My data).
- **Bundle special dates** run from today − 7 days (DateStepper range) with no upper cap (max 100): the bundle is cached
  forever per version, so a 60-day window computed at the first request would hide later dates; the app applies the
  window. A missing `v` redirects like a stale one (302, `s-maxage=15`); a suspended masjid's feed is empty.
- **Rate limits:** registration = Turnstile + 300/h per IP; the "5/h per Turnstile-verified client" bucket has no key —
  nothing identifies a client before it registers (Turnstile tokens are single-use). Resolve counts per device, or per
  IP without one (`device_or_ip`). Turnstile: secret + token only (never `remoteip`), 5 s, no redirects, fail closed;
  the answer's `hostname` must be the app host — skipped for Cloudflare's test secrets (local, and staging until O8),
  which production refuses at boot (#59).
- **Link previews (`/m/:code`, `/p/:publicId`) via Caddy templates:** the app build emits `og.html` (the shell + one
  `httpInclude` action reading only the two regexp captures of a strict `^/(m|p)/[A-Za-z0-9_-]{1,32}/?$` match);
  api-public serves the HTML-escaped tags at `GET /api/v1/og/{m|p}/:id` (`s-maxage=300`). So api-public never needs
  the built `index.html` (03 §3 had it inject the tags itself). Tags: masjid name/area/city, or a neutral title per
  item type — never message text, names (dua) or religious content; sisters-only and unknown → generic. `og.html` is
  not precached and not served directly (404).
- **Seed:** `@mc/db/seed` (10 §5 placeholders verbatim, fake names, fixed ids and follow codes TESTA001/TESTB002/
  TESTC003). Locally `pnpm db:reset` runs it (`pnpm db:seed` alone). **Staging: the worker writes it at boot and every
  6 h when missing or older than a day** (relative Ramadan/Eid/recent dates stay current) — no deploy-script change,
  no owner action; refuses production in code. Seed "photos" are two-colour gradients that exist only as their
  ThumbHash: the app paints the placeholder for `seed/` keys and requests nothing (no media host before Phase 3).
- **Deferred:** `PUT/DELETE /devices/me/push` (Phase 4), reports/grievances/legal (Phase 8).
- **CDN check:** `scripts/check-cdn-cache.mjs` (Nightly staging job): versioned bundle and feed URLs answer
  `cf-cache-status: HIT` on repeat, an unversioned bundle redirects.

### #92 — Client data layer and its bundle cost (PHASE_02 T2.3) — ACCEPTED (Claude Code, 23 Oct 2026; budget raise to be confirmed by the owner)
**Decision:**
- **Data layer** (`apps/app/src/lib`): one schema-versioned device document in IndexedDB (`idb-keyval` 6.3.0, own database
  `mc-device`; memory fallback in private mode) validated on every read — corrupt/unknown data resets to a fresh state
  keeping only the locale (04 §11); typed API client over the shared contracts (10 s timeout, GET retried twice with
  jitter, never 4xx/non-GET, device header, server-clock offset from `Date`); query keys with the content version in
  them; TanStack Query persisted to IndexedDB (`@tanstack/react-query-persist-client` 5.104.1 — matches react-query;
  30-day max age, buster = release, only content roots); versions poller (focus + 60 s while visible) that prunes older
  versions; registration retry queue (offline/Turnstile/busy → deferred, retried on `online` and next start) and follow
  reconciliation (local intention wins; server extras adopted; a forgotten device re-registers and re-sends).
  `gcTime` is infinite (TanStack's "≥ maxAge" rule; 30 days overflows a timer); old versions are pruned explicitly.
- **Bundle:** the first build of this layer put the musalli initial JS at **200.2 kB** (classic Zod ≈ 25–30 kB via the
  contracts). Measures: (1) the public contracts and the problem schema are written with **`zod/mini`** (≈ 7 kB core;
  `defineRoute` accepts any Zod schema — validation via Zod's core functions, a Mini request object must be
  `strictObject` (refused at definition otherwise), OpenAPI gets Mini schemas as Zod's own JSON Schema; the client
  imports `@mc/shared/contracts/public` directly so no classic schema ships); (2) **PROGRESS F14 done**: catalogues are
  precompiled to ICU ASTs at build (`mcIcuPrecompile`) and the FormatJS parser is aliased to its `no-parser` stub;
  `i18next-icu` is replaced by our 50-line `createIcuFormat` (dev/tests still parse strings); (3) the sync code loads
  just after start. Result: **171.2 kB** (admin 211.3 → 202.9 kB). The remaining +5.8 kB over 165.4 is the price of
  validating every response and stored value (contracts + Zod Mini + store ≈ 11.8 kB). **`pnpm size` limit for the
  musalli `/` is set to 175 kB** under the owner rule "quality over bundle size" (10–20 kB acceptable, record and tell
  the owner) — the owner may ask for the 170 kB to be restored (next lever: split the contracts so late endpoints'
  schemas load with their screens).

### #93 — Onboarding flow, Turnstile on the client and the e2e device fixture (PHASE_02 T2.4) — ACCEPTED (Claude Code, 23 Oct 2026; size raise to be confirmed by the owner)
**Decision:**
- **Gate:** until `onboardedAt` is set the app shows A1 (lazy chunk) instead of the tabs (`AppGate`). Opened from
  `/m/:code` the "add your first masjid" page is skipped; the code is only shape-checked on the client (the resolve
  endpoint normalises/validates it) and that masjid is followed after onboarding with a toast. While A1 shows (online)
  the tab screens, the privacy text, `sync.ts` and `turnstile.ts` are prefetched so finishing offline still works
  (Playwright WebKit has no service worker to fall back on).
- **Pager** (`@mc/ui/components`, 08 §5.11): full-width pages, horizontal swipe with axis lock, forward only when the
  page allows it (a required choice), hidden pages `inert` + `aria-hidden`, slide → instant switch under reduced motion.
  Motion helpers `crossfadeIn` / `drawStrokesIn` + token `tween.drawIn`.
- **Turnstile:** loaded lazily at registration. Cloudflare's documented **test site keys never load any script** —
  `1x`/`3x` resolve the documented dummy token, `2x` fails — so local/CI/staging (before O8) send no request to Cloudflare;
  production refuses test secrets at boot (#59). A real key loads exactly `TURNSTILE_SCRIPT_URL` (allowed by the Trusted
  Types policy and CSP) and runs an invisible `interaction-only` widget with a 30 s timeout. No token (offline,
  unreachable, failed) → registration is **deferred** (`registrationPending`) and retried by the queue (#92); onboarding
  never blocks on it.
- **Privacy notice** (A1 page 4): `packages/i18n/legal/en/privacy.md` **draft-1** (English only, like the other legal
  drafts — legal text is the owner's/lawyer's to finalise, 05); the accepted version is stored on the device.
- **e2e fixture:** `appDevice` option — `'onboarded'` (default) seeds the IndexedDB device document before the app reads
  it, so every other spec starts at Home; `'fresh'` gives a first launch.
- **Bundle:** initial JS **175.3 kB** (the lazy-chunk split moved a shared chunk into the entry); `pnpm size` limit
  176 kB under "quality over bundle size" — the owner may ask for 175/170 kB back.

### #94 — QR fallback reader and the follow flows (PHASE_02 T2.5) — ACCEPTED (owner, 23 Oct 2026: option 1; 180 kB budget to be confirmed)
**Context:** 01 §4 named `qr-scanner` as the fallback when the browser has no QR `BarcodeDetector`, but its last release is
1.4.2 (Nov 2022) — CLAUDE.md §6 forbids packages without a release in 18 months. iPhone Safari (our main "Scan in the app"
path, #14) and desktop browsers have no native QR detector; Android Chrome has. Options put to the owner: (1)
`barcode-detector` + `zxing-wasm` (maintained, needs CSP `'wasm-unsafe-eval'`), (2) `qr-scanner` as an exception,
(3) no fallback ("Enter code" only).
**Decision (option 1):**
- **Reader:** native `BarcodeDetector` when it lists `qr_code`; otherwise a lazy chunk with **`barcode-detector` 3.2.3**
  (MIT) over **`zxing-wasm` 3.1.6** (ZXing C++ → WebAssembly; pinned as a direct dependency so the reader file is ours).
  `zxing_reader.wasm` (947 kB, 414 kB gz) is a hashed asset of our build — never the library's default jsDelivr URL —
  served `application/wasm` + immutable, **not precached** (cached on first use by the `/assets` CacheFirst route) and
  fetched only when someone scans on a browser without native QR support (download starts with the chunk, in parallel
  with the camera prompt). The library has no `eval`/`Function`/workers/script injection (checked in its ES build).
- **CSP:** the musalli app origin's `script-src` adds **`'wasm-unsafe-eval'`** (compiling WebAssembly only; JS `eval`
  stays blocked; Trusted Types unchanged). Admin unchanged until it scans UPI QRs (Phase 5). Caddyfile, 04 §7 and the
  security-headers e2e updated.
- **Scan validation (04 §6):** only `https://<this origin>/m/<code>` or a bare 8-character code (`followCodeFromScan`);
  anything else → shake + "This is not a Masjid Connect QR code", no navigation; the same wrong QR is reported again only
  after 2.5 s. Frames are checked every 200 ms while visible and nothing is open over the scanner; nothing leaves the
  device but the code lookup. The camera is asked for only after a tap unless already granted; denied / no camera /
  busy each get their own card with "Enter code".
- **Motion (08 §5.8):** brackets breathe, a line sweeps, on detect they snap inward (scale 0.9) and turn green — not to
  the QR's exact bounds (mapping detector coordinates through `object-cover` is fragile on low-end phones; revisit with
  O16 feedback). New presets in `@mc/ui/motion` (`shake`, `breathe`, `sweep`, `snapTo`, `loop.scan*`).
- **Navigation:** `push` from a modal replaces the modal's history entry (Scan → follow → Masjid Detail; back → where
  Scan was opened); new `NavigatorApi.replace`; closing a modal that was the first page (deep link, onboarding "Enter
  code") replaces it with the tab root instead of leaving the app (bug found here). Masjid Detail lives at
  `/masjid/:masjidId` (placeholder until T2.8).
- **`/m/:code` (A16, #14):** in the app: preview + Follow → Masjid Detail in its place; unknown/malformed code → not
  found + "Scan again". iPhone Safari (not installed): explainer "follow it in the app" with the code large
  (`ABCD-EFGH`), the install guide, and "Use it here in Safari instead"; on a first visit this comes before onboarding
  (which then follows at its end, as before).
- **Tests:** unit (detector/camera/torch/code input/lookup/media/names, effects, navigator model); e2e
  `follow.spec.ts` (both phones: code entry incl. invalid/unknown/paste/already-followed, landing incl. iPhone
  explainer, not-found) and **journey 2** `scan.scan.spec.ts` in a new `scan` project: Chromium's fake camera plays a
  Y4M generated at global setup by zxing-wasm's writer (foreign QR 3 s, then `/m/TESTA001`; `e2e/.cache/`, not
  committed) — this runs the WebAssembly reader under the real CSP.
- **Local stack:** its CSP `img-src` also allows setup-local's dev media origin (`http://localhost:8790`), which the
  apps are built with (first screen that renders a masjid photo).
- **Bundle:** musalli initial JS **179.25 kB** → `pnpm size` limit **180 kB**. New code at start is ≈ 1 kB (routes,
  glyphs, name helper); the rest is rolldown splitting Motion into two extra preloaded shared chunks once a second lazy
  chunk (the follow flow's success check) uses it (lost gzip context). A Motion chunk group made it worse (+7.9 kB) and
  was reverted. Owner rule "quality over bundle size" — owner to confirm or ask for a deeper fix.

### #95 — Home (PHASE_02 T2.6) — ACCEPTED (Claude Code, 23 Oct 2026; 184 kB budget to be confirmed by the owner)
**Decision:**
- **View model** (`features/home/lib/home-view.ts`, pure, tested): strip day = today, or tomorrow once today's last jamaat
  is over (Fajr highlighted); highlighted cell = the next jamaat (`nextJamaat`, Jumu'ah on Fridays); countdown buckets from
  `@mc/domain`. The clock re-renders once a minute and at midnight (`useNow`), so prayer, Hijri date, Ramadan/Eid cards
  roll over without a reload. Date line Hijri = first followed masjid's offset (else the global one) with its Maghrib
  rollover. Ramadan card = first followed masjid in Ramadan mode; Eid card = nearest Eid salah within today + 3 days.
- **Data:** followed ids → versions → `bundle?v=` and the first feed page per masjid (persisted cache → works offline);
  masjids the versions endpoint no longer lists are hidden; first open offline → error card with retry. Recent updates =
  5 newest across the first pages; template notices use the template title in the app language. Bell dot = any of them
  newer than `updatesSeenAt`.
- **Components** (`@mc/ui`): `NextPrayerPanel`, `PrayerStrip` (one highlight element sliding by `--mc-index` with
  `spring.gentle` as CSS — transform only, RTL-aware; 08 §5.5's `layoutId` would need Motion's layout features at start),
  `CountdownText` (digit roll, pulse dot under 10 min), `MasjidCard`, `Carousel` (native scroll-snap, dots via scaleX),
  `PullToRefresh` (touch, `distance^0.7`, 72px commit, holds at 56px until the data settles); new glyphs (compass,
  wrench); tokens `loop.pulseMs`, `gesture.pull*`; utilities `transition-highlight`, `pulse-dot`, `mx-bleed`,
  `scroll-px-screen`.
- **Strings** for Home live in `common` (loaded at start) — a separate namespace would add a request before Home's first
  paint.
- **Placeholders** until their tasks: `/masjid/:id` (T2.8), `/items/:publicId` (T2.11), `/qibla` modal (Phase 7).
- **Tests that used the Home placeholder** (navigation, perf, smoke) now use the `/demo/:n` placeholders opened over the
  Home root; root scroll-to-top uses the Settings tab. The Home e2e pins the page clock and strips the API `Date` header
  (the drift correction would undo the pin) with service workers blocked for that spec.
- **Bundle:** initial JS **183.1 kB** → limit **184 kB**: the entry's shared modules now carry what Home uses (TanStack's
  query observer via `useMasjidVersions`, the new glyphs, time helpers). Home loads them at start anyway; F43 splits those
  modules so lazy-only code leaves the entry.
- **Open:** LCP warm ≤ 1.0 s / cold ≤ 2.5 s is measured by Lighthouse on staging after the deploy (report).

### #96 — My Masjids (PHASE_02 T2.7) — ACCEPTED (Claude Code, 23 Oct 2026)
**Decision:**
- **"N new updates"** per masjid = items of its first feed page newer than the later of the last Updates visit
  (`updatesSeenAt`, the only seen marker — 07 A13) and when it was followed, so a newly followed masjid does not show its
  history as new. Shown as 9+ above nine.
- **Mint row** = the masjid with the soonest next jamaat (07 A3).
- **Reorder** is device-only (follow order in the device document; the server keeps no order). `ReorderList` (`@mc/ui`):
  drag handle with pointer capture (rows slide by transform, haptic on pick-up and on each slot change), Arrow Up/Down on
  the focused handle; the single-pointer alternative required by WCAG 2.5.7 is the row menu (tap a row in edit mode →
  Move up / Move down / Unfollow). Entering edit mode: "Edit" in the header or long-press a row.
- **Unfollow** asks first (destructive dialog), hides at once, syncs in the background; the toast's Undo (5 s) puts the
  follow back in its old position with its original follow date — kept as is when the removal was not sent yet, queued
  to follow again when it was (`restoreFollow`).
- Masjid Detail stays a placeholder until T2.8; suspended / failed masjids show a short note row.

### #97 — Masjid Detail (PHASE_02 T2.8) — ACCEPTED (Claude Code, 23 Oct 2026)
**Decision:**
- **Layout:** own scroller (not `Screen`) so the hero can sit under a transparent bar; back and "…" are white circles
  (`onImage`) in both bar states; the bar fades to solid with the name between 60 % and 80 % of the hero scrolled
  (08 §4); parallax and overscroll scale are transforms written once per frame, off with reduced motion. The sheet fills
  at least the screen so the bar can always turn solid.
- **Mute** (DECISIONS #16) lives on the server (push targeting): `setMuted` changes the device copy at once, PATCHes when
  the follow is on the server, rolls back and says so when it can't (offline); a follow still queued sends its mute
  flag right after its PUT.
- **Share** = the follow link `/m/:code` (no tracking parameters) via Web Share, else a sheet with WhatsApp (`wa.me`
  link) and Copy link. **Directions** = Google Maps directions URL in a new tab (`noopener`). Both are plain
  navigations — no request from our servers.
- **Overview rows** show only sections with content: first page of each type's feed (5 cached, version-keyed requests
  that the section screens of T2.11 reuse); Weekly Chanda when the masjid shows it and has weeks. Unseen counts as in
  #96 (none when not followed). Rows open `/masjid/:id/:section` (placeholder until T2.11).
- **Prayer Timings tab** shows today's Adhan / Jamaat until A6 (T2.9) replaces it.
- **Not followed** (opened from a link): its own versions + bundle lookup; no Notifications action.
- **Shared-element morph** (08 §3.5, "progressive enhancement") deferred to F44: it needs a navigator hook for a
  cross-layer overlay; the acceptance alternative "disabled (documented)" applies until then.

### #98 — Prayer Timings (PHASE_02 T2.9) — ACCEPTED (Claude Code, 23 Oct 2026)
**Decision:**
- One `TimingsContent` for the A6 screen (`/masjid/:id/timings`, reached from Home's next-prayer panel) and Masjid
  Detail's "Prayer Timings" tab (07 A5: same content without the bar).
- Rows are the `@mc/domain` output as is (`resolveSchedule` → `timingRows`): Fajr, Sunrise (muted, Adhan only), Dhuhr —
  or Jumu'ah with the first jamaat on Fridays — Asr, Maghrib, Isha; calculated adhans carry a dot with the tooltip
  "Calculated for this masjid's location". The next jamaat's row is tinted only on the day it falls on.
- Date stepper range today −7 … +60 (arrows disable at the ends, the date sheet is bounded the same way); the Hijri date
  uses the masjid's offset (else the global one). Changing day slides the table ±40 px from the side it comes from
  (`slideIn`, `tween.quick`, mirrored in RTL; a fade with reduced motion).
- Special Dates lists today's and later entries grouped by date; admin labels/notes are shown as entered.
- F43 part 2 done: `@mc/ui/icons/glyphs.tsx` is a barrel over one module per glyph, so icons used only by lazy screens
  stay out of the entry (−2.1 kB).

### #99 — Updates, and what its fling trace changed underneath (PHASE_02 T2.10) — ACCEPTED (Claude Code, 24 Oct 2026)
**Decision:**
- **Merge:** each followed masjid's feed is paged on its own (first page shared with Home's cache, later pages by
  cursor). `mergeTimeline` shows an item only when it is not older than any unfinished masjid's oldest loaded item, and
  `loadMore` pages exactly those masjids — the list is always in true time order (e2e checks it against the API with
  3-item pages).
- **Chips** = All + the item types present in the followed masjids' first pages (new types appear by themselves).
- **Long lists:** rows use `content-visibility: auto` (the browser skips off-screen rows) instead of JS windowing; the
  fling trace passes with 30 rows at 4× CPU. Revisit with real-device data (O16) if lists grow into the hundreds.
- **Seen:** dots compare with the last visit as it was when the screen opened; after 1.5 s on screen the device's
  `updatesSeenAt` is set — written in `requestIdleCallback`, never mid-fling. Badge count lives in a tiny store in the
  entry (`lib/unseen.ts`), computed by Home's bell.
- **Performance fixes found by the trace** (each a real low-end-phone cost, not a test artifact):
  1. **Query cache persistence is per query** (`q:<hash>` entries, `createQueryPersistence`): the previous whole-cache
     persister re-serialised everything on every change (each versions poll), 120–490 ms at 4× CPU.
     `@tanstack/react-query-persist-client` removed; the cache is restored together with the device document before the
     first render; entries of another release or > 30 days are dropped.
  2. **IST conversions by arithmetic** (`calendarDateInZone` / `wallClockInZone` — IST is UTC+05:30, no DST); other zones
     use cached formatters. A new `Intl.DateTimeFormat` per call dominated prayer and timeline work.
  3. **`useDeviceSelector`** — screens subscribe to the field they use; and the device store publishes the validated
     candidate instead of Zod's deep copy, so unchanged parts (the follows) keep their identity.
  4. Long lists are memoised with identity comparators (`lib/same.ts`); Home's bell is its own component.
- **Perf project** runs without Playwright's trace (its DOM snapshots run inside the page and showed up as long tasks);
  flings are synthesised natively (`Input.synthesizeScrollGesture`), not with `mouse.wheel` (which waits in the page).

### #100 — Announcements, Hadith & Quran, Dua Requests — read side (PHASE_02 T2.11) — ACCEPTED (Claude Code, 24 Oct 2026)
**Decision:**
- **Routes:** `/masjid/:id/{announcements,hadith,duas}` (static segments win over `$section`, which stays the Phase 5/6
  placeholder) and `/items/:publicId` for every item: notice detail, the Read Full reader for hadith/ayah (Read Full
  pushes the same route — no separate reader URL), dua detail; other types show title + text until their phases.
- **Lists reuse the Updates paging** (`useTimeline(type, [masjidId])`); a followed masjid shares the followed-masjids
  versions poll, a masjid opened from a link gets its own. Category chips filter the loaded pages on the device (the
  sentinel keeps paging while a filter shows few rows). The detail renders from the cached feed pages (instant,
  offline) and fetches `GET /items/:id` only for links/pushes; it is persisted (Saved opens offline).
- **Template bodies at runtime:** notice templates are full ICU (02 §2, C9 editor), so they need the parser the app
  build removed (F14). `@mc/i18n/runtime-message` is the only module that keeps the real parser — `mcIcuPrecompile`
  now uses `resolveId` (no-parser stub for every other importer) — and it loads lazily, only where a template body is
  shown. Params are formatted per declared type (time/date/ranges → `x_start`/`x_end`, prayer names from
  `common:prayer`); a value of the wrong type is dropped, so the body falls back to nothing rather than to wrong text.
- **Hero card:** the newest item of the tab is the hero; the "Today's Hadith/Ayah" pill only when it was published
  today (IST). The picture is our own token-coloured SVG (lantern, open book, arched window) — 06 §5 forbids stock
  photos in UI chrome and 07 A8 forbids people; the owner can swap in a licensed photo later.
- **Ameen** (`lib/device/ameen.ts`): recorded on the phone at once (button state, `ameens`) and queued
  (`pendingAmeens`); sent on the tap, on start and on `online` (also after registration). Offline / 5xx / 429 stop
  quietly and keep the queue; a removed item is dropped; the server is idempotent per device. Shown count = max(live
  `GET /ameens` count, the exact count our POST returned) + 1 while ours is queued; nothing when no count is known.
  Motion 08 §5.6: Motion springs take two keyframes, so the pop runs 0.92 → 1.06 (`spring.snappy`) → 1
  (`spring.bouncy`); the ripple starts at the tap point (CSS vars on the shared `ripple` utility); haptic `ameen` 15 ms.
- **"Older":** a dua request is archived when the server marked it or after 30 days (no archive job before Phase 8);
  the section is collapsed by default.
- **Privacy wording:** a private name shows "For a brother or sister from our community" (no gender is stored, so the
  wording stays neutral).
- **Admin/library text gets `dir="auto"`** (titles, bodies, notes, messages, transliterations): English text in the
  Urdu UI keeps its own direction (found in the Urdu screenshot — the full stop jumped to the start). Arabic keeps
  `lang="ar" dir="rtl"` and is never mirrored (e2e checks direction, transform, Amiri in all four locales).
- **Image viewer:** native modal `<dialog>`, pinch around the fingers with rubber band (1–4×), pan, double-tap,
  wheel/`+`/`−`/`0`; releases settle with `spring.smooth` via the navigator driver's channels; geometry is pure
  (`zoom.ts`, property-tested). It closes with Esc / its button, like Sheet and Dialog (no history entry).
- **Add to calendar:** `@mc/domain/ics` builds one VEVENT (UTC, RFC 5545 escaping and 75-octet folding, so no text can
  inject a property); downloaded through an object URL — nothing leaves the phone.
- **Report ("…")** is not shown until Phase 8 builds reporting (phase file "Out of scope").
- **Bundle:** initial JS 181 → 184 kB limit (182.96 kB): the new screens share more of Motion and intl-messageformat, so
  rolldown splits them into more preloaded chunks (+3.1 kB, mostly lost gzip context). Owner, 24 Oct 2026: "10–20 kB
  is fine, focus on quality".
- **Seed:** the Alpha event notice has a gradient "photo" (`seed/notice-alpha`, ThumbHash only) and Gamma has one
  archived illness request (800 h old) — 31 items.

### #101 — Settings and the post landing (PHASE_02 T2.12) — ACCEPTED (Claude Code, 25 Oct 2026)
**Decision:**
- **Server-side preferences:** Language and Brother/Sister change the phone at once and the server device record
  (`PATCH /devices/me`, both fields sent together). Offline / 5xx / 429 → `prefsPending` in the device document, sent on
  start and on `online`; an unregistered device sends nothing (registration carries the current values); a forgotten
  device registers again. Feeds refilter without extra code — their query keys carry `aud`.
- **Clear all data** (05 §4, journey 12): `DELETE /devices/me` first, then the device document is reset (language kept),
  the query cache is cleared (its persisted entries go with it), the unseen badge resets, and onboarding shows.
  Offline, the phone is cleared at once and only the old credentials stay (`pendingDeletion`) until the server record is
  deleted on the next start/online — 05 §4 "works offline-queued". A 401 (already gone) counts as deleted. The two new
  device-document fields are optional, so existing phones' documents still validate (no reset).
- **My data** shows exactly `GET /devices/me` (in memory only, never persisted — it carries the app ID) and what the
  phone keeps (follows, saved count, Ameen count, reader/vibration settings).
- **Vibration (F16):** `settings.vibration` drives `setHapticsEnabled` from start; the switch shows only where
  `navigator.vibrate` exists (Android) — iOS has no web haptics.
- **Notifications row:** "Coming soon", dev/staging builds only (`DEV || VITE_PUBLIC_SHOWCASE`), per the phase file.
- **Legal:** the Privacy Policy reader shows the DRAFT tag and version (English draft for every locale until the human
  translations); it ends with a Contact & Grievance button (axe: a scrollable page needs a keyboard stop). Contact &
  Grievance shows the officer from `/config`; the mail link appears only for a real address (the migration's
  "NOT SET" placeholders until C10). The in-app grievance form is Phase 8. Terms / content policy / licences: Phase 8.
- **`/p/:publicId`:** the item detail in a read-only mode (no Ameen button — the count shows — and no bookmark) with
  Follow masjid (the `/m/:code` follow flow) and, outside the installed app, install guidance. A browser cannot open the
  installed app by itself, so "Open app" (07 A16) is that guidance. A first-time visitor onboards — "add your first
  masjid" is skipped as for `/m/:code` — and returns to the post. The landing loads all four string namespaces at once.
- **Copy fix:** onboarding's Brother/Sister help said "saved on this phone"; the server keeps it too (privacy notice §2)
  — corrected in all four locales.
- **Bundle:** initial JS limit 186 kB (184.1 kB): the start-up sync of queued Settings changes / deletion and the
  Vibration hook live in the data layer (+1.1 kB; owner rule "quality over bundle size").

### #102 — PWA / offline completion (PHASE_02 T2.13) — ACCEPTED (Claude Code, 25 Oct 2026)
**Decision:**
- **Runtime caching** stays as built in T0.11 (01 §5.6 already met: shell precache, versioned API CacheFirst, versions
  NetworkFirst 3 s, media images CacheFirst 300 / 30 days). New: API answers read from Cache Storage carry
  `X-MC-SW: cache` (immutable answer) or `X-MC-SW: fallback` (versions, network failed / timed out) — one Workbox
  plugin, last after expiration. Page and worker share `apps/app/src/lib/sw-protocol.ts` (constants + one pure function,
  no dependencies, so nothing extra enters the worker).
- **Server clock (bug found):** the client took the clock offset from every response's `Date`, and keeps the latest. A
  cached answer — browser HTTP cache (`max-age=31536000, immutable`), the worker's cache, a CDN hit — carries the
  `Date` of when it was stored, so an offline start with a bundle cached three days earlier moved "now" (countdowns,
  Hijri date) three days back. Now only answers whose `Date` is from now count: no `X-MC-SW`, no `Age > 0`, no
  `max-age > 0` (`freshDate`, unit-tested). `no-store` and CDN-only (`s-maxage`) answers still measure.
- **Offline banner (01 §5.6 "or requests fail"):** besides `navigator.onLine`, the client reports whether the server
  answered (`lib/reachability.ts`): a request with no answer (network failure, timeout, worker fallback) shows the
  banner; any answer hides it; an `online` event clears it. Answers from the worker's immutable cache say neither.
  Recovery (unreachable → answer) runs the same retry as `online` (registration, follows, Ameens, Settings).
  `AppSurfaces` (`@mc/ui/pwa`) takes an optional `unreachable` flag; the admin app is unchanged.
- **Background Sync for Ameen (where supported — Chromium):** after a tap leaves the Ameen queued, the page registers
  sync `mc-ameen`; the worker reads the device document **read-only** (credentials + `pendingAmeens`, field-checked by
  `queuedAmeens`) and POSTs each; 429/5xx/network → throw → the browser retries later. The page dequeues on its next
  flush (the server counts once per device, so the resend changes nothing) — one writer of the device document only.
  Elsewhere (Safari, Firefox): start / `online` / reachability recovery, as before.
- **Persistent storage:** `navigator.storage.persist()` once per start as soon as the device follows a masjid
  (skipped when already persistent; Chromium grants installed apps silently, Firefox may ask once).
- **Link capture (Android WebAPK) — documented behaviour:** a WebAPK registers intent filters for its manifest scope
  (`/` on the app origin), so `https://app.<domain>/m/<code>` and `/p/<id>` tapped in another app (WhatsApp) open the
  installed app; links followed inside Chrome stay in Chrome; iOS never captures links (the `/m/:code` Safari explainer,
  DECISIONS #94). **Bug found:** the manifest's `launch_handler: focus-existing` (T0.11) only focuses an open app and
  queues the URL in `window.launchQueue` — without a consumer a follow link tapped while the app was open did nothing.
  `lib/launch.ts` consumes it: tab root → switch tab, modal path → present it, otherwise push; other origins and the
  launch that loaded the document are ignored. Shortcuts (Updates, Qibla) use the same path. Verified by the owner on
  a real phone (guide 2.20) — headless browsers have no WebAPK.
- **iOS standalone detection:** already in `lib/platform.ts` (`display-mode: standalone` or `navigator.standalone`),
  used by onboarding, Settings → Install, the `/m/:code` and `/p/:id` landings; no change.
- **Journey 4 (10 §6)** `e2e/app/offline.spec.ts`: both phones — API unreachable on a live connection → reload → Home,
  Prayer Timings, Updates from the persisted query cache + banner, banner clears when the server answers; Chromium —
  no network → the worker serves shell + API, answers marked `fallback` / `cache`. WebKit skips the worker case
  (Playwright's WebKit does not run workers offline reliably — as T0.11).
- **Bundle:** initial JS 184.8 kB (+0.7 kB; limit 186 kB unchanged).

### #103 — Quality gates and Phase 02 close-out (PHASE_02 T2.14) — ACCEPTED (Claude Code, 25 Oct 2026)
**Decision:**
- **Visual regression (10 §1, journey 5):** `e2e/visual/screens.visual.spec.ts` — 10 musalli screens (onboarding
  welcome, Home, My Masjids, Masjid Detail, Prayer Timings, Updates, Announcements, Hadith & Quran, Dua Requests,
  Settings) × en/hi/ur/te × Pixel 7 + iPhone 14 = 80 baselines (`e2e/visual/__screenshots__`, CSS pixels, ≈ 5 MB).
  Screenshots differ between operating systems, so baselines are made **and** compared only inside the pinned
  Playwright Linux image (`mcr.microsoft.com/playwright:v1.63.0-noble`, by digest; `scripts/visual.mjs` refuses a
  mismatch with `@playwright/test`): `pnpm test:visual` / `pnpm test:visual:update`, and a CI step after Lighthouse.
  Deterministic by construction: the database is reset and seeded as of a fixed instant (`SEED_NOW` =
  `VISUAL_NOW`, Wed 21 Oct 2026 12:00 IST), the page clock is fixed there and the API `Date` header dropped; the shot
  waits for network idle, no `.skeleton`, fonts and settled motion. Tolerance `maxDiffPixelRatio` 0.002. The visual
  projects set `bypassCSP` only because Playwright's `animations: 'disabled'` / `caret: 'hide'` inject an inline
  `<style>` that WebKit blocks under our CSP; every other project keeps the CSP guard. On Windows/macOS the script
  copies the sources into the container and installs there (host `node_modules` cannot run in Linux).
- **Perf traces (08 §8)** on the real screens: `e2e/app/screens.perf.spec.ts` — Home → Masjid Detail push + swipe-back
  pop, tab switches, sheet open / short drag / dismiss (4× CPU; Qibla rotation is Phase 7), next to T0.9's navigator
  spec and T2.10's Updates fling. **It found real problems** (taps of 100–130 ms at 4× CPU), fixed with CPU profiles
  mapped through the hidden source maps:
  - `ChipGroup` and `UnderlineTabs` measured layout synchronously in a layout effect keyed on array identity, so any
    parent re-render (each navigation) forced a full page layout inside the tap (≈ 125 ms) → measured in the
    ResizeObserver callback, keyed by content;
  - the navigator's context value changed on every navigation, re-rendering every mounted screen that calls
    `useNavigator()` → a stable api object delegating to the latest one (the tab bar still gets the live `api`);
  - `useNow()` returned a new Date on every render, defeating every `useMemo(…, [now])` (Home recomputed all prayer
    times on each navigation) → one Date per minute tick / clock offset;
  - Masjid Detail read `scrollTop` / `offsetHeight` while mounting → first parallax values in the next frame;
  - a pushed screen's content now renders as a React transition (`ScreenSlot deferContent`): the layer starts sliding
    at once and the content fills in during the first frames instead of a long task before the first frame;
  - (tried and reverted: `content-visibility: hidden` on hidden tab layers — WebKit lost their scroll position.)
  Result: ≈ 50–75 ms at 4× CPU — **still over the 08 §8 limits** (long tasks > 50 ms, 6–13 % dropped frames, one
  forced layout on sheet open). **Deviation:** the three real-screen tests are `test.fixme` (F46), so the phase does
  not claim this gate; the navigator spec and the Updates fling keep the strict 08 §8 gate in CI. F46 is the first
  item of Phase 03 (with a real low-end phone, O16), before any new screen.
- **Two more bugs found by the visual baselines:** `DigitRoll` put every character in its own box — Urdu letters did
  not join and "30" showed as "03" in right-to-left lines → only numbers roll (one `dir="ltr"` group each), words stay
  text; English admin text in the Urdu Updates timeline / item lists put its "…" first → `dir="auto"` on admin-written
  titles (Timeline; `ListRow textDir`), as T2.11 did for the cards.
- **Journeys 1–5, 8, 12:** both phones, except journey 2 (camera scan) on Chromium only — Playwright's WebKit has no
  fake camera; the iPhone covers the Enter-code follow path (`follow.spec.ts`). Journey 4's worker case is Chromium
  only (#102).
- **Initial JS budget — deviation:** the phase file's "≤ 170 KB gz" is not met: 185.3 kB, `pnpm size` limit 186 kB.
  Owner's rule (O24, 24 Oct 2026: "10–20 kB is fine, focus on quality"; memory "quality over bundle size"); each raise
  is recorded (#92–#102). Cutting back (F42/F43) moves to Phase 9 hardening.
- **Security review of the phase (25 Oct 2026) — 1 HIGH, 1 MEDIUM, 8 LOW:**
  - **H1 fixed** — server-side template injection in the link previews: Caddy renders the api-public fragment as a
    template (`httpInclude` in og.html), so `{{ … }}` in a masjid name / title would have run in Caddy (env, includes,
    a meta refresh to a phishing page). `escapeHtml` now also escapes `{` `}` as entities (crawlers read the same);
    unit test, and verified through the real Caddy: a masjid named `Test {{now | date "2006"}} {{env "HOME"}} Alpha`
    comes back as literal text.
  - **M1 fixed** — "Clear all data" now also empties the worker's personal caches (feeds/bundles, the versions URL that
    lists the followed ids, photos) and every persisted query (`wipeCachedContent`, unit test); 05 §4 "local wipe".
  - **L1 fixed** — the worker caches only the three public versioned paths, never a request with `Authorization`, only
    `public` answers. **L2 fixed** — `deviceSelf` 120/h/device on `/devices/me*`, `publicReads` 1200/min/IP on
    versions + ameen counts (03 §2). **L4 fixed** — a failed preview include serves the plain shell (200, `no-store`;
    verified with api-public stopped). **L7 fixed** — `packageManager` pins pnpm's sha512 (corepack verifies).
  - **L3** (accept only the current privacy version at registration) → Phase 8 with the legal pages and consent
    versions; **L5** (staging Turnstile test keys) = owner item O8; **L6** (items view block-list fields, nothing leaks
    through the API allow-list) → Phase 5 with campaigns; **L8** — F45 closes by the body-parser bump, not by moving
    the date.
- **Phase verifier (27 Oct 2026) — fixed:** typecheck of the offline spec; CI e2e red since T2.13 because `followByCode`
  resolved codes per test against the 30/min per-IP `codeResolve` limit (now once per worker, clear error); journey 1
  now also "follow via `/m/:code` → Home counts down" in en/hi/ur/te; the Qibla placeholder (Home button) is
  dev/staging-only (`lib/build.ts SHOW_COMING_SOON`) and its manifest shortcut arrives with Phase 7; side-by-side
  reference images (`docs/reports/evidence/PHASE_02_side-by-side_*.png`); `pnpm verify` includes `test:visual`.
- **Further declared deviations:**
  - **T2.6 LCP (warm ≤ 1.0 s / cold ≤ 2.5 s) of a Home with masjids — not measured.** CI Lighthouse loads `/` on fresh
    storage (onboarding: 99/100/100) and the staging Lighthouse is report-only until F42 and O23; deferred with F42 to
    Phase 9.
  - **T2.2 "CDN HIT on staging"** — the automated check exists (Nightly) and still shows `DYNAMIC`: the Cloudflare
    cache rule does not match yet (owner item O23). Correctness does not depend on it (versions bump in the same
    transaction); only origin load does.
  - **F20** (real low-end Android motion check) merges into F46 (Phase 03, O16).
  - The Scan modal (A4) has no axe pass (its camera states are covered by unit tests); added with F46's motion work.
- **Follow-ups closed or deferred:**
  - **F21** (back closes sheets) — closed by the platform: every sheet/dialog is a modal `<dialog>` (`showModal`), and
    since Chrome 120 the Android back button / gesture is a close request that fires `cancel` (CloseWatcher
    integration), which our overlays already handle (animated close; a forced close keeps React state in sync). iOS has
    no back button; desktop browser Back still navigates (not a target). Owner check 2.19a on the Poco F7.
  - **F22** (icons) — the two weak musalli glyphs now use Phosphor's exact `hands-praying` / `megaphone` paths (MIT,
    `packages/ui/src/icons/PHOSPHOR_LICENSE`); the admin icons → Phase 3 (the admin screens are rebuilt there).
  - **F44** (card → hero shared-element morph, 08 §3.5 "progressive") → Phase 9 polish: the stack navigator animates
    whole layers and needs a per-push overlay hook; the push itself already slides with parallax. Owner guide 2.8 says so.
  - **F42 / F43** (start-up chain, entry chunk) → Phase 9 hardening together with the staging Lighthouse gate, which
    also waits for the Cloudflare cache rule (O23). CI Lighthouse on the built stack stays the gate meanwhile.
  - **F18** (`/demo/:n`) → Phase 9: every tab root, Scan and the spacer are real; `/demo/:n` remains only as the
    navigator specs' generic fixture (no link to it, no data).
  - **F45** — closed 27 Oct 2026: body-parser 2.4.0, serialize-javascript 7.1.4, all ignores removed. (Was: the
    time-boxed ignores keep CI correct until 27 Oct; done in the first session after that time (before Phase 03).
  - **F1** (Node 26) — cannot start before 28 Oct 2026 (Active LTS); first session after that.

### #104 — New features before launch: voice notes, Ruqyah, adhkar, ilm contacts, blood camp, needy people, personal zakat tracker — ACCEPTED (owner, 27 Oct 2026)
**Context:** after verifying Phase 02 the owner asked for seven features. Claude Code asked 8 questions with
recommendations (rules involved: CLAUDE.md §2.1 privacy, §2.2 money, §2.3 religious text; DPDP Act; cost). Owner's
answers, 27 Oct 2026: 1 — Ruqyah set by the masjid, as text it enters **or** audio it uploads, **and** the Content
Library as an option; 2 — needy people as recommended, details entered by the masjid; **no UPI change-lock for them —
the masjid adds the UPI ID**; zakat-eligible tag yes; 3–6 — as recommended; 7 — as recommended but voice notes up to
**10 minutes**; 8 — fold into the existing phases ("go with it" = recommended).
**Decision:** everything stays **per masjid** — a musalli sees only what the masjids they follow publish; nothing is
global. Every section appears only when its masjid has content in it (no extra toggles for admins).
1. **Voice notes (Phase 3).** Admins record (MediaRecorder) or pick an audio file, **≤ 10 min**, for announcements,
   dua requests, daily content, Ruqyah entries. A **one-line title is required** with every voice note (it is what
   push, lists, search and screen readers use; voice is not translated). Upload `POST /api/admin/masjids/:id/audio`
   (busboy, ≤ 25 MB, magic bytes: Ogg/Opus, WebM, MP4/M4A/AAC, MP3, WAV, 3GP), stored as Cloudinary `video` resource
   `m/<masjidId>/a/<uuid>` (the original is not kept beyond Cloudinary's master); duration from the upload response —
   over 600 s → rejected and deleted. Delivery: `media.<domain>/a/m4a/<key>` → one named transformation (AAC ~48 kbps
   mono, universal incl. iOS) through Caddy's allow-list and Cloudflare, `immutable`. Musalli: inline player
   (play/pause, scrub, 1×/1.5×/2×, remaining time), audio cached by the worker only after it was played (range
   requests). Push (Phase 4) shows the title + "🎤 Voice message". Moderation, reports, takedown and retention apply
   to audio exactly as to text (Phase 8). Cost: Cloudinary Free plan first; Super Admin Stats show stored audio
   minutes; moving to a paid plan is an owner decision later (CLAUDE.md §4 "paid service").
2. **Ruqyah (Phase 3).** A masjid section with headings by category (`nazar` "Protection from Nazar", `sihr`
   "Protection from black magic", `shifa` "Healing", `protection` "Daily protection", `general`). Each entry is one
   of: a **Content Library** entry (verified source, as hadith/ayah), **text entered by the masjid** (Arabic + one
   translation + optional reference — labelled "Added by <masjid>", never as a verified source), or **audio uploaded
   by the masjid** (with the ownership/permission checkbox, 05 §9). Optional masjid-written instruction per entry
   (e.g. when to listen) — guidance comes from the masjid, never from the app. ≤ 50 entries per masjid.
3. **Adhkar after salah (Phase 3).** Library kind `dhikr` (owner imports from a verified source; fields add `repeat`
   and occasion tags `after_salah`, `morning`, `evening`). The masjid turns "Adhkar after salah" on and picks an
   ordered set (≤ 30). Home shows an "Adhkar after salah" card for **30 minutes after each fard prayer's jamaat**
   (adhan when no jamaat) of the first followed masjid that has a set; "See all" always reachable from Masjid Detail.
   A tap counter for `repeat` lives on the device only.
4. **Ilm — ask someone (Phase 3).** Masjid contacts: name, role, topics, WhatsApp number (E.164), audience
   `brothers|sisters`, **consent confirmed** by the admin (required). Musallis see the contacts for their own
   Brother/Sister choice; one tap opens `https://wa.me/<number>` — the number is not printed on screen (it is still in
   the public link: consent text says so; audience is a display filter, not access control). ≤ 10 per masjid.
5. **Blood donation camp (Phase 3).** A masjid-pickable notice template `blood_donation_camp` with four params —
   date, time range, place, contact (new template param type `phone`, rendered as a WhatsApp button). Shown as an
   announcement (category `event`, `event_at`) and as a card on Home / Masjid Detail until the camp is over. **No donor
   list or blood groups in the app** (health data of musallis — CLAUDE.md §2.1).
6. **Needy people (Phase 5).** Masjid-verified people in need: display name (**first name or initials only**),
   category (`widow | orphan | disability | illness | elderly | homeless | debt | student | other`), short reason,
   **their own UPI ID + payee name** (set by the masjid — no change-lock, owner's choice; every change is in the audit
   log and visible to the Super Admin), **cap** and **received so far (updated by the masjid by hand; history
   append-only)**, optional **zakat-eligible** tag (the masjid's statement), **consent confirmed** (required;
   guardian's consent for orphans/minors). The person's phone and private notes are kept **encrypted, admin-only**
   (never public). Public list ordered **least-funded first** (received ÷ cap, then oldest), progress bar
   "₹1,200 of ₹3,000"; reaching the cap → `fulfilled` automatically and hidden. Pay = UPI deep link / QR straight to
   the person (we never touch money — CLAUDE.md §2.2). Personal data deleted 90 days after fulfilled/closed. ≤ 100
   active per masjid. **Risk accepted by the owner:** without a change-lock, a compromised admin account could swap a
   person's UPI ID; mitigations: audit trail, Super Admin view, the masjid's own review.
7. **Personal zakat tracker (Phase 5) — on the device only.** The musalli enters the zakat they owe (no calculation —
   nisab/rates are fiqh), logs each payment (amount, date, optional note or the needy person paid), sees what remains.
   Nothing goes to the server (no account, CLAUDE.md §2.1); lost with "Clear all data" or a new phone — the screen says
   so. Money in integer paise.
8. **Phase placement:** Phase 3 = F46 first (motion budget), then voice notes, adhkar, Ruqyah, ilm contacts, blood
   camp (T3.0, T3.13–T3.17). Phase 4 = push text for voice items. Phase 5 = needy people and the zakat tracker
   (T5.8–T5.9). Specs: 00 §4.9–4.15, 02 (enums, collections), 03 (endpoints), 05 (consent, retention), 07 (A18–A24,
   B14–B19), 01 §5.5 / 04 (audio pipeline).

### #105 — Real-screen motion budget: how F46 was closed (PHASE_03 T3.0) — ACCEPTED (Claude Code, 27 Oct 2026)
**Context:** `e2e/app/screens.perf.spec.ts` (08 §8 on real screens) was `fixme` since T2.14 (#103) with 50–75 ms taps,
6–13 % dropped frames and a forced layout on sheet open. CPU profiles (mapped through the hidden source maps) and
Chrome traces with the timeline-stack category attributed the rest:
**Decision:**
- **Navigation is applied as a React transition** (`startTransition` around the navigator's history-driven state
  update): the affected screens render in 5 ms slices instead of one sync task inside the tap / popstate. Motion is not
  delayed: a committed swipe already springs from the finger; a push's slide starts in the commit's layout effect.
- **Stable screen-slot props**: both apps passed a new `pendingFallback` element and `errorFallback` function on every
  render, defeating every `ScreenSlot` memo — each router update re-rendered every mounted screen. Hoisted to module
  constants.
- **Stable query results**: `useQueries` without `combine` returns a new array every render; `useHomeData` now uses
  module-level `combine` functions, so Home / My Masjids rows and prayer-time computations re-run only when a query
  result changes.
- **Motion promises resolve after the frame** (`animateChannel`): completion fires inside Motion's rAF batch and the
  callers' follow-ups (focus a title, close a dialog, unmount) read layout — they now run in a task after the frame.
- **Sheet** caches its panel height with the snaps (open, drag start) — no layout read after the drag's transform write.
- `pnpm test:perf` repeats every perf spec **3×** (`--repeat-each=3`), so one CI run is the "3 in a row" acceptance.
- Tried and not kept: `content-visibility: hidden` for hidden tabs (WebKit lost their scroll position).
**Consequences:** the local Windows dev PC is too noisy to judge 50 ms reliably (it varies ±20 ms between runs); CI on
Linux is the judge. Earlier T2.14 fixes (#103) stay.

### #106 — Content Library search (PHASE_03 T3.4) — ACCEPTED (Claude Code, 28 Oct 2026)
**Context:** 02 asks for a `search_text` that is "lowercase, NFKD, Arabic harakat/tatweel removed" over all
translations, transliterations, reference and tags, with a `default_language: "none"` text index, and T3.4 for
"normalized search incl. Arabic without harakat". Removing every combining mark (the usual NFKD recipe) would also
remove Devanagari and Telugu vowel signs — letters of the word, not diacritics.
**Decision:**
- `@mc/domain/search` `normalizeSearch`: NFKD → lower case → remove Latin combining diacritics (U+0300–036F), Arabic
  harakat/shadda/sukun/hamza-madda marks/superscript alef, Quranic annotation marks, tatweel, and invisible characters
  (ZWSP/ZWNJ/ZWJ, direction marks and controls, BOM, soft hyphen) → every non-letter/digit/mark run becomes one space.
  NFKD followed by mark removal also folds أ إ آ to ا. Indic vowel signs stay. Idempotent (property test).
- `librarySearchText` puts reference and tags first, then the English translation, Arabic, other translations and
  transliterations; above the 20 000-character validator limit it is cut at the last whole word, so the identifying
  fields always survive.
- Queries use the text index: `searchTerms` (normalized, unique, ≤ 8 words) are each quoted, so `$text` ANDs them
  (every word must appear). Whole words only — no prefix match: admins mostly tap topic/category chips, and a regex
  over 20 kB documents would scan the collection on every keystroke.
**Consequences:** "pati" does not find "patience"; a typed word must be complete. Revisit with real library data if
admins struggle (T3.12 usability check).

### #107 — Multipart uploads: `@fastify/busboy`, one file, read after auth (PHASE_03 T3.4) — ACCEPTED (Claude Code, 28 Oct 2026)
**Context:** 01 §4 and 04 §6 name `busboy` for uploads (library import now; images, audio in T3.6/T3.13). `busboy`'s last
release is 1.6.0 (19 Apr 2022) — "abandoned" under CLAUDE.md §6 (no release in 18 months). The global body gate
(`jsonBody`, before routing) answered every non-JSON body with 415, so no route could receive a file.
**Decision:**
- **`@fastify/busboy` 3.2.4** (the maintained fork, same streaming API and limits; the multipart parser inside undici,
  Node's `fetch`; no dependencies) in `@mc/api` only — server-side, no client bundle impact.
- `http/upload.ts` `readUpload`: exactly one part, a file in field `file`, no text fields, a per-route byte limit, held in
  memory only; violations → 400 `UPLOAD_INVALID` (new code, 4 locales) / 413 `PAYLOAD_TOO_LARGE` / 415.
- `defineRoute({ upload: { maxBytes } })` reads the file **after** authentication and rate limits (so nobody
  unauthenticated makes the server buffer a body); `upload` and `request.body` exclude each other. The global gate lets
  `multipart/form-data` through unparsed, and every route without `upload` answers it with 415 — the "no form posts"
  rule now holds per route.
- OpenAPI documents upload routes as `multipart/form-data` with a binary `file`.
**Consequences:** 01 §4 and 04 §6 now name `@fastify/busboy`. Content checks (magic bytes, JSON schema) stay with each
route — the claimed file name and type are never trusted.

### #108 — Content Library workflow: import, edit, verify, retire (PHASE_03 T3.4) — ACCEPTED (Claude Code, 28 Oct 2026)
**Context:** 07 C8 / 03 §5 give the steps (upload → dry-run report → import as `draft` → review → ★ Verify / Retire)
but not what an edit of a verified entry means, how large a file may be, or whether a partly bad file imports.
**Decision:**
- **File:** JSON `{format: "masjid-connect-library", version: 1, entries: [...]}`, ≤ 500 entries, ≤ 4 MB, uploaded as a
  file (DECISIONS #107). Field names follow 02 (snake_case); unknown keys are errors. JSON Schema:
  `scripts/library.schema.json` (generated from the Zod contract, byte-compared by a test).
- **Dry run first, as its own route:** `POST /library/import/dry-run` (no step-up) returns the report — every row
  error with row number + field path, duplicates (`kind + reference`) within the file and against the whole library
  (draft, verified and retired). ★`POST /library/import` (step-up) re-validates the same file and imports **all or
  nothing**: any error or duplicate → nothing is written and the report (status 200) says why, with `imported: 0`; otherwise every row is inserted as `draft` in one transaction with one `import_batch_id` and
  one `library.import` audit entry (`batch`, `entries`).
- **Edits (`PATCH /library/:id`):** draft and verified entries only; retired entries are read-only. Changing what an
  entry *says* (Arabic, translations, transliterations, reference, source, repeat, occasions) sends a verified entry
  back to `draft` and clears `verified_by/at` — published content must never show unverified words; tags and the dua
  category are metadata and keep the status. `kind` never changes (retire and re-import instead).
- **Verify:** draft → verified, `verified_by` (the scholar/reviewer, 2–120 chars) + `verified_at`, audited. Not a ★
  action: the step-up already guards the import, and verification is the Super Admin's careful per-entry review.
- **Retire:** draft or verified → retired (final). Items that used the entry keep their reference; the public view
  hides retired entries, so their library content disappears from bundles (02 `v_pub_library`).
- `search_text` is recomputed by the data layer on every content change (DECISIONS #106).
**Consequences:** a fix to a verified translation needs a fresh verification before musallis see the entry again (the
items that reference it show without the library body until then). Recorded in `docs/content-library-format.md`.

### #109 — Batched navigations: the navigator settles every screen a skipped step moved (PHASE_03 T3.0) — ACCEPTED (Claude Code, 28 Oct 2026)
**Context:** since #105 navigations are applied as React transitions. React may render several history changes as
one update (two quick back presses, a pop followed by a push), and the reduced `transition` then describes only the
last step. The navigator animated just that step: a screen popped by an earlier, skipped step stayed mounted at x = 0,
inert and on top — taps fell through to the tab layer (CI flake "rapid double push then double pop", 28 Oct 2026). A
component test reproduces it deterministically (`packages/ui/test/stack-navigator-batching.test.tsx`).
**Decision:** keep the transition (it removes the 50–100 ms tap task) and make the transition effect independent of
how many steps were batched: on a push or pop every screen in the tab's `leaving` list slides off with the same spring
and is unmounted (not only `transition.from`); stack screens below the new top are put at the covered position
directly; an outgoing screen that a skipped push mounted but never showed is covered without animating across.
Also: perf failures now list, for every layout forced inside an animation frame, the script calls of that frame
(and its JS stack with `MC_PERF_STACKS=1`), so a CI-only failure names its cause.
**Consequences:** a batched double pop looks like one pop that also slides the higher screen away. No change for
single navigations.

### #110 — T3.0 outcome: synchronous push/pop, transition for tab roots; the perf trace ignores the test driver (PHASE_03 T3.0) — ACCEPTED (Claude Code, 1 Nov 2026)
**Context:** with every navigation applied as a React transition (#105), CI failed two navigation e2e tests on every
run ("rapid double push then double pop", and #109's "two pops in one update" — a covered screen swallowing the tap,
or the top still moving), even after #109. An experiment commit with synchronous navigation (CI run 41290687905) made
the whole e2e suite green; its perf run showed (a) tab switches dropping 8.6 % of frames without the transition, (b)
the "layouts forced in animation frames" reported since T3.0 came from `raf@(inline)` — Playwright's injected
element-stability loop, which reads layout before every click — and (c) one real forced layout: the Masjid Detail hero
parallax read `scrollTop` / `offsetHeight` in its first animation frame after mount (3.6 ms).
**Decision:**
- Push and pop update the navigator synchronously; locations of a tab root (tab switch, pop to root) are applied as a
  transition. #109 stays (any batched update still settles every screen).
- The perf analyser does not count a forced layout in a frame that ran only URL-less scripts (the app's CSP allows no
  inline script, so those are the test driver's); the failure message still lists them, marked.
- Masjid Detail parallax: the hero height comes from a ResizeObserver, and the first paint runs in its callback (after
  layout); scroll paints stay rAF-batched.
**Consequences:** tapping fast through push/pop can never race a deferred stack update. Long tasks on push are
judged by CI's perf specs as before (#105's other fixes — stable screen props, `combine`, post-frame promises — stay).

### #111 — Notice templates: draft until reviewed, retired ones still render, starters by Super Admin action (PHASE_03 T3.5) — ACCEPTED (Claude Code, 1 Nov 2026)
**Context:** 02 had `template_status: active | retired` and `translation_reviewed`, and C9 says "translation reviewed"
is required before activation — but a new template had no state other than active, `v_pub_templates` hid retired
templates (published notices that used one would lose their text), and the starter set (00 §4.3) needed a home that
every environment gets, with its translations in the translators' review flow.
**Decision:**
- Status `draft` (migration 0010). Created templates are always `draft`; `active` requires `translation_reviewed`;
  `active → retired`, `retired → active`; never back to draft. Params change only while `draft` (published notices
  store values by param name). Changing the title or body of an active template must re-confirm the review in the same
  request. System templates (e.g. `timings_updated`) cannot be retired.
- `v_pub_templates` shows `active` **and** `retired` (old notices keep rendering); drafts are never public. The admin
  picker (policy cell) still shows active, non-system templates only.
- **Starters:** structure in `@mc/i18n/templates`, texts in `locales/*/templates.json` (reviewed through the review
  CSV like every string; `i18n:check` validates their ICU and placeholder parity). They reach the database through C9's
  **"Add starter templates"** (Super Admin, as `draft`, existing keys untouched, audited) — not through a migration: the
  migrator user has no data privileges on `notice_templates`, and a data migration's checksum would break when the
  translators edit the texts. The dev seed inserts them active for dev/staging.
- ICU is validated by the API in all four languages (`@mc/i18n/runtime-message` `messageArguments`): valid ICU, no
  arguments in titles, body arguments only from the params (a range param `x` provides `x_start` / `x_end`); C9 shows
  the same checks live and renders a preview with sample values.
- 16 starters: the 14 of 00 §4.3, `blood_donation_camp` (#104), and the system `timings_updated` (T3.2). Icons: a
  fixed set (`@mc/shared/contracts/template-icons`, glyphs in `@mc/ui` TemplateIcon; eight new Phosphor glyphs).
**Consequences:** on a new database (production) the Super Admin adds the starters and activates each one after the
translations are reviewed — a pilot prerequisite (owner). Template text reaches the apps only through the database.

### #112 — Visual baselines pin the API clock too (PHASE_03, CI) — ACCEPTED (Claude Code, 1 Nov 2026)
**Context:** the visual baselines (#103) are seeded as of `VISUAL_NOW` (21 Oct 2026) and the page clock is pinned, but
the API filtered special dates against its real clock ("from 7 days ago"); once the real date passed 28 Oct the Eid
card vanished from Home and the comparison failed — a test that rots with the calendar (CI, 1 Nov 2026).
**Decision:** the visual spec sets the API clock to `VISUAL_NOW` through the test hook (`PUT /api/v1/test/clock`) and
resets it afterwards; CI runs the step on the runtime-test stack (after the hooks step). Without the hook the spec
fails with a message naming the test stack.
**Consequences:** `pnpm test:visual` needs `pnpm stack:up:test`. Known residue: the baselines predate the Qibla
button's dev/staging gating (`SHOW_COMING_SOON`); the small compass difference is within the screenshot tolerance —
refresh the baselines at the next intended UI change.

### #113 — Admin preview = the musalli cards from `@mc/ui/content`, in their own locale scope (PHASE_03 T3.11) — ACCEPTED (Claude Code, 2 Nov 2026)
**Context:** T3.11 requires the preview to render the real musalli components, imported from a shared path, and to
be byte-identical to the musalli rendering. The cards were already in `@mc/ui`, but the item → card glue (titles,
template bodies, tags, dua privacy, janaza line, icons) lived in the musalli app. The preview also has to show a
language other than the admin's own UI language, at the musalli type scale.
**Decision:** (1) New path `@mc/ui/content`: `item-view`, `content-view`, `ItemIcon` and `useNoticeBody` moved there
from the app, plus `AnnouncementItemCard` / `DailyItemCard` / `DuaItemCard` (app concerns — navigation, Ameen, Saved,
Share — are props) and `FeedItemCard` (a fresh item as its section shows it: notice in A7, "Today's" hero in A8, dua
with no Ameen yet in A9; buttons are no-ops). The musalli rows are now thin wrappers around them. (2) `LocaleScope`
in `@mc/i18n/react`: a subtree with its own i18next instance per locale; `<html lang dir>` is untouched; the previous
language stays on screen until the next one has loaded. (3) CSS `.mc-preview` (generated into `type.css` / `fonts.css`,
plus `base.css`): musalli scale (no admin +2px) and the preview language's font stack. (4) `@mc/ui/admin`:
`PreviewFrame` (endonym switcher, phone frame, `lang`/`dir` on the screen, 200 ms crossfade on language change),
`PublishBar`, `StepHeader`, `PublishSuccess`. Components take every label as a prop (admin i18n keys come with the
flows in T3.6–T3.8). (5) "Byte-identical" is checked as the DOM HTML of the real musalli row against the preview's
screen, 5 items × 4 locales, with the admin UI in a different language
(`apps/app/src/features/content/__tests__/preview-parity.test.tsx`). React `useId` values necessarily differ
between two trees, so ids are renamed in order of appearance before comparing; nothing else is normalized.
**Consequences:** any change to a musalli section card changes the preview with it (intended). Musalli initial JS
185.68 kB (limit 186 kB; +0.4 kB over the last recorded figure). The preview's buttons are real but do nothing.
Follow-up F49: `DuaBox`'s translation has no `dir="auto"`, so an English fallback in Urdu puts its full stop at the
start (already true in A9; fixing it changes the Urdu visual baselines).

### #114 — A sheet opens across three tasks (PHASE_03 T3.0) — ACCEPTED (Claude Code, 2 Nov 2026)
**Context:** the third CI run for T3.0 (41458742300) failed "sheet: open" (My Masjids → Add Masjid): one long task of
51.6 / 61.5 ms; locally 62–82 ms in 5 of 5 runs. The trace put it all in the tap's task: React's commit, then the
Sheet's open layout effect — `showModal()` (a forced style recalculation of the whole page, 661 elements, 17–22 ms:
the rest of the page turns inert and focusability is checked), the focus move (blur/focus events), measuring the
snaps and starting the spring.
**Decision:** `Sheet` places the panel off-screen in the layout effect (writes only), calls `showModal()` + focuses the
title in the next task, and measures + starts the spring in the task after that (`setTimeout(…, 0)`, the same device
the motion driver uses to keep layout reads out of frames). Not `requestAnimationFrame`: the measurement would be a
layout forced inside an animation frame (08 §8). Reopening during a close still springs back at once.
**Consequences:** locally 5 of 5 runs green (from 0 of 5). The dialog exists for one extra task after the commit —
unit tests wait for it (`findByRole`), as a browser user would. The spring starts one frame later at most; the
press feedback is unchanged (same frame). `Dialog` (alert dialogs) keeps its synchronous open — no perf case yet.

### #115 — The publish transaction writes the outbox and the quota count as the admin (PHASE_03 T3.2) — ACCEPTED (Claude Code, 2 Nov 2026)
**Context:** 02 §4.1's matrix gave masjid admins only S on `notification_jobs` and `push_quota_usage`, but DECISIONS
#9, 01 §5.3 and 02 §2 (`push_quota_usage`: "incremented … inside the publish transaction") have the API write the
pending outbox job and count the notification in the same transaction as the item — which runs in the admin's scope.
`mc_admin` already holds find/insert/update on both (02 §4.3); only the policy layer lacked the cells.
**Decision:** narrow admin cells — `notification_jobs`: I, own masjid, checked: `status: pending`, `sent: 0`,
`failed: 0`, `bypass_quota: false` (no updates); `push_quota_usage`: I/U, own masjid, only `count` writable. The
shared publish helpers (`@mc/db/state` `insertPublishedItem`, `enqueueNotification`) are the only callers; the quota is
counted with a conditional update and a race ends in `NOTIFY_QUOTA_EXCEEDED`, rolling the whole publish back.
**Consequences:** matrix table and tests updated (admin `SI` / `SIU`); a test proves an admin cannot add a running,
already-sent, quota-bypassing or other-masjid job, nor change a job or a quota day. Enqueueing to BullMQ after commit
and the outbox sweeper stay Phase 4 (pending jobs simply wait).

### #116 — Budgets are soft: T3.0 accepted with a recorded tolerance (PHASE_03 T3.0) — ACCEPTED (owner, 3 Nov 2026)
**Context:** after #105, #109, #110 and #114 the real-screen perf spec (`e2e/app/screens.perf.spec.ts`) was borderline
in CI: green on `1b12d73`, `1165371`, `cb1649a` and `b72a5c5`, red on `74b1749` (sheet open 51.6 / 61.5 ms, fixed by
#114) and `58e9391` (push/pop long tasks 52–63 ms, ≈ 50 ms of React work; tab switches 7 % dropped frames) against
08 §8's 50 ms / 5 %. The owner had said the same about size budgets on 24 Oct 2026 (O24).
**Decision (owner, 3 Nov 2026):** "I accept the T3.0 with a small tolerance. It's okay if it is lagging by some ms. We
don't want to compromise on quality … a few KBs or a few ms are manageable and acceptable." The real-screen spec fails
only beyond **65 ms** long tasks / **8 %** dropped frames (constant `TOLERANCE` in the spec, with this entry's number).
Forced layouts inside animation frames stay a hard failure; the navigator (T0.9) and Updates-fling (T2.10) specs keep
the strict 08 §8 numbers. Bundle budgets work the same way: a raise of a few kB is recorded in `.size-limit.js` and
here, not optimised away at the cost of quality.
**Consequences:** T3.0 is done. A measurement between the strict number and the tolerance is not a task; one beyond
it is. The real low-end check stays the owner's (O16, "looks good" 27 Oct 2026).

### #117 — Special dates & Ramadan: rules, API shape, notify, and stale-while-loading bundles (PHASE_03 T3.3) — ACCEPTED (Claude Code, 3 Nov 2026)
**Context:** 00 §4.2 and 07 B11 give the fields; 03 §4 lists `GET/POST/PATCH/DELETE /special` and `PUT /ramadan`
without the read of Ramadan settings, the PATCH semantics, the length limits of Ramadan mode or what "Save (+ notify)"
publishes. The acceptance journey also found that every version bump blanked the musalli screens for a moment.
**Decision:**
- Rules in `@mc/domain/special` (screen live checks = data layer): 1–5 times per day, no time twice; the date within
  ±400 days of today (IST); Ramadan mode start ≤ end, at most **30 days** (start and end included), both within the
  same window, start/end set together (both `null` = off; the precautions stay). Codes `SPECIAL_DATE_INVALID`,
  `SPECIAL_DATE_NOT_FOUND`, `RAMADAN_INVALID`.
- `PATCH /special/:id` takes the **whole entry** (the B11 form always has it): a label or note left out is removed.
  Delete is soft (`deleted_at`; the public view hides it). The admin list starts 30 days back (recent days stay
  editable, under "Past"). Added `GET /ramadan` (`{start, end, sehriPrecaution, iftarPrecaution}`, the `PUT` body's
  shape) — the screen needs the saved state; 03 §4 updated.
- "Notify followers" on a special date publishes a `timing_update` item with the new **system** template
  `special_timings` (param `date`, 17th starter, texts in 4 locales for review) and its pending outbox job — the
  shared `publishTimingUpdate` (also used by `saveTimings`). It starts **on** for today or tomorrow, off otherwise —
  00 §4.2's rule for timing changes. Saving Ramadan mode never notifies (not asked for; the Ramadan card appears by
  itself).
- The musalli special-date card moved to `@mc/ui/content` (`SpecialDateCard`) so B11's preview is the real card (#113).
- **Bug fixed (musalli):** `useQueries` gives a changed key (`['bundle', id, v]`) a new observer, so after every
  version bump the screens saw "loading" until the new bundle arrived — Home's card blanked and the A6 tab jumped back
  to Daily. The placeholder is now the newest cached older bundle of the same masjid (`previousBundle`), and pruning
  keeps an old bundle until the new version has loaded (Home prunes again once it has).
**Consequences:** db 13 / api 4 integration tests, domain 8, admin 9, app +2 unit tests; e2e B11 journey (musalli
sees the entry and the Eid card after one poll, delete, Ramadan card) and B11 × 4 locales screenshots + axe. A
special date's label/note in the musalli card has no `dir="auto"` yet — part of F49 (next baseline refresh).

### #118 — A simple Qibla page (PHASE_07) — ACCEPTED (owner, 3 Nov 2026)
**Context:** Phase 07 planned a full compass module: a bundled list of ~500 cities in 4 scripts, magnetic declination,
accuracy and calibration detection, Wake Lock, and a map fallback with a tile-provider decision.
**Decision (owner, 3 Nov 2026):** "We don't want to work that much on the Qibla module … just a simple Qibla direction
page. Just make sure the design is good. For functionality … simple logic would be fine." Kept: the bearing and
distance math (tested), the arrow turning with the phone's heading where there is a compass, the ±3° aligned state, the
4-locale design, location on the device only. Location falls back to the first followed masjid's coordinates (no city
list). No compass → North-up dial with the bearing in degrees. Dropped: map mode and tiles (the owner prerequisite
goes), the city dataset, declination, accuracy/calibration, Wake Lock.
**Consequences:** `PHASE_07_QIBLA.md`, 00 §4.5, 07 A14 and 08 §5.9 updated; Phase 07 needs nothing from the owner but
the final mihrab comparison on two phones.

### #119 — Image pipeline: sharp, explicit media store, Caddy media site (PHASE_03 T3.6, part 1) — ACCEPTED (Claude Code, 3 Nov 2026)
**Context:** 01 §5.5 / #40 describe the pipeline; no code existed. sharp's prebuilt libvips decodes AVIF but has no
HEVC, so HEIC cannot be decoded. The owner's local api-admin env holds real Cloudinary keys.
**Decision:**
- **sharp 0.35.5** (`@mc/api` + `@mc/server` dependency, external in the bundle, prebuilt binaries — no build
  script). Accepted by magic bytes: JPEG, PNG, WebP, AVIF; **HEIC refused** with `IMAGE_INVALID` (iPhone Safari uploads
  JPEG from an `image/*` picker). Pixel count read from the header first (> 40 MP refused before decoding), decoder
  format must equal the magic bytes, then one JPEG master ≤ 1440 px, EXIF orientation applied, **no metadata**, plus
  a ThumbHash. Test-only `exif-reader` 2.0.3 proves EXIF/GPS are gone.
- `POST /masjids/:id/images?purpose=…&rightsConfirmed=true` (multipart `file`, ≤ 10 MB, 30/h per masjid + the session's
  write budget) → `{imageKey, thumbhash, width, height, urls}`; key `m/<masjid>/<uuid>`; audit `image.upload` with
  `rights_confirmed` (target id = the image id; `audit_log.target_id` ≤ 64).
- **`MEDIA_STORE`** = `cloudinary` (required outside local) | `files` (local default, `MEDIA_DIR`): local work never
  uploads to the real account even with keys present. Cloudinary: signed REST upload/destroy (SHA-256), no SDK.
- **Caddy media site** `https://{$MEDIA_HOST}` (+ local-only `http://localhost:8790` from `infra/caddy/local/`): only
  `/i/<480|960|1440>/<avif|webp>/m/<uuid>/<uuid>`, immutable, `nosniff`, CORP cross-origin; `MEDIA_BACKEND`
  `cloudinary` (rewrite to named transformation `t_mc_<w>_<fmt>`) or `files` (shared tmpfs volume in the stack).
  `make-env.sh` writes `MEDIA_HOST`, `MEDIA_BACKEND`, `CLOUDINARY_CLOUD_NAME` into web.env (owner O25).
**Consequences:** Cloudinary named transformations must be called `mc_480_avif` … `mc_1440_webp` (O25 steps). Staging
uploads fail until O25 (placeholder keys).

### #120 — Publishing a notice: one body for both paths, params checked against the template (PHASE_03 T3.6, part 2) — ACCEPTED (Claude Code, 4 Nov 2026)
**Context:** 03 §4 names `POST /items/announcement` but not its body; 00 §4.3 gives the free-text limits (title ≤ 80,
body ≤ 1,000 — the validator's 120 / 1,500 stay as the outer bound) and template params "with pickers"; 02 says the
params are "validated against the template's param schema" without saying where.
**Decision:**
- Body `content` is a discriminated union — `{kind: 'template', key, params}` or `{kind: 'text', title, body, locale}`
  — plus `category`, `isImportant` (preset from the template on the screen, editable), `eventAt` (category `event` only;
  a day ago … 400 days ahead), `image {key, thumbhash, rightsConfirmed: true}`, `notify`. The audience of a notice is
  always `everyone` (only videos choose brothers/sisters — 00 §1). Admin notices are type `announcement` even with a
  `timing` template; `timing_update` stays for the system templates.
- Param values: the contract checks the shape (safe text ≤ 80, whole number 0–10⁶, or `{start, end}`); the data layer
  reads the template **inside the transaction through the admin policy cell** (active, not system — so drafts, retired
  and system templates are `TEMPLATE_NOT_FOUND`) and runs `templateValueProblems` (`@mc/i18n/template-args`, also used
  by B5): required present, each value of its declared type (time range ends differ — may cross midnight; date range
  end ≥ start), no undeclared names. Refusals → new code `ANNOUNCEMENT_INVALID` (400, 4 locales).
- The photo key must be `m/<this masjid>/…` (the `IMAGE_KEY` pattern moved to `@mc/shared/contracts`); the item stores
  `image_key`, `image_thumbhash` and `rights_confirmed`. The ThumbHash comes back from the client (it is a placeholder,
  not a security property).
- `targeted` is counted **after** the commit through `v_admin_follow_audience` (follows not muted, push active, in the
  audience) — views are not read inside the transaction; it is an estimate for the success screen. `quotaLeft` comes
  from the transaction's own count (`enqueueNotification` now returns `{jobId, used}`).
- Audit `item.publish` with `{type, template, notify, image}`. Admin template list: `GET /masjids/:id/templates`
  (public `NoticeTemplate` shape, shared mapper `noticeTemplateOf`).
**Consequences:** db 10 / api 6 integration tests, i18n +4 unit tests. The same body grows `voice` in T3.13.

### #121 — B5 notice creator: three pushed screens, one draft, pickers per param type (PHASE_03 T3.6, part 3) — ACCEPTED (Claude Code, 4 Nov 2026)
**Context:** 07 B5 asks for a 3-step flow (Choose → Fill → Preview & Publish) with pickers instead of typing; 08 §5.12
says steps slide horizontally. 06 §6 lists `NumberPad` (an amount pad in paise) and `UploadProgress`.
**Decision:**
- The steps are **three routes** (`/notice`, `/notice/fill`, `/notice/preview`) pushed on the admin stack — the
  navigator's slide is the step motion and the phone's back button goes back one step. The draft lives in a small
  in-memory store (`features/notice/lib/draft-store.ts`, `useSyncExternalStore`); a reload loses it and Fill / Preview
  then offer "Choose a notice" again. Done after publishing pops to Home and clears it.
- Pickers by param type: time → `TimeSheet`; date → `DatePickerSheet` (today … 399 days); ranges → two slots ("From" /
  "To"); prayer → a 2-column grid of 56 px radio buttons (five prayers + Jumu'ah); short text and phone → text fields
  (a 10-digit Indian mobile number gets +91; E.164 checked like the server); number → a numeric text field (no starter
  uses `number`; `NumberPad` is the rupee pad). Param labels: by name for the starter params, else by type.
- The checks are the server's (`templateValueProblems`); "Next: Preview" stays pressable and, with something missing,
  lists it in plain words and scrolls the list into view (found while looking at the screenshots: it was off screen).
- Category (4 radio cards) and Important are preset by the template; an event gets an optional date + time (both or
  neither). Photo: the ownership tick comes first — the picker is disabled until it is ticked; JPEG / PNG / WebP / AVIF
  (`accept` makes an iPhone convert HEIC); a spinner while uploading.
- Preview: `PreviewFrame` + the musalli `FeedItemCard` (the A7 card shows no photo — a note says followers see it in
  the notice). Notify starts on while notifications are left; quota refusal → "Publish without notifying".
**Consequences:** journey 7 (`e2e/admin/notice.spec.ts`) and B5 × 4 locales + axe (`e2e/admin/screens.spec.ts`);
admin unit +18. New glyph `PencilIcon` ("Write your own"). Not built yet (F50): the `UploadProgress` ring (fetch reports
no upload progress), the Home tile's mint pulse after a publish (08 §5.12), the success screen's "View" (needs My Posts,
T3.9).

### #122 — Today's hadith / ayah: a library id and a note, a soft "already today" warning, B6 on the B5 pattern (PHASE_03 T3.7) — ACCEPTED (Claude Code, 4 Nov 2026)
**Context:** 00 §4.3 allows daily content only from the verified Content Library (no free-form text) with an optional
note ≤ 200; PHASE_03 T3.7 asks for one daily_content of each kind per masjid per day as a *soft* warning, not a refusal;
07 B6 lists toggle → suggestion → "Choose another" (keyword / topic chips) → note → preview → publish.
**Decision:**
- `POST /masjids/:id/items/daily-content` takes `{libraryId, note?, notify}` only (strict body — a `kind`, `title` or
  text is a 400). The kind is the entry's own; the entry is read through the admin policy cell inside the transaction,
  so draft / retired entries, duas, dhikr and unknown ids are all `404 LIBRARY_ENTRY_NOT_FOUND`. Same publish path as
  notices (`insertPublishedItem`, `enqueueNotification`, audit `item.publish` with `type: 'daily_content'`), same
  `{item, notification}` answer.
- The server never refuses a second one of a kind on a day. `GET /library/suggestion` now also answers
  `publishedToday` (published, not deleted, since 00:00 IST — `dailyPublishedToday`); B6 shows a sun-toned warning on
  step 1 and again on the preview, and publishing goes on.
- B6 is three pushed routes (`/daily`, `/daily/note`, `/daily/preview`) with an in-memory draft, as B5 (#121). The
  draft store became `createDraftStore()` (`features/publish/draft-store.ts`), and the last step — notify switch, quota
  line, quota dialog, success moment — became `PublishStep` / `PublishedMoment` (`features/publish`) used by B5 and B6
  and next by B7. Their strings stay under `notice.*` (generic wording) instead of being copied per flow.
- "Choose another" is a full-height sheet: search words (the library's whole-word search, #106) and topic chips — the
  eight most used tags of the kind, from the unfiltered first page. Tags are shown as the library writes them
  (`after-fajr` → "after fajr"): they are the owner's data like references (`docs/content-library-format.md` calls them
  the admins' chip words), not UI copy. Every entry shows the Arabic, the translation in the admin's language (English
  with a tag when missing) and the reference.
- Preview: `PreviewFrame` + the musalli `FeedItemCard` → the Hadith & Quran "Today's" hero card.
**Consequences:** db `daily.int.test.ts` 7, api int +1 (library routes), admin unit +13 (daily, publish); B6 journey
(`e2e/admin/daily.spec.ts`: an Urdu musalli sees the hero after one poll; a second hadith warns and publishes) and B6 ×
4 locales + axe. Test note: while a sheet closes the whole stack is `inert` for its exit animation — Playwright's `fill`
then types into nothing, so specs tap a field before filling it. Tag labels per language would need a library-format
change (F51, only if the owner wants it).

### #123 — Dua requests: template-assisted text in a chosen language, a verified dua, janaza for inteqal only (PHASE_03 T3.8) — ACCEPTED (Claude Code, 4 Nov 2026)
**Context:** 00 §4.3 says the message is "template-assisted, ≤ 500 chars", the title comes from the category and the
name is optional with "Keep name private" on by default; PHASE_03 T3.8 asks for message templates per category in four
languages (draft-flagged) and an integration test that a private name never reaches musallis.
**Decision:**
- Ready-made messages are plain community requests (never a dua, ayah or hadith — CLAUDE.md §2.3), three per category,
  in `packages/i18n/locales/<locale>/dua-messages.json` (`@mc/i18n/dua-messages`), reviewed with every other string
  (review CSVs = the draft flag). B7 fills the message box with one in the language the admin picks; editing makes it
  the admin's own text. The item stores `body` + `content_locale` — what the musalli card already shows — so no
  `template_key` (that field references `notice_templates`).
- `POST /masjids/:id/items/dua` `{category, message (1–500), locale, personName? (≤ 80), namePrivate, libraryId,
  janazaAt?, janazaPlace? (≤ 120), notify}` → 201 `{item, notification}`. The library entry must be a verified `dua`
  (else `404 LIBRARY_ENTRY_NOT_FOUND`); the UI filters by category, the server does not insist on it. A janaza goes with
  inteqal only (contract 400) and within a day ago … 30 days ahead (`400 DUA_INVALID`). Audit meta never holds the name.
- A private name is stored for the masjid's own record and removed by `v_pub_items` (02 §4.2). Proved at both layers:
  db `duas.int.test.ts` (view as `mc_public`, item, feed) and api `library-routes.int.test.ts` (api-public's item and
  feed responses as the real `mc_public` user never contain it).
- B7: four pushed steps — category (3 big cards; a tap goes on) → details (language, ready-made
  messages as radio cards + the editable text, name + "Keep name private" + consent hint, inteqal janaza date/time/place)
  → attach dua (verified duas of the category; a tap picks and goes on) → preview (`FeedItemCard`) + `PublishStep`.
  That keeps "illness request with private name" at 5 taps (T3.12). Logic in `features/dua/lib/dua.ts`.
- `dua-messages.json` is excluded from the build-time ICU precompile (`mcIcuPrecompile`): it is read as plain text, not
  through i18next — found in the journey, where the message box showed the compiled AST.
- Found and fixed on the way: `DatePickerSheet` calls `onChange` and then `onClose`, so a date sheet that opens the time
  sheet next (B5 event, B7 janaza) closed it again at once; `onClose` now clears only its own picker.
**Consequences:** db +7, api int +1, i18n +3, admin unit +7; B7 journey (`e2e/admin/dua.spec.ts`: a Hindi musalli
never sees the private name; an inteqal with janaza in slate) and B7 × 4 locales + axe. The library search hook moved
to `features/library` with an optional dua category (B6 and B7 share it).

### #124 — My Posts: edits reopen the creation flow, checked as at publish; soft delete with the purge marker (PHASE_03 T3.9) — ACCEPTED (Claude Code, 4 Nov 2026)
**Context:** 00 §4.3 allows edits for 24 h after publishing, without a new notification, shown as "edited"; 03 §4 lists
`GET /items`, `PATCH /items/:id` (If-Match `updated_at`) and `DELETE /items/:id`; 02 §5 asks for a purge marker
(`purge_after = now + 180 days`) when an item becomes deleted, which the policy gateway refuses to every generic write.
**Decision:**
- **One set of rules for publish and edit.** Each type's checks became a content builder (`announcementContent`,
  `dailyContent`, `duaContent` → `ItemContent` → `contentDocument`); publishing and `editItem` both use them, so an edit
  can never store what a publish would refuse. The PATCH body is the type's publish body without `notify`, tagged with
  its `type` (`itemEditSchema`; the shared field sets keep them equal). An edit `$set`s the new content, `$unset`s the
  optional fields it no longer has (e.g. own text → template), sets `edited_at` and never notifies.
- **Concurrency:** If-Match is the item's `updated_at` (ISO, quotes optional); a mismatch — checked again in the update
  filter — is `412 PRECONDITION_FAILED`, and the app sends the admin back to My Posts with a plain dialog. Past 24 h:
  `409 EDIT_WINDOW_CLOSED`; another type or a timing update: `409 ITEM_NOT_EDITABLE`; deleted or removed posts:
  `404 ITEM_NOT_FOUND` (removed ones are fenced by the admin update cell anyway).
- **Delete** is allowed at any age: status `deleted`, `deleted_at`, then the purge marker as a data-layer effect
  (`markItemForPurge` in `effects.ts`, like the version bump — raw collection, own masjid, in the transaction), version
  bump, audit `item.delete`. Deleting again is a no-op (no second bump or audit entry). Removed posts cannot be deleted
  (moderation evidence).
- **List:** every status, newest first, 30 a page; each row carries the item exactly as musallis receive it (the public
  `itemOf`, so "View" is the musalli card) plus `updatedAt`, `editableUntil`, `libraryId`, the private dua name (the
  masjid's own record — still never in `v_pub_items`) and a removed post's reason. These response schemas are Zod Mini
  (`contracts/admin-items.ts`): a classic object cannot embed the Mini `feedItemSchema` for the OpenAPI generator.
- **B12 UI:** type chips; cards with status, "You can change it until …", View (sheet), Edit, Delete (confirm). Edit puts
  the post back into its flow's draft (`editing: {itemId, updatedAt}`) and opens step 2; the last step then shows "Save
  changes" (`SaveStep`) and "Saved". An edited notice's photo keeps its key and shows its ThumbHash (the admin app has
  no media origin). The publish moment's "View in My Posts" (F50) and "Done" after saving open My Posts on top of Home.
**Consequences:** db `items.int.test.ts` 8, api int +4, admin unit +7; e2e `e2e/admin/posts.spec.ts` (publish → View
in My Posts → edit → the musalli sees "Edited" → delete → gone after one poll) and B12 × 4 locales + axe. The musalli
hadith reader and dua detail now show "Edited" too (notices already did).

### #125 — Masjid Profile: photo and Hijri adjustment through the allow-list; name changes as a note for the Super Admin (PHASE_03 T3.10) — ACCEPTED (Claude Code, 4 Nov 2026)
**Context:** 07 B13 lets the admin change the photo and the Hijri adjustment and view the names (changes "go to Super
Admin"); PHASE_03 T3.10 asks for a "Request change" that creates an audit note and a dashboard item, and an
integration test that the policy layer's field allow-list refuses everything else, including `$set`-style and dotted
keys. 03 §4 lists `GET /` · `PATCH /` (allowed fields only) · `POST /photo`.
**Decision:**
- `PATCH /masjids/:id` takes `{hijriOffset: -2…+2 | null}` only (strict body; `null` unsets the field so the app's global
  offset applies). `POST /masjids/:id/photo?rightsConfirmed=true` runs the same image pipeline as `/images` (one shared
  helper), records the upload (`image.upload`, purpose `masjid`) and sets `photo_key` / `photo_thumbhash`. Both go
  through `updateMasjidProfile` → the admin `masjids` cell (`ADMIN_MASJID_FIELDS`), with the version bump (public fields)
  and audit `masjid.profile {fields}`; another masjid's photo key or an out-of-range offset is `400 PROFILE_INVALID`.
  Both answer the whole profile (with the photo's delivery URL).
- **Request change:** `POST /masjids/:id/change-requests {note ≤ 300}` writes audit `masjid.change_request {note}` —
  no new collection. `GET /super/dashboard` gains `changeRequests`: the last 90 days' notes, closed automatically once
  the Super Admin edits that masjid afterwards (`masjid.update` audit entry later than the note). The dashboard row
  opens the masjid. (`listChangeRequests` is Super Admin only.)
- **Acceptance:** db `profile.int.test.ts` writes 13 crafted updates straight at the admin cell (other fields, dotted
  paths, `$`-positional paths, operator-shaped values and keys, `$unset`/`$inc`/`$rename`/`$currentDate`, a replacement
  document) — all refused, the document unchanged; api `admin-masjid.int.test.ts` sends 11 crafted PATCH bodies — all
  400, name / status / name_i18n unchanged.
- B13 screen: photo (ownership tick first, as notice photos), names in four scripts and the place (view) + "Request a
  change" sheet, Hijri −2…+2 as a segmented control with today's Hijri date for the chosen value and "Follow the app's
  date", My account row. Payment, Chanda, the admins list and the undertaking view come with their phases.
**Consequences:** db +5, api int +4, admin unit +3; e2e `e2e/admin/profile.spec.ts`; B13 × 4 locales + axe. The replaced
photo's file is not deleted yet (F52).

### #126 — Voice-note length and waveform: measured by the admin's browser, bounded by the server, the storage decides when it can (PHASE_03 T3.13, part 1) — ACCEPTED (Claude Code, 4 Nov 2026)
**Context:** 01 §5.5 says the upload response's `duration` (Cloudinary) must be ≤ 600 s and a 48-value peak envelope
is computed. Checked on 4 Nov 2026: Cloudinary's current upload / audio / upload-parameters docs show no video or audio
upload response at all — `duration` there is only a transformation parameter — so the field cannot be relied on as
documented. Locally (file store) there is no Cloudinary, and a MediaRecorder WebM carries no duration in its header.
Decoding audio on the server would need ffmpeg in the API image.
**Decision:**
- The admin's browser decodes the recording anyway (Web Audio) for its own preview; it sends the length and the 48
  peaks with the upload (`POST /masjids/:id/audio?rightsConfirmed=true&durationS=&peaks=`). The contract bounds them
  (0.5…600.5 s, exactly 48 integers 0…255).
- The server identifies the container by magic bytes (Ogg, WebM, MP4/M4A/3GP, MP3, WAV, ADTS AAC — `sniffAudio`;
  anything else `422 AUDIO_INVALID`), stores it (Cloudinary `video` resource, key `m/<masjid>/a/<uuid>`; locally at its
  delivery path), and keeps **the storage's own duration when the response has one**, else the browser's
  (`keptDuration`, whole seconds). Over ten minutes → the stored file is deleted and `422 AUDIO_TOO_LONG`.
- The length limit protects cost and abuse, not correctness: a client lying about the length only matters where the
  storage cannot measure it (local); on staging the real response is checked once O25 is done, and if Cloudinary's
  response turns out to carry no `duration`, a follow-up reads it through the Admin API before accepting (F53).
- Peaks are decorative (07 A18) and stored as sent after validation. Audit `audio.upload {duration_s, rights_confirmed}`.
**Consequences:** api unit `audio.test.ts` 6, api int +2. Part 2 adds `voice` to the three item types; part 3 the
recorder (B14), the player (A18), the worker cache, the Caddy `/a/m4a/<key>` route and CSP `media-src`.

### #127 — Voice notes on posts: always titled, the masjid's own recordings, the key not a URL (PHASE_03 T3.13, part 2) — ACCEPTED (Claude Code, 4 Nov 2026)
**Context:** 02 items: `voice {key ≤ 200, duration_s 1..600, peaks? ≤ 48}` on announcement / daily_content /
dua_request, and "when present `title` is required"; 03 §3 says items carry `voice {url, durationS, peaks?}`.
**Decision:**
- Migration **0011_item_voice** adds `voice` to the items validator (`AUDIO_KEY` pattern) and an `allOf` rule: a
  document with `voice` must have `title` and be one of the three types (the Zod mirror checks the same). `voice` is in
  `ITEM_WRITABLE` and in the optional content fields an edit unsets; `v_pub_items` passes it through unchanged.
- Bodies: every publish / edit body takes `voice?: {key, durationS, peaks[48]}`. The title is the free-text notice's
  own; template notices, hadith / ayah and dua requests send a top-level `title` (≤ 120) — **only with a voice note**
  (alone it is refused, so those posts still carry no free text of their own — 00 §4.3). The content builders check
  the recording is the masjid's own (`m/<masjid>/a/…`) and a title exists: `400 VOICE_INVALID`.
- Public items carry `voice {key, durationS, peaks?}` — the key, like photos (`image {key, thumbhash}`): the app builds
  `<media origin>/a/m4a/<key>` itself, so responses stay origin-independent (03 §3's "url" is read as the key).
**Consequences:** db `voice.int.test.ts` 5 (incl. the validator refusing a title-less or wrong-type voice note), api
int +1. Part 3 builds the recorder, the player and the delivery route.

### #128 — Voice notes in the apps: recorder, player, delivery and offline (PHASE_03 T3.13, part 3) — ACCEPTED (Claude Code, 5 Nov 2026)
**Context:** 07 B14 / A18, 01 §5.5 Audio ("Caddy `/a/m4a/<key>`", CSP `media-src`, worker CacheFirst with range requests,
max 30 / 30 days), 04 §7's Permissions-Policy (`microphone=()` everywhere).
**Decision:**
- **Microphone:** the admin SPA alone sends `microphone=(self)` (Caddy override in the admin site's static handler,
  04 §7 note, header spec); the musalli app keeps `microphone=()`.
- **Delivery:** the media site gains `/a/m4a/m/<masjid>/a/<id>` (path allow-list; files backend → `/srv/media/a/m4a/…`,
  Cloudinary → `video/upload/t_audio_m4a/…m4a`, owner step O25), `immutable`, with `Access-Control-Allow-Origin: *`
  (Cloudinary's own CORS headers stripped) so the app's worker can read it; CSP `media-src` gains `{$MEDIA_ORIGIN}` on
  both apps. Range requests pass through.
- **Offline (musalli worker):** `<audio crossorigin preload="none">` — nothing loads before the first play. The worker
  answers `/a/m4a/` from `mc-audio-v1`; on a miss it fetches the whole file (≤ 10 min of AAC ≈ 4 MB), keeps it
  (`CacheExpiration` 30 entries / 30 days) and answers the requested byte range with `createPartialResponse`
  (`workbox-range-requests` 7.4.1 — new dependency of `apps/app`, service-worker bundle only; the app's initial JS is
  unchanged: 185.8 kB of 186). Played notes reveal followed masjids, so "Clear all data" empties that cache too.
- **Player (A18)** `VoiceNote` in `@mc/ui`: play / pause 56 px, decorative waveform from the peaks (filled to the
  position), a native range slider for scrubbing (`aria-valuetext` "1:20 of 3:20"), elapsed / remaining, speed 1× →
  1.5× → 2×, one plays at a time (module-level), pause on unmount, "Available when online" on a load error. Shown on
  the notice, hadith and dua detail screens with the title above. The section cards (whole-card buttons) do not embed a
  player — a nested button is invalid (F54 tracks a card badge and the A8 hero).
- **Recorder (B14)** `VoiceField` in the notice Fill, hadith Note and dua Details steps: the ownership tick first;
  record (MediaRecorder, the first supported of MP4 / Ogg-Opus / WebM-Opus / WebM; live level meter; timer with
  auto-stop at 10:00; pause / resume; stop), play back, "Use this" or "Record again"; or "Choose audio file". The file
  is decoded with Web Audio → length + 48 peaks (#126) and uploaded; the title field appears where the post has none
  of its own (template notice, hadith, dua), and "Next" names a missing one.
**Consequences:** admin unit +8 (peaks, format choice, bodies through the server contracts, the recorder with fake
MediaRecorder / Web Audio), e2e `e2e/admin/voice.spec.ts` (a WAV attached by file → the musalli plays it), the header
spec checks the admin's microphone policy; the B5/B6/B7 screens with the voice field stay axe clean in 4 locales.

### #129 — Adhkar after salah: the set, the window, the card and the counter (PHASE_03 T3.14) — ACCEPTED (Claude Code, 5 Nov 2026)
**Context:** 00 §4.11, 07 B16 / A20, DECISIONS #104 §3, 02 masjids.`adhkar`, 03 §3 bundle additions.
**Decision:**
- **Data:** `masjids.adhkar {enabled, library_ids[] ≤ 30, unique}` (migration `0012_masjid_adhkar`, also in
  `v_pub_masjids`); written only through the admin `masjids` cell (`adhkar` added to `ADMIN_MASJID_FIELDS`) by
  `setAdhkar`, which replaces the whole set, checks every id through the admin `content_library` cell (verified
  `dhikr` only → else `404 LIBRARY_ENTRY_NOT_FOUND`; over 30 / a repeat → `400 ADHKAR_INVALID`), bumps the version and
  audits `adhkar.update {enabled, count}`. Last write wins (no `If-Match`): the set is small and replaced whole.
- **API:** `GET` / `PUT /masjids/:id/adhkar` (answer = `{enabled, entries}` in order). The bundle gains
  `adhkar: {entries} | null` — `null` when off or empty; an entry retired since is left out (both reads).
- **Window (`@mc/domain/prayer` `adhkarWindow`):** from each fard prayer's jamaat (its adhan when the masjid holds no
  jamaat; on Fridays each Jumu'ah jamaat in place of Dhuhr) for 30 minutes — `[start, start + 30 min)`; overlapping
  windows → the later start; yesterday is checked too, so an Isha before midnight runs past it.
- **Home card (A20):** the first followed masjid (follow order) with a set and timings; title "Adhkar after salah ·
  <prayer>", the first dhikr's Arabic (3 lines), "See all"; "Hide until the next salah" stores the window's key
  (`<masjid>/<date>/<HH:mm>`) in the device store (`adhkarDismissed`, device only). The card lives in
  `@mc/ui/content` (`AdhkarCard`) so the B16 preview renders the real component (T3.11).
- **List (A20):** route `/masjid/:id/adhkar` (Masjid Detail row "Adhkar after salah" after Dua Requests when the bundle
  has a set): Arabic at the reader's size, transliteration (the reader's switch), translation, reference, source; a
  large counter per dhikr (selection haptic per tap, success pattern at the count, "Start the count again"); counts are
  module memory — this app session only, never stored or sent.
- **Admin (B16):** a Home tile "Adhkar" (07 B3 lists none; B16 needs an entry point and the admin UI is icon-first —
  like the #104 tiles) → switch, ordered list (drag, Move up / Move down — WCAG 2.5.7 —, Remove), "Add dhikr" (the
  library search sheet with kind `dhikr`, chosen ones marked), the Home-card preview in four languages, Save.
- **Seed:** three verified `dhikr` placeholders (10 §5) and an adhkar set on Test Masjid Alpha.
- **Budget:** musalli initial JS 186.01 kB → limit 187 kB (Home's card and the window; owner rule "quality over bundle
  size"). Admin 212.7 / 220 kB.
**Consequences:** domain +5 (every prayer, adhan fallback, Jumu'ah, overlap, midnight), db int +5, API int +1, app unit
+3, admin unit +4, e2e `e2e/admin/adhkar.spec.ts` (admin picks → pinned clock: card after Dhuhr, gone 30 min later,
list + counter, Hide survives a reload), B16 + its sheet in the 4-locale screens spec (axe clean). Follow-up F55.

### #130 — Ruqyah: one collection, three sources, one order, the masjid's own words kept apart from the library (PHASE_03 T3.15) — ACCEPTED (Claude Code, 5 Nov 2026)
**Context:** 00 §4.10, 02 ruqyah_entries / `v_pub_ruqyah` / §4.1 / §6, 03 §3–4, 05 §9, 07 A19 / B15, DECISIONS #104 §2.
**Decision:**
- **Data:** `ruqyah_entries` (migration `0013_ruqyah`, area "masjid sections"): validator `oneOf` by `source`
  (`library_id` | `text` | `audio` — each only its own field; a recording also needs `title` and
  `audio.rights_confirmed: true`, a new DSL field `f.confirmed()` that the consent of T3.16 reuses), `instructions` ⇔
  `instructions_locale`, and **`deleted_at` exactly when `status: deleted`** (02 named only `status`; the 30-day
  retention clock of 02 §6 needs the moment — indexed, partial). `audio.peaks` (≤ 48) is kept like voice notes so the
  A18 player draws its waveform. It is a content collection (every write bumps the version and is confined by
  `contentWrite`) and is in the visibility mirror.
- **Policy / DB users:** admin S own · I own (only `active`) · U own and active only (never `masjid_id`, `created_by`;
  the only status change is to `deleted` — no undelete) · no D; super all; `v_pub_ruqyah` for every scope. `mc_admin`
  find/insert/update, `mc_system` all (retention purge), `mc_migrator` schema; `atlas-roles.json` regenerated — the
  Atlas roles on staging must be re-applied before this code is deployed (owner step O36).
- **The 50-entry limit** is counted inside the add transaction; the same transaction bumps the masjid's version, so two
  parallel adds conflict on the masjid document and the retry re-counts (db test: six parallel adds for the last three
  places → exactly three succeed).
- **Order:** one `sort` per masjid. The admin moves entries inside a heading (B15 shows the A19 headings); the client
  sends the whole list with the headings in A19 order (`PUT /ruqyah/order`, every active entry exactly once, else
  `409 RUQYAH_ORDER_INVALID` — the list changed meanwhile). New entries go to the end. A `PATCH` replaces the whole
  entry and may change its source; its place stays.
- **Reads:** public `GET /masjids/:id/ruqyah?v=` = `{sections: [{category, entries}]}` (non-empty headings in A19 order),
  immutable per version with `Cache-Tag: m-<id>`; a library entry no longer verified is left out for musallis and shown
  to the admin as "no longer in the library" (`libraryId` without `library`) — F55 covers the cached-version side. The
  bundle gains `sections {ruqyah, needy}` (needy = 0 until Phase 5), **optional in the contract** so a bundle cached
  before this release still parses (no row then). Recordings travel as the key (#127).
- **Labels (05 §9):** one shared `RuqyahCard` in `@mc/ui/content` (A19 and the B15 preview, T3.11): a library entry shows
  reference + "Source · Licence"; masjid text shows only "Added by <masjid>" — never a source or verified line (component
  test in 4 locales); its translation and the instruction carry `lang` of the language the masjid wrote them in (a tag
  names it when it differs from the app language); Arabic is `lang="ar" dir="rtl"` everywhere.
- **Musalli:** Masjid Detail row "Ruqyah" (after Adhkar) when `sections.ruqyah > 0`; the list is a persisted query
  (`ruqyah` root, pruned with old versions like bundles and feeds), so it works offline once opened.
- **Admin (B15):** Home tile → list grouped by heading (Edit, Move up / Move down and drag inside a heading — WCAG 2.5.7,
  Delete with confirm, "n of 50"); editor: what to add (library — any kind, chosen by a kind chip; own text; recording
  via the B14 field with its ownership tick and title) → heading → content → optional title and instruction with its
  language → the musalli card in the preview frame (4 languages) → Save; "Still needed: …" names what is missing.
- **Media:** a replaced or deleted recording is not deleted at once (moderation evidence / retention): deleted entries'
  recordings go with the 30-day purge (T8.7); a recording replaced by an edit is unreferenced — F52 now covers audio too.
**Consequences:** db int +12 (ruqyah) and the matrix / privilege / explain tests extended (43 namespaces), API int +3,
ui +6 (card), app unit +1, admin unit +8, e2e `e2e/admin/ruqyah.spec.ts` (admin types text + library dua, reorders →
musalli sees the row, library first, "Added by", no source line; delete → gone one poll later), A19 in 4 locales
(`e2e/app/content.spec.ts`, Arabic not mirrored) and B15 list / editor / new in the 4-locale screens spec (axe clean).
Musalli initial JS 186.35 / 187 kB.

### #131 — Ilm contacts: consent on every save, the number only inside the WhatsApp link, the audience a display filter (PHASE_03 T3.16) — ACCEPTED (Claude Code, 5 Nov 2026)
**Context:** 00 §4.12, 02 masjid_contacts / `v_pub_contacts` / §4.1 / §6, 03 §3–4, 05 §2, 07 A21 / B17, DECISIONS #104 §4.
**Decision:**
- **Data:** `masjid_contacts` (migration `0014_contacts`, area "masjid sections"): `consent_confirmed` is
  `f.confirmed()` (the validator refuses a contact without it); `deleted_at` exactly when `status: deleted` (the 30-day
  retention clock, as Ruqyah #130); index `{masjid_id, status, audience, sort}` + partial `{deleted_at}`. A content
  collection (every write bumps the version, confined by `contentWrite`) and in the visibility mirror. ≤ 10 active,
  counted inside the add transaction (six parallel adds for the last three places → exactly three succeed).
- **One E.164 rule:** 02 wrote `^+[1-9][0-9]{7,14}$` (8–15 digits); the template param `phone` (T3.4) already used
  `@mc/domain/phone` `isE164` = `^+[1-9][0-9]{6,14}$` (7–15 digits, the E.164 maximum). The validator, the admin
  contract, the public contract and `isE164` now share the latter, so nothing the API accepts is refused by the database
  (contract-sync test); 02 updated.
- **Consent:** `consentConfirmed: true` is required on **every** save (`POST` and `PATCH` replace the whole contact).
  B17 opens a saved contact ticked, and clears the tick when its name or number changes (the person agreed to be listed
  with those). Removal is the delete — also how a "remove me" request is carried out (05 §2).
- **Policy / DB users:** as Ruqyah — admin S own · I own (active) · U own and active only (never `masjid_id`,
  `created_by`; status only to `deleted`) · no D; super all; `v_pub_contacts` for every scope (both audiences, without
  consent, creator, status). `mc_admin` find/insert/update; `atlas-roles.json` regenerated (owner step O36).
- **Personal data:** the audit entry carries only `audience` and `consent_confirmed` — never the name or number;
  `whatsapp` added to the logger's redaction paths (bodies are never logged anyway).
- **Reads:** no separate endpoint — the bundle's `contacts` (both audiences, brothers first, each in the masjid's
  order; **optional in the contract** so a bundle cached before this release still parses). No reorder in B17 (07 B17
  asks for none): new contacts go to the end.
- **The number is never rendered (07 A21):** one shared `IlmContactCard` (`@mc/ui/content`, A21 and the B17 preview):
  initial, name, role, topics and a "Message" **button** that calls `window.open(url, '_blank', 'noopener,noreferrer')`
  — not a link, so the number is in no text and no attribute (component test in 4 locales + e2e). URL from
  `whatsappChatUrl` (`@mc/domain/phone`): `https://wa.me/<digits without +>?text=<URL-encoded greeting>` — WhatsApp's
  documented click-to-chat format (faq.whatsapp.com, checked 5 Nov 2026). The greeting "Assalamu alaikum" is a UI
  string in the app language (07 A21 names it), in the review CSVs with the rest.
- **Audience:** Masjid Detail shows "Ask the masjid" (after Ruqyah) only when the masjid lists contacts for the device's
  Brother/Sister choice; A21 lists only those. A display filter, not access control (#104 — the view carries both).
**Consequences:** db int +9 (contacts) and the matrix / privilege / explain tests extended (45 namespaces), API int +4
(+1 contract sync), domain +2, ui +6 (card), app unit +1, admin unit +5, e2e `e2e/admin/contacts.spec.ts` (consent
gate, sisters' contact never on a brothers device, new number clears the tick, remove), `e2e/app/ilm.spec.ts`
(brothers / sisters devices, no number on screen, wa.me + greeting, no row without contacts, A21 in 4 locales) and B17
list / editor / new in the 4-locale screens spec; fixture option `appAudience`. Musalli initial JS 186.52 / 187 kB.

### #132 — Blood donation camp: a notice, not a collection; the card lives while the camp's hours do (PHASE_03 T3.17) — ACCEPTED (Claude Code, 5 Nov 2026)
**Context:** 00 §4.13, 07 A22 / B18, DECISIONS #104 §5, #111 (draft templates), #131 (WhatsApp link, one E.164 rule).
**Decision:**
- **No new collection or personal data:** a camp is an announcement from the starter template `blood_donation_camp`
  (T3.4/T3.5: `date`, `hours` time range, `place`, `contact` phone; category `event`; draft translations, active on
  dev/staging, `draft` on a new production database until the Super Admin reviews it — #111). The app reads the camp from
  the item's template params (`bloodCampOf` in `@mc/ui/content`); no donor list, no blood groups.
- **When it shows:** `istWindow` (`@mc/domain/time`) turns the date + hours into IST instants — a range whose end is not
  after its start runs past midnight and ends the next day. Home and Masjid Detail show a card while `now < end`
  (upcoming or running), soonest first; the card disappears on the minute re-render after the end. Source: the followed
  masjids' first feed pages (Home) and the announcement page (Masjid Detail) — a camp announced so long ago that it has
  left the first page shows only in the list (accepted; feeds are newest first and a camp is announced shortly before).
- **The card (A22):** shared `BloodCampCard` (Home, Masjid Detail, and the admin B5 preview of a camp notice — T3.11):
  drop icon, title, the masjid (Home), date · hours, place — that part opens the notice — and "Contact on WhatsApp"
  (`WhatsAppButton`, the same button and `wa.me` link as Ilm contacts, #131). Home's startup code carries only the camp
  check; the card is a lazy chunk (`@mc/ui/content/blood-camp`), so the musalli initial JS stays under 187 kB.
- **The number:** unlike Ilm contacts (a volunteer listed with consent), the organiser's number is part of a public
  notice the admin typed for people to call: the notice text shows it, grouped as people read it (`formatPhone`:
  "+91 98765 43210") in a Unicode LTR isolate so Urdu text keeps the digits in order; the notice detail adds "Contact on
  WhatsApp" for every `phone` param (`templatePhones`). The card itself does not print it.
- **Admin (B18):** the "Blood Camp" tile (drop icon, matching A22) opens `/blood-camp`, which starts a B5 draft from the
  template and replaces itself with step 2; Preview shows the notice card and the camp card; "Notify followers" is on by
  default (B5). When the template is not active (production before review) the screen says to ask the Super Admin.
- `formatPhone` moved to `@mc/domain/phone` (the B17 editor uses it too).
**Consequences:** domain +2 (`istWindow`, `formatPhone`), i18n +4 (the camp in 4 locales — date, hours, place, isolated
number), ui +9 (camp view incl. past midnight, card in 4 locales, preview, `templatePhones`), e2e
`e2e/admin/blood-camp.spec.ts` (tile → fill → preview → publish; a musalli pinned to that morning sees the card on Home
and Masjid Detail, WhatsApp opens wa.me, the detail has the number and the button; a minute after the last hour the cards
are gone) and B18 in the 4-locale screens spec.

### #133 — Phase 03 close-out: the usability tap budget, library changes refresh their masjids, voice-note gaps (PHASE_03 T3.12, F54, F55) — ACCEPTED (Claude Code, 5 Nov 2026)
**Context:** PHASE_03 T3.12 (5 tasks, ≤ 6 taps each), F54 (#128), F55 (#129, #130), CLAUDE.md §2.8 (low literacy: templates
over typing).
**Decision:**
- **T3.12 — measured, not estimated:** `e2e/admin/usability.spec.ts` performs the 5-task script from Admin Home and counts
  every tap until the change is saved / published: Maghrib offset **6**, "No water 10–2" **6**, today's hadith **4**,
  illness dua with the name private **5**, delete a post **3** — no typing in any of them. Two changes made that
  possible: the jamaat sheet offers **5 / 10 / 15 / 20 / 30 minutes** as one-tap buttons beside the ±1 stepper (07 B4's
  stepper stays for any other value); a **time-range** param opens **one sheet with both wheels** and one Done (07 B5
  "time range → two wheels" — before, each end had its own sheet: 8 taps). The script with the counts is in the owner
  guide (Phase 03, check 3.13; O26) and goes into the phase report.
- **F55 — library status changes refresh the masjids that use the entry:** `retireLibraryEntry` (from verified),
  `updateLibraryEntry` when a content edit sends a verified entry back to draft, and `verifyLibraryEntry` bump the
  content version of every masjid using the entry — its adhkar set (`masjids.adhkar.library_ids`), its active Ruqyah
  entries, and its published hadith / dua posts — in the same transaction. Followers refetch the bundle, feeds and Ruqyah
  list at their next poll, so a retired text leaves cached versions within a minute. The item lookup has no index of its
  own (a rare Super Admin action, bounded by the posts that quote the entry). Tags-only edits change nothing visible
  and bump nothing.
- **F54 — voice notes:** list cards (announcements, dua requests) carry a "Voice message · 0:42" tag — a whole-card
  button cannot hold a player; the hadith / ayah card (A8, hero and regular — not a single button) plays it in place
  under the note; the player also pauses when another screen is pushed over its screen (it watches its screen's
  `inert`); recording is covered by `e2e/admin/voice-recording.spec.ts` with Chromium's fake capture device (record
  ~3 s in the hadith note step → upload → the musalli plays it in the A8 card). Still open in F54: a real phone recording
  on staging (Safari MP4, Chrome Opus) — owner check 3.14 with O25.
**Consequences:** db int +3 (`library-users.int.test.ts`), e2e usability (tap counts), voice-recording, voice badge
assertion; the B4 jamaat sheet and B5 time-range screens stay axe clean in 4 locales.

### #134 — Lighthouse warm runs start a fresh browser on the cold run's profile; startup work trimmed (F56) — ACCEPTED (Claude Code, 6 Nov 2026)
**Context:** CI `a0954df` and `4cc10d4` failed the warm (service-worker) performance category ≥ 90: app 87 (TBT 515 ms),
admin 89 (TBT 439 ms). The worst warm runs began with one 300–500 ms "Unattributable" main-thread task at t≈8 ms. A
Chromium trace of it holds almost nothing but V8 "heap object iterator" sweeps and a code deoptimization — what V8 does
when a profiler switches on JS coverage (Lighthouse's `unused-javascript` gatherer) in a renderer that still holds the
previous visit's heap: `pnpm lhci` ran the warm visit in the same tab, right after the cold one. Its size grew with
the app's heap (313 ms in October), so it fails more often as the app grows. No user's repeat visit has it.
**Decision:**
- `scripts/lighthouse.ts`: every cold/warm pair gets its own temporary browser profile; each run starts Chromium on
  it and closes it afterwards, so the warm run is the app **opened again** (service worker and caches kept, new
  process) — what a returning musalli or admin does. Budgets unchanged (01 §9; #84 warm gate as before). Locally the
  warm medians went to app 95 / admin 97 (TBT 260 / 201 ms) with no t≈8 ms task; in a reused tab the same build
  ranged 86–99.
- Real startup work found by a CPU profile of the warm load (4× CPU) and cut: `formatters()` built 14 Intl formatters
  up front on the first render (~70 ms at 4×) — each is now built on first use; the onboarding `Pager` read the text
  direction with `getComputedStyle` (a forced style recalculation during the first render) — it now reads the nearest
  `dir` attribute, which is what sets the direction.
- Left as is: the rest of the warm TBT is evaluating the main bundle and React's first render (`index` ≈ 120–190 ms
  tasks at 4×); the Motion `VisualElement` chunk is shared by every animated screen. Warm TBT stays reported, not gated
  (#51, F27).
**Consequences:** `pnpm lhci` takes a few seconds longer (12 browser starts); cold runs also start a fresh browser — the
same as CI's first run did before. The local stack's app cold LCP (2.6–2.7 s, Windows + Docker) still misses 2.5 s as
it did before this change (3.6 s on 5 Nov); CI's cold runs pass — CI is the gate.

### #135 — Phase 03 close: security-review and phase-verifier findings fixed; three criteria met another way (PHASE_03) — ACCEPTED (Claude Code, 6 Nov 2026)
**Context:** the Phase 03 security review (0 HIGH, 2 MEDIUM, 5 LOW) and phase-verifier run (FAIL: 3 blockers, 4 should-fix)
on `a75d4d8`; CLAUDE.md §5 (fix every HIGH/MEDIUM, justify LOWs).
**Decision — security:**
- **M1 — voice originals:** recordings are uploaded to Cloudinary as `type=private` (destroyed with the same type): the
  original as recorded (container metadata, a video track in an MP4) is never deliverable unsigned; only derived
  renditions are, and with strict transformations only the named one. Caddy serves
  `video/private/t_audio_m4a/m/<masjid>/a/<id>.m4a` (verified in Cloudinary's "Control access to media" docs,
  6 Nov 2026). The named transformation is `audio_m4a` = `ac_aac,br_48k` (AAC ~48 kbps, 01 §5.5; `br_` sets the
  audio bitrate per Cloudinary's audio docs; phone recordings are mono already — Cloudinary documents no downmix).
- **M2 — memory and the upload bucket:** at most two uploads per api process are held in memory at once
  (`MAX_UPLOADS_IN_FLIGHT`; the next answers 503 `SERVICE_UNAVAILABLE` with `Retry-After: 5`, freed when the
  response closes); the `adminUploads` key is the lower-cased masjid id, so another spelling of the same id shares the
  30/h bucket; the audio Blob no longer copies the buffer.
- **L2** a removed item's `voice` is redacted like its title/body/image. **L3** `push_quota_usage`: inserts start at 1,
  updates are `$inc: {count: 1}` only — no reset, no jump (policy checks now see the update operator). **L4**
  `v_pub_ruqyah` is an allow-list (migration `0015_ruqyah_view`). **L5** a MongoDB server error (it has `errInfo`) is
  logged as `{name, code, codeName}` only — validation details carry the rejected values.
- **L1 (kept, tracked as F53):** when Cloudinary returns no duration the browser's (≤ 600 s, contract-bounded) is used;
  the first staging upload shows whether the response has it, else the Admin API is read before accepting.
- **Polyglots:** an audio file whose bytes contain HTML / XML markup (`<html`, `<script`, `<!doctype`, `<?xml`,
  `<iframe`, `<object`, `<embed`) is refused as not audio (T3.13); the media site's `nosniff` + CSP stay the main guard.
**Decision — phase-verifier:**
- T3.0: the Scan modal is axe-checked (live camera in the `scan` project; no camera on both phones).
- T3.13 upload tests: Chrome's WebM/Opus and Safari's MP4/AAC accepted — generated fixtures (`scripts/generate-audio-
  fixtures.ts`: Chromium's MediaRecorder records a 440 Hz tone; Playwright's WebKit has no Web Audio on Windows, and
  the container + codec are what the server checks); polyglot and > 25 MB refused; 10:01 measured by the storage →
  422 `AUDIO_TOO_LONG` and the stored file deleted. Player: keyboard, spoken names, one-at-a-time, reduced motion
  (`packages/ui/test/voice-note.test.tsx`); a start interrupted by a pause (AbortError) no longer shows "unavailable".
- 4-locale screenshots + axe: B14 recorder (`screens.spec`), A18 player (`voice.spec`), A20 adhkar list
  (`content.spec`), A22 camp card (`blood-camp.spec`) — the app's language switched through Settings
  (`e2e/support/locale.ts`).
- F49 fixed (the dua translation, a special date's labels and note are `<bdi>` isolates — punctuation stays put; the
  paragraph alignment and the Urdu baselines do not change). F50: unit tests for `use-timings-editor` and `use-special`.
- Pinned-clock e2e helpers route at the **context**: the app's service worker fetches API responses too, and a Date
  header through it set the app back to the real time (the blood-camp spec failed on CI at 08:00 IST).
**Met another way (deviations):**
- **T3.13 "Removal deletes the media"** — not at the moment of removal: a removed item keeps its media for the 180-day
  evidence period (IT Rules 3(1)(g), 05; `purge_after`), and a recording can be referenced by more than one record;
  deletion is the `media-delete` job of Phase 8 (F52), which deletes what nothing references after the grace period.
  The storage adapter's delete is integrated and tested (the 10:01 path deletes the stored file).
- **T3.13 "musalli plays it (both phones)"** — the recording e2e plays on Pixel 7 (Chromium); WebKit playback is owner
  check 3.14 on a real iPhone against staging (Cloudinary's AAC rendition): Playwright's WebKit cannot record, and the
  local file store serves the raw WebM/WAV that Safari does not play.
- **F50 polish → Phase 9 (polish, with F44):** the `UploadProgress` ring (needs XHR upload progress; uploads show
  "Uploading…" with a spinner today) and the Home tile's mint pulse after a publish (08 §5.12).
- **T3.1 inbox banner** — waits for the inbox it points to (reports: Phase 8; change-request replies: Phase 5).
**Consequences:** api int 272, db int 290, ui 310, admin +8, domain 192 (100 % again — `formatPhone` has no
unreachable branch); one more migration (0015); owner O25 creates `audio_m4a` as `ac_aac,br_48k`.

### #136 — Cold LCP gets a recorded 100 ms tolerance; Latin times are LTR-isolated in Urdu sentences (Phase 03 close) — ACCEPTED (Claude Code under the owner's standing rule, 6 Nov 2026)
**Context:** CI `9a391d6` (run 42157915597): e2e 255 passed, perf 18 passed, Lighthouse warm PASS on both apps (F56
fixed), but the musalli app's **cold** LCP was **2505 ms** against the 2500 ms target (median of 5; performance 95; a
fresh browser per run since #134). The owner's standing rule (3 Nov 2026, #116): a few ms over a perf budget is
acceptable with an explicit, recorded tolerance — do not trade quality or spend sessions on it.
**Decision:**
- `COLD_BUDGETS.tolerance`: LCP may exceed the 2.5 s target by up to **100 ms** before the page fails; within it the
  run prints "over the 2500 ms target, within the 100 ms tolerance (DECISIONS #136)" — reported, never silent. The 01 §9
  target itself is unchanged; every other budget has no tolerance.
- **F58 (found in the Phase 03 Urdu screenshots, fixed):** a Latin time inside an Urdu sentence showed as "PM 8:45" and
  a range as "AM – 2:00 PM 10:00" (bidi reordering). Times are now LTR isolates (U+2066 … U+2069, `ltrIsolate` in
  `@mc/i18n/template-args`) wherever they are put into a sentence: template params `time` / `time_range` (phones
  already were), the blood-camp card's hours, the khutbah line, the Eid card's times (each isolated, the list in the page
  direction). The voice player's elapsed / remaining labels follow the page direction (elapsed at the slider's start —
  the right in Urdu), each reading LTR. Visual baselines regenerated in the pinned Linux image: Urdu announcements and
  Home now read correctly; Home in every locale also loses the Qibla placeholder (dev / staging builds only since
  Phase 02 — the old baselines predate that and stayed within the pixel tolerance).
**Consequences:** `packages/config/test/lighthouse.test.ts` covers the tolerance; e2e text checks allow the isolates;
the owner sees the cold-LCP number in the Phase 03 report.

### #137 — Phase 04 starts before Phase 03's owner verification (owner, 8 Nov 2026) — ACCEPTED (owner, 8 Nov 2026)
**Context:** CLAUDE.md §3/§5 say the next phase starts only after the owner verified the last one. Phase 03 is built
and closed on `feat/phase-03` (report, phase-verifier and security review done — #135, #136), but its staging deploy
waits for the rest of O25 (Cloudinary templates + strict mode) and the owner's checks O26/O27.
**Decision (owner, 8 Nov 2026):** "phase 3 is already done, now continue with the next phase and don't stop in
subphases; don't ask for my permission; update progress at each milestone." Phase 04 is built on `feat/phase-04`,
branched from `feat/phase-03`. Phase 03 keeps its open items (deploy, O25, O26, O27); its status becomes AWAITING
OWNER VERIFICATION when deployed. Phase 04 is deployed together with or after Phase 03.
**Consequences:** the two phases ship to staging in order (03 first); owner checks for both may be done in one sitting.

### #138 — Push pipeline: adapter, queues, resumable fan-out, ledger, kill switch (PHASE_04 T4.1, T4.4, T4.7) — ACCEPTED (Claude Code, 8 Nov 2026)
**Context:** 01 §5.3 / §5.8, 04 R7 / §6; `web-push` 4.0.0 was published 6 Nov 2026 — younger than the repo's
`minimumReleaseAge` (3 days); BullMQ 6.3.11 refuses ":" in custom job ids ("Custom Id cannot contain :", read in its
source).
**Decision:**
- **Adapter** (`packages/api/src/push/sender.ts`): `web-push` **3.6.7** (pinned; 4.x after its release age and a
  changelog review — F60) only encrypts (RFC 8291 aes128gcm) and signs VAPID (RFC 8292) via `generateRequestDetails`;
  we POST with `fetch` — no redirects followed, 10 s deadline, the endpoint re-checked against the 04 §6 allow-list
  before every request. One classifier: 2xx sent · 404/410 gone (prune) · 429/5xx/network retry (Retry-After read,
  capped at 1 h) · everything else rejected (counted failed, never pruned). TTL 86 400 s announcements / 43 200 s
  others, `Urgency: high` for important notices and inteqal requests, `Topic` = the item's public id.
- **Queues** (`packages/api/src/queue/`): one BullMQ queue per job (`push-fanout`, `push-send-batch`, `alert-send`,
  `outbox-sweeper`), Zod payloads checked at enqueue **and** at process time (invalid → `UnrecoverableError`, no
  retries); 5 attempts, exponential backoff; completed jobs kept a day (id dedup), failed a week. Batch job id
  `<jobId>.<page>.<locale>` (01 §5.8 wrote ":", which BullMQ refuses). API code imports only `queue/`, never `jobs/`.
- **Resumable fan-out** (migration `0016_push_fanout`): `notification_jobs.fanout_page / fanout_cursor / fanout_done`
  and index `{status, last_progress_at}`. Each page is recorded conditionally on `fanout_page`, so a retried fan-out
  never counts batches twice; the job completes when `fanout_done` and `pending_batches ≤ 0`.
- **Ledger** (Redis, worker ACL `~push:*`, 24 h TTL): `push:sent:<job>` = devices already sent (a retried batch only
  sends the rest; a duplicated fan-out sends nothing), `push:done:<job>` = batches already counted. A batch's final run
  counts `sent` = its devices in the sent-set, `failed` = unsent after the last attempt; `pruned` grows inside the
  prune transaction by the devices actually changed (a device that re-subscribed meanwhile is kept).
- **Payload** = 01 §5.3 plus `l` (the text's locale → notification `lang` / `dir`); `i` dropped (the service worker
  uses the app's own icon and badge). ≤ 3 KB enforced by shortening the body. Words: title = the masjid's name in the
  reader's script, body = the item's title line (+ "🎤 Voice message") and its text; template notices rendered with
  `@mc/i18n/runtime-message` + `template-args` like the apps; strings in `locales/*/push.json` (plain text, outside
  i18next) and the apps' own item labels / prayer names (`@mc/i18n/push-text`).
- **Kill switch** (T4.7): fan-out and send-batch read `app_settings.push_paused` before work and between pages; when on,
  the job is moved to delayed for 60 s (`DelayedError` — no attempt used) and the outbox job stays `pending` /
  `running`; it continues by itself after resume.
- **Sweeper** (every minute, Asia/Kolkata): pending > 2 min → `push-fanout` again (a failed BullMQ job is retried, a
  finished one removed and re-added); running without progress for 10 min → `failed` + `alert-send` `push_job_stuck`
  to the Super Admin. An item no longer published at fan-out → `failed` ("item no longer published"), nothing sent;
  deleted mid-send → the remaining batches count off without sending.
- **Producers of jobs:** the publish routes (after commit, `PushNotifier.afterCommit` — a lost hand-over is the
  sweeper's), the worker itself, and the Super Admin's own test alert outside production (T4.6). Route-table test:
  no queue / job / worker route; the only jobs path is the read-only notification history.
- **Subscriptions:** `setDevicePush` (device scope, follow mirror in one transaction); an endpoint another device
  record holds → `409 PUSH_ENDPOINT_IN_USE` and the app makes a fresh subscription (same for admin subscriptions).
**Consequences:** api +3 unit files, +1 integration file (10 scenarios on real Redis/BullMQ/MongoDB), db +11
integration tests; publish state functions return `notificationJobId`.

_None — every decision is ACCEPTED (23 Oct 2026)._

### #139 — Push e2e: the runtime-test worker captures pushes; CDP delivers them; a full-Chromium `push` project (PHASE_04 T4.8, T4.9) — ACCEPTED (Claude Code, 8 Nov 2026)

**Context.** Headless browsers cannot subscribe at a real push service (Chromium: "Registration failed — permission
denied"), and Playwright's default headless shell also denies the notification permission, so a service worker cannot
show a notification there. An e2e that let the worker POST to fcm.googleapis.com would send traffic to Google from
tests. T4.8 measured the worker together with the seeding (472 MB) — not the worker alone.

**Decision.**
1. The **runtime-test** worker sends through `capturePushTransport` (in `@mc/api/test-hooks`, i.e. only in
   `dist-test/test-hooks.mjs` → only the `runtime-test` image), loaded by `loadWorkerPushTransport` under the same gate
   as the API hooks (APP_ENV=local AND NODE_ENV=test AND the module exists). It records endpoint, plaintext payload and
   TTL/Urgency/Topic in the Redis list `e2e:push:captured` and answers 201 — nothing leaves the machine.
2. api-admin's test hook `GET /api/admin/test/push-captured?endpoint=` reads them. Only the **local** Redis ACL has
   `e2e:*` (worker read/write, api-admin `%R~` read-only); the VPS ACL has no such pattern, so even a misconfigured
   deploy could not capture. ACL integration test added.
3. Tests register fake FCM subscriptions with real P-256 keys (the worker really encrypts) — through the API, or through
   the app with a stubbed `PushManager`. `ServiceWorker.deliverPushMessage` (CDP) hands a captured payload to the
   musalli SW; `registration.getNotifications()` checks what it shows.
4. New Playwright project `push` (`*.push.spec.ts`): Pixel 7 on `channel: 'chromium'` (new headless — notifications
   work). CI runs it in the test-hook step (`--project=push`).
5. T4.8: the load test forks the worker into its own process (`scripts/load/push-worker.ts`) with a counting stand-in
   transport: 50k → 409 MB peak RSS; 100k → 404 MB (bounded by batches in flight).

**Consequences.** Real subscription creation and real push-service delivery are covered only by the owner's device
checks (O38). The global kill switch in the push spec is always reset in `finally`; run hook specs with one worker.

### #140 — T4.9 run: a send-batch counting race fixed (migration 0017), test defects fixed, a readable disabled Switch, musalli initial JS 188 kB (PHASE_04 T4.4, T4.9) — ACCEPTED (Claude Code under the owner's standing rule, 8 Nov 2026)

**Context.** The first run of the T4.9 specs on the local stack (after the WSL hang was cleared by a real reboot — the PC
had not restarted since 24 Oct 2026 because Fast Startup turns "Shut down" into hibernation). The worker log showed one
send batch failing with `Document failed validation`.

**Decision.**
1. **Product bug — a fast batch could leave its job unfinishable.** The fan-out enqueues a page's batches *before* it
   records `pending_batches += n` (so a crash in between re-enqueues instead of losing batches, #138). A batch that
   finished first took `pending_batches` to -1, which the validator (`int ≥ 0`) refused — after the Redis ledger had
   already marked the batch counted, so its retry skipped the count and the job could never reach 0 (it would end as
   "stuck" after 10 min). Fixed twice: (a) `pending_batches` is a **balance** (validator `int` ±2·10⁹, migration
   `0017_push_batch_balance`, 02 updated); completion stays "≤ 0 and `fanout_done`", and the fan-out's own final
   `completeIfDone` covers the case where every batch counted off before the last page was recorded; (b) the
   send-batch claims the batch, writes the counters, and **releases the claim when the write fails**
   (`SendLedger.releaseBatch`) so the retry records it — any transient MongoDB error after the claim had the same
   effect. Tests: db "batches may count off before the fan-out records their page"; api "a batch whose counter write
   fails is counted by its retry" (fails without the release — checked).
2. **Disabled `Switch` (packages/ui):** only the track dims (`disabled:opacity-40` on the control); the label and
   description stay at full contrast. axe flagged the dimmed description of "Alerts on this phone" (WCAG 1.4.3) when
   the browser cannot show alerts; the row says why it is off, so it must stay readable.
3. **Test defects fixed.** (a) `push-pipeline.int`: the job completes inside the last batch's processor, a moment
   before BullMQ moves that batch to its completed set — the test waits for BullMQ. (b) `admin-masjid.int`: the quota
   expectation gains `paused` + `reach` (T4.5). (c) The push e2e taps "Turn on" only after
   `navigator.serviceWorker.ready` (on a first visit the SW may still be precaching). (d) A second musalli phone made
   with `browser.newContext()` is seeded like the fixture's own context — `seedOnboardedDevice` (exported from
   `@mc/config/playwright`, the fixture uses it too); without it the app's first run wrote its own device document over
   the stored credentials. Both phones' follows must be `synced` (`awaitFollowsSynced`) before publishing. (e) Kill
   switch in the push e2e: `paused` is set before any assertion (a failed assertion had left the global pause on), a
   leftover pause is cleared through C10 at the start (a fresh session needs the step-up — 403 through the API), the
   step-up is optional when one was just made, and the resumed job is awaited for 90 s — a paused job looks at the
   switch again every 60 s (`PAUSE_RECHECK_MS`, #138; T4.7 asks only that jobs continue). (f) Journey 7 expects
   "1 person will be notified." (one follower has push on now; the app pluralises correctly). (g) The admin screens
   spec activates its masjid (with timings) before the notification-history shot — a pending masjid's posts are not
   public, so the worker correctly ended that notification ("item no longer published").
4. **Musalli initial JS 187 → 188 kB** (187.65 kB, +0.65 kB): the push bridge (a tapped notification opens its screen)
   and the soft-ask shell. The subscription code (`lib/push.ts` → `push-*.js`) and the ask sheet stay lazy — checked:
   none of the 12 initial files contains it. Owner's standing rule: a few kB over a budget is fine when recorded.

**Consequences.** Staging/production need migration 0017 (applied by the normal deploy migrate step). Hook specs that
open a second musalli phone use `seedOnboardedDevice`; specs that publish to followers wait for
`awaitFollowsSynced` first.

### #141 — mc-server: two HIGH zlib CVEs in the distroless base that our process never loads (Trivy, 8 Nov 2026) — ACCEPTED: option A (owner, 8 Nov 2026)

**Context.** CI `1ebba4b` failed the image scan: `zlib1g 1:1.3.dfsg+really1.3.1-1+b1` in
`gcr.io/distroless/nodejs24-debian13` (CVE-2026-76844, CVE-2026-85091; fixed in Debian `+deb13u1`). The newest
distroless digest (`b8cec4b2…`, pulled 8 Nov 2026) still ships the old package — Google has not rebuilt yet. Distroless
has no package manager, so the image cannot be patched in place. **Evidence of exposure:** the official Node binary
does not link the system zlib (`ldd node` in node:24.21.0-trixie-slim: no `libz`); Node uses its bundled zlib
(`process.versions.zlib` = 1.3.2.1-motley); a running distroless Node process maps no `libz` (`/proc/self/maps`). The
only executable in the image is `node`. (Caddy's findings were fixable and are fixed — `ee106d5`.)
**Options.**
- **A (recommended):** a time-boxed ignore for exactly these two CVE ids, for the `mc-server` scan only
  (`infra/trivy/mc-server.trivyignore.yaml` with `expired_at` 7 days out + this evidence), and move to the new
  distroless digest as soon as it carries `+deb13u1` (Renovate). Every other finding still fails CI.
- **B:** wait for the upstream rebuild. CI stays red at the image scan; e2e, perf and Lighthouse do not run on CI until
  then (Phase 04 cannot be verified there).
- **C:** graft the patched `libz.so.1` + dpkg status into the distroless image in a build stage — brittle, hides the
  package from future scans; not recommended.
**Decision (owner, 8 Nov 2026): A.** `infra/trivy/mc-server.trivyignore.yaml` lists exactly the two CVE ids with
`expired_at: 2026-11-15`; CI and the nightly pass it only for the server image (`mc-server:local`, deployed
`al-masjid-server@…`). Checked with Trivy 0.75.0: the scan passes with the file and fails again with an expired date.
Follow-up F61: new distroless digest, then delete the entries.

### #142 — Phase 04 security review fixed: paused jobs never fail as stuck, revocations stop alerts, no Topic header, send-time follow check; warm Lighthouse score tolerance (PHASE_04) — ACCEPTED (Claude Code; M3 decided by the owner, 8 Nov 2026)

**Context.** `security-reviewer` on `origin/main...feat/phase-04` (8 Nov 2026): 0 HIGH, 3 MEDIUM, 11 LOW. CI `64b0234`:
image scan, e2e (254 passed, 1 flaky) and motion perf green; the musalli **warm** Lighthouse performance score 89 < 90
(TBT 453 ms, LCP 665 ms, CLS 0.001, benchmarkIndex 2293); cold LCP 2485 ms passed.
**Decision.**
- **M1 — a pause or worker stop longer than 10 min no longer loses notifications.** The stuck-job detector does not run
  while `push_paused`; a quiet running job whose fan-out or any send batch still waits in BullMQ (waiting / delayed /
  active) only gets `last_progress_at` refreshed (`listStuckCandidates` + `touchJobProgress`, replacing
  `failStuckJobs`); only a job with nothing left anywhere is failed + alerted. Test: a running job paused past the window
  → no failure, no alert → completes on resume.
- **M2 — revoking stops alerts.** `revokeAdminSessions`, `revokeAdminPasskeys` (Super Admin ★) and "sign out
  everywhere" (`revokeSessions` without a session id) delete the admin's `admin_push_subscriptions` in the same
  transaction. Kept on purpose: the counter-regression path (its alert must reach the real owner) and one-device logout
  (the app removes its own subscription; no session ↔ subscription link exists — F65).
- **M3 — no `Topic` header (owner's choice, of: keyed hash / drop / keep).** It reaches FCM / APNs unencrypted and the
  public item id would reveal which masjid a phone follows. The service worker's `tag` still replaces an earlier
  notification of the same item on the phone. 01 §5.3 updated.
- **L1** push-pause route `auth: 'super_step_up'` (the state function still checks). **L5** a send batch reads only
  devices that still follow the job's masjid unmuted, push on, targeted choice (unfollow / mute during a pause; a forged
  batch cannot reach other devices). **L6** hook detector knows `/test/push-captured` and `e2e:push:captured`
  (`check:image` OK). **L7** log redaction: `auth`, `push_*`, two levels deep (unit test). **L8** Trivy ignores carry the
  zlib1g purl (verified: another package with the same ids still fails). **L9** "Clear all data" ends the browser push
  subscription. **L10** failed send batches leave Redis after a day.
- **Deferred with reason (follow-ups):** L2 timed-out send batch keeps running (duplicate at most one buzz, collapsed by
  `tag` — F62); L3 `Retry-After` not honoured beyond BullMQ backoff (F63); L4 pause bites per batch, ≤ 4 × 1,000 sends
  (F64); L11 `apk upgrade` makes the Caddy build non-reproducible — accepted while the Trivy gate and digest deploys
  stand, removed with F24.
- **Warm Lighthouse:** `WARM_BUDGETS.categoryTolerance.performance = 0.02` — up to two points under 90 is printed as a
  note, not a failure (the score is weighted by the ungated service-worker TBT burst, #51 / F27; owner's standing rule
  on small budget overruns, #116 / #136). Cold scores have no tolerance (unit-tested).
**Consequences.** API int 345 (branches 85.3 %), db int 310 (lines 97.0 %), unit app 193 / api 181 / config 68.

### #143 — phase-verifier (8 Nov 2026): Super Admin passkey alert only on a new passkey; push stats on C1; F59 / F60 timing; test gaps tracked under T4.9 (PHASE_04) — ACCEPTED (Claude Code, 8 Nov 2026)

**Context.** `phase-verifier` on `feat/phase-04` @ 9e2d734: FAIL — the unit gate red (a `#142` in a test title matched
the raw-colour check), a bug, doc gaps in 02, and missing tests for some client code.
**Decision.**
- **Bug fixed:** `super_passkey_added` ("New passkey on a Super Admin account") was raised on every Super Admin
  sign-in and step-up as well as on registration; now only `/auth/register/verify` raises it (a new passkey arrives only
  there — first registration or "add another phone"). Integration test: once on registration, never on login or
  step-up. F38 (a) done.
- **Unit gate:** the test title cites `DECISIONS #142` (the check skips references written that way).
- **02 updated:** `notification_jobs.fanout_page / fanout_cursor / fanout_done` and the `status_progress` index
  (migration 0016); `admin_push_subscriptions` — the ★ revoke functions delete any admin's subscriptions (#142).
- **Push stats live on the C1 dashboard** (the 24 h success card next to the kill-switch banner), not on C12 Stats: the
  owner sees them on opening the Super Admin app, and C12 is a Phase 9 screen. 03 already documents the endpoint.
- **F59** (CI-only skip of the voice playback assertion) → Phase 9: CI `64b0234` had no voice.spec failure; keep the
  skip until media logs exist. **F60** (web-push 4.x) → Phase 9 hardening after its changelog review; 3.6.7 has no
  known advisory.
- **Tests still to add before T4.9 is ticked** (the staging preview goes ahead on the owner's instruction, 8 Nov 2026):
  push-bridge (PUSH_OPEN → navigate / Updates, versions refreshed on any push); admin `use-alerts` (enable, disable,
  409 re-subscribe, sign-out); A15 blocked / install-first states; onboarding page 7 with 4-locale screenshots; C1 paused
  banner (assertion + screenshot); Publish bar "Will notify N" = DB reach; the outbox-sweeper scheduler in
  `Asia/Kolkata`; brothers-only audience and dead-status recipients in `push-pipeline.int`.

### #144 — Phase 04 security re-review (9 Nov 2026): recovery and counter regression stop alert phones; stuck check covers the page in flight; no `topic` option (PHASE_04) — ACCEPTED (Claude Code, 9 Nov 2026)

**Context.** `security-reviewer` on `64b0234..4392293` (the #142 / #143 fixes and the commits after them): 0 HIGH,
1 MEDIUM, 6 LOW. M1, M3, L1, L5–L10 and the #143 fix verified; M2 partly. CI on `bd4845b` was red in the visual
baselines only (the new Settings row — fixed in `1eae71c`); e2e journey 7's new reach assertion found the Publish bar
showing Home's cached reach (fixed in `4392293`).
**Decision.**
- **M-R1 fixed — redeeming a `recovery` invite deletes the admin's alert subscriptions** in the registration
  transaction, next to revoking every session: recovery means the old phone is lost (04 R3 makes revoking its passkeys
  optional, so the subscription was the one thing left reaching it). `add_device` keeps them. db int test.
- **L-R2 fixed for masjid admins — a passkey counter regression deletes a masjid admin's subscriptions** (the clone's
  phone may hold one). A Super Admin keeps theirs: the regression alert goes to the Super Admins and the affected one
  may be the only one. Session expiry still leaves subscriptions — **F65 moves before Phase 5's first alert to masjid
  admins** (today they receive only test alerts).
- **L-R1 fixed — the stuck-job detector also checks the page being fanned out** (`page <= fanout_page`: the fan-out
  enqueues a page's batches before it records the page). **L-R6:** the lookups run in parallel. Integration test: a
  waiting batch of page `fanout_page` keeps the job running.
- **L-R3 fixed — `PushOptions.topic` removed**; a unit test checks no `Topic` header in any case.
- **L-R4 fixed — "Clear all data" ends the push subscription first**, so a failing wipe cannot leave notifications
  coming; the default (no service worker) is tested.
- **L-R5 fixed — `*.*.push_endpoint | push_p256dh | push_auth`** redacted too (unit test).
**Consequences.** 02 `admin_push_subscriptions` lists the recovery / regression deletes; F65 re-planned.

### #145 — Phase 05 starts before the owner verifies Phases 03 + 04 (owner, 9 Nov 2026) — ACCEPTED (owner, 9 Nov 2026)
**Context:** Phases 03 + 04 are on staging (`863e064`, 9 Nov 2026) and AWAITING OWNER VERIFICATION (O39, O25 rest,
O27, O26, O38). CLAUDE.md §3 says the next phase waits for that verification; #137 made the same exception once.
**Decision (owner, 9 Nov 2026):** asked "start Phase 05 now anyway, like #137?" → **"Start Phase 05 now"**. Phase 05
is built on `feat/phase-05`, branched from `feat/phase-04` = `main` (`863e064` + docs). Whatever the owner's 03/04
checks find is fixed first (on `feat/phase-04` → `main`, then merged into `feat/phase-05`); Phases 03 + 04 are marked
DONE only on the owner's word.
**Consequences:** Phase 05 deploys to staging only after Phases 03 + 04 are verified, or with the owner's OK.

### #146 — UPI change-lock: the data layer (PHASE_05 T5.2) — ACCEPTED (Claude Code, 9 Nov 2026)
**Context:** 02 `payment_profiles` (state machine `pending → approved_on_hold → active`, `pending → rejected`), 04 R1.
**Decision:**
- `packages/db/src/state/payment.ts` is the only writer: the policy layer keeps **no** write cell for
  `payment_profiles` (proven again in `payment.int.test.ts`); state functions write inside one transaction with the
  audit entry (`payment.request` / `.approve` {hold_minutes} / `.reject` {from} / `.activate` — **never the VPA or payee
  name in meta**: the profile documents are the history).
- **Reject also during the hold** (`approved_on_hold → rejected`), a deviation from 02's diagram: the 24 h hold exists
  so that a wrong or malicious change can be stopped before it goes live (Super Admin alert on every request) — without
  this transition the hold could not do that. 02 updated.
- The admin request normalizes the VPA (`@mc/domain/upi`) and cleans the payee name exactly like the link builder
  (`cleanUpiText`), so the approved text is the text in every `upi://` link. One open request per masjid: checked, and
  enforced by the partial unique index (a mutation without the check still passes — the index holds).
  `PAYMENT_UNCHANGED` refuses a request equal to the active details. Suspended / deleted masjids cannot request.
- **Activation** (system job, ≤ 50 per run, one transaction each, idempotent): previous active → `superseded`, then
  active; version bump; when the masjid is public an **important** announcement from the **system template
  `payment_details_updated`** (category general, audience everyone) with an outbox job `bypass_quota: true`. A masjid
  that is not public gets no notice (nobody can see it; it is hidden with the masjid).
- That notice is **locked**: `editItem` / `deleteItem` refuse it (`ITEM_LOCKED`) — a compromised admin account must not
  be able to hide the change from followers.
- Bundle `payment` = `v_pub_payment_profiles` (active only, public masjids only) `{vpa, payeeName, effectiveAt}`.
**Consequences:** 18 starter templates (texts in 4 locales, drafts for review — O31); the template must be active in
each environment (Super Admin "Add starter templates", as for `timings_updated`).

### #147 — Admin UPI-QR scan: allow the WebAssembly QR reader on the admin origin? (PHASE_05 T5.2, B8) — ACCEPTED: option B (owner, 9 Nov 2026)
**Context:** B8 lets the admin scan the masjid's existing UPI QR (`parseUpiUri`). The QR camera code moved from the app
to `@mc/ui/scanner` (shared). Phones without a native `BarcodeDetector` (every iPhone, desktop) need the self-hosted
WebAssembly reader (#94), which needs CSP `script-src 'wasm-unsafe-eval'` — today only on the app origin. #94 said
"admin unchanged until it scans UPI QRs (Phase 5)". Loosening the admin CSP is an owner decision (CLAUDE.md §4).
**Options:**
- **A — add `'wasm-unsafe-eval'` to the admin CSP** (compiling WebAssembly only; JS `eval` stays blocked, Trusted
  Types unchanged — the same as the app since #94). Scan works on every phone.
- **B — native detector only on admin (built now, no CSP change).** Android Chrome scans; on iPhone / desktop the
  "Scan UPI QR" button is not offered and the admin types the UPI ID (the payee name is still checked by the Super
  Admin and shown by every UPI app before paying).
- C — no scan at all; typing only.
**Recommendation:** B for now (nothing loosened; most masjid admins use Android); A later if iPhone admins ask.
**Decision (owner, 9 Nov 2026):** "Android-only scan for now" — option B as built: the admin CSP is unchanged; the
admin app imports only `@mc/ui/scanner` (native detector), never `@mc/ui/scanner/fallback`, so the WebAssembly reader
is neither bundled nor precached there. Revisit if iPhone admins ask.

### #148 — Donation campaigns: the data layer (PHASE_05 T5.3) — ACCEPTED (Claude Code, 9 Nov 2026)
**Context:** 00 §4.3 campaign rules; 02 items.campaign + campaign_amount_history.
**Decision:**
- `state/campaigns.ts`: `createCampaign` (needs the masjid's **active** UPI details — their id is recorded as
  `payment_profile_id`; target ≥ ₹1,000; ≤ 3 active — creates that race are serialized by the version bump on the
  masjid document, test with three parallel creates), `updateCampaign` (title, description, cover, end date; the target
  **only upward**, audited `target_raised`), `setCampaignReceived` ("Update amount": an append-only history row with who
  and when; allowed while active **or completed**; not once closed; notify optional), `completeCampaign`,
  `closeEndedCampaigns` (system: `ends_on < today` → closed, one transaction per masjid).
- **"Completed" is the admin's choice, not automatic at the target** (00 §4.3 lists both; amounts often keep coming,
  and the bar caps at 100 % while the text shows the real figure). A completed campaign keeps Donate Now until it
  closes.
- Audit meta carries no amounts (`campaign.create` {purpose, notify}, `.update` {fields, target_raised},
  `.received` {notify}, `.complete`).

### #149 — Donation campaigns for musallis: QR library, Donate Now, list rules, the Delta seed masjid (PHASE_05 T5.4) — ACCEPTED (Claude Code, 10 Nov 2026)
**Context:** 07 A10, 08 §5.7, 01 §4 (QR generate: `qrcode`), CLAUDE.md §6 dependencies (no package without a release in
18 months; a runtime dependency of the apps needs an entry with its bundle cost).
**Decision:**
- **QR generator `lean-qr` 2.7.4 (MIT, no dependencies, released 7 Sep 2026) instead of `qrcode`** — `qrcode`'s last
  release is 1.5.4 (5 Aug 2024, > 18 months) and it pulls `yargs` + `pngjs`. We use the nano encoder (a UPI link is ASCII
  once percent-encoded) at error correction ≥ M and `toSvgPath` (one React `<path>` — no `innerHTML`, Trusted Types
  untouched). It lives in `@mc/ui/qr` and loads only with the UPI QR sheet: the sheet chunk is **4.2 kB gzip**; the
  musalli initial JS is 187.85 / 188 kB (+0.2 kB: the shared bundle hook and donation components). Proven by decoding
  every generated code with the ZXing reader we already ship (`packages/ui/test/qr.test.tsx`, offline .wasm), incl.
  non-Latin payee names (fast-check sample). 01 §4 updated.
- **Donate Now** clicks a temporary `<a href="upi://pay?…">` inside the tap (the link from `buildUpiUri` with the
  masjid's **live** bundle `payment`, note = campaign title), shows "Opening your UPI app…", and opens the QR sheet when
  the page was neither hidden nor blurred within 1.5 s. An anchor (not `location.href`) so e2e can intercept the exact
  link in every engine (a capture-phase listener; custom schemes never reach `page.route`). No UPI details in a cached
  bundle → no buttons, "UPI details are not available right now".
- **Closed campaigns stay listed 30 days after their end date** — a display rule in the app (`campaignsForList`), not a
  server filter: the feed is immutable per content version, so a date-dependent server filter would serve stale pages.
  The detail still opens from a link. List order: active → completed → closed, newest first in each.
- **"Payment details changed on …"** shows in the QR sheet for 30 days after `bundle.payment.effectiveAt` (also after a
  masjid's first activation — the bundle cannot tell; harmless) plus a standing "your UPI app shows the name before you
  pay — make sure it says <payee>" hint (04 R1: the name is the last line of defence).
- Bundle `campaigns` = the active campaigns' public ids, newest first (≤ 3; 03 "active campaigns summary").
- The item detail now takes a cached item from the **newest** content version that lists it (a campaign's amount
  changes under the same public id).
- **Dev seed: a 4th masjid "Test Masjid Delta" (`TESTD004`)** with active fake UPI details (10 §5 `testmasjid@okexample`,
  payee "Test Masjid Delta Committee", changed 10 days before the seed time) and five campaigns (2 active, completed
  above goal, closed 10 days ago, closed 40 days ago). No earlier spec or visual baseline follows it, so they are
  unchanged; staging gets demo data. The re-seed writes the UPI details only while no other profile is active for Delta
  (someone may try the change-lock there).
**Consequences:** `e2e/app/campaigns.spec.ts` (9 on Pixel 7 locally; WebKit runs in CI — this PC's WebKit cannot load
these screens reliably, the known "style-src-elem … ?:5" error page). Visual baselines for A10 come with T5.6/T5.7.
