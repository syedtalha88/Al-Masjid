# PROGRESS

> Claude Code updates this file after every task. The owner reads it to see where the build is.
> Status values: `NOT STARTED` · `IN PROGRESS` · `AWAITING OWNER VERIFICATION` · `DONE` · `BLOCKED (see DECISIONS #n)`

## Phase status

| Phase | Title | Status | Report | Owner verified on |
|---|---|---|---|---|
| 00 | Foundation, tooling & design system | IN PROGRESS | – | – |
| 01 | Database, security core, passkey auth, Super Admin | NOT STARTED | – | – |
| 02 | Musalli app core (follow, timings, feed, offline, install) | NOT STARTED | – | – |
| 03 | Masjid Admin content tools | NOT STARTED | – | – |
| 04 | Push notifications | NOT STARTED | – | – |
| 05 | Donations, chanda & UPI change-lock | NOT STARTED | – | – |
| 06 | Bayan videos | NOT STARTED | – | – |
| 07 | Qibla compass | NOT STARTED | – | – |
| 08 | Moderation, grievance, legal pages, QR posters | NOT STARTED | – | – |
| 09 | Hardening, Play Store & pilot launch | NOT STARTED | – | – |

## Current phase task checklist

**Phase 00** — started 9 Oct 2026. Owner: Docker installed ✅; GitHub public repo ✅ (DECISIONS #28); DECISIONS #27–#31 + #35 accepted. Owner details (10 Oct 2026): domain **almasjids.com** on Cloudflare (nameservers switched) ✅; VPS **Hostinger Mumbai, 4 vCPU / 16 GB, Ubuntu 24.04, static IPv4**, one VPS for staging + production (DECISIONS #42) ✅; Cloudinary cloud name `g0ytozsb` (not a secret; API keys go only into VPS env files) ✅; test phones **iPhone + Poco F7** (Poco F7 is mid/high-end — low-end checks keep using throttled Moto-G-class profiles) ✅. Pending: WireGuard + VPS setup together in T0.14; Sentry DSNs (optional).

- [x] T0.1 — Monorepo bootstrap (clean-clone `pnpm install && pnpm verify:quick` green; 5 lint violations proven — `docs/reports/evidence/PHASE_00_T0.1_lint-proof.txt`; Turbo full cache hit 31/31)
- [x] T0.2 — Env & config (`packages/shared/src/env.ts`: 4 server + 2 client schemas, forbidden-var boot assertion, name-only errors with leak test; `.env.example` + sync test; `brand.ts`; 49 tests, 100% lines. Bundle-level `VITE_PUBLIC_*` proof → F2)
- [ ] T0.3 — CI pipeline
- [x] T0.4 — App & API scaffolds (API 48 tests incl. no-stack-trace, `?a[$ne]=1`, SIGTERM drain; server 14 tests; `pnpm dev` + `pnpm stack:up` verified live; Playwright smoke 12/12 on Pixel 7 + iPhone 14 through Caddy; containers non-root/read-only/cap-dropped; local Redis/Mongo security checks 11/11; hadolint clean — DECISIONS #37)
- [ ] T0.5 — Security headers & CSP
- [x] T0.6 — Design tokens, Tailwind, fonts, base styles (Tailwind 4.3 with default palette removed; tokens.ts → generated tokens.css/type.css; `type-*` scale with hi/te/ur + admin adjustments; contrast fixed for 26 pairs (closes F8); subset fonts per locale + /boot.js preloads + Capsize fallback metrics; 5 prayer icons, masjid tile, 3 illustrations; ui 52 tests, i18n 77; e2e 20/20 (only active-locale fonts download, CLS ≤ 0.01); zero raw colors in apps — DECISIONS #41)
- [x] T0.7 — i18n foundation (`@mc/i18n`: i18next + ICU, lazy per-locale namespace chunks, typed keys, `formatters()` for ₹/numbers/times/dates/relative/Hijri stub/lists, external `/boot.js` sets `<html lang dir>` before paint, instant RTL switch, `<Bdi>/<Money>/<Time>`; `pnpm i18n:check` (all 09 §3 rules, grapheme-based lengths) + `pnpm i18n:review` CSVs (19 drafts × hi/ur/te awaiting human review); `glossary.md` drafts; both apps wired, `RouteError` translated; 72 unit tests; Playwright 18/18 incl. Urdu RTL boot on Pixel 7 + iPhone 14; i18n adds ≈29 KB gzip, `/` initial JS 130.8/170 KB — DECISIONS #38)
- [x] T0.8 — Motion foundation (Motion 14: lazy LazyMotion features, tokens per 08 §2 + CSS spring curves, MotionProvider, useReducedMotionPref, lite-motion + dropped-frame burst detector, haptics + setting hook, CSS-driven Pressable (same-frame pointerdown, scroll-cancel, long-press), SuccessCheck, CountUp, DigitRoll; lint rule extended to inline CSS timings; ui 74 tests, config 37; e2e 38/38 — DECISIONS #43)
- [x] T0.9 — Navigation system (history-driven StackNavigator: per-tab stacks, push/pop with parallax + dim (LTR/RTL), edge swipe-back, Android/browser back, tab bar + raised Scan FAB, Scan modal with scaled background, per-screen scroll, inert covered screens, focus to title / back to trigger; admin uses the same navigator; model 13 unit tests, e2e 18 navigation tests × 2 devices incl. stress, swipe-interrupt, re-tap pop-to-root + scroll top, RTL, axe; perf: no long task > 50 ms at 4× throttle; full e2e 56/56 through Caddy — DECISIONS #44. iPhone check pending → F17)
- [ ] T0.10 — Core component library + showcase
- [ ] T0.11 — PWA baseline
- [ ] T0.12 — Testing infrastructure
- [ ] T0.13 — Observability baseline
- [ ] T0.14 — Staging VPS & deployment
- [ ] T0.15 — Docs & decisions

## Open follow-ups (must be empty before a phase can be DONE, unless explicitly deferred with a DECISIONS entry)

| # | Found in | Description | Planned fix (phase/task) |
|---|---|---|---|
| F1 | T0.1 | Move Node 24 → 26 when Node 26 enters Active LTS (28 Oct 2026): `.nvmrc`, `engines`, `@types/node`, Docker base image, CI (DECISIONS #32) | After 28 Oct 2026 (Phase 00 or 01) |
| F2 | T0.2 | Prove client bundles contain only `VITE_PUBLIC_*`: Vite `envPrefix: VITE_PUBLIC_` + `parseClientEnv` at build, and the CI bundle secret scan | T0.4 + T0.3 |
| F9 | Audit 9 Oct | PHASE_00 T0.14, 04 §12.1 and HANDOFF still describe SSH-from-CI deploys; superseded by DECISIONS #27 (WireGuard + pull deploys). Update those texts when implementing. | T0.3 / T0.14 |
| F10 | Audit 9 Oct | Owner wants no paid services. Phase 1 needs an Atlas staging tier with custom roles + views + transactions — likely not the free tier (verify). Decide before Phase 1: paid Atlas tier vs. self-hosted MongoDB for staging. Production Atlas M10 (~$60–80/mo) is in the plan. | Before Phase 1 (owner) |
| F11 | Audit 9 Oct | Vendored `.claude/skills` (ui-ux-pro-max, MIT) — keep an MIT LICENSE notice in the folder (public repo). | T0.15 |
| F12 | T0.4 | Add `runtime-test` image target with the test-hooks module + CI check that `runtime` has no hooks (DECISIONS #31) | T0.12 |
| F13 | T0.7 | Hijri month names: Intl gives English names for `te` and odd ordering for `hi` — add per-locale month-name fallback table (09 §4) | Phase 2 T2.1 |
| F14 | T0.7 | i18n runtime is ≈29 KB gzip of the initial JS; if the 170 KB budget gets tight, precompile ICU messages to ASTs at build time and drop the parser (~8 KB gzip) (DECISIONS #38) | When `pnpm size` nears budget |
| F15 | T0.7 | Phase 00 exit budget: musalli initial JS ≤ 120 KB gz (PHASE_00 exit criteria). Measured 10 Oct: **149.0 KB** (after T0.9 navigation; was 141.2 after T0.8) = react-dom ≈ 47 %, router, i18n ≈ 29 KB, Motion runtime 9.7 KB (DECISIONS #43), query. Wire size-limit, then reduce (ICU precompile F14, defer non-shell code) or propose a revised Phase 00 target to the owner with numbers (01 §9 final budget for `/` stays 170 KB). | T0.12 |
| F16 | T0.8 | Haptics "Vibration" setting lives in memory; persist it in the device store (IndexedDB) and add the Settings toggle | Phase 2 (Settings) |
| F17 | T0.9 | Confirm on the owner's iPhone (installed app + Safari) that iOS gives no native back swipe in standalone mode and that Safari's own swipe does not double-animate; adjust the platform rule if needed (DECISIONS #44) | T0.14 (needs staging URL) |
| F18 | T0.9 | Phase 0 placeholder screens (`/demo/$number`, placeholder tab roots/Scan, tall spacer) exist only to exercise navigation; replace with real screens | Phase 2 |
| F19 | Owner 10 Oct | Owner rule: never trade quality for small KB savings (10–20 KB is fine). Revert the stack navigator animations from CSS transitions back to Motion (MotionValues + `animate`, swipe-release velocity hand-off, interruptible springs) — DECISIONS #44 to be amended; re-run navigation e2e + perf | Start of next session, before T0.10 |

## Session log (newest first, one line each)

| Date | Phase/Task | Summary |
|---|---|---|
| 2026-10-10 | 00 / pause | Paused by owner. Owner rule: quality over bundle size (10–20 KB acceptable). **Next session: F19 first (navigator back to Motion), then T0.10.** |
| 2026-10-10 | 00 / T0.9 | T0.9 done (DECISIONS #44): history-driven stack navigator, tab bar, swipe-back, modal, focus/inert, perf; switched navigator animations to CSS spring curves (−12 KB). e2e found & fixed: swipe pointer capture, WebKit focus, flick velocity noise. Next: T0.10 component library. |
| 2026-10-10 | 00 / T0.8 | T0.8 done (DECISIONS #43). Owner details recorded (domain almasjids.com, Hostinger VPS shared by staging+prod — DECISIONS #42, Cloudinary g0ytozsb, iPhone + Poco F7). Docker running again; full e2e 38/38. Next: T0.9 navigation. |
| 2026-10-10 | 00 / T0.6 | T0.6 done (DECISIONS #41): tokens, type scale, fonts, icons; fixed Urdu-rendered-in-Arial fallback bug found by e2e; hi/te font budget raised to 180 KB. Docker was not running — font e2e ran against vite preview. Next: T0.8 motion. |
| 2026-10-10 | 00 / plan change | Owner: bayans = YouTube links only (DECISIONS #39), Cloudinary replaces AWS S3, logs stay on the VPS (DECISIONS #40; answers 1a 2a 3a). Env schema, .env.example, tests and all docs updated. Next: T0.6. |
| 2026-10-09 | 00 / T0.7 | T0.7 done: i18n foundation, 72 tests, e2e 18/18, closed F4 + F7, added F14 (DECISIONS #38). Next: T0.6 design tokens. |
| 2026-10-09 | 00 / T0.4 | Done. Dockerfiles (distroless server, non-root Caddy), dev + stack compose, Caddyfile, precompressed builds, Playwright smoke. Fixed on the way: Caddy root→non-root, source maps were served (now 404), `dev up` removed stack containers, health field `release`→`version` (F5). F5/F6 closed. |
| 2026-10-09 | 00 / audit | Full re-read of the pack (CLAUDE.md, docs 00–10, phases 00–09, owner docs, agents, commands, design refs) vs. work done. On plan; 1 contract mismatch (F5) + 6 tracked items (F6–F11). |
| 2026-10-09 | 00 / T0.4 | API, server, SPAs and local env generator done and pushed to GitHub. Paused for Docker: owner enabling WSL (`wsl --install --no-distribution`) + Windows restart. Next: Docker parts of T0.4, then T0.7 → T0.6 → T0.8 → T0.9 → T0.10. |
| 2026-10-09 | 00 / owner answers | #27 WireGuard + pull deploys (no paid/external service), #28 public repo, #29–#31 accepted; `.claude/settings.json` deny narrowed so `.env.example` is editable (real env files still blocked); F3 closed. |
| 2026-10-09 | 00 / T0.2 | Env schemas per process (stricter than spec: per-process Mongo/Redis users, TLS + ap-south-1 + Cloudflare proxy outside local, RP_ID = admin host; external-service creds optional only in local). migrate process gets its own forbidden list (least privilege). |
| 2026-10-09 | 00 / T0.1 | Monorepo bootstrapped (pnpm 12 + Turbo, TS 6.0 strict, ESLint 10 + 3 custom rules, 36 lint-rule tests, lefthook + gitleaks + commit-msg, Renovate). Toolchain recorded in DECISIONS #32. gitleaks installed on dev PC via winget. |
| 2026-10-09 | 00 / start | Read all Phase 00 docs; raised OPEN DECISIONS #27–#31; asked owner for prerequisites (GitHub repo + plan, domain on Cloudflare, staging VPS, Docker Desktop on dev PC). No code yet. |
