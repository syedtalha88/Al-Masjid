# PHASE 00 REPORT — Foundation, tooling & design system — **DRAFT (14 Oct 2026)**

> Draft written during the autonomous session of 14 Oct 2026. Sections marked **⏳ T0.14** are filled in after the
> staging server exists; the phase-verifier and security-reviewer runs happen at phase completion (CLAUDE.md §5).

**Date:** draft 14 Oct 2026 · **Commit range:** `ca5784d..bfc5af1` on `main` (+ `ci/t0.14-prep`) ·
**Staging URLs:** ⏳ T0.14 · **Deployed image digests:** server image released to GHCR by every green `main` run
(see the *Release to staging* job summary); web image ⏳ T0.14 (needs the staging variables).

## 1. Summary

The monorepo (pnpm + Turborepo, strict TypeScript) builds two installable, offline-capable PWAs (musalli + admin)
and four server processes (api-public, api-admin, worker, migrate) that run as hardened containers behind Caddy.
Both apps share a token-only design system, a 4-language i18n layer (Urdu RTL), a Motion-based navigation and
component library matching the reference images, strict security headers with CSP + Trusted Types, and
privacy-first error reporting (Sentry, off without a DSN). CI runs 5 required jobs (static, unit + coverage gates,
security scans, integration, build/e2e/Lighthouse) and releases images by digest; the VPS side (pull deploys with
signed manifests) is prepared and waits for the staging server session.

## 2. Tasks

| Task | Status | Key files | Tests |
|---|---|---|---|
| T0.1 Monorepo bootstrap | ✅ | `package.json`, `turbo.json`, `packages/config` | lint-rule tests (39) |
| T0.2 Env & config | ✅ | `packages/shared/src/env.ts`, `.env.example` | env tests (49+) |
| T0.3 CI pipeline | ✅ (owner checks 0.15–0.17 open) | `.github/workflows/*`, `.semgrep/` | green on `main` |
| T0.4 App & API scaffolds | ✅ | `apps/*`, `packages/api`, `infra/docker`, `infra/compose` | api 59, server 23 |
| T0.5 Security headers & CSP | ✅ (A+ grades ⏳ T0.14) | `infra/caddy/Caddyfile`, `@mc/ui/security` | 26 e2e + 5 unit |
| T0.6 Tokens, Tailwind, fonts | ✅ | `packages/ui/src/tokens` | in ui 202 |
| T0.7 i18n foundation | ✅ | `packages/i18n` | i18n 81 |
| T0.8 Motion foundation | ✅ | `packages/ui/src/motion` | in ui 202 |
| T0.9 Navigation system | ✅ (iPhone check F17 ⏳) | `packages/ui/src/navigation` | e2e navigation + perf |
| T0.10 Component library + showcase | ✅ | `packages/ui/src/components` | showcase e2e 19 |
| T0.11 PWA baseline | ✅ | `apps/*/src/sw`, `@mc/ui/pwa` | pwa e2e |
| T0.12 Testing infrastructure | ✅ | `@mc/config/{vitest,playwright,lighthouse}`, `.size-limit.js` | config 60 |
| T0.13 Observability | ✅ (Sentry end-to-end F28 ⏳ owner) | `@mc/shared/observability`, `@mc/ui/observability`, `apps/server/src/sentry.ts` | shared 108, e2e 8 |
| T0.14 Staging VPS & deployment | ⏳ held for the owner — prepared | `infra/vps/*`, `infra/edge`, `infra/compose/docker-compose.{vps,edge}.yml`, `infra/cloudflare/README.md`, `docs/runbooks/T0.14_STAGING_SESSION_PLAN.md` | deploy verify 9, firewall/log-archive/Redis/SNI tested locally |
| T0.15 Docs & decisions | ◐ README + runbook done; VPS parts + iOS finding ⏳ T0.14 | `README.md`, `docs/runbooks/DEPLOY.md`, DECISIONS #53 | README verified from a fresh clone |

## 3. Verification results (local + CI, 14 Oct 2026)

