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
- [x] T0.4 — App & API scaffolds (API 48 tests incl. no-stack-trace, `?a[$ne]=1`, SIGTERM drain; server 14 tests; `pnpm dev` + `pnpm stack:up` verified live; Playwright smoke 12/12 on Pixel 7 + iPhone 14 through Caddy; containers non-root/read-only/cap-dropped; local Redis/Mongo security checks 11/11; hadolint clean — DECISIONS #37)
- [ ] T0.5 — Security headers & CSP
- [ ] T0.6 — Design tokens, Tailwind, fonts, base styles
- [ ] T0.7 — i18n foundation — **IN PROGRESS (paused 9 Oct, owner's usage limit). Work is on disk, NOT committed** (`packages/i18n/**`, root `package.json` i18n scripts). Done: `src/locales.ts`, `src/format.ts` (money always en-IN grouping, Latin AM/PM upper-cased — record as DECISIONS #38), `src/boot.ts` + `src/vite-plugin.ts` (external `/boot.js` for pre-paint lang/dir — fixes F7), `src/document.ts`, `src/i18n.ts` (lazy JSON backend, ICU), `src/types.ts` (typed keys from en JSON), `src/react.tsx` (provider, `useLocale`, `<Bdi>/<Money>/<Time>`), locales en/hi/ur/te for `common` + `errors`, `meta/*.json`, `tools/check.ts` + `tools/cli.ts`, `review/*.csv` generated. **Next steps:** (1) fix 2 `i18n:check` problems — Telugu `countdown.hoursMinutes` too long (shorten or raise maxLength to ~24) + review CSV refresh (`pnpm i18n:review`); (2) write tests: `test/format.test.ts` (4 locales: ₹1,00,000, times, dates, relative incl. >6 days, plurals 0/1/2/5/21), `test/check.test.ts` (temp-dir fixtures: missing key, placeholder mismatch, invalid ICU, extra key, untranslated, missing `other`), `test/boot.test.ts`, `test/react.test.tsx` (jsdom: switch to ur → `<html dir=rtl lang=ur>` without reload, Money/Time render in `<bdi>`); (3) `packages/i18n/glossary.md` (religious terms per locale, translators confirm); (4) wire apps: `mcLocaleBoot()` in both vite configs, `I18nProvider` in providers, `RouteError` → `t('common:appError.*')` (closes F4), add `/boot.js` to Caddy `@entry` no-cache list; (5) add `packages/i18n/src/**/*.tsx` to eslint UI_FILES; typecheck/lint/test; e2e smoke still green; (6) DECISIONS #38, tick T0.7, commit + push.
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
| F7 | Audit 9 Oct | 09 §5 sets `<html lang dir>` before first paint from `localStorage mc.locale`, but CSP forbids inline scripts → needs an external blocking `/boot.js` + a documented exception to the `localStorage` lint ban. | T0.7 |
| F8 | Audit 9 Oct | `text-tertiary` (#8A938E) fails WCAG AA (2.97:1 on canvas); tag text colours ~4.2–4.4:1. Darken per 06 §2 and record in DECISIONS. | T0.6 |
| F9 | Audit 9 Oct | PHASE_00 T0.14, 04 §12.1 and HANDOFF still describe SSH-from-CI deploys; superseded by DECISIONS #27 (WireGuard + pull deploys). Update those texts when implementing. | T0.3 / T0.14 |
| F10 | Audit 9 Oct | Owner wants no paid services. Phase 1 needs an Atlas staging tier with custom roles + views + transactions — likely not the free tier (verify). Decide before Phase 1: paid Atlas tier vs. self-hosted MongoDB for staging. Production Atlas M10 (~$60–80/mo) is in the plan. | Before Phase 1 (owner) |
| F11 | Audit 9 Oct | Vendored `.claude/skills` (ui-ux-pro-max, MIT) — keep an MIT LICENSE notice in the folder (public repo). | T0.15 |
| F4 | T0.4 | `RouteError` in both apps shows temporary English copy ("Something went wrong…") — move to i18n keys in all 4 locales | T0.7 |
| F12 | T0.4 | Add `runtime-test` image target with the test-hooks module + CI check that `runtime` has no hooks (DECISIONS #31) | T0.12 |
| F13 | T0.7 | Hijri month names: Intl gives English names for `te` and odd ordering for `hi` — add per-locale month-name fallback table (09 §4) | Phase 2 T2.1 |

## Session log (newest first, one line each)

| Date | Phase/Task | Summary |
|---|---|---|
| 2026-10-09 | 00 / T0.7 | Started i18n foundation; paused mid-task (owner usage limit). Uncommitted work on disk in `packages/i18n` — see T0.7 line for exact next steps. Local stack may still be running (`pnpm stack:down` to stop). |
| 2026-10-09 | 00 / T0.4 | Done. Dockerfiles (distroless server, non-root Caddy), dev + stack compose, Caddyfile, precompressed builds, Playwright smoke. Fixed on the way: Caddy root→non-root, source maps were served (now 404), `dev up` removed stack containers, health field `release`→`version` (F5). F5/F6 closed. |
| 2026-10-09 | 00 / audit | Full re-read of the pack (CLAUDE.md, docs 00–10, phases 00–09, owner docs, agents, commands, design refs) vs. work done. On plan; 1 contract mismatch (F5) + 6 tracked items (F6–F11). |
| 2026-10-09 | 00 / T0.4 | API, server, SPAs and local env generator done and pushed to GitHub. Paused for Docker: owner enabling WSL (`wsl --install --no-distribution`) + Windows restart. Next: Docker parts of T0.4, then T0.7 → T0.6 → T0.8 → T0.9 → T0.10. |
| 2026-10-09 | 00 / owner answers | #27 WireGuard + pull deploys (no paid/external service), #28 public repo, #29–#31 accepted; `.claude/settings.json` deny narrowed so `.env.example` is editable (real env files still blocked); F3 closed. |
| 2026-10-09 | 00 / T0.2 | Env schemas per process (stricter than spec: per-process Mongo/Redis users, TLS + ap-south-1 + Cloudflare proxy outside local, RP_ID = admin host; external-service creds optional only in local). migrate process gets its own forbidden list (least privilege). |
| 2026-10-09 | 00 / T0.1 | Monorepo bootstrapped (pnpm 12 + Turbo, TS 6.0 strict, ESLint 10 + 3 custom rules, 36 lint-rule tests, lefthook + gitleaks + commit-msg, Renovate). Toolchain recorded in DECISIONS #32. gitleaks installed on dev PC via winget. |
| 2026-10-09 | 00 / start | Read all Phase 00 docs; raised OPEN DECISIONS #27–#31; asked owner for prerequisites (GitHub repo + plan, domain on Cloudflare, staging VPS, Docker Desktop on dev PC). No code yet. |
