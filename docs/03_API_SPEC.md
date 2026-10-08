# 03 — API Specification

> Contracts are Zod schemas in `packages/shared/src/contracts/**`, shared by server and client. Routes are Express 5 routers whose every route is declared through the typed `defineRoute({ method, path, auth, rateLimit, request: {params, query, body, headers}, responses, handler })` helper in `packages/api/src/http/define-route.ts` — it validates input with the Zod schemas, applies auth + rate limit, and registers the route in the OpenAPI registry. Direct `router.get/post/...` calls outside the helper are banned by ESLint. The generated OpenAPI document is committed (`packages/api/openapi.json`) and diffed in CI.
> All responses JSON (`application/json; charset=utf-8`). Errors: RFC 9457 `application/problem+json` `{type, title, status, code, detail?, errors?[]}` with stable `code` strings (e.g. `FOLLOW_LIMIT_REACHED`) that the client maps to i18n messages.
> Every request gets `X-Request-Id` (generated if absent) echoed in responses and logs.

## 0. Cross-cutting middleware (order)
App settings: `app.disable('x-powered-by')`, `app.set('query parser', 'simple')` (no nested objects in query strings → no `?a[$ne]=` operator injection), `app.set('trust proxy', <Caddy hop only>)`, `strict routing`, `case sensitive routing`. Client IP (coarse rate limits only, **never stored or logged**) = `CF-Connecting-IP` when `TRUSTED_PROXY_MODE=cloudflare` (origin only accepts Cloudflare traffic — 04 §12), else the socket address.
1. Request id → 2. Security headers (04 §7, `helmet` configured exactly) → 3. Body parsing with size limit (`express.json({ limit: '32kb', strict: true })`, only `application/json` accepted on JSON routes → 415 otherwise; uploads use `busboy` on their own routes) → 4. Origin/CSRF check (admin) → 5. Auth (device / session) → builds the typed DB **Scope** → 6. Rate limit → 7. Zod validation → 8. Handler (all DB access through scoped repositories; multi-writes in `withTransaction`) → 9. 404 handler → 10. Error mapper (never leaks internals; Express 5 forwards async errors automatically).
Server timeouts: `requestTimeout` 15 s (uploads 120 s), `headersTimeout` 10 s, `keepAliveTimeout` 65 s (> Caddy idle), graceful shutdown on `SIGTERM`.

## 1. Auth schemes
- **Device** (public app): `Authorization: Device <deviceId>.<secret>` — secret is 32 random bytes base64url; server compares `sha256(secret)` to `devices.secret_hash` in constant time. Missing/invalid → 401 `DEVICE_AUTH_REQUIRED`.
- **Session** (admin app): cookie `__Host-mc_sess` (opaque 32-byte token; DB stores SHA-256 with pepper). Required header on all non-GET: `X-MC-CSRF: 1` and `Origin` must equal `ADMIN_ORIGIN`.
- **Step-up** (super admin sensitive ops): session `step_up_at` within 5 minutes, else 403 `STEP_UP_REQUIRED` → client runs a passkey assertion → retry.
- **Jobs**: not HTTP — BullMQ processors inside the `worker` container (01 §5.8); Redis is reachable only on the private Docker network with per-process ACL users.
- **Bunny** (hooks): shared secret / signature as per Bunny docs (verify current mechanism in Phase 6).

## 2. Rate limits (Redis via `rate-limiter-flexible`; key = device id / session id; IP used only as a coarse secondary key with generous limits because of CGNAT; Cloudflare WAF rate rules are an outer, coarser layer)
| Bucket | Limit |
|---|---|
| device register | 5 / hour / Turnstile-verified client + 300 / hour / IP |
| code resolve (`/masjids/resolve`) | 30 / min / device-or-IP |
| follow/unfollow | 60 / hour / device |
| ameen | 120 / hour / device |
| reports | 10 / day / device |
| grievances | 5 / day / IP + Turnstile |
| admin login options/verify | 10 / 10 min / IP, 20 / hour / credential |
| admin writes | 120 / hour / session |
| admin uploads (image/video create) | 30 / hour / masjid |
| super admin writes | 600 / hour / session |
Exceeded → 429 with `Retry-After`.

