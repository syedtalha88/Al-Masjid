# PHASE 03 — Masjid Admin Content Tools

## Goal
A masjid admin with little English can, using only taps, keep prayer times, special dates and Ramadan settings current, and publish notices (from templates), daily hadith/ayah (from the verified library), and dua requests — with a faithful preview and a clear publish moment. The Super Admin can import and verify the Content Library and manage notice templates. Musallis see changes within one version poll. (Push sending is Phase 4; this phase records `notify` intent and creates pending `notification_jobs` outbox documents.)

## Read before starting
`CLAUDE.md` · `00_PRODUCT_SPEC.md` §3.2, §4.2, §4.3 (Announcements, Daily, Dua), §7 · `02_DATA_MODEL.md` (masjid_timings, special_timings, items, content_library, notice_templates, audit_log, §4 policy, §5 side effects) · `03_API_SPEC.md` §4 (Masjid-scoped), §5 (Library, Templates) · `04_SECURITY.md` §5–6 · `05_LEGAL_COMPLIANCE_IMPLEMENTATION.md` §2, §9 · `06_DESIGN_SYSTEM.md` §3 (admin scale), §6 (admin components) · `07_SCREEN_SPECS.md` B3–B7, B11–B13, C8–C9 · `08_MOTION.md` §5.12 · `09_I18N.md` §7–8.

## Owner prerequisites
- AWS account (MFA on, root account not used day-to-day). Claude Code gives exact steps to create the staging S3 **media** bucket in `ap-south-1`, its `media-staging.<domain>` Cloudflare record, and a scoped IAM user for `api-admin` (put/read on the media prefix only) and one for `worker` (delete). Keys go only into the staging VPS env files.
- **Real content is not required to finish this phase** (placeholders are used). But tell the owner now that before the pilot they must supply a verified Content Library JSON (format below) and reviewed template translations (see owner legal doc).

## Out of scope
Push delivery, donations, chanda, videos, moderation.

---

## Tasks

### T3.1 — Admin Home completion
**Do:** Tiles become live (Prayer Times, Notice, Hadith/Ayah, Dua Request, Special Dates & Ramadan, My Posts, Masjid Profile). Donation Drive, Chanda, Bayan Video tiles show "Coming soon" (hidden in production builds until their phase). Header with followers chip (`GET /stats`), today strip, quota pill (reads `GET /notifications/quota`; counting implemented here, sending in Phase 4), inbox banner placeholder.
**Acceptance:** [ ] 4-locale screenshots; 56 px targets; axe clean.

### T3.2 — Prayer timings editor (B4)
**Do:** API `GET/PUT /timings`, `GET /timings/preview?date=`; atomic save of 5 prayers + jumu'ah (single `masjid_timings` document, `If-Match: rev`); validation rules from 00 §4.2 in shared Zod + domain; diff summary in confirm sheet; "Notify followers" auto-on rule (today/tomorrow changes); creates a `timing_update` item when notifying (short template "Timings updated: Isha jamaat 8:30 PM"). TimeWheel sheets; Auto/Manual adhan with ±adjust; Jamaat fixed/offset. Preview frame of the musalli timings screen. Activation rule update: Super Admin can only activate masjids whose five jamaat configs are set (API + UI message).
**Acceptance:** [ ] E2E journey 6 (admin changes time → musalli sees it after version poll; clock/poll controlled). [ ] Invalid combos blocked with friendly localized messages. [ ] Concurrency: two admins → second gets "changed by someone else" sheet.

### T3.3 — Special dates & Ramadan (B11)
**Do:** CRUD for special timings; Ramadan settings with live preview of today's Sehri/Iftar; musalli Home Eid/Ramadan cards fed from real data now.
**Acceptance:** [ ] Integration tests for validation (1–5 times, dates within ±400 days). [ ] Musalli Special Dates tab shows new entries.

### T3.4 — Content Library (C8 + admin browse)
**Do:** Library import JSON schema (`scripts/library.schema.json`) — fields from `02 content_library` (the data layer computes `search_text`) (+ required `source_name`, `source_license`, `reference`, `translation.en`, `kind`, optional `dua_category`, `tags`). Super Admin: upload → dry-run report (row errors, duplicates by `kind+reference`) → import as `draft` → review screen (Arabic rendering preview with Amiri, all translations, transliterations, reference, source/license) → ★Verify (verifier name required) / Retire. Admin APIs: browse/search (normalized search incl. Arabic without harakat), category/tag chips, `GET /library/suggestion` (deterministic daily rotation per masjid, no repeat within 60 days). Write `docs/content-library-format.md` for the owner with a field table and a **placeholder** example row (never real religious text).
**Acceptance:** [ ] Schema rejects rows missing source/license/reference. [ ] Only `verified` entries are selectable by admins (policy-matrix + API test). [ ] Search normalization tests.

