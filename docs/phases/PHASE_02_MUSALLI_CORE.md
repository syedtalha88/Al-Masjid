# PHASE 02 — Musalli App Core

## Goal
A musalli can install the app, onboard in their language, follow masjids by QR / link / code, and use Home, My Masjids, Masjid Detail, Prayer Timings, Updates, Announcements, Hadith & Quran and Dua Requests (read side, with Ameen) — fast, offline-capable, beautifully animated, and pixel-close to the reference designs. Content comes from the dev/staging **seed** (admin creation tools arrive in Phase 3).

## Read before starting
`CLAUDE.md` · `00_PRODUCT_SPEC.md` §3.3–3.4, §4.1–4.3 (read rules), §4.6, §4.8, §7 · `01_ARCHITECTURE.md` §5.2, §5.6, §5.7, §9 · `02_DATA_MODEL.md` (devices, device_follows, items, ameens, §4 policy/views, §5 side effects) · `03_API_SPEC.md` §1–3, §7 · `04_SECURITY.md` §6, §9, §11 · `05_LEGAL_COMPLIANCE_IMPLEMENTATION.md` §1–2, §4 · `06_DESIGN_SYSTEM.md` (all) · `07_SCREEN_SPECS.md` A1–A9, A13, A15–A17 · `08_MOTION.md` (all) · `09_I18N.md` §4–5, §7 · `10_TESTING.md` §4–6 · **the 3 reference images**.

## Owner prerequisites
Turnstile site/secret keys (staging). A real Android phone and iPhone for checks.

## Out of scope
Push (Phase 4 — leave the soft-ask step and Settings → Notifications as visible-but-disabled "Coming soon" rows **not** shown to users in production builds), donations/chanda (5), videos (6), Qibla (7 — Home Qibla button navigates to a placeholder hidden in production), reports & full legal pages (8 — onboarding links to DRAFT privacy page).

---

## Tasks

### T2.1 — Domain logic (`packages/domain`) — test-first
**Do:** `prayer` (wrap `adhan`: methods incl. Karachi; madhab; per-prayer minute adjustments; `resolveSchedule` for adhan auto/manual + jamaat fixed/offset/none; Friday Jumu'ah substitution; sunrise; `nextJamaat(now)` incl. after-Isha → tomorrow's Fajr; Ramadan Sehri/Iftar with precautions), `hijri` (Umm al-Qura via Intl + offset + after-Maghrib rollover), `followCode` (generate/normalize/validate per 00 §4.1), `time` (IST wall-clock helpers, midnight rollover, server drift correction from `Date` header), `money` (paise ↔ ₹ with Indian grouping), `countdown` (formatting buckets "2h 18m", "48m", "Starts in 8 min", "Jamaat now").
**Acceptance:** [ ] 100% branch coverage. [ ] Golden prayer-time files for 7 cities × 6 dates with documented independent sources, ±1 min. [ ] Property tests: times monotonic within a day; follow code normalize ∘ generate = identity.

