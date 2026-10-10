# 01 — Architecture

> Binding technical design. Rationale for the big choices is in `DECISIONS.md` (#1–#26; stack = Revision 2: React/Vite + Node/Express + MongoDB Atlas on a VPS).
> **Before coding against any library or service listed here, verify its current API in the official docs** (CLAUDE.md §4.2). Use the latest stable versions at Phase 0 and pin them.

## 1. System overview

```
                     ┌──────────────── Cloudflare (DNS · TLS · CDN cache · WAF · DDoS) ────────────────┐
 Musalli phone       │  app.<domain>                                   admin.<domain>                   │   Admin phone
 ┌──────────────┐    │  cache: static assets, versioned /api/v1 GETs   no API caching                   │   (passkey)
 │ PWA (apps/app)│───▶│                                                                                  │◀── ┌──────────┐
 │ IndexedDB     │    └───────────────┬──────────────────────────────────────────┬───────────────────────┘    │ Admin PWA │
 │ Service Worker│◀─push──┐           │ HTTPS (Authenticated Origin Pulls,       │                            └──────────┘
 └──────────────┘         │           │ origin firewall = Cloudflare IPs only)   │
                          │  ┌────────▼──────────────── VPS (Mumbai) · Docker Compose ───▼──────────────────────────┐
                          │  │  caddy ── static: apps/app/dist, apps/admin/dist (security headers, cache headers)    │
                          │  │    ├── app.<domain>/api/v1/*    → api-public  (×2)   MongoDB user mc_public           │
                          │  │    └── admin.<domain>/api/admin/*, /api/super/*, /api/hooks/*                          │
                          │  │                                 → api-admin   (×2)   MongoDB user mc_admin            │
                          │  │  worker (BullMQ: push fan-out, send batches, schedules, retention)  user mc_system    │
                          │  │  redis (private network only; ACL users; AOF)  ← rate limits, challenges, job queues  │
                          │  └──────────────┬───────────────────────────────────────────────┬────────────────────────┘
                          │                 │ TLS, IP access list = VPS static IP          │
                          │      ┌──────────▼────────────────────────────┐        ┌────────▼───────────────┐
                          │      │ MongoDB Atlas (AWS ap-south-1 Mumbai)  │        │ Cloudinary (free plan)  │
                          │      │ replica set · custom roles · views ·   │        │ sanitized images via    │
                          │      │ Continuous Backup (PITR)               │        │ media.<domain> + CF     │
                          │      └────────────────────────────────────────┘        │ encrypted legal docs    │
   Push services (FCM / APNs / Mozilla) ◀── web-push (VAPID) ── worker              └─────────────────────────┘
   YouTube (bayans): api-admin checks oEmbed + copies the thumbnail; phones load the youtube-nocookie
     embed only after the user taps Play (DECISIONS #39). Log archive: on the VPS, encrypted, 200 days (#40)
   Cloudflare Turnstile (invisible) ◀── device registration, reports, grievances
   Sentry (errors, PII-scrubbed)
```

## 2. Domains & origins

| Origin | Serves | Notes |
|---|---|---|
| `app.<domain>` | Musalli PWA + `/api/v1/*` + `/m/:code` + `/p/:id` | Public. Cookie-less. Device bearer auth. Cloudflare caches static assets + versioned API GETs. |
| `admin.<domain>` | Admin + Super Admin PWA + `/api/admin/*`, `/api/super/*`, `/api/hooks/*` | Passkey RP ID = `admin.<domain>`. `__Host-` session cookie. Not linked from the public app. `noindex`. Cloudflare "bypass cache" for `/api/*`. |
| `media.<domain>` | Processed public images: Caddy route proxying an allow-listed path to Cloudinary, cached by Cloudflare (DECISIONS #40) | Immutable, random keys. Never serves HTML. |
| `<domain>` | Tiny static landing (what is this, legal pages, grievance officer details, Play Store link) | Served by the same Caddy (static folder). |
| `app-staging.<domain>`, `admin-staging.<domain>`, `media-staging.<domain>` | Staging VPS / staging Cloudinary folder | Stable staging hosts (passkeys need a real RP domain). `noindex`. |

Two separate service-worker scopes, two manifests, two installable apps. There are **no** `/api/jobs/*` HTTP routes: background jobs run only inside the `worker` container (not reachable from the internet).

## 3. Repository layout

```
masjid-connect/
├─ CLAUDE.md
├─ .claude/                    # agents, commands, settings
├─ docs/                       # specs (this folder)
├─ apps/
│  ├─ app/                     # Musalli PWA (Vite + React) → static build only
│  │  ├─ public/               # icons, manifest assets, offline.html
│  │  ├─ src/
│  │  │  ├─ app/               # router, providers, shell (tab bar, stack navigator)
│  │  │  ├─ features/          # onboarding, home, masjids, masjid-detail, timings, updates,
│  │  │  │                     # announcements, daily-content, dua, donations, chanda, videos,
│  │  │  │                     # qibla, scan, settings, legal, install, notifications
│  │  │  ├─ lib/               # api client, device store (IndexedDB), push, platform detect
│  │  │  └─ sw/                # service worker source (Workbox injectManifest)
│  ├─ admin/                   # Admin + Super Admin PWA (same structure; features: auth, home,
│  │                           # timings, notices, daily-content, dua, campaigns, chanda, videos,
│  │                           # profile, super/*)
│  └─ server/                  # Node entrypoints (no business logic here):
│     ├─ src/public.ts         #   starts api-public  (createPublicApp from packages/api)
│     ├─ src/admin.ts          #   starts api-admin   (createAdminApp)
│     ├─ src/worker.ts         #   starts worker      (BullMQ processors + schedulers)
│     └─ src/migrate.ts        #   runs DB migrations (one-off container)
├─ packages/
│  ├─ api/                     # Express apps: createPublicApp, createAdminApp; routers, services,
│  │                           # middleware, jobs/ (processors), hooks/ (webhooks), openapi
│  ├─ db/                      # MongoDB clients per process, schema (Zod → $jsonSchema), policy
│  │                           # table, scoped repositories, transactions helper, migrations/,
│  │                           # migration runner, roles/views definitions
│  ├─ domain/                  # PURE logic: prayer, hijri, qibla, upi, money, follow-code,
│  │                           # time (IST), text (sanitize/limits), audience
│  ├─ shared/                  # Zod schemas (API contracts), error types, env schema, brand, constants
│  ├─ ui/                      # tokens, Tailwind preset, components, motion presets, icons
│  ├─ i18n/                    # locales/{en,hi,ur,te}/*.json, legal/{locale}/*.md, formatters, typed keys
│  └─ config/                  # tsconfig bases, eslint config, vitest base, playwright base
├─ infra/
│  ├─ docker/                  # Dockerfiles (multi-stage, distroless/alpine, non-root), .dockerignore
│  ├─ compose/                 # docker-compose.dev.yml (mongo replset+auth, redis),
│  │                           # docker-compose.staging.yml, docker-compose.prod.yml
│  ├─ caddy/                   # Caddyfile per env (routing, headers, static cache rules)
│  ├─ mongo/                   # roles.ts + views.ts (single source → local createRole & Atlas Admin API)
│  ├─ cloudflare/              # documented settings: cache rules, WAF rules, origin pulls (as code/JSON)
│  └─ vps/                     # provisioning + hardening script (cloud-init/bash), firewall refresh,
│                              # backup/log-ship scripts, systemd timers
├─ e2e/                        # Playwright specs, fixtures, visual baselines
├─ load/                       # k6 scripts (Phase 4/9)
├─ scripts/                    # i18n-check, bundle secret scan, bootstrap-super-admin, import-library,
│                              # seed-dev, seed-staging, db-verify-roles
├─ .github/workflows/          # ci.yml, deploy-staging.yml, deploy-prod.yml, nightly.yml
├─ turbo.json · pnpm-workspace.yaml · package.json · .env.example · renovate.json
```

## 4. Technology choices (pin exact versions at Phase 0)

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js current **Active LTS** | Same major in `.nvmrc`, `engines`, Docker base image, CI |
| Package mgmt | pnpm workspaces + Turborepo | Remote cache optional |
| Language | TypeScript (strict, see CLAUDE.md §6) | Server built with `tsup`/`tsc` to ESM; dev with `tsx watch` |
| SPA | React 19 + Vite | `@vitejs/plugin-react` (SWC) |
| Routing | TanStack Router (file-based, type-safe search params) | Custom stack transitions (08_MOTION) |
| Server state | TanStack Query v5 + `persistQueryClient` (IndexedDB via `idb-keyval`) | Offline-first reads |
| Styling | Tailwind CSS v4 with tokens from `packages/ui` | Logical properties only |
| Motion | Motion (`motion/react`) with `LazyMotion` + `domAnimation` features (`m.*` components) | Budgeted |
| Icons | Phosphor Icons (React, tree-shaken; regular + fill weights) | Mosque, HandsPraying, etc. |
| Forms | React Hook Form + Zod resolver | Admin app |
| PWA | vite-plugin-pwa (`injectManifest` strategy) + Workbox modules | Custom SW for push |
| API | **Express 5** + a small typed `defineRoute()` helper (Zod request/response schemas, auth, rate-limit bucket, OpenAPI registration) | Express 5 for native async error handling; `query parser: 'simple'` |
| OpenAPI | `@asteasolutions/zod-to-openapi` (verify Zod 4 support) or Zod 4 native JSON Schema + small registry | Committed `openapi.json`, CI diff |
| HTTP hardening | `helmet` (configured to the exact headers in 04 §7), custom CSRF/origin middleware, `express.json` with strict limits | |
| Logging | `pino` + `pino-http` (redaction paths) | JSON to stdout |
| DB | **MongoDB Atlas** 8.x (AWS ap-south-1), replica set | Transactions, `$jsonSchema` validators, custom roles, views |
| DB driver | Official `mongodb` Node.js driver (no ODM — DECISIONS #25) | UUID `_id`s (#22) |
| Migrations | In-house runner in `packages/db/migrations` (`NNNN_name.ts` with `up()`; applied list + checksum in `_migrations`; lock document) | Creates collections, validators, indexes, views |
| Passkeys | SimpleWebAuthn (`@simplewebauthn/server` + `/browser`) | |
| Rate limit / ephemeral | **Redis 7+** (self-hosted container) + `rate-limiter-flexible` (sliding/fixed window) | Challenges (GETDEL), rate limits, idempotency keys |
| Jobs | **BullMQ** (queues, retries/backoff, job schedulers) + MongoDB outbox | `worker` container only |
| Push | `web-push` (VAPID) | `worker` only |
| Video | **YouTube links** (DECISIONS #39): oEmbed check, copied thumbnail, `youtube-nocookie.com` embed after tap | No video hosting, no player library |
| Images | `sharp` sanitize/re-encode → **Cloudinary** signed server-side upload (DECISIONS #40) | Named transformations 480/960/1440 × AVIF/WebP; strict transformations ON |
| Multipart | `busboy` (streaming, hard limits) | Admin image uploads only |
| QR generate | `qrcode` (SVG output) | Posters, UPI QR |
| QR scan | `BarcodeDetector` where available, else `qr-scanner` (lazy) | |
| Prayer times | `adhan` (adhan-js) | Wrapped in `packages/domain/prayer` |
| Bot protection | Cloudflare Turnstile (invisible/managed) | Server verifies token |
| Errors | Sentry (browser + node), PII scrubbing | `sendDefaultPii: false` |
| Web server / TLS | **Caddy 2** (reverse proxy, static files, headers) behind **Cloudflare** | Cloudflare Origin CA cert, Authenticated Origin Pulls |
| Containers | Docker Engine + Docker Compose v2 | Images in GHCR, pinned by digest |
| Testing | Vitest, Supertest, Testing Library, Playwright, MSW, fast-check, Lighthouse CI, size-limit, axe-core, k6; MongoDB + Redis via Docker for DB/integration tests | See 10_TESTING |
| CI/CD | GitHub Actions (build, test, image build, Trivy scan, SSH deploy with approvals) | Required checks on `main` |

**Rejected:** Next.js (DECISIONS #5), Mongoose (#25), self-hosting MongoDB on the VPS (#6), serverless hosting (owner chose VPS — #21), Firebase (vendor lock-in), payment gateways (#11), analytics SDKs (#17).

## 5. Runtime design

### 5.1 Processes, DB users & the scoped data layer (DECISIONS #7, #20)
- Each Node process creates **one** `MongoClient` at boot (module scope): `maxPoolSize: 20` (api) / `30` (worker), `minPoolSize: 2`, `maxIdleTimeMS: 60000`, `serverSelectionTimeoutMS: 5000`, `retryWrites: true`, `retryReads: true`, write concern `majority`, `appName` = process name, TLS required. Graceful shutdown closes it (`SIGTERM` → stop accepting → drain ≤ 10 s → close).
- MongoDB users (definitions in `infra/mongo/roles.ts`; applied locally with `createRole`/`createUser`, on Atlas via the Atlas Admin API/CLI or documented UI steps):
  - `mc_public` — used by `api-public` only. `find` on the **public views** only; read/write on device-owned collections (02 §4.1).
  - `mc_admin` — used by `api-admin` only. Read/write on content/admin collections, `insert`+`find` only on append-only collections, no access to `devices`.
  - `mc_system` — used by `worker` and one-off scripts (bootstrap, seed-staging). Broad read/write incl. purge.
  - `mc_migrator` — used only by the migration container in CI deploys (collMod, createIndex, create views). Never present in a running app container.
- **Every** DB call goes through a scoped repository in `packages/db`: `withScope(scope, fn)` where `scope` is one of `publicScope()`, `deviceScope(deviceId)`, `adminScope({adminId, masjids: [{id, role}]})`, `superScope(adminId)`, `hookScope(name)` (reserved for inbound webhooks with narrow policy cells; none in v1 since Bunny was dropped — DECISIONS #39), `systemScope()`. The **policy table** (02 §4) supplies the filter, projection and writable-field allow-list for each (collection × scope × operation); a missing cell throws `PolicyDeniedError`. Multi-document writes use `withTransaction(scope, fn)` (driver `session.withTransaction`, `readConcern: majority`, `writeConcern: majority`).
- `systemScope()` may only be imported from `packages/api/src/jobs/**` (runs in `worker` with `mc_system`) and `scripts/**`; `hookScope()` only from `packages/api/src/hooks/**` (runs in `api-admin` with `mc_admin`) — enforced by ESLint `no-restricted-imports` + Semgrep. Raw driver imports (`mongodb`) are banned outside `packages/db`.
- Verify in T1.1 that Atlas custom roles can grant privileges on **views** without privileges on the source collections; if not, record an OPEN decision (fallback: `mc_public` gets `find` on source collections and the policy layer projections become the only filter — weaker, needs owner sign-off).

### 5.2 Caching strategy (DECISIONS #8)
| Resource | Endpoint | CDN `Cache-Control` | Client |
|---|---|---|---|
| Versions of followed masjids | `GET /api/v1/masjids/versions?ids=…` (≤ 20 ids, sorted) | `public, s-maxage=15, stale-while-revalidate=60` | Polled on app focus + every 60s while visible |
| Masjid bundle (profile, timings, special dates, ramadan, payment profile, active campaigns, chanda summary) | `GET /api/v1/masjids/:id/bundle?v=` | `public, max-age=31536000, immutable` when `v` matches current; if `v` stale → 302 to current `v` with `s-maxage=15` | TanStack Query, persisted |
| Feed page | `GET /api/v1/masjids/:id/feed?v=&type=&aud=&cursor=` | immutable when `v` present | Infinite query, persisted first page |
| Item detail | `GET /api/v1/items/:publicId?v=` | immutable with `v` | |
| Images | `media.<domain>` key with content hash in name | `immutable` | SW CacheFirst (max 300 entries, 30 days) |
| App shell | Vite hashed assets (served by Caddy) | `immutable` | Precached by SW |
| `index.html`, `sw.js`, manifest | | `no-cache` | |

- Cloudflare: Cache Rules make `app.<domain>/api/v1/*` GETs "eligible for cache" and **respect origin cache headers** (`s-maxage`), cache key **includes the full query string**; `admin.<domain>/api/*` and all non-GET requests bypass cache. Configuration lives in `infra/cloudflare/` and is verified by an automated header test against staging.
- Every cacheable public response carries `Cache-Tag: m-<masjidId>[, i-<publicId>]`.
- The version bump happens in the **same MongoDB transaction** as any publish/edit/delete/removal (done by the data layer — 02 §5), so caches can never serve removed content past the version check. Takedown additionally purges the CDN for the removed item (by cache tag; if the account's plan cannot purge by tag, purge by URL for each version URL from the item's first published version to the current one — the server can enumerate them) via a `cdn-purge` worker job.

### 5.3 Push pipeline (DECISIONS #9)
1. Admin publishes → API writes item + `notification_jobs` document (`pending`, the **outbox**) + quota increment + version bump in one transaction → after commit, enqueues BullMQ job `push-fanout {jobId}` with `jobId` as the BullMQ job id (dedup).
2. `push-fanout` (worker): load job; stop if `app_settings.push_paused`; set `running`; page through `device_follows` where `masjid_id = X, muted = false, push_active = true, audience_pref ∈ audienceTargets` ordered by `device_id` (keyset pagination, 1,000 per page, single compound index — 02 §2); for each page group by `locale` and enqueue `push-send-batch {jobId, page, locale, deviceIds[]}` (BullMQ job id = `${jobId}:${page}:${locale}`).
3. `push-send-batch`: load push endpoints for the device ids from `devices` (one `$in` query); send with concurrency 50, `TTL` 86400 (announcement) / 43200 (others), `Urgency: high` for important/inteqal else `normal`, `Topic` = item public id (collapses). Handle responses: 201 ok; 404/410 → mark subscription dead (device `push_status='dead'` + follows `push_active=false`, one transaction); 429/5xx → throw for BullMQ retry (exponential backoff, 5 attempts) — already-sent endpoints in that batch are recorded in a Redis set (`push:sent:<jobId>`, 24h TTL) so retries never double-send; 413 → log (payload bug).
4. Update counters `sent/failed/pruned` (`$inc`); job `completed` when all batches done (pending-batch counter reaches 0).
5. Payload (≤ 3 KB): `{ v:1, t:"<title>", b:"<body>", u:"/items/<publicId>", m:"<masjidId>", cv:<contentVersion>, tag:"<publicId>", i:"<icon url>" }`. Title/body localized at fan-out per device locale (batches are grouped by locale).
6. The service worker **always** shows a notification for every push (required by browsers); it never silently drops one.
7. **Outbox sweeper** (every minute): re-enqueues `notification_jobs` still `pending` after 2 minutes; **stuck-job detector**: `running` with no progress for 10 min → `failed` + Super Admin alert.

### 5.4 Bayan videos — YouTube links (DECISIONS #39; replaces the Bunny pipeline of #10)
1. Admin pastes a link → the admin app parses it client-side for instant feedback → `POST /api/admin/videos` (link, title, speaker, description, audience, language).
2. `api-admin` re-parses strictly (allowed hosts/paths only, 11-char id `[A-Za-z0-9_-]{11}`, optional start seconds) and stores **only** `youtube_id` + `start_s` — never the pasted URL.
3. Server calls YouTube oEmbed (fixed host, URL built from the validated id, 5 s timeout) → title pre-fill; private/deleted/embedding-disabled → `422 VIDEO_UNAVAILABLE`.
4. Server fetches `https://i.ytimg.com/vi/<id>/hqdefault.jpg` (fixed host; size/type limits) → the normal image pipeline (§5.5) → Cloudinary; stores `thumb_key` + thumbhash.
5. Item published immediately (no processing state) → outbox + push, audience-filtered.
6. Musalli: card with our thumbnail + play button (facade). Only on tap: `<iframe src="https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0&playsinline=1[&start=n]" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin">`. No Google request before the tap; CSP `frame-src https://www.youtube-nocookie.com` only.


### 5.5 Images
Upload → `api-admin` (admin only, `busboy` with 10 MB hard limit) → magic-byte check (JPEG/PNG/WebP/HEIC) → `sharp` decode (limit input pixels 40 MP) → strip metadata → resize to 3 widths (480/960/1440) → re-encode one sanitized master (max 1440 px) → compute a **thumbhash** (≈ 25 bytes, base64) for the blurred placeholder → signed server-side upload to Cloudinary as `m/<masjidId>/<random-uuid>` → DB stores the key + thumbhash (`*_thumbhash` next to every `*_key` field). Original discarded (never written to disk; processed in memory with limits).
Delivery (DECISIONS #40): `media.<domain>/i/<480|960|1440>/<avif|webp>/<key>` → Caddy (path allow-list) → Cloudinary named transformation → Cloudflare cache `public, max-age=31536000, immutable`, so musalli IPs never reach Cloudinary and most views cost no credits. Cloudinary **strict transformations** ON (no ad-hoc sizes). Legal-order documents: AES-256-GCM encrypted in `api-admin`, stored as Cloudinary `raw` + `authenticated`, downloaded and decrypted server-side only.

### 5.6 Offline & service worker (apps/app)
- Precache app shell + locale JSON for the active locale + active locale font subset.
- Runtime: images CacheFirst; versioned API GETs CacheFirst (they're immutable); versions endpoint NetworkFirst (3s timeout) → cache fallback; everything else NetworkOnly.
- TanStack Query persisted to IndexedDB (max age 30 days) so Home renders instantly offline.
- Offline banner (subtle, top) when `navigator.onLine === false` or requests fail; writes queued only for Ameen (Background Sync where supported; otherwise retried on next open).
- Update flow: new SW `waiting` → toast "Update available — Refresh" → `postMessage(SKIP_WAITING)` → reload at a safe moment. Never auto-reload while a sheet/form is open.
- `navigator.storage.persist()` requested after first follow.
- Admin app SW: precache shell only; **never cache `/api/*`**.

### 5.7 On-device computation (packages/domain)
- `prayer`: wrap `adhan` → `computeDay(coords, date, method, madhab, adjustments) → {fajr, sunrise, dhuhr, asr, maghrib, isha}` in IST `HH:mm`; `resolveSchedule(masjidConfig, date) → {adhan, jamaat}[]`; `nextJamaat(schedule, now)`.
- `hijri`: `toHijri(date, offset, afterMaghrib)`.
- `qibla`: `bearingToKaaba(lat, lng)`, `distanceToKaaba(lat, lng)`, `headingFromOrientationEvent(event, screenAngle)`.
- `upi`: `isValidVpa`, `buildUpiUri({vpa, payeeName, note})`, `parseUpiUri(string)` (for admin QR scan).
- `money`: paise ↔ display with Indian grouping (`₹1,00,000`).
- `followCode`: generate/normalize/validate Crockford Base32 codes.

### 5.8 Background jobs (worker, BullMQ)
| Queue / job | Trigger | Idempotency |
|---|---|---|
| `push-fanout` | API after publish commit; outbox sweeper | job status in MongoDB; BullMQ job id = notification job id |
| `push-send-batch` | from fanout | BullMQ job id `(jobId, page, locale)` + Redis sent-set |
| `payment-activate` | scheduler every 10 min | state machine (02 §2 Payments) |
| `campaign-close` | scheduler daily 00:10 IST | state machine |
| `retention` | scheduler daily 03:00 IST | per-collection batches |
| `sla-alerts` | scheduler every 15 min | one alert per (target, threshold) recorded |
| `outbox-sweeper` | scheduler every 1 min (also runs the stuck-job detector) | status check |
| `report-triage` | scheduler every 1 min | sends the immediate Super Admin alert for each new urgent report and auto-hides an item once ≥ `report_autohide_threshold` distinct devices reported it within 1 h (the public API may only insert reports, so this runs in the worker); one alert/hide per report/item, recorded |
| `cdn-purge` | moderation removal | idempotent (purge is) |
| `alert-send` | admin/super-admin alert pushes | (alertId) |
| `media-delete` | retention, moderation | (Cloudinary key) — destroy + invalidate, then Cloudflare purge |
| `cloudinary-usage` | scheduler daily 06:00 IST | alert at 70% / 90% of monthly credits, once per (month, threshold) |
| `stats-snapshot` | scheduler hourly (writes `stats_snapshots` + `masjid_stats.ameens_7d`) | (hour) |
| `counters-reconcile` | scheduler weekly (Sun 04:00 IST) | recompute, idempotent |
Schedulers use explicit time zone `Asia/Kolkata`. Each processor has a timeout, max attempts, exponential backoff, and writes failures to Sentry + structured logs. Queue health (waiting/active/failed counts, oldest job age) is exposed to Super Admin Stats.

### 5.9 VPS layout & deployment (DECISIONS #21)
- Compose project per environment; networks: `edge` (caddy ↔ apis) and `internal` (apis/worker ↔ redis). Redis is on `internal` only, no published port. Only Caddy publishes 80/443.
- Containers: non-root user, `read_only: true` + tmpfs `/tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, CPU/memory limits, healthchecks (`/api/v1/health`, `/api/admin/health`, worker heartbeat key in Redis), `restart: unless-stopped`.
- Rolling deploy: pull new digests → run `migrate` one-off container (only on deploys with new migrations; manual approval in prod) → restart replicas one at a time waiting for healthy → smoke test → done. Rollback = previous digest (kept in `deploy/releases.log`).
- Secrets: per-process env files on the VPS (`/etc/masjid-connect/<env>/<process>.env`, mode 600, root-owned), never in the repo or images; injected via `env_file`.

## 6. Environments

| Env | Frontend & API | DB | Redis / Jobs | Storage | Video |
|---|---|---|---|---|---|
| local | Vite dev servers; `api-public` :8787, `api-admin` :8788, `worker` via `tsx watch`; Vite proxy `/api` | Docker `mongo:8` single-node **replica set with auth** (roles + views applied by `db:reset`) | Docker Redis; BullMQ real; VAPID dev keys | filesystem adapter | YouTube oEmbed **mock** adapter by default |
| staging | Staging VPS (Mumbai) via Docker Compose; `app-staging.<domain>`, `admin-staging.<domain>` behind Cloudflare | Atlas project `mc-staging` (Mumbai) | Redis container on staging VPS | Cloudinary (staging folder) | YouTube links |
| production | Production VPS (Mumbai) | Atlas project `mc-prod` (Mumbai, M10+, Continuous Backup on) | Redis container on prod VPS | Cloudinary (prod folder) | YouTube links |

Passkeys require the real RP domain → device testing of admin login happens on staging (`admin-staging.<domain>`). Staging and production never share credentials, Atlas projects, buckets or VAPID keys.

## 7. Configuration (`packages/shared/src/env.ts`)
Per-process env sets (Zod-validated at boot; missing/invalid → refuse to start, listing names never values):
- **Common (all server processes):** `NODE_ENV`, `APP_ENV` (`local|staging|production`), `LOG_LEVEL`, `SENTRY_DSN`, `MONGODB_DB_NAME`, `APP_ORIGIN`, `ADMIN_ORIGIN`, `MEDIA_ORIGIN`, `TRUSTED_PROXY_MODE` (`cloudflare|none`).
- **api-public:** `MONGODB_URI_PUBLIC`, `REDIS_URL_PUBLIC` (ACL user `rl_public`), `TURNSTILE_SECRET`, `PORT`.
- **api-admin:** `MONGODB_URI_ADMIN`, `REDIS_URL_ADMIN` (ACL user `admin`), `SESSION_PEPPER`, `FIELD_ENCRYPTION_KEY` (AES-256-GCM, base64 32 bytes) + `FIELD_ENCRYPTION_KEY_ID` (+ old keys for rotation), `RP_ID`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (api-admin's own key), `TURNSTILE_SECRET`, `VAPID_PUBLIC_KEY`, `PAYMENT_HOLD_MINUTES` (≥ 1440 enforced in production), `PORT`.
- **worker:** `MONGODB_URI_SYSTEM`, `REDIS_URL_WORKER` (ACL user `worker`), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:), `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (the worker's own key), `CF_API_TOKEN_PURGE`, `CF_ZONE_ID`, `FIELD_ENCRYPTION_KEY*` (retention anonymization), `PAYMENT_HOLD_MINUTES`.
- **migrate (one-off):** `MONGODB_URI_MIGRATOR`.
- **Client (build time):** `VITE_PUBLIC_API_BASE`, `VITE_PUBLIC_VAPID_PUBLIC_KEY`, `VITE_PUBLIC_TURNSTILE_SITE_KEY`, `VITE_PUBLIC_SENTRY_DSN`, `VITE_PUBLIC_APP_ORIGIN`, `VITE_PUBLIC_MEDIA_ORIGIN`.
**Forbidden-variable boot assertion:** `api-public` must NOT have any of `MONGODB_URI_ADMIN`, `MONGODB_URI_SYSTEM`, `MONGODB_URI_MIGRATOR`, `CLOUDINARY_API_*`, `VAPID_PRIVATE_KEY`, `CF_API_TOKEN_PURGE`, `SESSION_PEPPER`, `FIELD_ENCRYPTION_KEY*`. `api-admin` must NOT have `MONGODB_URI_SYSTEM`, `MONGODB_URI_MIGRATOR`, `MONGODB_URI_PUBLIC`, `VAPID_PRIVATE_KEY`, `CF_API_TOKEN_PURGE`. `worker` must NOT have `MONGODB_URI_PUBLIC`, `MONGODB_URI_ADMIN`, `MONGODB_URI_MIGRATOR`, `SESSION_PEPPER`. Each assertion is unit-tested.

## 8. Scalability targets (design for, then load-test in Phase 9)
- 10,000 masjids · 10 lakh (1M) devices · 50 lakh follows.
- Peak read: 2,000 req/s (Jumu'ah/Ramadan Iftar spikes) — ≥ 95% served from the Cloudflare cache.
- Push: a 50,000-follower masjid fully dispatched in < 3 minutes.
- MongoDB: all hot queries index-backed (`explain('executionStats')` in tests for the 10 hottest queries: `IXSCAN`, no `COLLSCAN`, `totalDocsExamined` ≤ 2× `nReturned`), p95 < 20 ms.
- Origin capacity: production VPS (start ≥ 4 vCPU / 8 GB RAM) must sustain 300 req/s of cache-miss traffic at p95 ≤ 150 ms; scaling path = more API replicas → bigger VPS → second VPS behind a Cloudflare load balancer (stateless APIs; Redis moves to a managed/primary node).

## 9. Performance budgets (CI-enforced)
| Metric (musalli app, Moto G-class profile, "Slow 4G" throttling in Lighthouse) | Budget |
|---|---|
| Initial JS (gzip) for `/` route | ≤ 170 KB |
| Any lazy route chunk (gzip) | ≤ 60 KB |
| Initial CSS (gzip) | ≤ 25 KB |
| Fonts on first load | Only active-locale subset(s), `font-display: swap`, ≤ 120 KB (Urdu Nastaliq lazy ≤ 350 KB, loaded only for `ur`) |
| LCP (cold) | ≤ 2.5 s |
| LCP (warm, SW) | ≤ 1.0 s |
| INP | ≤ 200 ms |
| CLS | ≤ 0.05 |
| Lighthouse Performance / Accessibility / Best Practices | ≥ 90 / ≥ 95 / ≥ 95 |
| Animation | 60 fps under 4× CPU throttle; no long tasks > 50 ms during transitions |
| API p95 (server time, cache miss) | ≤ 150 ms |
Admin app budgets: initial JS ≤ 220 KB, others same. Compression: Caddy serves pre-compressed `br`/`gzip` static assets (built at CI) and compresses API JSON.

## 10. Observability
- Sentry: release tagging, source maps uploaded (not served publicly), PII scrubber (strip query strings, auth headers, IPs), sample rates: errors 100%, traces 5%. One Sentry project per process type (app, admin, api, worker) or tags.
- Structured logs (pino JSON) with request id; Docker log rotation; daily encrypted archive on the VPS kept 200 days (≥ 180 required by CERT-In), included in VPS backups (DECISIONS #40).
- Health: `GET /api/v1/health` and `GET /api/admin/health` (MongoDB ping, Redis ping, build version); worker heartbeat. External uptime monitor on both (Phase 9).
- VPS: disk/CPU/memory alerts (provider monitoring or a lightweight agent), Docker container restart alerts, Atlas alerts (connections, oplog window, disk, slow queries).
- Dashboards (Super Admin "Stats"): push success rate, job queue lag & failed jobs, error rate, storage usage.

## 11. Cost guardrails (verify current vendor pricing before launch)
Rough monthly order of magnitude at 1,000 masjids / 2 lakh devices: production VPS 4 vCPU/8 GB (~$25–50) + staging VPS 2 vCPU/4 GB (~$10–25), MongoDB Atlas M10 in Mumbai with backup (~$60–80; staging on the cheapest tier that supports custom roles + transactions), Cloudflare (free plan; Pro optional for more WAF rules), Cloudinary (free plan: 25 credits/month, no card; kept inside it by the Cloudflare cache — DECISIONS #40), YouTube for bayans (free — DECISIONS #39), Sentry (free tier), domain. Super Admin dashboard shows Cloudinary credits used.
