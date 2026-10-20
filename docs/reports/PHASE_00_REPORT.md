# PHASE 00 REPORT — Foundation, tooling & design system — **FINAL (20 Oct 2026)**

> Phase 00 was accepted by the owner on 16 Oct 2026 with closure items carried alongside Phase 01 (DECISIONS #62).
> This is the closure report (V-22). **Still open for DONE:** owner checks 0.15 / 0.16 (branch ruleset + failing-PR
> proof — the owner does them last, see §7). DECISIONS #79 (latency) was accepted by the owner on 20 Oct 2026.

**Date:** 20 Oct 2026 · **Commit range:** `ca5784d..261f4c9` on `main` (Phase 00 + Phase 01 so far share `main`) ·
**Staging URLs:** app https://app-staging.almasjids.com · admin https://admin-staging.almasjids.com ·
**Deployed image digests** (signed staging manifest, release `b9eb751`, 20 Oct 2026 10:28 UTC; every green `main`
replaces it):
server `ghcr.io/syedtalha88/al-masjid-server@sha256:bb8302c8963e2205b7772ececdfaed7dd40fe2dbd11ba8aeb70a38153cc8ba71` ·
web `ghcr.io/syedtalha88/al-masjid-web@sha256:f98bfbafa82c4cbabf85b6b1b25f9ee5479040d33e159953f8ada6c7b740fc6e`

## 1. Summary

The monorepo (pnpm + Turborepo, strict TypeScript) builds two installable, offline-capable PWAs (musalli + admin)
and four server processes (api-public, api-admin, worker, migrate). They run as hardened containers behind Caddy,
on a hardened Hostinger VPS that Cloudflare fronts and only Cloudflare can reach.

Both apps share:
- a token-only design system;
- a 4-language i18n layer (Urdu RTL);
- a Motion-based navigation and component library that matches the reference images;
- strict security headers with CSP + Trusted Types (Mozilla Observatory A+ 135 on both hosts).

Releases are signed manifests, which the server pulls and deploys by image digest. Rollback was demonstrated, and the
reboot test passed. CI runs 5 required jobs plus CodeQL and a Nightly. The owner checked both apps on an iPhone and a
Poco F7 (checks 0.1–0.14).

## 2. Tasks

| Task | Status | Key files | Tests / evidence |
|---|---|---|---|
| T0.1 Monorepo bootstrap | ✅ | `package.json`, `turbo.json`, `packages/config` | lint-rule tests (61); `docs/reports/evidence/PHASE_00_T0.1_lint-proof.txt` |
| T0.2 Env & config | ✅ | `packages/shared/src/env.ts`, `.env.example` | env tests in shared (136), boot tests per process (server 24) |
| T0.3 CI pipeline | ✅ — PR-block proof = owner 0.16 (§7) | `.github/workflows/*`, `.semgrep/` | green on `main` (`261f4c9`: 5 jobs) |
| T0.4 App & API scaffolds | ✅ | `apps/*`, `packages/api`, `infra/docker`, `infra/compose` | api unit 98, `e2e/smoke/stack.spec.ts`; README first run fixed 20 Oct (`pnpm db:reset`) |
| T0.5 Security headers & CSP | ✅ | `infra/caddy/Caddyfile`, `@mc/ui/security` | `security-headers.spec.ts`; A+ evidence `docs/reports/evidence/PHASE_00_T0.5_headers_2026-10-20.txt` |
| T0.6 Tokens, Tailwind, fonts | ✅ | `packages/ui/src/tokens` | ui 204, `fonts.spec.ts` (active-locale fonts only, CLS ≤ 0.01) |
| T0.7 i18n foundation | ✅ | `packages/i18n` | i18n 84, `pnpm i18n:check` |
| T0.8 Motion foundation | ✅ | `packages/ui/src/motion` | in ui 204 |
| T0.9 Navigation system | ✅ | `packages/ui/src/navigation` | navigation e2e + perf; iOS swipe-back confirmed (#75); screen readers checked by the owner (O19, TalkBack + VoiceOver, 20 Oct) |
| T0.10 Component library + showcase | ✅ | `packages/ui/src/components` | showcase e2e (axe × 4 locales, sheet behaviour); §4.1 visual comparison |
| T0.11 PWA baseline | ✅ | `apps/*/src/sw`, `@mc/ui/pwa` | `pwa.spec.ts`; owner 0.10–0.12 on both phones |
| T0.12 Testing infrastructure | ✅ | `@mc/config/{vitest,playwright,lighthouse}`, `.size-limit.js` | config 61; `docs/reports/evidence/PHASE_00_T0.12_coverage-gate-proof.txt` |
| T0.13 Observability | ✅ (Sentry end-to-end F28 waits for the owner's optional Sentry projects) | `@mc/shared/observability`, `@mc/ui/observability`, `apps/server/src/sentry.ts` | scrubber tests; no `.map` served |
| T0.14 Staging VPS & deployment | ✅ (owner-accepted 16 Oct, #62) | `infra/vps/*`, `infra/edge`, `infra/compose/docker-compose.{vps,edge}.yml`, `docs/runbooks/DEPLOY.md` | `check.sh` 106 PASS · 0 FAIL · 2 WARN (`docs/reports/evidence/PHASE_00_T0.14_check-sh_2026-10-20.txt`); deploy-verify tests in CI |
| T0.15 Docs & decisions | ✅ (20 Oct, #75) | `README.md`, `docs/runbooks/DEPLOY.md`, `docs/DECISIONS.md` | README "First run" re-checked 20 Oct |

## 3. Verification results (20 Oct 2026)

| Gate | Result | Numbers |
|---|---|---|
| Typecheck / lint / format | ✅ | 0 warnings; turbo typecheck + lint + root checks all green; Prettier clean |
| Unit + component | ✅ | ui 204 · shared 136 · api 98 · i18n 84 · config 61 · db 30 · server 24 · domain 23 · admin 21. The 10 §2 coverage gates pass in CI (unit job). db and api coverage is gated on their integration runs |
| DB policy matrix / privileges | ✅ (Phase 01 work) | `pnpm db:test` 145; staging `deploy.sh --verify-roles` 17/17 PASS (#63) |
| Infra | ✅ | Trivy images + config: 0 HIGH/CRITICAL (CI + Nightly). `check.sh` on the VPS: 106 PASS · 0 FAIL · 2 WARN (no userns remap → #74; production not deployed yet). Origin lock-down: 443 unreachable directly, TLS without Cloudflare's client certificate refused (`tlsv13 alert certificate required`, 16 Oct; check.sh line 106 on 20 Oct) |
| API integration | ✅ | api 142 · db 145 (Phase 00 + 01) |
| E2E (Pixel 7 / iPhone 14) | ✅ | full local run on the shipped stack 20 Oct: 135 passed, 16 skipped (engine-specific). The WebKit showcase spec flaked under 4 local workers and passed 9/9 with one (CI uses one worker) |
| Accessibility (axe) | ✅ | 0 violations of any impact on the showcase in 4 locales, navigation, overlays; Lighthouse a11y 100 on both apps |
| Visual regression | — | per-locale screenshots are captured in CI (artifact); baselines start with the Phase 2 screens |
| Bundle budgets | ✅ | app initial JS 165.4 kB gz (limit 170 — #47 / F23), admin 210.9 kB (220); CSS 9.35 kB (25); every lazy chunk ≤ 60 kB |
| Lighthouse (mobile, local 20 Oct, median of 3) | ✅ | app cold 99 / 100 / 100, warm 100 / 100 / 100. admin cold 97 / 100 / 96, warm 100 / 100 / 96. Admin best-practices 96 = the browser logging the expected `401` from `/auth/me` before sign-in (the login gate), not an error |
| Motion perf traces | ✅ | `pnpm test:perf` 2/2: no long task > 50 ms at 4× CPU |
| Security headers | ✅ | Mozilla Observatory A+ 135, 12/12 on both hosts (20 Oct); securityheaders.com A+ (owner, 16 Oct) |
| phase-verifier (V-31) | ✅ with open items | 20 Oct 2026: every criterion PASS except T0.3 PR-block (owner 0.16, §7), T0.15 README (fixed the same day) and the latency target (#79 — accepted by the owner, option A). Housekeeping done: F25 closed, `db:verify-roles` stub replaced, evidence files added |
| security-reviewer (V-31) | 0 HIGH / 0 MEDIUM open | 20 Oct 2026, scope `69ca205..b9eb751`: 1 HIGH + 3 MED found and fixed with tests (add-passkey step-up, IPv6 /64 limits, item policy value checks, `safeText`). 10 LOW fixed or justified — DECISIONS #80; L2 → #81 (owner: limit raised to 30 / 10 min) |

## 4. Screenshots

- **Showcase:** sections × 4 locales × 2 devices, from `e2e/components/showcase.spec.ts` (CI `e2e-reports` artifact;
  artifacts expire, so the committed set is the visual table below).
- **Admin dashboard alert:** phone en / ur (RTL) and desktop, checked on 20 Oct 2026 (Phase 01, T1.8).
- **Product screens:** none yet (Phase 2).

### 4.1 Visual comparison with the reference images (T0.10 acceptance; re-review V-6)

Captured 16 Oct 2026 from staging `/_dev/showcase` (Pixel 7, English, reduced motion) — files in
`docs/reports/evidence/PHASE_00_T0.10_visual/`. Refs: **R1** `ref-1_home_my-masjids_detail_timings.png`,
**R2** `ref-2_announcements_hadith_donation-detail_updates.png`, **R3** `ref-3_announcements_hadith_dua_donation-campaign.png`
(screen numbers as printed under each phone).

| Component | Reference | Capture | Match | Differences (and why) |
| --- | --- | --- | --- | --- |
| Button variants | R3 #13 "Donate Now" (filled), "Show UPI QR Code" (tonal); R3 #11 "Share" (outline), "Read Full" (tonal); R1 #7 "Add Another Masjid" (outline, full width) | `buttons.png` | ✅ | Filled / tonal / outline / text pills, full-width and inline sizes, leading icon. Extra states the refs don't show: destructive, loading spinner, disabled (06 §6). |
| ChipGroup | R3 #10 and #12 (All · General · Events · Facilities; All · Illness · Inteqal · Other) | `tabs.png` | ✅ | Selected = filled primary pill, others neutral surface — R3 style. R2 #10 draws a lighter tonal + underline chip; 06 §6 follows R3 (one chip style app-wide). |
| SegmentedControl | R3 #11 (Hadith / Quran) | `tabs.png` | ✅ | Filled primary thumb on a neutral track, as R3. R2 #11 uses a tonal underline variant — not adopted (same reason as chips). |
| UnderlineTabs | R1 #8 (Overview · Prayer Timings · Announcements), R1 #9 (Daily Timings · Jumu'ah · Special Dates) | `tabs.png` | ✅ | Active label primary + bold with the primary indicator (06 §6: 2.5 px, slides between tabs) under the full tab, hairline track. |
| TabBar + ScanFab | R1 #6/#7, R2 #13, R3 (all) | `navbar.png` (bottom) | ✅ | Five slots Home · My Masjids · (Scan) · Updates · Settings; raised primary circle with scan glyph, active tab filled icon + primary label. Ours has a surface-coloured ring around the FAB, which R1 #6 shows only faintly — owner to judge with the design notes (O7); the "My Masjids" glyph is our masjid outline instead of R1's calendar-like icon (06 icon set). |
| ListRow with IconCircle | R1 #6 "Recent Updates", R2 #13 "Updates", R2 #10 | `cards.png` | ✅ | Tinted icon circle per category (megaphone red, dua pink, book blue), bold title, 2-line clamp body, meta "masjid • time", count badge + chevron, inset divider. Text in captures = clearly fake fixtures (CLAUDE.md §2.3). |
| Tag colors | R2 #10 Important (red) · Event (green) · General (grey); R3 #12 Illness (pink) · Inteqal (grey-blue); R1 #8 Verified | `tags.png` | ✅ | Same hues on tinted backgrounds. "Facilities" (amber, `sun-bg` / `#9A6A00` — 06 icon table) has no example in the refs. |
| InfoNote | R1 #9 ("Timings may change…"), R3 #13 ("Payments are made directly…") | `tags.png` | ✅ | Neutral rounded panel, outlined info icon at the start, secondary text. |
| ProgressBar | R2 #12, R3 #13 (72 %) | `progress.png` | ✅ | Rounded primary-500 fill on a neutral track. The "72 %" / "₹72,000 raised" labels belong to the campaign composite (Phase 5), not the bar. |
| NavBar large | R1 #6 "Assalamu Alaikum" + lead, R1 #7 "My Masjids", R2 #13 "Updates" | `navbar-large.png` (top), `cards.png` (collapsed) | ✅ | Large left-aligned title with a secondary lead line; on scroll it collapses into a centered inline title (08 §4). |
| NavBar inline | R2 #10 "Announcements / Masjid Al-Noor", R1 #9, R3 (all) | `navbar.png` | ✅ | Back chevron, centered headline title with caption subtitle, trailing action. The showcase wraps it in a card only to set it apart from the page. |

Not compared here (no product screens until Phase 2): photo headers, MasjidCard, PrayerStrip, campaign cards — they
are composites built in their own phases against the same refs.

### 4.2 Staging evidence

- **Rollback demo (16 Oct 2026):**
  - The deploy timer deployed release #2 `6bde56e` with nobody on the server.
  - `deploy.sh staging --rollback` went back to `eae9d1c`. It rolled container by container, and the site stayed up
    throughout, verified from outside on both APIs and the web `mc-release` header.
  - The timer then moved forward to release #3 `cd3fb57`.
- **Reboot test (16 Oct 2026):** the firewall came up before Docker, all 8 containers were healthy, the timers were
  listed, both sites returned 200 from outside, and NTP synced a minute after boot.
- **Latency VPS → Atlas ap-south-1 (O9, 20 Oct 2026):**
  - Method: `curl` `time_connect`, 3 runs per shard.
  - Raw values: 0.200 / 0.170 / 0.179 · 0.009 / 0.181 / 0.174 · 0.182 / 0.009 / 0.171 s.
  - The 9 ms runs had DNS cached, so ≈ 9 ms is the network round trip; the ~170 ms runs include the DNS lookup.
  - Target ≤ 5 ms is not met. The owner accepted ≈ 9 ms for staging (DECISIONS #79, option A); Phase 9
    re-measures production.

## 5. Deviations from spec

| Deviation | Decision |
|---|---|
| Phase 00 initial-JS budget 220 kB instead of 120 kB (back to 170 kB since Phase 01 — measured 165.4) | #47 (F15, F23) |
| MSW 2.15 (not 3.x); Lighthouse 13 directly instead of LHCI | #48 |
| Warm-start TBT reported, not gated (spec defines the warm budget as LCP); owner kept `font-display: swap` | #51 (F27) |
| Caddy built from source (patched Go / x/net) | #49 (F24) |
| Trusted Types policy list `default` only (no `dompurify`); HSTS without preload; no `interest-cohort` | #50, #29, #33 |
| Installability checked via CDP instead of the removed Lighthouse PWA category | #30 |
| Pull deploys with SSH-signed manifests; HAProxy SNI router on the shared VPS; root systemd deploy timer instead of a restricted `deploy` user | #27, #54, #55, #56 |
| Zone-level Authenticated Origin Pulls with our own CA | #57 |
| Showcase on staging only (production builds pin it off) | #58 |
| Host layer installed only by `provision.sh host <sha>`; releases bring image digests only | #59, #61 |
| No Docker userns remapping in v1; no Caddy access log | #74 |
| Admin client uses the platform WebAuthn API, no `@simplewebauthn/browser` (affects 01 §4's library list) | #72 |
| CI jobs that start MongoDB run on `ubuntu-22.04` while the 24.04 runner kernel (7.0.0) blocks MongoDB 8 | #76 (F35) |
| Staging VPS → Atlas latency ≈ 9 ms vs. ≤ 5 ms target (accepted for staging, re-measured in Phase 9) | #79 |
| Sentry v11 with `dataCollection` all off + own scrubber | #52 |

## 6. Known limitations / follow-ups

Open in `docs/PROGRESS.md`, each with its decision:

| Item | What | Decision / when |
|---|---|---|
| F1 | Node 24 → 26 after 28 Oct 2026 | #32, #53 |
| F13 | Hijri month-name fallback table (te/hi) | #74 → Phase 2 T2.1 |
| F14 | Precompile ICU messages if the 170 kB budget tightens | #38 |
| F16 | Persist the haptics setting + Settings toggle | #43 → Phase 2 |
| F18 | Replace the Phase 0 placeholder screens | #74 → Phase 2 |
| F20 | Real low-end Android performance check | #74 → Phase 2 (owner O16 phone) |
| F21 | Android/browser back closes an open Sheet/Dialog | #45 → Phase 2 |
| F22 | Icon design pass (dua, megaphone + Phase 01 admin icons) | #74 → before Phase 2 screens |
| F24 | Back to the official Caddy binary once patched | #49 |
| F27 | Warm-start re-layout after the font load (reported, not gated) | #51 — owner kept `swap`; phone checks fine (O7) |
| F28 | Sentry end-to-end once the owner creates the projects (optional) | #52 |
| F31 | Turnstile switch-over (Phase 2), Cloudinary + purge token (Phase 3) | #74 |
| F35 | MongoDB CI jobs back to ubuntu-24.04 when its kernel ≥ 7.0.14 | #76 |
| F36 / F37 | `deploy.sh` log wording; VPS Redis ACL without SCAN — next host-layer update | #80 |
| F38 | Push alert on new Super Admin passkeys (Phase 4); self-service passkey removal (Phase 3) | #80 |

Known limitations:
- **Translations:** hi / ur / te strings are drafts awaiting human review (276 per locale, `packages/i18n/review/*.csv`).
- **Low-end phone:** real low-end Android performance waits for a test phone (O16). The throttled CI perf spec is the
  gate meanwhile.

## 7. What the owner should test now

- **Done:** owner checks **0.1–0.14** (16 Oct 2026, iPhone + Poco F7; 0.2 / 0.13 verified in T0.14), **0.17**
  (production reviewer, admin bypass off — 20 Oct 2026), O19 screen readers and F17 swipe-back (20 Oct 2026).
- **Remaining — do last (`owner/MY_PENDING_TASKS.md` → O6):**
  - **0.15** branch ruleset on `main` with the 6 required checks:
    - `Typecheck · lint · format · i18n`
    - `Unit + component tests (coverage gates)`
    - `Security scans`
    - `Integration tests (MongoDB + Redis)`
    - `Build · budgets · images · e2e · Lighthouse`
    - `CodeQL (javascript-typescript)`
  - **0.16** a deliberately failing PR is blocked. Ask Claude Code for the throw-away branch.
  - After this, `main` changes only through pull requests.
- **Optional:** 0.18 Sentry.
- **Answered 20 Oct 2026:** DECISIONS #79 (A) and #81 (A).
- **Design notes:** the owner's notes from O7 (incl. whether the black top strip — V-19, fixed 16 Oct — is still
  visible, and the Scan-button ring from §4.1) go to the phase they belong to.