### T2.2 — Public API
**Do:** Implement every `03 §3` endpoint **except** reports, grievances, videos/play, legal (Phase 8 / 6): health, config, devices (register with Turnstile verify, patch, delete), resolve code, follows (put/patch/delete/get), versions, bundle (profile, schedules raw config + jumu'ah + special dates 60 days + ramadan; payment/campaign/chanda fields present but empty until Phase 5), feed (keyset pagination by `(published_at, id)`, type filter, audience filter), item detail (incl. library content, dua detail, ameen count), ameen (idempotent via `recordAmeen`), templates, library entry. All public reads go through the `v_pub_*` views with `publicScope()`; device writes through `deviceScope()` state functions (`followMasjid`, `unfollowMasjid`, `setDevicePrefs`, `deleteDevice`) so follow counts and the device→follows mirror stay consistent. Cache headers exactly per `01 §5.2` (stale `v` → 302 to current) plus `Cache-Tag`. `/m/:code` and `/p/:publicId` OpenGraph meta route (03 §3). Device auth middleware. Rate limits.
Dev/staging seed (`scripts/seed-dev.ts` used by `pnpm db:reset` + `scripts/seed-staging.ts` run on the staging VPS via the worker image): 3 fake masjids in Hyderabad/Delhi/Chennai with photos (CC0 placeholder images of generic buildings, or generated gradients — no real masjid photos), schedules, jumu'ah, a special Eid date, Ramadan mode on for one masjid, 30 items across announcement/daily_content/dua types using templates and **placeholder religious content only** (10 §5), library with 10 placeholder entries, 8 templates with English + draft translations.
**Acceptance:** [ ] Integration tests for every endpoint: success, validation failures, auth failures, rate limits, cache headers, audience filtering, suspended masjid behaviour (uniform 404 on resolve; bundle returns `status: suspended` for followers). [ ] `explain('executionStats')` of the feed, bundle, versions and resolve queries (through the views) shows `IXSCAN`, no `COLLSCAN`, docs examined ≤ 2× returned on a seeded collection of 100k items (test). [ ] Cloudflare caches versioned GETs on staging (`cf-cache-status: HIT` on the second request — automated check).

### T2.3 — Client data layer
**Do:** `lib/device` (IndexedDB via idb-keyval: device id/secret, locale, audience, privacy version, follows order, unseen markers, saved items, settings; schema-versioned with migrations), typed API client (03 §7), query key factory, persisted TanStack Query (IndexedDB, 30-day max age, buster = app version), version poller (focus + 60 s while visible + after push in Phase 4), content-version → targeted invalidation, offline detection, server time drift, device registration retry queue, reconciliation of local follows with server (`GET /devices/me/follows`).
**Acceptance:** [ ] Unit tests with MSW for poller/invalidation. [ ] Corrupt IndexedDB data → app resets gracefully (test).

### T2.4 — Onboarding (A1)
**Do:** Pages 1–6 (Install page: Android `beforeinstallprompt` captured early and stored; iOS guide). Notifications page hidden until Phase 4. Device registration on "Continue" from Privacy page (Turnstile invisible/managed). Live language/RTL switch with crossfade. Welcome illustration draw-in. Page swipe with parallax. Arrive-via-`/m/:code` path skips page 5 and auto-follows after onboarding.
**Acceptance:** [ ] E2E journey 1 (10 §6) on both device profiles, all 4 locales (parameterized). [ ] Registration offline → app continues, registers later (e2e with offline toggle).

### T2.5 — Scan, enter code, follow, landing
**Do:** A4 Scan modal (BarcodeDetector → fallback `qr-scanner` lazy chunk; camera permission flows; torch), Enter code sheet, follow preview sheet, success → Masjid Detail. `/m/:code` landing (A16) incl. iOS non-standalone explainer (DECISIONS #14) with large follow code. QR payload validation (04 §6). Follow cap handling.
**Acceptance:** [ ] E2E journey 2 with fake camera feed of a generated QR. [ ] Non-app QR rejected without navigation. [ ] iOS Safari (WebKit profile, non-standalone) shows explainer.

### T2.6 — Home (A2)
**Do:** Large-title NavBar with Hijri/Gregorian subtitle, Qibla + bell buttons; masjid carousel with snap + elongating dots; `MasjidCard` + `NextPrayerPanel` + `PrayerStrip` (sliding highlight, digit-roll countdown aligned to minute boundaries, Friday Jumu'ah); Ramadan card; Eid card; Recent Updates (5); empty state; pull-to-refresh; skeletons. Midnight/Maghrib rollover without reload.
**Acceptance:** [ ] Visual match vs ref-1/1 documented with side-by-side screenshot in report. [ ] Countdown correctness tests across prayer boundaries with mocked clock (component + e2e). [ ] LCP warm ≤ 1.0 s, cold ≤ 2.5 s (Lighthouse on staging).

### T2.7 — My Masjids (A3)
**Do:** List with thumbs, next prayer, unseen-count circles; "+ Add Masjid" pill; reorder mode (drag, persisted locally); unfollow with confirm + undo toast; "+ Add Another Masjid"; limit message.
**Acceptance:** [ ] Visual match vs ref-1/2. [ ] Reorder persists across reloads; unfollow removes server follow (integration via e2e network assertion).

### T2.8 — Masjid Detail (A5)
**Do:** Hero with thumbhash → image, scrim, parallax + overscroll scale, overlapping sheet, Verified badge, location, 3 CircleActions (Notifications = mute toggle stored server-side via follows PATCH, visible now; Share via Web Share/WhatsApp/copy; Directions), "…" menu (Share, Mute, Unfollow; Report added in Phase 8), UnderlineTabs (Overview / Prayer Timings / Announcements) with swipeable panels, Overview rows (only rows with content; counts of unseen), suspended state. Shared-element morph from Home/My Masjids cards (progressive).
**Acceptance:** [ ] Visual match vs ref-1/3. [ ] Shared element passes perf trace or is disabled in lite mode (documented).

### T2.9 — Prayer Timings (A6)
**Do:** DateStepper (−7…+60 days, date sheet), tabs Daily / Jumu'ah / Special Dates, PrayerTable with Sunrise muted row and "calculated" dots, JumuahCard, special dates list, InfoNote, Hijri under date pill, directional content slide on date change.
**Acceptance:** [ ] Visual match vs ref-1/4. [ ] Times rendered = `packages/domain` output for the masjid config (test).

### T2.10 — Updates (A13)
**Do:** Merged feed from all followed masjids (client merges per-masjid cached feeds by `published_at`), chips (types available so far; future types appear automatically when present), TimelineList with connector line, date headers, infinite scroll with virtualization > 50 items, unseen tracking + tab badge + bell dot.
**Acceptance:** [ ] Visual match vs ref-2/4. [ ] E2E journey 3. [ ] Fling scroll perf trace passes.

### T2.11 — Announcements, Hadith & Quran, Dua Requests (read side)
**Do:** A7 list + detail (image viewer with pinch-zoom, .ics download, share), A8 with hero card + regular cards + Read Full reader (font size A−/A+, transliteration toggle, copy, attribution line) + local Save, A9 list + detail with DuaBox, privacy of names, janaza row, **Ameen** (API + optimistic UI + motion 08 §5.6 + offline queue), Older section.
**Acceptance:** [ ] Visual match vs ref-2/1, ref-3/1 (announcements), ref-2/2 + ref-3/2 (hadith), ref-3/3 (dua). [ ] Ameen counts once per device (integration + e2e journey 8). [ ] Arabic text never mirrored, uses Amiri, renders correctly in all locales (screenshots).

### T2.12 — Settings (A15) & item landing
**Do:** Language, Brother/Sister, Saved, Vibration, Install app, My data ("what we store" + Clear all data → `DELETE /devices/me` + local wipe + back to onboarding), legal reader with DRAFT privacy policy + grievance officer details from config, About. `/p/:publicId` landing (A16).
**Acceptance:** [ ] E2E journey 12 (clear data). [ ] Changing Brother/Sister updates server device record and refilters feeds.

### T2.13 — PWA/offline completion
**Do:** SW runtime caching per 01 §5.6 (versioned API CacheFirst, versions NetworkFirst 3 s, images CacheFirst with expiration), `storage.persist()` after first follow, offline banner, install prompts in Settings, Android WebAPK link capture check for `/m/:code` (document behaviour), iOS standalone detection.
**Acceptance:** [ ] E2E journey 4 (offline). [ ] Installed Android app opens `/m/:code` links in-app (owner manual check).

### T2.14 — Quality gates
**Do:** E2E journeys 1–5, 8, 12 on both profiles; visual baselines (all new screens × 4 locales); perf traces (08 §8); Lighthouse budgets (01 §9); axe clean.
**Acceptance:** [ ] All green. [ ] Initial JS ≤ 170 KB gz.

---

## Phase exit criteria
Everything above + phase-verifier PASS + security-reviewer clean + report with side-by-side reference comparisons for every reference screen built in this phase.