### T3.5 — Notice templates (C9) + ICU rendering
**Do:** Super Admin template list/editor: key, category, icon, important default, params builder (types from 02), per-locale ICU title/body with live preview using sample params, "translation reviewed" checkbox required to activate. Seed the starter templates from `00 §4.3 Announcements` with English source + draft translations (flagged in review CSV). Client renderer: template + params → localized title/body via ICU with params formatted per locale (times, dates, ranges, prayer names).
**Acceptance:** [ ] Rendering tests for every starter template × 4 locales with sample params. [ ] Unreviewed templates cannot be activated.

### T3.6 — Notice creator (B5) + image pipeline
**Do:** 3-step flow (Choose template / write own → Fill with pickers → Preview & Publish). Image upload API (`POST /images`) implementing `01 §5.5` (`busboy` with hard limits, sharp, metadata strip, sizes, AVIF/WebP, thumbhash, random keys, upload of outputs only to the S3 public media bucket served at `media.<domain>` — storage adapter with `s3` and local `fs` implementations, quotas) + ownership checkbox. Publish API `POST /items/announcement` with `notify`; returns notification preview `{targeted, quotaLeft}` (`targeted` counted via `v_admin_follow_audience`); creates the `notification_jobs` outbox document `pending` in the publish transaction (no sending yet). Success moment animation.
**Acceptance:** [ ] E2E journey 7 (template notice → Telugu musalli sees Telugu). [ ] Image pipeline tests: EXIF/GPS removed (assert with exif reader), polyglot/oversized/invalid files rejected, decompression-bomb guard. [ ] Free-text path enforces limits and stores `content_locale`.

### T3.7 — Hadith/Ayah publisher (B6)
**Do:** Toggle, suggestion card, choose another (search sheet), optional note, preview, publish (`POST /items/daily-content`). One daily_content of each kind per masjid per day (soft warning if another exists).
**Acceptance:** [ ] Integration tests; musalli Hadith & Quran screen shows the new item as "Today's" hero.

### T3.8 — Dua request creator (B7)
**Do:** Category cards, message templates per category (ICU, 4 languages, draft-flagged), optional name with "Keep name private" default ON + consent hint, janaza time/place (inteqal), attach dua from library filtered by category, preview, publish (`POST /items/dua`).
**Acceptance:** [ ] Name never appears in API responses to musallis when private (integration test). [ ] Inteqal uses slate palette on musalli side.

### T3.9 — My Posts (B12) & edits
**Do:** List with type chips and statuses; Edit within 24 h (If-Match `updated_at` → 412 handled), Delete (confirm, soft delete → version bump → hidden), View. "edited" label on musalli side.
**Acceptance:** [ ] Edit after 24 h rejected (`EDIT_WINDOW_CLOSED`). [ ] Deleted item disappears for musallis after next poll (e2e).

### T3.10 — Masjid Profile (B13, partial)
**Do:** Photo change (pipeline), names view + "Request change" (creates a super-admin task note in audit + dashboard item), Hijri adjust with preview, account section (from Phase 1). Payment and Chanda sections arrive in Phase 5.
**Acceptance:** [ ] The policy layer's field allow-list prevents changing anything else (integration test with crafted payload, including `$set`-style and dotted keys).

### T3.11 — Shared preview & publish components
**Do:** `PreviewFrame` renders the real musalli components (imported from a shared package path, not duplicated) inside a phone frame with locale switcher; `PublishBar` with quota; `StepHeader`; `SuccessCheck` moment.
**Acceptance:** [ ] Preview output is byte-identical to the musalli rendering for the same item (component test comparing DOM snapshots).

### T3.12 — Usability verification
**Do:** Prepare a "5-task usability script" in the report for the owner (set Maghrib jamaat offset, publish "No water 10–2", publish today's hadith, create an illness dua request with private name, delete a post) — owner runs it with a real masjid person (owner guide Phase 03).
**Acceptance:** [ ] Script included; all 5 tasks achievable in ≤ 6 taps each (documented tap counts).

---

## Phase exit criteria
E2E journeys 6–7 green; library and template flows tested; image pipeline security tests green; budgets (admin initial JS ≤ 220 KB gz); phase-verifier PASS; security-reviewer clean; report includes tap counts and screenshots of every admin screen in 4 locales.