| Gate | Result | Numbers |
|---|---|---|
| Typecheck / lint / format | ✅ | 0 warnings (`pnpm verify:quick` 32/32 tasks) |
| Unit + component | ✅ | ui 202 · shared 108 · i18n 81 · config 60 · api 59 · server 23 · domain 20 · db 2 — coverage: domain 100/100, db 100, shared 100 (br 96.4), api 99 (br 92.4), server 96.3, config 93.9, i18n 93.0, ui 72.2 lines (gates per 10 §2 all pass) |
| DB policy matrix / privileges | n/a | Phase 1 (only per-file test databases + local service checks 11/11 so far) |
| Infra | ✅ (local) / ⏳ VPS | Trivy images + config: 0 HIGH/CRITICAL (Caddy built from source — F24); `check.sh` ⏳ on the server |
| API integration | ✅ | 3 + 2 integration tests (Redis/Mongo isolation, ACL NOPERM) |
| E2E (Pixel 7 / iPhone 14) | ✅ | CI: 125 passed, 12 skipped (engine-specific), flaky 0 (single worker in CI) |
| Accessibility (axe) | ✅ | 0 violations of any impact (stricter than serious/critical) on showcase in 4 locales, navigation, overlays |
| Visual regression | — | per-locale screenshots captured (`test-results/screens/<device>/<locale>/`); baselines from Phase 2 screens |
| Bundle budgets | ✅ | app initial JS 165.0 kB gz (Phase 00 limit 220 — #47; final 170), admin 163.3 kB; CSS 9.3 kB; largest lazy chunk 31.2 kB (Sentry, never loaded without DSN) |
| Lighthouse (mobile, CI) | ✅ | cold: Perf 99 / A11y 100 / BP 100, LCP ≈ 1.95 s, CLS 0, TBT 0 ms; warm (SW): LCP ≈ 0.1 s (warm TBT reported, not gated — #51, F27) |
| Motion perf traces | ✅ | long tasks > 50 ms: 0 over 8 repeats; visible dropped frames < 5 %; 0 layouts forced in rAF |
| phase-verifier | ⏳ | at phase completion |
| security-reviewer | ⏳ | at phase completion |

## 4. Screenshots

Showcase sections × 4 locales × 2 devices (`test-results/screens/…` in the CI `e2e-reports` artifact). No product
screens yet (Phase 2).

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

## 5. Deviations from spec

| Deviation | Decision |
|---|---|
| Phase 00 initial-JS budget 220 kB instead of 120 kB (back to 170 kB in Phase 01) | #47 |
| MSW 2.15 (not 3.x), Lighthouse 13 directly instead of LHCI | #48 |
| Warm-start TBT reported, not gated (spec defines warm budget as LCP) | #51 |
| Caddy built from source (patched Go/x/net) | #49 |
| Trusted Types policy list `default` only (no `dompurify`); HSTS without preload; no `interest-cohort` | #50, #29, #33 |
| Pull deploys with SSH-signed manifests; HAProxy SNI router on the shared VPS; root deploy timer | #27, #54, #55, #56 |
| Sentry v11 with `dataCollection` all off + own scrubber | #52 |

## 6. Known limitations / follow-ups

Open in `docs/PROGRESS.md`: F1 (Node 26 after 28 Oct), F13, F14, F16, F17 (iPhone checks — staging), F18, F20 (real
low-end Android), F21, F22, F23 (back to 170 kB in Phase 01), F24 (official Caddy binary when patched), F25
(signing keys — T0.14), F27 (warm-start re-layout after font load), F28 (Sentry end-to-end once the owner creates
the projects), F29 (done for the VPS).

## 7. What the owner should test now

`owner/PHASE_TESTING_GUIDE.md → Phase 00` after the T0.14 session (checks 0.1–0.14 need the staging URLs).
Now already possible: **0.15** (GitHub branch ruleset), **0.16** (failing PR is blocked — ask Claude Code for the
throw-away branch), **0.17** (production approval), **0.18** (optional Sentry).
