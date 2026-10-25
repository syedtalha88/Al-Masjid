# PHASE 02 REPORT — Musalli app core (follow, timings, feed, offline, install) — **DRAFT (25 Oct 2026)**

> Status: **AWAITING OWNER VERIFICATION** once CI, the phase-verifier and the security review below are green.
> Open deviation the owner should know first: the real-screen motion budget (08 §8) is **not met yet** — F46, the
> first task of Phase 03 (§5).

**Date:** 25 Oct 2026 · **Commit range:** `f7ef8a9..<close commit>` on `main` (Phase 02 started 22 Oct 2026) ·
**Staging URLs:** app https://app-staging.almasjids.com · admin https://admin-staging.almasjids.com ·
**Deployed release:** _filled in after the staging deploy_

## 1. Summary

A musalli can install the app, onboard in English, Hindi, Urdu (right-to-left) or Telugu, and follow masjids by QR
scan, follow link or 8-character code — without an account (a random device id/secret only). Home shows the next
jamaat with a live countdown, the day's five prayers, Ramadan and Eid cards and recent updates; My Masjids, Masjid
Detail, Prayer Timings (date stepper, Jumu'ah, special dates), the merged Updates timeline, Announcements, Hadith &
Quran and Dua Requests with Ameen (once per device, offline-queued) work against the public API, all from the
dev/staging seed. Settings changes language and Brother/Sister on the server, and Clear all data deletes the device
record. Everything renders from the cache offline, with an offline banner, also on "connected but no internet".

## 2. Tasks

| Task | Status | Key files | Tests / evidence |
|---|---|---|---|
| T2.1 Domain logic | ✅ | `packages/domain/src/{prayer,hijri,follow-code,time,money,countdown}.ts` | 136 tests, 100 % lines + branches; golden prayer times 7 cities × 6 dates (Aladhan) ±1 min; property tests (DECISIONS #90) |
| T2.2 Public API + seed | ✅ | `packages/api/src/routes/public.ts`, `packages/db/src/seed/` | every 03 §3 endpoint of the phase, integration as `mc_public`; explain tests on 100k items: IXSCAN, ≤ 2× examined (#91). CDN HIT on staging waits for O23 |
| T2.3 Client data layer | ✅ | `apps/app/src/lib/{device,api,query}/` | MSW tests for poller/invalidation, corrupt IndexedDB reset (#92) |
| T2.4 Onboarding (A1) | ✅ | `features/onboarding/` | `onboarding.spec.ts` (4 locales, arrival code, offline) (#93) |
| T2.5 Scan / code / follow / landing | ✅ | `features/follow/` | journey 2 `scan.scan.spec.ts` (fake camera), `follow.spec.ts` (#94) |
| T2.6 Home (A2) | ✅ | `features/home/` | `home.spec.ts` (pinned clock across the jamaat start) (#95) |
| T2.7 My Masjids (A3) | ✅ | `features/masjids/` | `my-masjids.spec.ts` (reorder keyboard/menu/drag, unfollow + undo) (#96) |
| T2.8 Masjid Detail (A5) | ✅ | `features/masjid/MasjidDetailScreen.tsx` | `masjid-detail.spec.ts` (#97) |
| T2.9 Prayer Timings (A6) | ✅ | `features/masjid/TimingsScreen.tsx` | `timings.spec.ts` (#98) |
| T2.10 Updates (A13) | ✅ | `features/updates/` | journey 3 `updates.spec.ts`, fling perf `updates.perf.spec.ts` (#99) |
| T2.11 Announcements / Hadith & Quran / Dua | ✅ | `features/content/` | journey 8 `content.spec.ts` (Ameen once, offline), Arabic in Amiri, never mirrored (#100) |
| T2.12 Settings & item landing | ✅ | `features/settings/`, `PostLanding.tsx` | journey 12 `settings.spec.ts` (Clear all data, server record) (#101) |
| T2.13 PWA / offline | ✅ | `src/sw/sw.ts`, `lib/{reachability,launch,storage,sw-protocol}.ts` | journey 4 `offline.spec.ts`; two bugs fixed (clock from cached `Date`, launch links) (#102) |
| T2.14 Quality gates | ✅ with deviation | `e2e/visual/`, `scripts/visual.mjs`, `e2e/app/screens.perf.spec.ts` | 80 visual baselines; real-screen perf spec `fixme` (F46); three bugs fixed (#103) |

## 3. Verification results

| Gate | Result | Numbers |
|---|---|---|
| Typecheck / lint / format | ✅ | 0 warnings (local; CI _pending_) |
| Unit + component | ✅ | app 154 (90.5 % lines / 88.5 % branches), ui 243, domain 136 (100 % / 100 %), shared 100 % lines, i18n 95 % lines |
| DB policy matrix / privileges | ✅ | unchanged from Phase 01 + `mc_public` view reads and device state functions (db int); CI _pending_ |
| API integration | ✅ | every public endpoint (success, validation, auth, rate limit, cache headers, audience, suspended) — CI _pending_ |
| E2E (Pixel 7 / iPhone 14) | ✅ | Pixel 7: 100 passed, 1 skipped (local, after the T2.14 changes); iPhone 14: _pending_; CI _pending_ |
| Journeys 1–5, 8, 12 | ✅ | both phones; journey 2 Chromium only (no fake camera in WebKit); journey 4's worker case Chromium only (#102, #103) |
| Accessibility (axe) | ✅ | every screen spec runs `expectAxeClean` (serious/critical 0) |
| Visual regression | ✅ | 10 screens × 4 locales × 2 phones = 80 baselines, compared in the pinned Playwright Linux image; two identical re-runs |
| Bundle budgets | ⚠️ deviation | musalli initial JS 185.2 kB gz (phase target ≤ 170; limit 186 per owner O24 — #103) |
| Lighthouse (mobile) | _pending CI_ | |
| Motion perf traces | ⚠️ partial | navigator push/pop + swipe and Updates fling: no long task > 50 ms, < 5 % dropped (CI). Real screens: F46 (§5) |
| phase-verifier | _pending_ | |
| security-reviewer | _pending_ | |

## 4. Screenshots

Visual baselines (also the screenshot set for this report): `e2e/visual/__screenshots__/visual-{pixel-7,iphone-14}/{en,hi,ur,te}/`
— `onboarding-welcome`, `home`, `my-masjids`, `masjid-detail`, `prayer-timings`, `updates`, `announcements`,
`hadith-quran`, `dua-requests`, `settings`.

Comparison with `docs/design-references` (side by side):

| Reference | Ours (`visual-pixel-7/en/…`) | Notes |
|---|---|---|
| ref-1 #6 Home | `home.png` | Same structure: greeting, My Masjids card with Next Prayer + countdown, five-prayer strip with the current one tinted, Recent Updates. Differences by spec: the subtitle is the Gregorian · Hijri date (07 A2); Qibla + bell top right; seed Ramadan / Eid cards sit above Recent Updates |
| ref-1 #7 My Masjids | `my-masjids.png` | Same: 3:4 thumbs, next prayer + countdown, "N new updates" badge, "+ Add Masjid" pill, "+ Add Another Masjid". Thumbs are ThumbHash gradients (no real photos in the test stack) |
| ref-1 #8 Masjid Detail | `masjid-detail.png` | Same: hero, overlapping sheet with Verified, three round actions, Overview / Prayer Timings / Announcements tabs, next prayer + strip, section rows with counts. Donation Campaigns / Weekly Chanda rows arrive with Phase 5 |
| ref-1 #9 Prayer Timings | `prayer-timings.png` | Same: date stepper, Daily / Jumu'ah / Special Dates, Adhan + Jamaat columns, info note |
| ref-2 #1 / ref-3 #1 Announcements | `announcements.png` | Category icons and cards as in the references |
| ref-2 #2 / ref-3 #2 Hadith & Quran | `hadith-quran.png` | Hero card + regular cards; placeholder content only (CLAUDE.md §2.3) |
| ref-3 #3 Dua Requests | `dua-requests.png` | Request cards with the dua box and Ameen |
| ref-2 #4 Updates | `updates.png` | Timeline with coloured icon circles and the connector line, filter chips, day headers |

## 5. Deviations from spec

- **Real-screen motion budget not met (08 §8) — F46, DECISIONS #103.** The new real-screen perf spec found taps of
  100–130 ms at 4× CPU; T2.14 fixed the causes it could find (forced layouts in ChipGroup / UnderlineTabs / Masjid
  Detail, navigator context re-rendering every screen, a new `Date` per render defeating memos, synchronous mounting of
  pushed screens) → ≈ 50–75 ms, but long tasks, 6–13 % dropped frames and one forced layout on sheet open remain over
  the limits. The spec is `test.fixme`; F46 is the first task of Phase 03, judged on a low-end phone (O16).
- **Initial JS 185.2 kB > 170 kB** — owner's "quality over bundle size" (O24); F42/F43 in Phase 9 (#103).
- **Shared-element morph (08 §3.5, progressive)** — Phase 9 polish (F44, #103).
- **Journey 2 on Chromium only** (WebKit has no fake camera); iPhone covers the code path (#103).
- **Visual projects bypass CSP** only because Playwright's screenshot styles are inline (#103).

## 6. Known limitations / follow-ups

All deferred with DECISIONS #103: F46 (Phase 03 first), F45 (dependency bumps, first session after 25 Oct 21:25 UTC),
F1 (Node 26 after 28 Oct), F22 admin icons (Phase 3), F18 / F42 / F43 / F44 (Phase 9). Owner items: O23 (Cloudflare
cache rule — T2.2's CDN HIT check), O8 Turnstile on staging, O16 low-end phone, Grievance Officer details before launch.

## 7. What the owner should test now

`owner/PHASE_TESTING_GUIDE.md` → Phase 02 (2.1–2.21, incl. new 2.19a Android back closes sheets; 2.8 updated — no
morph yet; 2.14 and 2.20 extended in T2.13). Seed data on staging: follow codes **TESTA001** (Hyderabad), **TESTB002**
(Delhi, Ramadan mode on), **TESTC003** (Chennai, Eid in 2 days) — or scan / open `https://app-staging.almasjids.com/m/TESTA001`.
The staging worker refreshes the seed daily so the Ramadan / Eid cards and "hours ago" stay current.
