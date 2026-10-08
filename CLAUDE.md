# CLAUDE.md — Masjid Connect

> This file is loaded automatically by Claude Code at the start of every session.
> It is the **operating manual** for building this project. Everything here is binding.
> When this file and another doc disagree, **this file wins**, then `docs/DECISIONS.md`, then the numbered docs, then phase files.

---

## 1. What we are building (30-second version)

**Masjid Connect** (working name — the only place the name lives in code is `packages/shared/src/brand.ts`) is a **free, ad-free, multilingual Progressive Web App** for Muslims in India.

- Masjids are onboarded and verified by the **Super Admin** (the project owner). Each masjid gets a **unique QR code** printed on a poster.
- **Musallis** (end users) scan the QR → the masjid is added to their app. They can follow many masjids. **They never create an account.**
- **Masjid Admins** (imam / mutawalli / committee member) log in with a **passkey** (the phone's screen lock) and publish: prayer & jamaat timings, special dates (Eid, Taraweeh), Ramadan Sehri/Iftar, daily Hadith/Ayah, announcements/notices, dua requests (illness / inteqal) with an attached dua, donation campaigns (UPI, progress bar updated manually), weekly chanda totals, and bayan videos (audience: everyone / brothers / sisters).
- Every publish sends a **web push notification** to that masjid's followers (respecting the brothers/sisters audience).
- Extra: **Qibla compass**, Hijri date, WhatsApp share link, printable QR poster, 4 languages (**English, Hindi, Urdu (RTL), Telugu**).

Full spec: `docs/00_PRODUCT_SPEC.md`.

## 2. Non-negotiable principles (read twice)

1. **Privacy by architecture.** Musallis have no accounts. Never add name, phone, email, precise location, or any identifier for musallis to the server. Location for Qibla/prayer calc stays **on the device**.
2. **We never touch money.** Donations are UPI deep links / QR to the masjid's own UPI ID. No payment gateway, no wallets, no storing bank details beyond the VPA + payee name.
3. **Never generate religious text.** Do **not** write Quran ayat, hadith, duas, translations, transliterations, or references from memory — not in seed data, tests, fixtures, UI copy, or examples. Use the clearly fake placeholders defined in `docs/10_TESTING.md §Fixtures`. Real content is imported by the owner from licensed, scholar-verified sources via the Content Library import (Phase 3).
4. **Security is a feature, not a phase.** Every task follows `docs/04_SECURITY.md`. Policy-layer authorization on every collection (DECISIONS #20), server-side validation on every input, least-privilege MongoDB users per process, no secrets in client bundles.
5. **Legal compliance is designed in.** `docs/05_LEGAL_COMPLIANCE_IMPLEMENTATION.md` defines takedown, grievance, retention and audit features. They are not optional.
6. **Mobile-first, low-end-first.** Target device: a ₹8,000 Android phone on a patchy 4G connection. Performance budgets in `docs/01_ARCHITECTURE.md §9` are enforced in CI.
7. **Premium, fluid, Apple-like motion** on every navigation, tap, sheet and scroll — but only transform/opacity animations, 60fps on low-end, and full `prefers-reduced-motion` support. See `docs/08_MOTION.md`.
8. **Admins may have low literacy and little English.** Icon-first, big targets, templates over typing, preview before publish, every string translated. See `docs/07_SCREEN_SPECS.md §Admin`.
9. **No bugs left behind.** A task is done only when its tests exist and pass, types and lint are clean, and acceptance criteria are verified. No TODOs without a tracked entry in `docs/PROGRESS.md`.

## 3. Session start protocol (do this EVERY session, in order)

1. Read this file fully.
2. Read `docs/PROGRESS.md` → find the current phase and the next unchecked task.
3. Read `docs/DECISIONS.md` (all accepted decisions are binding; OPEN items block related work).
4. Read the current phase file `docs/phases/PHASE_XX_*.md` fully.
5. Read every doc listed in that phase's **"Read before starting"** section. Do not skim the security doc.
6. State in one short paragraph: current phase, next task, and anything blocking. Then work.

If `docs/PROGRESS.md` says a phase is "AWAITING OWNER VERIFICATION", **do not start the next phase**. Ask the owner whether manual testing passed (see `owner/PHASE_TESTING_GUIDE.md`).

## 4. How to work on a task

For every task `Tn.m` in the phase file:

1. **Plan** — restate the task's acceptance criteria. List files you will create/change. If the task touches auth, the policy layer / DB users / views, uploads, payments, push, moderation, or infrastructure (Docker, Caddy, Cloudflare, VPS), re-read the matching section of `docs/04_SECURITY.md`.
2. **Verify third-party APIs before using them.** Your training data may be outdated. For any library or service (Vite, React, TanStack, Motion, Tailwind, Express 5, the `mongodb` Node driver, MongoDB Atlas (custom roles, views, backups), BullMQ, Redis, rate-limiter-flexible, helmet, pino, SimpleWebAuthn, web-push, AWS S3 SDK, Bunny Stream, Turnstile, Cloudflare (cache rules, WAF, purge API, origin pulls), Caddy, Docker Compose, Workbox/vite-plugin-pwa, adhan, hls.js, qr-scanner, Playwright…), check the **current official docs** (web fetch / docs MCP if available) before writing code against it. Record the version you used.
3. **Test-first where logic is non-trivial** — domain logic (prayer, Hijri, Qibla, UPI, money, codes), policy-matrix cells and DB privileges, API validation, auth flows, job processors. Write the failing test, then the code.
4. **Implement** in small, reviewable steps. Follow §6 coding standards.
5. **Verify** — run `pnpm verify:quick` (typecheck + lint + unit tests for touched packages). For DB changes also run `pnpm db:test`. For UI changes, run the relevant Playwright spec and look at the screenshot output.
6. **Record** — tick the task in `docs/PROGRESS.md`, note anything surprising, and add a `DECISIONS.md` entry if you made a non-obvious choice.
7. **Commit** — one logical change per commit, Conventional Commits (`feat(app): …`, `fix(api): …`, `test(db): …`, `chore: …`). Never commit secrets, `.env*`, or generated junk.

### When to STOP and ask the owner

- Two docs contradict each other and `DECISIONS.md` doesn't resolve it.
- A requirement is technically impossible as specified, or a third-party API no longer works the way the docs assume.
- A change would weaken security, privacy, or legal posture.
- A task needs a paid service, a new third-party service, or a credential that doesn't exist yet.
- You are about to delete or rewrite more than ~200 lines of already-verified code.

Write the question as an `OPEN` entry in `docs/DECISIONS.md` with options + your recommendation, then ask. Don't guess on these.

## 5. Phase completion protocol

When all tasks in a phase are ticked:

1. Run `pnpm verify` (full: typecheck, lint, unit, integration, db tests, e2e, a11y, i18n completeness, bundle budgets, Lighthouse CI).
2. Run the **`phase-verifier`** subagent (`.claude/agents/phase-verifier.md`) against the phase file. Fix every finding.
3. Run the **`security-reviewer`** subagent (`.claude/agents/security-reviewer.md`) on the diff for this phase. Fix every HIGH/MEDIUM finding; justify LOW findings in the report.
4. Write `docs/reports/PHASE_XX_REPORT.md` using `docs/phases/_REPORT_TEMPLATE.md`: what was built, test counts, coverage, budgets, screenshots list, known limitations, deviations from spec (with DECISIONS links).
5. Deploy to the **staging** VPS (via the `deploy-staging` workflow) and put the URLs in the report.
6. Set the phase status in `docs/PROGRESS.md` to `AWAITING OWNER VERIFICATION` and tell the owner: "Phase XX is ready. Please run the checks in `owner/PHASE_TESTING_GUIDE.md` → Phase XX."
7. Only after the owner confirms, mark it `DONE` and start the next phase.

Shortcut commands: `/start-phase <NN>` and `/finish-phase <NN>` (see `.claude/commands/`).

## 6. Coding standards

### Language & types
- **TypeScript strict everywhere** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`).
- No `any`. No `as` casts except at validated boundaries (with a comment). No `@ts-ignore`; `@ts-expect-error` only with a reason.
- All external input (HTTP bodies, query params, headers, webhook payloads, env vars, IndexedDB data, push payloads, QR contents) is parsed with **Zod** schemas from `packages/shared`. Never trust a type you didn't validate.
- Money is **integer paise** (BSON `long`/int64 in MongoDB written via `toInt64()`, `number` safe-integer in TS, validated ≤ 10^12). Never floats/doubles for money.
- Time: store BSON `Date` (UTC); calendar dates as `YYYY-MM-DD` strings. Display in `Asia/Kolkata`. Prayer times are local `HH:mm` wall-clock values. Use the helpers in `packages/domain/time`.

### Structure
- Monorepo (pnpm + Turborepo). Layout in `docs/01_ARCHITECTURE.md §3`. Respect package boundaries: `apps/*` may import `packages/*`; packages never import apps; `packages/domain` is pure (no I/O, no React).
- Feature-folder structure inside apps: `src/features/<feature>/{components,hooks,api,routes,__tests__}`.
- Database access **only** through the scoped repositories in `packages/db` (`withScope(publicScope() | deviceScope(id) | adminScope(...) | superScope(id) | hookScope(name) | systemScope(), fn)` and `withTransaction`). The `mongodb` package may only be imported inside `packages/db`. `systemScope` may only be imported from `packages/api/src/jobs/**` (worker) and `scripts/**`; `hookScope` only from `packages/api/src/hooks/**` — enforced by ESLint `no-restricted-imports` + Semgrep. Every new collection or repository method adds its policy cells + tests in the same commit (`docs/02_DATA_MODEL.md §4`).
- HTTP routes are declared only through `defineRoute()` (Zod-validated, auth + rate limit + OpenAPI). No raw `router.get/post` calls.
- No business logic in React components. Components render; hooks orchestrate; `packages/domain` computes; `packages/api` services enforce rules.

### Style
- ESLint (flat config, `typescript-eslint` strict-type-checked, react-hooks, jsx-a11y) + Prettier. Zero warnings policy in CI.
- Names: `camelCase` vars/functions, `PascalCase` components/types, `SCREAMING_SNAKE` constants, `kebab-case` files except React components (`PascalCase.tsx`).
- Every exported function in `packages/domain`, `packages/api/src/services` and `packages/db` has a TSDoc comment stating inputs, outputs, and failure modes.
- Errors: API returns RFC 9457 `application/problem+json` via the shared error helper. Never leak stack traces, database errors/queries, or internal IDs of other tenants.
- Logging: structured JSON via the shared logger. **Never log** secrets, tokens, push subscription keys, passkey material, admin phone numbers, grievance contact details, or request bodies of auth endpoints.

### UI
- Only design tokens from `packages/ui` (no raw hex colors, no ad-hoc px spacing). See `docs/06_DESIGN_SYSTEM.md`.
- Only the motion presets in `packages/ui/motion` (no ad-hoc durations/easings). See `docs/08_MOTION.md`.
- Every user-visible string goes through i18n with keys present in **all four** locales. CI fails on missing keys. See `docs/09_I18N.md`.
- Use CSS logical properties (`ms-*`, `me-*`, `ps-*`, `start-*`, `text-start`) — never `left/right` for layout. Urdu is RTL.
- Every interactive element: accessible name, visible focus ring, min 44×44 px (admin app: 56×56 px).
- Loading → skeleton; empty → illustrated empty state with an action; error → friendly message + retry. No blank screens, no raw error text.

### Dependencies
- Prefer the platform and the libraries already chosen in `docs/01_ARCHITECTURE.md §4`. Adding a runtime dependency to `apps/*` requires a `DECISIONS.md` entry with bundle-size impact.
- Pin exact versions (`save-exact=true`). Renovate keeps them current.
- No abandoned packages (no release in 18 months) and no packages with known critical CVEs.

## 7. Commands (to be created in Phase 0; keep this list accurate)

```
pnpm dev               # both PWAs + api-public + api-admin + worker (tsx watch) + local MongoDB/Redis (requires Docker)
pnpm dev:app           # public PWA + api-public only
pnpm dev:admin         # admin PWA + api-admin + worker only
pnpm db:start          # docker compose up mongo (replica set + auth) + redis
pnpm db:reset          # drop local DB, run migrations, apply roles/views, dev seed
pnpm db:migrate        # run pending migrations (idempotent)
pnpm db:test           # policy-matrix + DB-privilege + explain tests against local MongoDB
pnpm db:schema:check   # generated validators/indexes/views vs live DB; CI fails on drift
pnpm db:verify-roles   # privilege checks against a remote env (staging) — read-only
pnpm test              # unit + component tests (Vitest)
pnpm test:int          # API + job integration tests against local MongoDB/Redis
pnpm test:e2e          # Playwright (mobile Chrome + mobile WebKit) against the local compose stack
pnpm i18n:check        # missing/extra keys, ICU syntax, placeholder parity
pnpm size              # bundle budgets (size-limit)
pnpm lhci              # Lighthouse CI against the built stack
pnpm stack:up          # full production-like stack locally (caddy + apis + worker + mongo + redis)
pnpm infra:check       # VPS hardening checklist (run on the VPS / against staging)
pnpm verify:quick      # typecheck + lint + unit (affected)
pnpm verify            # everything CI runs
```

## 8. Environments & secrets

- `local` (Docker MongoDB replica set + Redis; Bunny/S3/push mocked where noted), `staging` (staging VPS + Atlas `mc-staging`, deployed from `main`), `production` (production VPS + Atlas `mc-prod`, deployed with manual approval).
- All env vars are declared and validated with Zod in `packages/shared/src/env.ts`. The app must refuse to boot with missing/invalid env.
- `.env.example` documents every variable with a comment, grouped per process (`api-public`, `api-admin`, `worker`, `migrate`, client). Real values live only in the per-process env files on the VPS (`/etc/masjid-connect/<env>/*.env`, mode 600), GitHub environment secrets (deploy only), and local `.env.local` (git-ignored). **Never** read or print `.env*` contents in the transcript; never SSH into staging/production unless the owner asks for a specific action.
- Client bundles may contain only `VITE_PUBLIC_*` values. CI greps built bundles for secret patterns and fails if found.

## 9. Definition of Done (applies to every task)

- [ ] Acceptance criteria in the phase file are all met and demonstrably verified.
- [ ] Unit/integration/policy-matrix/DB-privilege/e2e tests added as the phase file requires; all green.
- [ ] Typecheck, lint, i18n check, size budgets pass.
- [ ] Works in all 4 locales; Urdu layout is mirrored correctly.
- [ ] Works offline / degrades gracefully where the spec says so.
- [ ] Respects `prefers-reduced-motion`.
- [ ] No new security finding; inputs validated; authz enforced in the API **and** the policy layer (and covered by DB privileges where applicable).
- [ ] `docs/PROGRESS.md` updated; decisions recorded.

## 10. Doc map

| Doc | Use it for |
|---|---|
| `docs/00_PRODUCT_SPEC.md` | Roles, features, business rules, edge cases |
| `docs/01_ARCHITECTURE.md` | Stack, repo layout, processes, VPS/Docker/Cloudflare topology, caching, jobs, push, video, performance budgets |
| `docs/02_DATA_MODEL.md` | Collections, enums, validators, indexes, policy matrix, views, DB users, side effects, retention |
| `docs/03_API_SPEC.md` | Every endpoint, auth, validation, caching headers, errors |
| `docs/04_SECURITY.md` | Threat model and mandatory controls |
| `docs/05_LEGAL_COMPLIANCE_IMPLEMENTATION.md` | Features required by Indian law (DPDP, IT Rules, CERT-In) |
| `docs/06_DESIGN_SYSTEM.md` | Tokens, typography, components (from reference images) |
| `docs/07_SCREEN_SPECS.md` | Every screen, musalli + admin + super admin |
| `docs/08_MOTION.md` | Animation system and per-interaction specs |
| `docs/09_I18N.md` | 4 languages, RTL, fonts, formatting |
| `docs/10_TESTING.md` | Test strategy, tooling, fixtures, CI gates |
| `docs/design-references/*.png` | Visual source of truth for the musalli app |
| `docs/phases/PHASE_XX_*.md` | What to build now |
| `docs/PROGRESS.md` | Where we are |
| `docs/DECISIONS.md` | Why things are the way they are |
