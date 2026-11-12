# PHASE 07 REPORT — Qibla direction (simple)

> **Status: DRAFT — T7.3 / T7.4 being verified** (perf re-run after the paint-only alignment change, CI, phase-verifier,
> security review). Closes as "DONE — owner checks pending" under DECISIONS #162; the owner compares the arrow with a
> mihrab on one Android and one iPhone (guide Phase 07, O29).

**Date:** 13 Nov 2026 · **Branch:** `feat/phase-07` (on top of Phases 05 + 06) · **Staging:** with the next `main` ·
**Decisions:** #118 (simple page), #166 (how it is built).

## 1. Summary

Home → compass opens a calm Qibla page: the dial (ticks every 5°, N / E / S / W in Latin, never mirrored) with the
Kaaba marker and arrow at the Qibla bearing, "Qibla is 280° from North" and the distance to Makkah. Where from: the
phone's location after "Use my location" (kept on the phone only, rounded to ~100 m) or the first followed masjid's.
Phones with a compass turn the dial live (iPhone after one tap to allow motion); within ±3° the ring turns green with a
soft pulse, "You are facing the Qibla" and one short vibration. Without a compass the dial stays North-up with the
bearing large and a hint. No map, no city list, no calibration (DECISIONS #118). No request carries coordinates.

## 2. Tasks

| Task | Status | Key files | Tests |
|---|---|---|---|
| T7.1 Qibla math | ✅ | `packages/domain/src/qibla.ts`, `test/fixtures/qibla-golden.json` | 25 incl. golden 7 cities vs Aladhan + GeographicLib (±0.5°), distances ±1 %, fast-check; domain 100 % (306) |
| T7.2 Location & heading | ✅ | `features/qibla/hooks/{useQiblaLocation,useHeading}.ts`, `lib/heading.ts` | unit 7 (synthetic stream: wrap-around, noise, no compass, stop; platform rules); e2e: no request carries coordinates |
| T7.3 Qibla page (A14) | ⏳ | `features/qibla/QiblaScreen.tsx`, `components/QiblaDial.tsx` | e2e `qibla.spec.ts` 8 (masjid source, live, aligned, no compass, Use my location, iOS card, 4 locales, not mirrored); perf `qibla.perf.spec.ts`; visual `qibla` × 4 × 2 |
| T7.4 Quality gates | ⏳ | Caddyfile (admin Permissions-Policy), smoke test | budgets, visual, security review |

## 3. Verification results

| Gate | Result | Numbers |
|---|---|---|
| Typecheck / lint / format | ✅ local | 0 warnings |
| Unit | ✅ local | domain 306 (100 %), app qibla 7 |
| E2E (Pixel 7, local) | ✅ | qibla 8/8; axe clean in 4 locales |
| Perf (60 Hz stream, 4× CPU) | ⏳ | first trace: 110–140 ms per alignment change → the live part isolated, static face memoised, alignment now flips paint only — re-run pending |
| Visual | ✅ | `qibla` × en / hi / ur / te × Pixel 7 / iPhone 14 (no-compass state) |
| Permissions-Policy | ✅ | location + motion sensors on the app origin only; admin `()` (smoke test updated) |
| phase-verifier / security-reviewer | ⏳ | |

## 4. Screenshots

`a14-qibla` × 4 locales, `a14-qibla-facing`, `a14-qibla-no-compass` (e2e attachments); visual baselines `qibla`.
No reference image exists for A14; it follows 07 A14 and 06's tokens.

## 5. Deviations from spec

- The heading value is a small observable instead of a Motion `MotionValue` (08 §5.9's intent — no React state per
  event — kept; no new dependency for the app) (#166).
- iOS permission card only on iOS / iPadOS: Chromium also exposes `DeviceOrientationEvent.requestPermission` but
  grants without asking (#166).

## 6. Known limitations / follow-ups

Magnetic declination is not corrected (out of scope, #118): in India it is under 2°, inside the ±3° "aligned" zone.

## 7. What the owner should test now

`owner/PHASE_TESTING_GUIDE.md` → Phase 07 (7.1–7.8) on staging: compare the arrow with a masjid's mihrab on one Android
and one iPhone (O29).
