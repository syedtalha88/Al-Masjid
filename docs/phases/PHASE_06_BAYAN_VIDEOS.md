# PHASE 06 — Bayan Videos

## Goal
Admins upload bayans from their phone on a patchy network (resumable) or paste a YouTube link, choose the audience (everyone / brothers / sisters), and followers get a smooth adaptive player — with storage quotas protecting running costs.

## Read before starting
`CLAUDE.md` · `00_PRODUCT_SPEC.md` §4.3 (Bayan videos) · `01_ARCHITECTURE.md` §5.4, §9 (video chunk budget), §11 · `02_DATA_MODEL.md` (`items.video`, `items.audience`, masjids quota fields, `hookScope` cells) · `03_API_SPEC.md` (Videos admin, videos/play, hooks/bunny) · `04_SECURITY.md` §6 (YouTube parsing), §7 (CSP media/connect/frame) · `05_LEGAL_COMPLIANCE_IMPLEMENTATION.md` §9 · `07_SCREEN_SPECS.md` A12, B10 · `08_MOTION.md` §3.5 (video shared element), §5.12.

## Owner prerequisites
Bunny.net account with a **Stream library** for staging (token authentication ON, allowed referrers = staging origins, renditions 360/480/720 only, MP4 fallback OFF, webhook URL → staging admin `/api/hooks/bunny`). Library ID, API key, token key, CDN host, webhook secret go into the staging VPS env files per `01 §7` (API key only in `api-admin` and `worker`; token key in `api-public` + `api-admin` for playback signing; CDN host is public).

## Out of scope
Live streaming, downloads, comments, on-device compression.

---

## Tasks

### T6.1 — Bunny adapter (verify current Bunny Stream docs first)
**Do:** `packages/api/src/video/bunny.ts`: create video object, TUS presign (signature/expiry per Bunny docs), get video status, delete video, token-signed playback URL (HLS playlist) with expiry, webhook verification. `mock.ts` adapter for local/tests implementing the same interface (simulates processing via timers). Record the verified API details in DECISIONS.
**Acceptance:** [ ] Contract tests run against the mock and (opt-in flag) against the staging library. [ ] Signatures never logged.

### T6.2 — Admin upload flow (B10)
**Do:** Quota bar; file pick (accept video/*), client validation (type sniff via first bytes, size ≤ 2 GB, duration ≤ 120 min via metadata, friendly errors), fields + audience (required) + ownership checkbox; `POST /videos` → TUS upload with `tus-js-client` (chunk 8–16 MB, retry delays [0, 3s, 10s, 30s], fingerprint in IndexedDB for resume after app restart), `UploadProgress` with pause/resume/cancel, Wake Lock while uploading (where supported), warning before leaving app mid-upload. Server: quota pre-check using declared size; reject if exceeding.
**Acceptance:** [ ] E2E with mock adapter: upload → interrupt network → resume completes. [ ] Quota exceeded → `VIDEO_QUOTA_EXCEEDED` with localized message.

### T6.3 — Webhook & publish
**Do:** `/api/hooks/bunny` on `api-admin` with `hookScope('bunny')` (raw-body signature verification, idempotent by (videoId, status)): processing → ready (duration, size, thumbnail) → item `published` + version bump + push job (audience-filtered) + admin alert "Video ready"; failed → admin alert + retry option (re-upload). Update `video_used_bytes` with actual size.
**Acceptance:** [ ] Integration tests for each status transition, duplicate webhooks, bad signature (401).

### T6.4 — YouTube option
**Do:** Admin: paste link → strict id extraction (04 §6) → preview thumbnail from `i.ytimg.com` → title/audience → publish. Musalli: lite facade (thumbnail + play button), iframe `youtube-nocookie.com/embed/<id>?autoplay=1&rel=0` only after tap; CSP updated.
**Acceptance:** [ ] Malformed/other-host URLs rejected (fast-check fuzz). [ ] No request to YouTube before tap (network assertion).

### T6.5 — Musalli Bayans & player (A12)
**Do:** Bayans list (Masjid Detail row + Updates chip "Bayans"), audience filtering server-side, VideoCard, Player screen in a lazy chunk (hls.js light build only when native HLS unavailable; ≤ 90 KB gz), custom controls per A12, PiP, remembered position (IndexedDB), errors/retry, `GET /videos/:publicId/play` with token URL refresh before expiry. Shared-element thumbnail → player (progressive).
**Acceptance:** [ ] E2E journey 10 (sisters-only hidden for brothers; visible for sisters). [ ] Player works on WebKit profile (native HLS) and Chromium (hls.js) in e2e with a tiny test HLS stream. [ ] Controls accessible (keyboard, labels) and work in RTL (timeline not mirrored).

### T6.6 — Deletion, quotas & retention
**Do:** On admin delete **or** moderation removal: the item is hidden immediately and its size stops counting toward the quota immediately; the Bunny object itself is deleted by the retention job (worker `bunny-delete`) after the 180-day preservation period (same rule for both cases). Super Admin quota edit; storage stats.
**Acceptance:** [ ] Retention job deletes Bunny objects (mock) at the right time.

### T6.7 — Quality gates
**Do:** Visual baselines; budgets (video chunk); CSP violation-free; security review (upload & webhook paths).

---

## Phase exit criteria
Owner uploads a real 10-minute bayan from a phone on mobile data, interrupts it, resumes, and plays it on a weak network (owner guide Phase 06); phase-verifier PASS; security-reviewer clean.
