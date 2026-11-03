# PHASE 07 — Qibla Direction (simple)

## Goal
A **simple, beautiful Qibla direction page** (owner, 3 Nov 2026 — DECISIONS #118): the Kaaba direction from where the
musalli stands, an arrow that turns with the phone where the phone has a compass, and the bearing in degrees from North
where it doesn't. The design must be good (calm, premium, smooth); the logic stays simple — no map, no city list, no
calibration or accuracy machinery. The user's location never leaves the phone.

## Read before starting
`CLAUDE.md` · `00_PRODUCT_SPEC.md` §4.5 · `01_ARCHITECTURE.md` §5.7 (qibla) · `04_SECURITY.md` §7 (Permissions-Policy)
· `05_LEGAL_COMPLIANCE_IMPLEMENTATION.md` §1 (location stays on device) · `07_SCREEN_SPECS.md` A14 · `08_MOTION.md` §5.9
· `10_TESTING.md` §4 · **DECISIONS #118**.

## Owner prerequisites
None.

## Out of scope (DECISIONS #118)
Map fallback and map tiles, a bundled city list, magnetic declination correction, compass accuracy / calibration
detection, Wake Lock.

---

## Tasks

### T7.1 — Qibla math (test-first)
**Do:** `packages/domain/qibla`: Kaaba coordinates constant (21.4225° N, 39.8262° E), great-circle initial bearing,
haversine distance, `headingFromOrientation(event, screenAngle, platform)` (iOS `webkitCompassHeading`; Android
`deviceorientationabsolute` alpha → `(360 - alpha + screenAngle) % 360`; `null` when no absolute heading),
shortest-angle delta, simple exponential smoothing.
**Acceptance:** [ ] Golden bearings/distances for the 7 test cities cross-checked with two independent calculators
(sources documented), ±0.5°. [ ] Wrap-around (359° → 0°) and screen-rotation unit tests.

### T7.2 — Location & heading (simple)
**Do:** Location: "Use my location" (geolocation on tap, 10 s timeout); otherwise — or if refused — the first followed
masjid's coordinates ("Using: <masjid name>"); the last location is kept on the phone only. Heading: iOS
`DeviceOrientationEvent.requestPermission()` on a tap; Android absolute orientation; no heading within 2 s → no-compass
mode. Heading goes into a MotionValue, not React state (08 §5.9); listeners removed on leave / hidden.
**Acceptance:** [ ] Unit tests with a synthetic event stream (wrap-around, noise). [ ] No network request carries
coordinates (e2e network assertion).

### T7.3 — Qibla page (A14)
**Do:** The A14 page: dial (SVG, ticks, N/E/S/W in Latin, never mirrored), Kaaba marker, arrow; aligned (±3°): ring
colour + soft pulse + one haptic (debounced); "Qibla is 287° from North", distance to Makkah, location line with
change; no-compass mode: the dial fixed with North up, the bearing large, and a one-line hint ("Face 287° from North —
use your phone's compass app if you need to"); permission states as simple cards. Reduced motion: no pulse, the arrow
snaps instead of gliding.
**Acceptance:** [ ] Perf trace with synthetic 60 Hz events at 4× CPU within the 08 §8 budget (owner tolerance
#116). [ ] Screenshots + axe in 4 locales (dial not mirrored in Urdu). [ ] E2E for the permission and no-compass
states (mocked sensors).

### T7.4 — Quality gates
**Do:** budgets (the page is a lazy chunk), visual baselines, security review (Permissions-Policy allows
geolocation/sensors on the app origin only).

---

## Phase exit criteria
Owner compares the arrow with a known masjid mihrab direction on one Android and one iPhone (owner guide Phase 07);
phase-verifier PASS; security-reviewer clean.