## 3. Public API — `app.<domain>/api/v1` (process: `api-public`, DB user `mc_public`)

| Method & path | Auth | Purpose | Cache |
|---|---|---|---|
| `GET /health` | – | `{ok, db, redis, version}` | no-store |
| `GET /config` | – | public settings: `{globalHijriOffset, maintenanceBanner, legalVersions, minClientVersion}` | s-maxage=60 |
| `POST /devices` | Turnstile | Register: body `{locale, audiencePref, platform, turnstileToken}` → `{deviceId, secret}` (secret returned once) | no-store |
| `PATCH /devices/me` | Device | Update `{locale?, audiencePref?}` | no-store |
| `PUT /devices/me/push` | Device | `{endpoint, keys:{p256dh, auth}}` (endpoint must be https and on an allow-listed push service host) | no-store |
| `DELETE /devices/me/push` | Device | Remove subscription | no-store |
| `DELETE /devices/me` | Device | Delete device + follows (Clear all data) | no-store |
| `GET /masjids/resolve/:code` | – (device optional) | Normalize code → `{masjid summary}` or 404 `MASJID_NOT_FOUND` (same response for suspended/pending) | s-maxage=300 |
| `PUT /devices/me/follows/:masjidId` | Device | Follow (idempotent) → 409 `FOLLOW_LIMIT_REACHED` at 20 | no-store |
| `PATCH /devices/me/follows/:masjidId` | Device | `{muted}` | no-store |
| `DELETE /devices/me/follows/:masjidId` | Device | Unfollow | no-store |
| `GET /devices/me/follows` | Device | Server copy (used to reconcile local store) | no-store |
| `GET /masjids/versions?ids=` | – | `{[id]: {v, status}}` for ≤ 20 ids | s-maxage=15, swr=60 |
| `GET /masjids/:id/bundle?v=` | – | Masjid profile, schedules (raw config — client resolves times), jumu'ah, special dates (next 60 days), ramadan, active payment profile `{vpa, payeeName}`, active campaigns summary, chanda (last 8 weeks if shown) | immutable w/ v |
| `GET /masjids/:id/feed?v=&type=&aud=&cursor=&limit=` | – | Paginated items (limit ≤ 30), `aud` ∈ brothers/sisters → returns everyone + that audience | immutable w/ v |
| `GET /items/:publicId?v=&aud=` | – | Full item incl. type detail + library content | immutable w/ v |
| `POST /items/:publicId/ameen` | Device | Idempotent (via `recordAmeen`); returns `{count}` | no-store |
| `GET /videos/:publicId/play?aud=` | Device | `{hlsUrl, expiresAt, posterUrl}` (token-signed, 2h) or `{youtubeId}` | private, no-store |
| `GET /library/:id` | – | Library entry (verified only) | s-maxage=86400 |
| `GET /templates` | – | Active notice templates (all locales) | s-maxage=3600 |
| `POST /reports` | Device + Turnstile | `{targetType, targetPublicId, reason, details?}` | no-store |
| `POST /grievances` | Turnstile | `{category, description, contact?}` → `{publicRef}` | no-store |
| `GET /legal/:doc/:locale` | – | Markdown → sanitized HTML for privacy/terms/grievance-officer/content-policy | s-maxage=3600 |

Non-API routes on the app origin: `/m/:code` (SPA route — landing/follow), `/p/:publicId` (SPA route — item landing). Both work for non-installed visitors. For link previews (WhatsApp), Caddy routes these two paths to `api-public`, which returns the built `index.html` with OpenGraph `<meta>` tags injected server-side (masjid name / item title only, HTML-escaped, no inline scripts; uniform generic tags for unknown codes) — `Cache-Control: public, s-maxage=300`.

## 4. Admin API — `admin.<domain>/api/admin` (process: `api-admin`, DB user `mc_admin`)

