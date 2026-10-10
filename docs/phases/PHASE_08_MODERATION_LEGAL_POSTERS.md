# PHASE 08 — Moderation, Grievance, Legal Pages, Retention & QR Posters

## Goal
The platform can meet Indian intermediary obligations in practice: anyone can report content, the Super Admin can act within legal timelines with timers and alerts, removed content disappears everywhere instantly while being preserved privately for 180 days, grievances are tracked, legal texts are versioned and accepted, retention runs automatically, kill switches exist — and the Super Admin can print beautiful QR posters for distribution.

## Read before starting
`CLAUDE.md` · `00_PRODUCT_SPEC.md` §4.7, §5 · `02_DATA_MODEL.md` (reports, grievances, legal_orders, audit_log, app_settings, §6 Retention) · `01_ARCHITECTURE.md` §5.2 (CDN purge), §5.8 (jobs) · `03_API_SPEC.md` (reports, grievances, legal; Super moderation/grievances/legal/settings/audit; §6 jobs) · `04_SECURITY.md` §13 · `05_LEGAL_COMPLIANCE_IMPLEMENTATION.md` (all) · `07_SCREEN_SPECS.md` A15 §7–8, A17, C1, C3, C5–C7, C10–C12 · `09_I18N.md` §9.

## Owner prerequisites
- Grievance Officer details (name, email, city/postal address) and a monitored email inbox.
- Legal texts: Claude Code writes DRAFTS; the owner's lawyer finalizes (owner legal doc). Phase can complete with drafts; **production launch (Phase 9) cannot**.

---

## Tasks

### T8.1 — Reporting (musalli)
**Do:** "Report" in "…" menus of item detail screens, video player, campaign, dua, Masjid Detail; report sheet with reasons (00 §4.7) + optional details + Turnstile; `POST /reports` (device auth, rate limit 10/day); urgent routing for reasons implying intimate imagery/impersonation (SLA 2 h); thank-you confirmation. Reported items are not hidden automatically (avoid brigading) — except when ≥ N distinct devices report the same item within 1 h (configurable, default 10) → item auto-hidden pending review + urgent alert. Both the auto-hide and the immediate urgent alert are done by the worker job `report-triage` (every minute — 01 §5.8), because the public API's DB user can only insert reports.
**Acceptance:** [ ] Integration tests incl. rate limits, auto-hide threshold and urgent alert (job-level tests with clock control; each fires exactly once). [ ] Reporter device id never exposed to masjid admins.

