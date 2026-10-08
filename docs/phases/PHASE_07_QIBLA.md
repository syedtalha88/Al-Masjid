# PHASE 07 — Qibla Compass

## Goal
An accurate, calm, beautiful Qibla compass that works on cheap Android phones and iPhones, never sends the user's location anywhere, and degrades gracefully to a map when there's no compass.

## Read before starting
`CLAUDE.md` · `00_PRODUCT_SPEC.md` §4.5 · `01_ARCHITECTURE.md` §5.7 (qibla) · `04_SECURITY.md` §7 (Permissions-Policy, CSP for map tiles) · `05_LEGAL_COMPLIANCE_IMPLEMENTATION.md` §1 (location stays on device) · `07_SCREEN_SPECS.md` A14 · `08_MOTION.md` §5.9 · `10_TESTING.md` §4.

## Owner prerequisites
Decision on map tiles for the fallback (Claude Code proposes options with costs/terms in an OPEN decision at phase start — e.g. a hosted vector-tile provider free tier vs. a static low-zoom basemap bundled with the app).

---

## Tasks

### T7.1 — Qibla math & city dataset (test-first)
**Do:** `packages/domain/qibla`: Kaaba coordinates constant (21.4225° N, 39.8262° E), great-circle initial bearing, haversine distance, `headingFromOrientation(event, screenAngle, platform)` (iOS `webkitCompassHeading`; Android `deviceorientationabsolute` alpha → `(360 - alpha + screenAngle) % 360`; handle missing absolute), shortest-angle delta, exponential smoothing utility, optional magnetic declination correction (small WMM table/lib; India is within about ±2°, so behind a flag, default on if lib ≤ 10 KB). City dataset: ~500 Indian cities (name in 4 scripts where available + lat/lng) from an **open-licensed source** (e.g., GeoNames, CC BY) with attribution added to Licenses; bundled as a lazy JSON chunk.
**Acceptance:** [ ] Golden bearings/distances for 7 cities cross-checked with two independent calculators (sources documented), ±0.5°. [ ] Wrap-around and screen-rotation unit tests.

### T7.2 — Sensor & permission layer
**Do:** `useLocation` (geolocation on tap, high accuracy with 10 s timeout, fallback to city picker; cached last location locally), `useHeading` (iOS `DeviceOrientationEvent.requestPermission()` on tap; Android absolute orientation; detects unavailability within 2 s; accuracy from `webkitCompassAccuracy` or variance heuristic; calibration-needed detection), Wake Lock while screen open, cleanup on unmount/visibility change. Heading flows into MotionValues, not React state (08 §5.9).
**Acceptance:** [ ] Unit tests with synthetic event streams (noise, wrap-around, sudden jumps). [ ] No network requests containing coordinates (e2e network assertion).

### T7.3 — Compass UI (A14)
**Do:** Dial (SVG, ticks, N/E/S/W Latin), Kaaba marker, arrow, alignment state (±3°) with color/pulse/haptic (debounced), info rows (bearing, distance, heading, accuracy, location source with change-city), permission/calibration states with illustrations, reduced-motion behaviour.
**Acceptance:** [ ] Perf trace with synthetic 60 Hz events: no long tasks, ≤ 5% dropped frames under 4× CPU throttle. [ ] Screenshots 4 locales (dial not mirrored in Urdu).

### T7.4 — Map fallback
**Do:** Implement per the accepted tile decision: lazy chunk (MapLibre or a lightweight static-map approach), great-circle line to Kaaba, user marker, bearing text, attribution; CSP updated for tile hosts only.
**Acceptance:** [ ] Desktop/no-sensor → map mode automatically. [ ] Chunk within budget (document size).

### T7.5 — Quality gates
**Do:** e2e for permission flows (mocked), visual baselines, budgets, security review (Permissions-Policy, CSP).

---

## Phase exit criteria
Owner compares the compass with a known masjid mihrab direction on at least one Android and one iPhone (owner guide Phase 07); phase-verifier PASS; security-reviewer clean.
