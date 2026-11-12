# PHASE 07 REPORT — Qibla direction (simple)

> **Status: FINAL — DONE, owner checks pending** (DECISIONS #162). CI green on `ci/phase-07` `f4b9231` (run
> 43258177290) before the phase-verifier fixes (#169); those are verified locally (Pixel 7 + iPhone 14) and go through
> CI with the merge into `main`, which takes Phases 06 + 07 to staging. The owner compares the arrow with a mihrab on one Android
> and one iPhone (guide Phase 07, O29).

**Date:** 12 Nov 2026 · **Commits:** `ce213da..f4b9231` on `feat/phase-07` (on top of Phases 05 + 06) · **Staging:**
with the merge into `main` · **Decisions:** #118 (simple page), #166 (how it is built), #167 (security review fixes,
iPhone e2e, Qibla in every build), #169 (phase-verifier fixes).

## 1. Summary

Home → compass opens a calm Qibla page: the dial (ticks every 5°, N / E / S / W in Latin, never mirrored) with the
Kaaba marker and arrow at the Qibla bearing, "Qibla is 280° from North" and the distance to Makkah. Where from: the
phone's location after "Use my location" (kept on the phone only, rounded to ~1 km — the bearing moves < 0.05° anywhere in India) or the first followed masjid's.
Phones with a compass turn the dial live (iPhone after one tap to allow motion); within ±3° the ring turns green with a
soft pulse, "You are facing the Qibla" and one short vibration. The page opens from the Home compass button and from
the installed app's "Qibla" shortcut (long-press the icon) in every build. Without a compass the dial stays North-up with the
bearing large and a hint. Travelling: "Update my location", or "Use <masjid> instead" to drop the phone's location.
No map, no city list, no calibration (DECISIONS #118). No request carries coordinates.

## 2. Tasks

| Task | Status | Key files | Tests |
|---|---|---|---|
| T7.1 Qibla math | ✅ | `packages/domain/src/qibla.ts`, `test/fixtures/qibla-golden.json` | 25 incl. golden 7 cities vs Aladhan + GeographicLib (±0.5°), distances ±1 %, fast-check; domain 100 % (306) |
| T7.2 Location & heading | ✅ | `features/qibla/hooks/{useQiblaLocation,useHeading}.ts`, `lib/heading.ts` | unit 7 (synthetic stream: wrap-around, noise, no compass, stop; platform rules); e2e: no request carries coordinates |
| T7.3 Qibla page (A14) | ✅ | `features/qibla/QiblaScreen.tsx`, `components/QiblaDial.tsx` | e2e `qibla.spec.ts` 12 on Pixel 7 **and iPhone 14** (masjid source, live, aligned, no compass, Use my location + travelling, location refused, no followed masjid, reduced motion, iOS granted / refused, 4 locales, not mirrored); perf `qibla.perf.spec.ts` 3/3; visual `qibla` × 4 × 2 |
| T7.4 Quality gates | ✅ | Caddyfile (admin + media Permissions-Policy), `api/test/no-device-location.test.ts`, Semgrep `mc-geolocation-only-in-qibla` | budgets, visual 40/40, security review, CI |

## 3. Verification results

| Gate | Result | Numbers |
|---|---|---|
| Typecheck / lint / format | ✅ local | 0 warnings |
| Unit | ✅ local + CI | domain 306 (100 %), app qibla 14 (incl. the `useHeading` hook 5) + device schema / clear-data / rounding; api no-device-location contract |
| E2E | ✅ | qibla 12/12 on Pixel 7 (×3 runs) and iPhone 14 (Linux image); axe clean in 4 locales; the network check watches the whole context incl. the service worker, URLs and headers |
| Perf (60 Hz stream, 4× CPU) | ✅ | 3/3, opened from a settled Home, 3 s heading sweep through North and the aligned zone: no long task over 50 ms, < 5 % dropped frames (first trace had 110–140 ms → live part isolated, static face memoised, alignment flips opacity / visibility only) |
| Visual | ✅ | 40/40; `qibla` × en / hi / ur / te × Pixel 7 / iPhone 14 (no-compass state); `home`, `donations-home` regenerated for the compass button |
| Permissions-Policy | ✅ | location + motion sensors on the app origin only; admin and media origins deny all (smoke test) |
| Bundle budgets | ✅ | musalli initial JS 189.04 / 190 kB, `qibla` chunk 3.87 kB (+0.07 kB, owner rule "quality over budgets"); Qibla route lazy |
| CI | ✅ | run 43258177290 on `f4b9231`: typecheck · lint · i18n, unit, integration, security scans, build · e2e · Lighthouse |
| security-reviewer | ✅ | 0 HIGH · 1 MEDIUM · 5 LOW, all fixed (#167): no-device-location contract test + Semgrep rule, dial name in an SVG `<title>`, ~1 km rounding, whole-context network check, device-schema tests, media Permissions-Policy |
| phase-verifier | ✅ after fixes | first run FAIL (4 required + docs): no way to change the phone's location, the glow ring drifted (scale on SVG), no reduced-motion / permission-state tests → all fixed, plus 5 of 7 LOW items (#169) |

## 4. Screenshots

`a14-qibla` × 4 locales, `a14-qibla-facing`, `a14-qibla-no-compass` (e2e attachments); visual baselines `qibla`.
No reference image exists for A14; it follows 07 A14 and 06's tokens.

## 5. Deviations from spec

- The heading value is a small observable instead of a Motion `MotionValue` (08 §5.9's intent — no React state per
  event — kept; no new dependency for the app) (#166).
- Kept location rounded to 2 decimals (~1.1 km) instead of ~100 m (#167 L2 — less precise data on the phone, no
  visible change to the bearing).
- "Use <masjid> instead" on the source card (not in 07 A14): the way back from the phone's location, which also deletes
  it from the phone (#169).
- iOS permission card only on iOS / iPadOS: Chromium also exposes `DeviceOrientationEvent.requestPermission` but
  grants without asking (#166).

## 6. Known limitations / follow-ups

Magnetic declination is not corrected (out of scope, #118): in India it is under 2°, inside the ±3° "aligned" zone.
Locally, the unrelated `screens.perf` "Home → Masjid Detail" spec fails about 1 run in 3 on this Windows machine (one
~70 ms tap at 4× CPU); it is green on CI and nothing in Phase 07's fixes touches those screens.

## 7. What the owner should test now

`owner/PHASE_TESTING_GUIDE.md` → Phase 07 (7.1–7.8) on staging: compare the arrow with a masjid's mihrab on one Android
and one iPhone (O29).