`GET /health` → `{ok, db, redis, version}` (no-store; container healthcheck + uptime monitor; no auth, reveals nothing else).

### Auth
| Method & path | Purpose |
|---|---|
| `GET /auth/invite/:token` | Validate invite (not consumed) → `{adminDisplayName, masjidNames[], purpose, uiLocale}`; uniform 404 for invalid/used/expired |
| `POST /auth/register/options` | `{inviteToken}` → WebAuthn creation options (rp, user handle = random 32 bytes stored per admin, `residentKey: required`, `userVerification: required`, `attestation: none`, exclude existing creds). Challenge stored in Redis 5 min keyed by invite |
| `POST /auth/register/verify` | `{inviteToken, response, label}` → verify, store credential, consume invite (single txn), create session, set cookie |
| `POST /auth/login/options` | → options with empty `allowCredentials` (discoverable), `userVerification: required`; challenge id in short-lived `__Host-mc_chal` cookie |
| `POST /auth/login/verify` | Verify assertion, update sign count (reject if non-zero counter goes backwards → lock credential + audit), create session (rotate), set cookie |
| `POST /auth/step-up/options` / `verify` | Same as login but bound to current session → sets `step_up_at` |
| `POST /auth/logout` | Revoke current session |
| `GET /auth/me` | `{admin, masjids[{id, name, role}], undertakingRequired}` |
| `POST /auth/undertaking` | `{version}` accept |
| `GET /auth/sessions` / `DELETE /auth/sessions/:id` | Own sessions |
| `PUT /auth/push` / `DELETE /auth/push` | Admin's own push subscription (status alerts; SLA alerts for super admin) |
| `GET /auth/passkeys` / `PATCH /auth/passkeys/:id` (label) | Own passkeys (cannot delete last one) |

