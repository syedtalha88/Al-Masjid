# PHASE 00 — Foundation, Tooling & Design System

## Goal
A production-grade monorepo where both PWAs and the Express API processes boot, deploy to a hardened staging VPS (Docker Compose + Caddy behind Cloudflare) with A+ security headers, speak 4 languages (Urdu RTL), and share a premium component library + navigation/motion system that matches the reference designs. No product features yet — but everything later phases build on is solid, tested and budgeted.

## Read before starting
`CLAUDE.md` · `docs/DECISIONS.md` (#5, #6, #7, #19–#26) · `docs/01_ARCHITECTURE.md` (all) · `docs/04_SECURITY.md` §2 (R8, R9, R12), §7, §10, §11, §12 · `docs/06_DESIGN_SYSTEM.md` (all) · `docs/08_MOTION.md` (all) · `docs/09_I18N.md` (all) · `docs/10_TESTING.md` (all) · the 3 images in `docs/design-references/`.

## Owner prerequisites (ask for these at phase start if missing)
- GitHub repository (private) with Actions enabled (GHCR is used for Docker images).
- A domain name (e.g. `<domain>`) moved to **Cloudflare DNS** (free Cloudflare account, MFA on).
- A **staging VPS** in Mumbai (DECISIONS #21): Ubuntu LTS, 2 vCPU / 4 GB RAM minimum, a static public IPv4, root/initial SSH access shared with Claude Code **only through the owner's own terminal session or an SSH key the owner adds** (never paste private keys into chat). Claude Code gives the owner exact provider-neutral steps if needed.
- Optional now: Sentry project (DSNs: app, admin, server).

## Out of scope
Database collections/auth (Phase 1 — but local MongoDB + Redis containers already run in dev/CI from T0.12), real data, push, any feature screens (beyond the dev showcase and empty shells).

---

## Tasks

### T0.1 — Monorepo bootstrap
**Do:** pnpm workspaces + Turborepo per `01 §3`. Packages: `apps/app`, `apps/admin`, `apps/server`, `packages/{api,db,domain,shared,ui,i18n,config}`, plus `infra/{docker,compose,caddy,mongo,cloudflare,vps}` folders. `.nvmrc` + `engines` (current Node Active LTS; same major in the Docker base image), `packageManager` field, `.npmrc` (`save-exact=true`, `strict-peer-dependencies=true`), pnpm `onlyBuiltDependencies` allow-list. `tsconfig` bases (strict flags from CLAUDE.md §6). ESLint flat config (typescript-eslint strict-type-checked, react-hooks, jsx-a11y, import order, `no-restricted-imports` for `systemScope` (outside `packages/api/src/jobs/**` and `scripts/**`), `hookScope` (outside `packages/api/src/hooks/**`) and `mongodb` (outside `packages/db`), a rule banning `router.<verb>(` outside `defineRoute`, physical-direction Tailwind classes via a custom rule or `eslint-plugin-tailwindcss` config, ban numeric transition literals outside `packages/ui/motion`). Prettier. Husky (or lefthook) + lint-staged + gitleaks pre-commit. `.editorconfig`, `.gitignore` (incl. `.env*` except `.env.example`), `renovate.json` (grouped, weekly, automerge only patch dev-deps). Root scripts from CLAUDE.md §7 (stubs allowed for DB scripts until Phase 1, but they must print a clear "available from Phase 1" message, not fail silently).
**Acceptance:**
- [ ] `pnpm install && pnpm verify:quick` passes on a clean clone.
- [ ] A deliberate `any`, a `console.log`, a physical `ml-2` class, a `systemScope` import in `packages/api/src/routes`, and a `mongodb` import in `packages/api` each fail lint (prove with a temporary test file in the report, then delete).
- [ ] Turbo caches typecheck/lint/test tasks.
**Tests:** lint rule fixtures in `packages/config/test`.

### T0.2 — Env & config
**Do:** `packages/shared/src/env.ts` with Zod schemas for the `api-public`, `api-admin`, `worker`, `migrate`, `app-client`, `admin-client` env sets (01 §7). Boot assertion: each server process refuses to start if any variable forbidden for it is present (01 §7 last paragraph). `.env.example` fully commented. `packages/shared/src/brand.ts` (app name, short name, colors for manifest) — single source of the working name "Masjid Connect".
**Acceptance:** [ ] Missing var → clear error listing names (never values). [ ] Forbidden var in each process's env → boot failure test (one per process). [ ] Client bundle contains only `VITE_PUBLIC_*`.
**Tests:** unit tests for schemas and the forbidden-var assertion.

### T0.3 — CI pipeline
**Do:** `.github/workflows/ci.yml` per `10 §7` with the stages that exist now (typecheck, lint, format, i18n:check, unit/component + coverage, semgrep, gitleaks, osv-scanner, hadolint, MongoDB/Redis service containers, build both apps, bundle secret scan, size-limit, server image build + Trivy, e2e against the compose stack, axe, Lighthouse CI). `deploy-staging.yml` (on `main`: push images to GHCR by digest → SSH deploy to staging with the restricted deploy user → smoke + header checks). `deploy-prod.yml` skeleton (manual approval, environment `production`). Pin action SHAs, least `permissions`, concurrency cancel. `nightly.yml` skeleton. Branch protection instructions for the owner in the report (required checks).
**Acceptance:** [ ] CI green on main. [ ] A PR with a failing test is blocked.

### T0.4 — App & API scaffolds
**Do:** Both apps: Vite + React 19 + TS, TanStack Router (file-based routes, type-safe), TanStack Query provider, error boundary, Suspense fallbacks. `packages/api`: Express 5 factories `createPublicApp()` and `createAdminApp()` with app settings and the middleware chain from `03 §0` (request id, `helmet` headers, JSON body limit + content-type check, error mapper → problem+json, 404 handler), the `defineRoute()` helper (Zod validation + OpenAPI registry), pino-http logger with redaction, and `GET /api/v1/health` (public) / `GET /api/admin/health` (admin) returning version info only (DB/Redis checks added in Phase 1). `apps/server`: entrypoints `public.ts`, `admin.ts`, `worker.ts` (BullMQ connection + heartbeat only for now), `migrate.ts` (no-op until Phase 1) with graceful shutdown and server timeouts (03 §0). Local dev: `tsx watch` for the processes + Vite proxy `/api` → 8787/8788. Dockerfile (multi-stage, pnpm `deploy --prod`, non-root user, minimal base pinned by digest, `HEALTHCHECK`), `.dockerignore`. `infra/compose/docker-compose.dev.yml` (mongo:8 single-node replica set **with auth** + keyfile, redis with ACL file) and a `stack` compose file running caddy + api-public + api-admin + worker + mongo + redis locally. `infra/caddy/Caddyfile` routing per 01 §1 (static SPA with fallback to `index.html` excluding `/api`, `/api/v1/*` → api-public, `/api/admin|super|hooks/*` → api-admin, precompressed assets, cache headers per 01 §5.2 for static files).
**Acceptance:** [ ] `pnpm dev` serves both apps with working `/api/*/health`. [ ] `pnpm stack:up` serves the same through Caddy on `https://localhost` equivalents. [ ] Unknown route → SPA; unknown API route → problem+json 404. [ ] Error mapper never returns stack traces (test). [ ] `?a[$ne]=1` arrives as a plain string (query parser test). [ ] SIGTERM drains in-flight requests (test).
**Tests:** API tests via Supertest; one Playwright smoke per app against the compose stack.

### T0.5 — Security headers & CSP
**Do:** Exact headers from `04 §7` for static files (Caddyfile) and API responses (`helmet` + custom middleware) on both origins, parameterized by env hosts; `Server`/`X-Powered-By` removed. Ensure Vite build emits no inline scripts/styles (adjust `index.html`, disable modulepreload polyfill inline if needed; verify). Trusted Types policy setup (a `default` policy that throws on unexpected sinks in dev, logs in prod). E2E fixture that fails any test on a `securitypolicyviolation` event or console CSP error.
**Acceptance:** [ ] Staging scores A+ on securityheaders.com and Mozilla Observatory (screenshot/URL in report). [ ] No CSP violations across all e2e specs. [ ] Motion + Tailwind + fonts work under CSP (verified in e2e).

### T0.6 — Design tokens, Tailwind, fonts, base styles
**Do:** `packages/ui/tokens.css` with every token from `06 §2–4`; Tailwind v4 `@theme` mapping (semantic names only; remove default palette so raw colors can't be used). Fonts self-hosted per `09 §6` with `unicode-range`, fallback metric overrides, per-locale loading. Base styles: canvas bg, `-webkit-tap-highlight-color: transparent`, safe-area utilities, focus-visible ring, `text-size-adjust`, `overscroll-behavior` on scrollers, selection color, `color-scheme: light`. Prayer icon set (5 custom SVG icons per `06 §5`) + masjid tile glyph + 3 empty-state illustrations (mosque, QR poster, bell) as optimized inline SVG components.
**Acceptance:** [ ] Grep finds zero hex colors in `apps/**`. [ ] Fonts: only active-locale UI font is downloaded on first load (network assertion in e2e for each locale). [ ] CLS from font swap ≤ 0.01 (Lighthouse).

### T0.7 — i18n foundation
**Do:** Everything in `09 §2–6`: i18next + ICU, lazy namespaces, typed keys (generated d.ts), 4 locale folders, format helpers (`format.ts`) with tests (₹ grouping, times, dates, relative, Hijri formatting stub), synchronous `lang/dir` boot from `localStorage` mirror, RTL switching at runtime, `pnpm i18n:check` script with all rules, `glossary.md`, `review/<locale>.csv` generation.
**Acceptance:** [ ] Switching to `ur` flips layout instantly without reload; Latin times/amounts render inside `<bdi>`. [ ] `i18n:check` fails on missing key, placeholder mismatch, invalid ICU (fixtures). [ ] Formatting tests cover all 4 locales.

### T0.8 — Motion foundation
**Do:** `packages/ui/motion`: tokens (08 §2), `MotionProvider` (LazyMotion + feature loading), `useReducedMotionPref`, lite-motion detection (08 §6) incl. dropped-frame burst detector, haptics util with Settings toggle hook, `Pressable` primitive implementing 08 §5.1 (pointer events, cancel on scroll, long-press), `SuccessCheck`, count-up and digit-roll primitives.
**Acceptance:** [ ] Reduced motion swaps to crossfades (component test with mocked media query). [ ] Pressable responds on `pointerdown` within the same frame (test with fake timers + rAF). [ ] Lint rule blocks ad-hoc transitions outside the motion package.

### T0.9 — Navigation system
**Do:** `StackNavigator` per `08 §3`: per-tab stacks, push/pop animations (LTR & RTL), interactive edge swipe-back with velocity/distance commit, history integration (Android back pops; browser back works), modal presentation with background scale (lite-motion aware), scroll restoration per screen, `inert`/`aria-hidden` on covered screens, focus management (focus moves to new screen title; restores on pop). TabBar + ScanFab wired with 5 placeholder tab roots. Investigate iOS standalone native back-swipe behaviour on a real iPhone (owner may need to help) and record a DECISIONS entry.
**Acceptance:** [ ] Rapid double push/pop and swipe-interrupt don't break state (e2e stress spec). [ ] Re-tapping active tab pops to root and scrolls top. [ ] Screen reader focus order correct after push/pop (axe + manual note). [ ] Perf trace: push/pop with 4× CPU throttle has no long task > 50 ms.

### T0.10 — Core component library + showcase
**Do:** Build the components listed in `06 §6` under "Structure & navigation", "Content" (generic ones: Card, ListRow, IconCircle, Tag, CountBadge, VerifiedBadge, InfoNote, Divider, SectionHeader, ProgressBar, Image with thumbhash placeholder, ArabicText), and "Controls" (all), with variants exactly as specified. Feature-specific composites (MasjidCard, PrayerStrip, etc.) come in later phases. Showcase route `/_dev/showcase` in both apps (excluded from production builds — build check) with: locale switcher, reduced-motion toggle, lite-motion toggle, each component in all variants and states (loading/disabled/error).
**Acceptance:** [ ] Every component: component test (render, roles/labels, interactions), axe clean, 4-locale screenshot. [ ] Visual comparison against the reference images documented in the report for: Button variants, ChipGroup, SegmentedControl, UnderlineTabs, TabBar+ScanFab, ListRow with IconCircle, Tag colors, InfoNote, ProgressBar, NavBar large/inline. [ ] Sheet: drag, snap, dismiss, focus trap, `Esc`, scroll handoff (e2e). [ ] `/_dev/*` absent from production build (test).

### T0.11 — PWA baseline
**Do:** vite-plugin-pwa `injectManifest` for both apps. Manifests: name/short_name from brand, `id`, `start_url` (`/?source=pwa`), `scope`, `display: standalone`, `display_override: ['standalone']`, `orientation: portrait`, `background_color #F8F8F5`, `theme_color #F8F8F5`, `lang`, `dir: auto`, icons (192/512 any + maskable, monochrome badge 96 for notifications), `launch_handler: { client_mode: 'focus-existing' }` (app), shortcuts (app: Qibla, Updates). Apple meta tags (`apple-touch-icon`, status bar style, splash via `apple-touch-startup-image` generated for common iPhone sizes). Placeholder brand mark: green rounded square with white dome glyph (owner may replace later). SW: precache shell; offline fallback page; update flow (08 §5.10, 01 §5.6). Admin SW never caches `/api/*`.
**Acceptance:** [ ] Lighthouse "installable" checks pass for both apps. [ ] Offline reload shows shell + offline page/banner. [ ] New deployment → "Update available" toast → refresh applies it (e2e with two builds).

### T0.12 — Testing infrastructure
**Do:** Vitest workspace config (jsdom for UI, node for API/domain/db), Testing Library, MSW, fast-check, Supertest; test helpers that give each test file its own MongoDB database name and Redis key prefix on the Docker services (with clean-up); an injectable `Clock`; coverage thresholds (10 §2); Playwright config with Pixel 7 + iPhone 14 projects, `TZ=Asia/Kolkata`, locale param, axe fixture, CSP fixture, screenshot helper (per locale), perf-trace helper (08 §8); Lighthouse CI config with budgets (01 §9); size-limit config. Test-only hooks framework (compiled out of prod; build check).
**Acceptance:** [ ] Each tool runs in CI with at least one real test. [ ] Coverage gates enforced (deliberately failing fixture proves it, then removed).

### T0.13 — Observability baseline
**Do:** Sentry browser + node init for every process (no-op without DSN), `beforeSend` scrubber (strip URLs' query strings, headers, cookies, IPs, user), release = git SHA, source maps uploaded in CI (not served, not copied into the Caddy static folder). pino JSON logger with allow-listed fields, redaction paths and request id; Docker log rotation configured.
**Acceptance:** [ ] Unit test proves scrubber removes tokens/emails/phone-like strings. [ ] Production bundle has no `.map` files served.

### T0.14 — Staging VPS & deployment
**Do:**
1. `infra/vps/provision.sh` (idempotent, reviewed line by line with the owner before running): creates the admin user, SSH hardening, unattended-upgrades, NTP, Docker Engine + Compose, firewall per `04 §12.2` (443/80 only from Cloudflare ranges incl. the `DOCKER-USER` chain; SSH restricted), fail2ban, a restricted `deploy` user whose key may only run `infra/vps/deploy.sh`, weekly Cloudflare-IP refresh timer, `/etc/masjid-connect/staging/` with per-process env files (mode 600) created from `.env.example` (owner fills secrets on the server).
2. `infra/vps/check.sh` — hardening checklist (SSH config, open ports, firewall rules, Docker daemon options, container users/read-only/caps, env file permissions, NTP) with PASS/FAIL output.
3. Cloudflare: DNS records for `app-staging.<domain>` and `admin-staging.<domain>` (proxied), SSL **Full (strict)** with an Origin CA certificate installed for Caddy, **Authenticated Origin Pulls** enforced by Caddy, cache rules + WAF baseline from `infra/cloudflare/` (document every dashboard setting if it can't be applied via API), Rocket Loader/Email Obfuscation/auto-injected analytics **off**.
4. `deploy-staging.yml` deploys to the VPS: pull images by digest → `docker compose up -d` with rolling replica restart + health waits → smoke checks; `deploy/releases.log` for rollback.
5. Measure and record round-trip latency from the VPS to AWS ap-south-1 (Atlas region) in the report (target ≤ 5 ms; DECISIONS #21).
`noindex` on admin and on all staging hosts.
**Acceptance:** [ ] Both staging URLs load on a phone; installable; showcase reachable on staging only. [ ] Headers A+ on both. [ ] `check.sh` all PASS (output in report). [ ] A direct request to the VPS IP (bypassing Cloudflare) is refused (no TCP accept from non-Cloudflare IPs, and no TLS without the Cloudflare client certificate). [ ] Rollback to the previous digest demonstrated.

### T0.15 — Docs & decisions
**Do:** `README.md` (developer setup: prerequisites incl. Docker, commands, env per process, local stack, troubleshooting) and `docs/runbooks/DEPLOY.md` (deploy, rollback, where env files live, how to add a secret — owner-readable). DECISIONS entries for pinned versions of major libs and the iOS swipe-back finding. Update PROGRESS.
**Acceptance:** [ ] A fresh developer can run the project from README alone (phase-verifier checks the steps exist and work).

---

## Phase exit criteria
All tasks' acceptance boxes ticked with evidence; `pnpm verify` green; budgets: app initial JS (shell + showcase excluded) ≤ 120 KB gz at this stage; staging VPS hardening checklist PASS; Trivy clean; phase-verifier PASS; security-reviewer no HIGH/MEDIUM; report written; owner guide Phase 00 handed over.