### T8.2 — Moderation queue & takedown (C5)
**Do:** Queue sorted by SLA due; item preview identical to musalli rendering (all template languages); actions: ★Remove (reason category + note; links reports/legal order) → `removeItem` state function (status removed, `purge_after = now+180d`, version bump — one transaction) → `cdn-purge` worker job (Cloudflare purge by cache tag `i-<publicId>`, or by URL for every version URL since `published_version` if tag purge isn't available on the plan — verify) + cancellation of pending push batches for that item, ★Restore, Dismiss, Suspend masjid, Revoke admin. Admin side: inbox entry + push "A post was removed: <reason category>" + My Posts shows "Removed by moderation" with content policy link. Repeat-violation counter on masjid page.
**Acceptance:** [ ] E2E journey 11: report → remove → musalli no longer sees item after next poll; opening old notification shows "no longer available". [ ] Removed content still retrievable by Super Admin (preservation) and not by anyone else (policy-matrix test + `v_pub_items` view test). [ ] On staging, the removed item's cached detail URL returns the fresh (gone) response within 1 minute (automated check).

### T8.3 — SLA engine & dashboard (C1)
**Do:** SLA constants in `packages/shared/src/compliance.ts`; `sla-alerts` worker job every 15 min → Super Admin push at 50/80/100% of each SLA; dashboard cards sorted by urgency with color states; email fallback via Sentry/uptime alert integration (document).
**Acceptance:** [ ] Clock-controlled integration tests for alert thresholds (each fires exactly once).

### T8.4 — Grievances (musalli form + C6 tracker)
**Do:** Settings → Contact & Grievance: officer card (from settings), form (category incl. `privacy`, `content`, `technical`, `other`; description ≤ 2000; optional contact encrypted; Turnstile) → `GR-YYYY-NNNNNN` reference shown + "We will acknowledge within 24 hours." Tracker: ack/resolve with timers, ★reveal contact (audited), resolution notes.
**Acceptance:** [ ] Contact encrypted at rest (DB test reads ciphertext). [ ] Reference numbers sequential per year, unguessable ordering not required.

### T8.5 — Legal orders register (C7)
**Do:** Create/edit orders with received time (entered), due = +3 h, linked targets, action log, private document upload (encrypted with AES-256-GCM in `api-admin`, stored as a Cloudinary `raw` + `authenticated` asset; downloads only through `api-admin`, which fetches, decrypts and streams the file to a Super Admin with step-up — no signed URL ever reaches a browser; uploads via `busboy` with type/size limits — DECISIONS #40), status flow.
**Acceptance:** [ ] Stored bytes are ciphertext (test reads the raw object via the adapter); a non-super or no-step-up session gets 403; the Cloudinary asset is not reachable by its public URL (staging opt-in check). [ ] Timer and alerts work (reuse T8.3).

### T8.6 — Legal texts, versions & reminders
**Do:** Draft `privacy`, `terms`, `content-policy`, `grievance`, `undertaking` in English + draft translations, each with `DRAFT — REQUIRES LEGAL REVIEW` banner and front-matter status; legal reader screen (both apps); version tracking (`app_settings.*_version`) → re-acceptance prompts (musalli privacy notice sheet; admin undertaking screen); annual reminder (musalli sheet; admin re-accept); `licenses` page generated at build from dependency licenses + fonts + datasets (GeoNames, etc.) + library sources. Production build check refuses drafts.
**Privacy policy draft must accurately list:** data categories (02 devices/admin/grievance), purposes, processors (VPS hosting provider, MongoDB Atlas, Cloudinary (images; encrypted legal documents), Cloudflare (CDN/WAF/DNS + Turnstile), YouTube (only after a user taps Play on a bayan), Sentry, push services FCM/APNs/Mozilla) and their regions, retention table, rights & how to exercise, grievance officer, children statement, no ads/no tracking, changes policy.
**Acceptance:** [ ] Build check proven (fails with draft in prod mode). [ ] Re-acceptance flows e2e.

### T8.7 — Retention job
**Do:** Worker job `retention` (scheduler 03:00 IST, `systemScope()`) implementing every row of `02 §6` in batches (≤ 1,000 documents per operation, loop until done or time budget), media deletion (Cloudinary via `media-delete` + Cloudflare purge), VPS log-archive 200-day cleanup check, audited summary, `--dry-run` mode (Super Admin can trigger dry-run report on staging), alert on failure.
**Acceptance:** [ ] Integration test per retention rule with clock control; dry-run changes nothing.

### T8.8 — QR poster generator (C3)
**Do:** Super Admin → masjid → Generate poster: print-optimized HTML/CSS page (A4/A5 toggle), QR SVG (error correction Q, `https://app.<domain>/m/<CODE>`), follow code, masjid names, 4-language instructions with icons, branding, "Free · No ads · No account". Print stylesheet with exact colors (`print-color-adjust: exact`), page size, margins. Also downloadable QR-only PNG/SVG.
**Acceptance:** [ ] Visual test of print layout (Playwright `page.pdf()` for A4/A5 → snapshot). [ ] Scanned from the generated PDF at 1.5 m on a phone (owner check). [ ] Urdu and Telugu instructions shape correctly in the PDF (browser-rendered).

### T8.9 — Kill switches & banners
**Do:** Super Admin Settings ★: pause all push (from Phase 4), admin read-only mode (writes → 503 `READ_ONLY_MODE` with friendly banner), maintenance banner (4 languages) shown in both apps, global "show banner to all musallis" for incidents.
**Acceptance:** [ ] Integration tests for each switch.

### T8.10 — Audit & stats completion
**Do:** Audit viewer filters/export final; Stats page (masjids by status, devices, follows, push success, job lag, Cloudinary credits used, reports/grievances SLA compliance %).
**Acceptance:** [ ] CSV export audited; no secrets/PII columns beyond what Super Admin may see.

### T8.11 — Quality gates
**Do:** e2e journeys 11 + legal re-acceptance; visual baselines for new screens; security review focused on moderation privileges, private bucket, encryption, retention.

---

## Phase exit criteria
Owner walks through a full mock takedown (report → remove within timer → admin notified → content preserved) and a mock legal order (owner guide Phase 08); posters printed and scanned; phase-verifier PASS; security-reviewer clean.