### Masjid-scoped (`/masjids/:masjidId/...`, membership enforced)
| Resource | Endpoints |
|---|---|
| Profile | `GET /` · `PATCH /` (allowed fields only) · `POST /photo` (multipart ≤ 10 MB → re-encode) |
| Timings | `GET /timings` · `PUT /timings` (all five + jumu'ah atomically in one document, `If-Match: <rev>` → 412 on conflict, `notify` flag) · `GET /timings/preview?date=` (resolved times for a date) |
| Special dates | `GET /special` · `POST /special` · `PATCH /special/:id` · `DELETE /special/:id` |
| Ramadan | `PUT /ramadan` `{start, end, sehriPrecaution, iftarPrecaution}` |
| Items | `GET /items?type=&status=&cursor=` · `POST /items/announcement` · `POST /items/daily-content` · `POST /items/dua` · `PATCH /items/:id` (If-Match `updated_at`; ≤ 24h after publish) · `DELETE /items/:id` |
| Campaigns | `POST /campaigns` · `PATCH /campaigns/:id` · `POST /campaigns/:id/received` `{receivedPaise}` · `POST /campaigns/:id/complete` |
| Chanda | `GET /chanda` · `PUT /chanda/:weekStart` `{amountPaise, note?, notify}` · `PATCH /chanda/settings` `{show, weekStart}` |
| Payment | `GET /payment` (active + pending) · `POST /payment/requests` `{vpa, payeeName, note}` |
| Videos | `POST /videos` `{title, speaker?, description?, audience, locale, sizeBytes, durationSec, mimeType}` → `{videoPublicId, tus: {endpoint, signature, expire, libraryId, videoId}}` · `POST /videos/youtube` `{url, title, …}` · `PATCH /videos/:id` · `DELETE /videos/:id` · `GET /videos/quota` |
| Library/templates (read) | `GET /library?kind=&q=&category=&cursor=` · `GET /library/suggestion?kind=` · `GET /templates` |
| Notifications | `GET /notifications/quota` `{used, limit, resetsAt}` · `GET /notifications/jobs?cursor=` |
| Stats | `GET /stats` `{followers, itemsThisWeek, ameenThisWeek}` (`ameenThisWeek` from `masjid_stats.ameens_7d`, up to 1 h old) |
| Uploads | `POST /images` (multipart, purpose ∈ announcement/campaign) → `{imageKey, urls}` |

Publishing endpoints accept `notify: boolean` and return `{item, notification: {queued, targeted, quotaLeft} | null}`.

## 5. Super Admin API — `admin.<domain>/api/super` (role super_admin; ★ = step-up required)
| Area | Endpoints |
|---|---|
| Dashboard | `GET /dashboard` (SLA breaches/at-risk first, pending approvals, stats) |
| Masjids | `GET /masjids?q=&status=&cursor=` · `POST /masjids` · `GET/PATCH /masjids/:id` · `POST /masjids/:id/activate` · ★`POST /masjids/:id/suspend` `{reason}` · `POST /masjids/:id/unsuspend` · ★`DELETE /masjids/:id` · `PATCH /masjids/:id/quotas` |
| Admins | `POST /admins` `{displayName, phone?, uiLocale, masjidId, role}` → `{inviteUrl}` · `GET /admins?masjidId=` · ★`POST /admins/:id/invites` `{purpose}` · ★`POST /admins/:id/revoke-sessions` · ★`POST /admins/:id/revoke-passkeys` · ★`DELETE /admins/:id/masjids/:masjidId` · ★`GET /admins/:id/phone` (decrypt, audited) |
| Payments | `GET /payments/pending` · ★`POST /payments/:id/approve` · `POST /payments/:id/reject` `{reason}` |
| Moderation | `GET /reports?status=&cursor=` · ★`POST /items/:id/remove` `{reason, reportIds[]?, legalOrderId?}` · ★`POST /items/:id/restore` · `POST /reports/:id/dismiss` |
| Grievances | `GET /grievances` · `POST /grievances/:id/ack` · `POST /grievances/:id/resolve` · ★`GET /grievances/:id/contact` |
| Legal orders | `GET/POST /legal-orders` · `PATCH /legal-orders/:id` · `POST /legal-orders/:id/document` |
| Library | ★`POST /library/import` (JSON file, schema-validated, dry-run first) · `PATCH /library/:id` · `POST /library/:id/verify` `{verifiedBy}` · `POST /library/:id/retire` |
| Templates | `GET/POST/PATCH /templates` |
| Settings | `GET/PATCH /settings` |
| Audit | `GET /audit?actor=&masjid=&action=&from=&to=&cursor=` · `GET /audit/export.csv` |
| Posters | `GET /masjids/:id/poster-data` (follow code, deep link, names) — poster rendered client-side |
| Stats | `GET /stats` |

## 6. Jobs & hooks
**Jobs** are BullMQ processors in the `worker` container (DB user `mc_system`) — full list, schedules and idempotency keys in `01_ARCHITECTURE.md §5.8` (`push-fanout`, `push-send-batch`, `payment-activate` every 10 min, `campaign-close` daily 00:10 IST, `retention` daily 03:00 IST, `sla-alerts` every 15 min → Super Admin push via admin push subscriptions, `report-triage` every 1 min, `outbox-sweeper`, `cdn-purge`, `alert-send`, `bunny-delete`, `stats-snapshot`, `counters-reconcile`). There are no public job endpoints.

**Hooks** (HTTP, on `api-admin`, handlers use the narrow `hookScope('bunny')` — 01 §5.1):
| Path | Trigger | Idempotency |
|---|---|---|
| `POST /api/hooks/bunny` | Bunny webhook (signature/secret verified; raw body captured for verification before JSON parsing) | (videoId, status) |

## 7. Client API layer rules
- One typed client per app built from contracts (`packages/shared`), wrapping `fetch` with: timeout (10s, uploads excluded), retry (GET only, 2× with jitter, not on 4xx), problem+json parsing → typed `ApiError`, `X-Request-Id`, device auth header injection.
- TanStack Query keys factory per feature; `staleTime` aligned with cache TTLs; optimistic updates only for Ameen, follow/unfollow, mute.
