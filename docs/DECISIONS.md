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

### #21 — Hosting: VPS + Docker Compose + Caddy + Cloudflare — ACCEPTED
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

---

## OPEN

_None._
