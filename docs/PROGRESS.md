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

**Phase 00** — started 9 Oct 2026. Owner: Docker installed ✅; GitHub public repo ✅ (DECISIONS #28); DECISIONS #27–#31 + #35 accepted. Pending (needed for T0.5/T0.14): domain on Cloudflare, staging VPS details (already purchased), WireGuard setup together in T0.14.

- [x] T0.1 — Monorepo bootstrap (clean-clone `pnpm install && pnpm verify:quick` green; 5 lint violations proven — `docs/reports/evidence/PHASE_00_T0.1_lint-proof.txt`; Turbo full cache hit 31/31)
- [x] T0.2 — Env & config (`packages/shared/src/env.ts`: 4 server + 2 client schemas, forbidden-var boot assertion, name-only errors with leak test; `.env.example` + sync test; `brand.ts`; 49 tests, 100% lines. Bundle-level `VITE_PUBLIC_*` proof → F2)
- [ ] T0.3 — CI pipeline
- [ ] T0.4 — App & API scaffolds
- [ ] T0.5 — Security headers & CSP
- [ ] T0.6 — Design tokens, Tailwind, fonts, base styles
- [ ] T0.7 — i18n foundation
- [ ] T0.8 — Motion foundation
- [ ] T0.9 — Navigation system
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
| F4 | T0.4 | `RouteError` in both apps shows temporary English copy ("Something went wrong…") — move to i18n keys in all 4 locales | T0.7 |

## Session log (newest first, one line each)

| Date | Phase/Task | Summary |
|---|---|---|
| 2026-10-09 | 00 / owner answers | #27 WireGuard + pull deploys (no paid/external service), #28 public repo, #29–#31 accepted; `.claude/settings.json` deny narrowed so `.env.example` is editable (real env files still blocked); F3 closed. |
| 2026-10-09 | 00 / T0.2 | Env schemas per process (stricter than spec: per-process Mongo/Redis users, TLS + ap-south-1 + Cloudflare proxy outside local, RP_ID = admin host; external-service creds optional only in local). migrate process gets its own forbidden list (least privilege). |
| 2026-10-09 | 00 / T0.1 | Monorepo bootstrapped (pnpm 12 + Turbo, TS 6.0 strict, ESLint 10 + 3 custom rules, 36 lint-rule tests, lefthook + gitleaks + commit-msg, Renovate). Toolchain recorded in DECISIONS #32. gitleaks installed on dev PC via winget. |
| 2026-10-09 | 00 / start | Read all Phase 00 docs; raised OPEN DECISIONS #27–#31; asked owner for prerequisites (GitHub repo + plan, domain on Cloudflare, staging VPS, Docker Desktop on dev PC). No code yet. |
