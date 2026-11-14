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
- **Webhooks**: none in v1 (no video host — DECISIONS #39).

## 2. Rate limits (Redis via `rate-limiter-flexible`; key = device id / session id; IP used only as a coarse secondary key with generous limits because of CGNAT; Cloudflare WAF rate rules are an outer, coarser layer)
| Bucket | Limit |
|---|---|
| device register | 5 / hour / Turnstile-verified client + 300 / hour / IP |
| code resolve (`/masjids/resolve`) | 30 / min / device-or-IP |
| follow/unfollow | 60 / hour / device |
| ameen | 120 / hour / device |
| device self (`GET/PATCH/DELETE /devices/me`, `GET /devices/me/follows`) | 120 / hour / device (DECISIONS #103, review L2) |
| public list reads (`/masjids/versions`, `/ameens`) | 1200 / min / IP — generous (CGNAT, Jumu'ah peaks); the CDN absorbs most (DECISIONS #103) |
| reports | 10 / day / device |
| grievances | 5 / day / IP + Turnstile |
| admin login options/verify, invite read, registration | 30 / 10 min / IP (IPv6 by /64) — DECISIONS #81, #80; 20 / hour / credential counting **failed** assertions of a known credential only (#80 L3) |
| admin writes | 120 / hour / session |
| admin uploads / video links (image upload, video create) | 30 / hour / masjid |
| super admin writes | 600 / hour / session |
Exceeded → 429 with `Retry-After`.

## 3. Public API — `app.<domain>/api/v1` (process: `api-public`, DB user `mc_public`)

| Method & path | Auth | Purpose | Cache |
|---|---|---|---|
| `GET /health` | – | `{ok, db, redis, version}` | no-store |
| `GET /config` | – | public settings: `{globalHijriOffset, maintenanceBanner, legalVersions, minClientVersion}` | s-maxage=60 |
| `POST /devices` | Turnstile | Register: body `{locale, audiencePref, platform, turnstileToken}` → `{deviceId, secret}` (secret returned once) | no-store |
| `PATCH /devices/me` | Device | Update `{locale?, audiencePref?}` | no-store |
| `PUT /devices/me/push` | Device | `{endpoint, keys:{p256dh, auth}}` (endpoint must be https and on an allow-listed push service host) → 204 (follows get `push_active`); another device record holding the endpoint → `409 PUSH_ENDPOINT_IN_USE` (the app makes a fresh subscription — DECISIONS #138) | no-store |
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
| `GET /masjids/:id/ruqyah?v=` | – | `{sections: [{category, entries}]}` — non-empty headings in A19 order, entries in the masjid's order; library content expanded (entries whose library entry is no longer verified left out); recordings as `audio {key, durationS, peaks?}` — the key, like voice notes (#127); a suspended masjid answers `{sections: []}` (DECISIONS #104, #130) | immutable w/ v |
| `GET /masjids/:id/beneficiaries?v=&zakat=` | – | Active needy people, least-funded first; public fields only (Phase 5, #104) | per v, `max-age=86400, s-maxage=86400` — never a year: a removed person must leave caches (#160) |
| `GET /items/:publicId?v=&aud=` | – | Full item incl. type detail + library content | immutable w/ v |
| `POST /items/:publicId/ameen` | Device | Idempotent (via `recordAmeen`); returns `{count}` | no-store |
| `GET /library/:id` | – | Library entry (verified only) | s-maxage=86400 |
| `GET /templates` | – | Active notice templates (all locales) | s-maxage=3600 |
| `POST /reports` | Device + Turnstile | `{targetType, targetPublicId, reason, details?}` | no-store |
| `POST /grievances` | Turnstile | `{category, description, contact?}` → `{publicRef}` | no-store |
| `GET /legal/:doc/:locale` | – | Markdown → sanitized HTML for privacy/terms/grievance-officer/content-policy | s-maxage=3600 |


Bundle additions (DECISIONS #104): `adhkar` (`{entries}` — the ordered verified `dhikr` library entries; `null` when off or empty — #129), `contacts` (Ilm — `[{id, name, role?, topics?, whatsapp, audience}]`, both audiences, brothers first, each in the masjid's order; the client shows the device's own and never prints the number; optional so an older cached bundle parses — #131), `sections {ruqyah: count, needy: count}` so Masjid Detail can show its rows without loading the lists. Items carry `voice {url, durationS, peaks?}` when they have a voice note.

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
| `GET /auth/me` | `{admin, masjids[{id, name, role}], undertakingRequired, undertakingVersion?, readOnly, maintenanceBanner?}` — `readOnly` = the Super Admin's admin read-only mode (T8.9); while on, a masjid admin's non-GET request answers `503 READ_ONLY_MODE` except sign-out, ending sessions, step-up, alert subscription and the undertaking |
| `POST /auth/undertaking` | `{version}` accept |
| `GET /auth/sessions` / `DELETE /auth/sessions/:id` | Own sessions |
| `PUT /auth/push` / `DELETE /auth/push` | Admin's own push subscription (status alerts; SLA alerts for super admin): `PUT` body = the device subscription shape (allow-listed host; ≤ 5 phones per admin, oldest dropped; another admin's endpoint → `409 PUSH_ENDPOINT_IN_USE`), `DELETE` body `{endpoint}` (T4.6) |
| `GET /auth/passkeys` / `PATCH /auth/passkeys/:id` (label) | Own passkeys (cannot delete last one) |

### Masjid-scoped (`/masjids/:masjidId/...`, membership enforced)
| Resource | Endpoints |
|---|---|
| Profile | `GET /` · `PATCH /` (allowed fields only) · `POST /photo` (multipart ≤ 10 MB → re-encode) |
| Timings | `GET /timings` · `PUT /timings` (all five + jumu'ah atomically in one document, `If-Match: <rev>` → 412 on conflict, `notify` flag) · `GET /timings/preview?date=` (resolved times for a date) |
| Special dates | `GET /special` (from 30 days ago, by date) · `POST /special` · `PATCH /special/:id` (the whole entry; a label/note left out is removed) · `DELETE /special/:id` (soft) — body `{type, date, label?, times[1..5]{time, label?}, note?, notify}` (#117) |
| Ramadan | `GET /ramadan` · `PUT /ramadan` `{start, end, sehriPrecaution, iftarPrecaution}` (start/end both `null` = off; ≤ 30 days — #117) |
| Items | `GET /items?type=&status=&cursor=` · `POST /items/announcement` · `POST /items/daily-content` · `POST /items/dua` · `PATCH /items/:id` (If-Match `updated_at`; ≤ 24h after publish) · `DELETE /items/:id` |
| Campaigns | `POST /campaigns` · `PATCH /campaigns/:id` · `POST /campaigns/:id/received` `{receivedPaise}` · `POST /campaigns/:id/complete` |
| Chanda | `GET /chanda` · `PUT /chanda/:weekStart` `{amountPaise, note?, notify}` · `PATCH /chanda/settings` `{show, weekStart}` |
| Payment | `GET /payment` (active + pending) · `POST /payment/requests` `{vpa, payeeName, note}` — masjid **owners** only (`403 PAYMENT_OWNER_ONLY` for an editor; the Super Admin and every owner are alerted — DECISIONS #161); approve answers `409 PAYMENT_REQUESTER_REMOVED` (and closes the request) when the requester has since lost access |
| Videos (YouTube links only — DECISIONS #39) | `POST /videos/preview` `{url}` → `{youtubeId, startS?, title, thumbnail}` (our copy as a `data:image/jpeg` URL) (strict parse + oEmbed; `422 INVALID_VIDEO_LINK` / `422 VIDEO_UNAVAILABLE`) · `POST /videos` `{url, title, speaker?, description?, audience, locale, notify}` → published item (thumbnail copied to Cloudinary) · `GET /videos` (published / removed / deleted) · `PATCH /videos/:id` (texts only, ≤ 24 h, If-Match) · delete via `DELETE /items/:itemId` — preview returns our thumbnail as a `data:` URL; 30 lookups / hour / masjid; `503 VIDEO_LOOKUP_FAILED` when YouTube cannot be asked (DECISIONS #163) |
| Voice notes | `POST /audio` (multipart ≤ 25 MB; Ogg/Opus, WebM, MP4/M4A/AAC, MP3, WAV, 3GP by magic bytes; duration ≤ 600 s) → `{audioKey, durationS, peaks}` — attached as `voice` to `POST /items/announcement`, `/items/daily-content`, `/items/dua` (then `title` required) and to Ruqyah entries (#104) |
| Ruqyah | `GET /ruqyah` (active entries in order; a library entry no longer verified comes back with `libraryId` and no `library`) · `POST /ruqyah` → 201 `{id}` · `PATCH /ruqyah/:id` (the whole entry; what is left out is removed) · `DELETE /ruqyah/:id` → 204 (soft) · `PUT /ruqyah/order` `{ids}` (every active entry once → the list; else `409 RUQYAH_ORDER_INVALID`). Body: `{category, source: library\|text\|audio, title?, instructions?: {text, locale}}` + `libraryId` \| `text {arabic, translation, translationLocale, reference?}` \| `audio {key, durationS, peaks?, rightsConfirmed: true}` (then `title` required). Errors: `RUQYAH_INVALID` 400 (another masjid's recording), `LIBRARY_ENTRY_NOT_FOUND` 404, `RUQYAH_NOT_FOUND` 404, `RUQYAH_LIMIT_REACHED` 409 (50) (#104, #130) |
| Adhkar | `GET /adhkar` · `PUT /adhkar` `{enabled, libraryIds[] ≤ 30}` (verified `dhikr` entries only) (#104) — both answer `{enabled, entries[]}` in order; a draft, retired, other-kind or unknown id `404 LIBRARY_ENTRY_NOT_FOUND`, a repeat `400` (#129) |
| Ilm contacts | `GET /contacts` (`{contacts}`, brothers first) · `POST /contacts` → 201 `{id}` · `PATCH /contacts/:id` (the whole contact; a role or topics left out is removed) · `DELETE /contacts/:id` → 204 (soft). Body `{name ≤80, role? ≤60, topics? ≤120, whatsapp (E.164), audience: brothers|sisters, consentConfirmed: true}` — `consentConfirmed: true` required on every save. Errors: `VALIDATION_FAILED` 400 (no consent, not E.164), `CONTACT_NOT_FOUND` 404, `CONTACT_LIMIT_REACHED` 409 (10) (#104, #131) |
| Needy people (Phase 5) | `GET /beneficiaries` (active least-funded first, then fulfilled, then closed; never the private part) · `POST /beneficiaries` (`consentConfirmed: true` required — 400 without it, #156) · `PATCH /beneficiaries/:id` (active only; consent again; `private`: object = replace, `null` = remove, absent = keep) · `POST /beneficiaries/:id/received` `{receivedPaise}` (≥ cap fulfils; below it lists a fulfilled person again) · `POST /beneficiaries/:id/close` · `DELETE /beneficiaries/:id` · `GET /beneficiaries/:id/private` (decrypts phone/note for own masjid admins; audited) (#104, #156, #157) |
| Library/templates (read) | `GET /library?kind=&q=&category=&cursor=` · `GET /library/suggestion?kind=` · `GET /templates` |
| Notifications | `GET /notifications/quota` `{used, limit, resetsAt, paused, reach: {everyone, brothers, sisters}}` (`paused` = the Super Admin's kill switch; `reach` = followers a notification reaches per audience — "Will notify N people", T4.5) · `GET /notifications/jobs?cursor=` → `{jobs: [{id, status, audience, createdAt, completedAt?, targeted, sent, failed, pruned, item?: {id, type, status, category?, title?, templateKey?}}], next}` (30 a page, newest first) |
| Stats | `GET /stats` `{followers, itemsThisWeek, ameenThisWeek}` (`ameenThisWeek` from `masjid_stats.ameens_7d`, up to 1 h old) |
| Uploads | `POST /images` (multipart, purpose ∈ announcement/campaign) → `{imageKey, urls}` |

The blood donation camp (#104) is an announcement from the masjid-pickable template `blood_donation_camp` (`POST /items/announcement`) — no endpoint of its own.

Publishing endpoints accept `notify: boolean` and return `{item, notification: {queued, targeted, quotaLeft} | null}`.

`POST /items/announcement` (T3.6, DECISIONS #120): `{content: {kind: 'template', key, params} | {kind: 'text', title ≤80, body ≤1000, locale}, category, isImportant, eventAt? (category event only; from a day ago to 400 days ahead), image? {key (m/<own masjid>/…), thumbhash, rightsConfirmed: true}, notify}` → 201 `{item: {id, publicId}, notification}`. Params are checked against the template's declared params; an unknown, draft, retired or system template is `404 TEMPLATE_NOT_FOUND`; params that do not fit, another masjid's photo or an event time out of range are `400 ANNOUNCEMENT_INVALID`; no notifications left is `409 NOTIFY_QUOTA_EXCEEDED` (nothing published). `GET /templates` lists the active, non-system templates in all four languages (the public `NoticeTemplate` shape).

`POST /items/daily-content` (T3.7, DECISIONS #122): `{libraryId, note? (1–200), notify}` → 201 `{item, notification}`. The kind (hadith / ayah) is the library entry's own; free text, a `kind` or a `title` in the body is a 400. A draft, retired, dua, dhikr or unknown entry is `404 LIBRARY_ENTRY_NOT_FOUND`; no notifications left is `409 NOTIFY_QUOTA_EXCEEDED`. A second one of the same kind on a day is allowed: `GET /library/suggestion?kind=` answers `{entry, publishedToday}` so B6 can warn first.

`POST /items/dua` (T3.8, DECISIONS #123): `{category, message (1–500), locale, personName? (≤80), namePrivate, libraryId, janazaAt?, janazaPlace? (≤120), notify}` → 201 `{item, notification}`. The entry must be a verified dua (`404 LIBRARY_ENTRY_NOT_FOUND`); `janazaAt` / `janazaPlace` only with `inteqal` (400), the janaza from a day ago to 30 days ahead (`400 DUA_INVALID`). The title is the category's ("Request for Dua"), never sent. A private name is never in api-public's responses (`v_pub_items` removes it).

My Posts (T3.9, DECISIONS #124): `GET /items?type=&status=&cursor=` → `{items: [{id, status, updatedAt, editableUntil?, libraryId?, privateName?, removedReason?, deletedAt?, item: FeedItem}], next}` (every status, newest first, 30 a page). `PATCH /items/:id` with `If-Match: "<updatedAt>"` and `{type, …the type's publish fields without notify}` → `{updatedAt}`; within 24 h of publishing (`409 EDIT_WINDOW_CLOSED`), stale If-Match `412 PRECONDITION_FAILED`, missing `400`, another type or a timing update `409 ITEM_NOT_EDITABLE`; content is checked as at publish; sets `edited_at`; never notifies. `DELETE /items/:id` → 204 (any age; again → 204; removed posts → 404): soft delete, purge after 180 days.

Masjid Profile (T3.10, DECISIONS #125): `GET /masjids/:id` → `{id, name, nameI18n, area, city, state, address, photo?{key, thumbhash?, url?}, hijriOffset (-2…+2 | null), globalHijriOffset}`. `PATCH /masjids/:id` `{hijriOffset: -2…+2 | null}` only (any other key → 400). `POST /masjids/:id/photo?rightsConfirmed=true` (multipart `file`, the image pipeline) → the profile. Both bump the masjid version; `400 PROFILE_INVALID` for an offset out of range or nothing to change. `POST /masjids/:id/change-requests {note ≤ 300}` → 204: a note for the Super Admin, listed in `GET /super/dashboard` → `changeRequests` until that masjid is next edited.

Voice notes (T3.13, DECISIONS #126): `POST /masjids/:id/audio?rightsConfirmed=true&durationS=<seconds>&peaks=<48 comma-separated 0…255>` (multipart `file`, ≤ 25 MB, container by magic bytes) → 201 `{audioKey, durationS, peaks}`; not audio `422 AUDIO_INVALID`; over 10 minutes (the storage's own measurement when it has one, else the declared length) `422 AUDIO_TOO_LONG` and nothing kept. Posts (T3.13 part 2, #127): the announcement / daily-content / dua publish and edit bodies take `voice?: {key, durationS, peaks[48]}` plus a top-level `title` (≤ 120) for posts without one of their own — only together with a voice note; another masjid's recording or a voice note without a title is `400 VOICE_INVALID`. Public items carry `voice {key, durationS, peaks?}` (the app plays `<media origin>/a/m4a/<key>`).

## 5. Super Admin API — `admin.<domain>/api/super` (role super_admin; ★ = step-up required)
| Area | Endpoints |
|---|---|
| Dashboard | `GET /dashboard` (SLA breaches/at-risk first, pending approvals, stats incl. `activeCampaigns` — T5.6; `push` = the last 24 h: jobs, running, failed jobs, sent, failed, pruned, success rate, paused — T4.5) |
| Masjids | `GET /masjids?q=&status=&cursor=` · `POST /masjids` · `GET/PATCH /masjids/:id` · `POST /masjids/:id/activate` · ★`POST /masjids/:id/suspend` `{reason}` · `POST /masjids/:id/unsuspend` · ★`DELETE /masjids/:id` · `PATCH /masjids/:id/quotas` |
| Admins | `POST /admins` `{displayName, phone?, uiLocale, masjidId, role}` → `{inviteUrl}` · `GET /admins?masjidId=` · ★`POST /admins/:id/invites` `{purpose}` · ★`POST /admins/:id/revoke-sessions` · ★`POST /admins/:id/revoke-passkeys` · ★`DELETE /admins/:id/masjids/:masjidId` · ★`GET /admins/:id/phone` (decrypt, audited) |
| Payments | `GET /payments/pending` · ★`POST /payments/:id/approve` · `POST /payments/:id/reject` `{reason}` |
| Moderation | `GET /reports?status=&cursor=` · ★`POST /items/:id/remove` `{reason, reportIds[]?, legalOrderId?}` · ★`POST /items/:id/restore` · `POST /reports/:id/dismiss` |
| Grievances | `GET /grievances` · `POST /grievances/:id/ack` · `POST /grievances/:id/resolve` · ★`GET /grievances/:id/contact` |
| Legal orders | `GET/POST /legal-orders` · `PATCH /legal-orders/:id` · `POST /legal-orders/:id/document` |
| Library | `GET /library?status=&kind=&category=&tag=&q=&cursor=` · `GET /library/:id` · `POST /library/import/dry-run` (multipart JSON file → report) · ★`POST /library/import` (same file; all or nothing, as `draft`) · `PATCH /library/:id` · `POST /library/:id/verify` `{verifiedBy}` · `POST /library/:id/retire` (DECISIONS #108) |
| Templates | `GET /templates` · `GET /templates/:key` · `POST /templates` (always `draft`) · `PATCH /templates/:key` (edits; `status` active/retired — active needs reviewed translations; params only while draft) · `POST /templates/starters` (adds missing starters as drafts) — ICU checked in all 4 languages (DECISIONS #111) |
| Settings | `GET/PATCH /settings` (`GET` includes `pushPaused`, `adminReadOnly`, `maintenanceBanner?`, `incidentBanner?`; `PATCH` sets a banner `{en, hi, ur, te}` (each 1–300 characters) or takes it down with `null` — T8.9) · ★`POST /settings/push-pause` `{paused}` → `{paused, changed}` (kill switch, T4.7; audited `push.pause` / `push.resume`) · ★`POST /settings/read-only` `{readOnly}` → `{readOnly, changed}` (admin read-only mode, T8.9; audited `settings.read_only_on` / `settings.read_only_off`) · `POST /alerts/test` → `{queued}` — a test alert to your own phones; 404 in production (T4.6) |
| Audit | `GET /audit?actor=&masjid=&action=&from=&to=&cursor=` (`from` inclusive, `to` exclusive; C11 sends India days) · ★`GET /audit/export.csv` (same filters, ≤ 10 000 rows, audited `audit.export` with the filters and row count; meta keys are per-action allow-lists — no secrets / PII, pinned by `audit-allowlist.test.ts`, T8.10) |
| Posters | `GET /masjids/:id/poster-data` (follow code, deep link, names) — poster rendered client-side |
| Stats | `GET /stats` → `{at, now, trend}`: `now` = the newest hourly snapshot or null (masjids, devices {total, platform, locale, push}, follows, push24h with successRate, queues? {waiting, active, delayed, failed, lagS}, cloudinary? {usedPercent, plan?, credits?}, sla {reports, grievanceAck, grievanceResolve: {onTime, late, rate}}); `trend` = the last snapshot of each India day for 30 days {day, activeMasjids, devices, follows, pushSent, pushFailed} (T8.10) |

## 6. Jobs & hooks
**Jobs** are BullMQ processors in the `worker` container (DB user `mc_system`) — full list, schedules and idempotency keys in `01_ARCHITECTURE.md §5.8` (`push-fanout`, `push-send-batch`, `payment-activate` every 10 min, `campaign-close` daily 00:10 IST, `retention` daily 03:00 IST, `sla-alerts` every 15 min → Super Admin push via admin push subscriptions, `report-triage` every 1 min, `outbox-sweeper`, `cdn-purge`, `alert-send`, `media-delete`, `cloudinary-usage`, `stats-snapshot`, `counters-reconcile`). There are no public job endpoints.

**Hooks**: none in v1 (Bunny dropped — DECISIONS #39). The `/api/hooks/*` route prefix and `hookScope(name)` stay reserved on `api-admin` for a future webhook, which must verify a signature over the raw body and add its own narrow policy cells.

## 7. Client API layer rules
- One typed client per app built from contracts (`packages/shared`), wrapping `fetch` with: timeout (10s, uploads excluded), retry (GET only, 2× with jitter, not on 4xx), problem+json parsing → typed `ApiError`, `X-Request-Id`, device auth header injection.
- TanStack Query keys factory per feature; `staleTime` aligned with cache TTLs; optimistic updates only for Ameen, follow/unfollow, mute.
