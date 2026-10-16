# Masjid Connect

A free, ad-free, multilingual Progressive Web App for Muslims in India: musallis follow their masjid by QR code
(no account), masjid admins publish timings, notices, duas, campaigns and bayans with passkey login.
The specification lives in [`docs/`](docs/) — start with [`CLAUDE.md`](CLAUDE.md) (the operating manual),
[`docs/PROGRESS.md`](docs/PROGRESS.md) (where the build is) and [`docs/DECISIONS.md`](docs/DECISIONS.md) (why).

|          |                                                                                                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apps     | `apps/app` musalli PWA · `apps/admin` admin + super-admin PWA · `apps/server` the four server processes                                                                                                                                                                          |
| Packages | `api` (Express 5) · `db` (MongoDB policy layer) · `domain` (pure logic) · `shared` (env, contracts, clock, observability) · `ui` (tokens, components, motion, navigation, PWA) · `i18n` (en/hi/ur/te) · `config` (tsconfig, ESLint, Vitest, Playwright base, Lighthouse budgets) |
| Stack    | Vite 8 + React 19 + TanStack Router/Query · Express 5 · MongoDB 8 · Redis 8 + BullMQ · Caddy · Docker Compose · Cloudflare                                                                                                                                                       |

## Prerequisites

| Tool     | Version                                                         | Notes                                                                                      |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Node.js  | 24.15+ (24.x)                                                   | `.nvmrc` says `24`                                                                         |
| pnpm     | 12.10.1                                                         | via Corepack: `corepack enable && corepack install` (reads `packageManager`)               |
| Docker   | Docker Desktop (WSL 2 on Windows) or Docker Engine + Compose v2 | MongoDB, Redis and the production-like stack                                               |
| gitleaks | 8.x                                                             | used by the pre-commit hook — `winget install Gitleaks.Gitleaks` / `brew install gitleaks` |

## First run

```bash
git clone https://github.com/syedtalha88/Al-Masjid.git && cd Al-Masjid
corepack enable && corepack install
pnpm install                 # installs git hooks (lefthook) too
pnpm setup:local             # writes git-ignored .env.local* files with random local secrets
pnpm db:start                # MongoDB (replica set + auth, host port 27018) + Redis (ACL users) in Docker
pnpm --filter @mc/server verify:local   # 11 checks: auth required, ACL scopes, replica set
pnpm dev                     # both PWAs + api-public + api-admin + worker (watch mode)
```

| URL                                 | What                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| http://localhost:5173               | musalli app (Vite dev, `/api` proxied to api-public on 8787) |
| http://localhost:5174               | admin app (`/api` proxied to api-admin on 8788)              |
| http://localhost:5173/_dev/showcase | component showcase (dev builds only)                         |

`pnpm dev:app` / `pnpm dev:admin` start one side only.

### Production-like stack (Caddy, built images)

```bash
pnpm stack:up                # builds both PWAs + server/Caddy images, runs everything behind Caddy
pnpm stack:up:test           # same, with the runtime-test server image (e2e test hooks, NODE_ENV=test)
pnpm stack:down
```

Open https://app.localhost:8443 and https://admin.localhost:8443 (Caddy's internal CA — the browser warns locally).
These are the URLs the e2e tests and Lighthouse use.

Browsers resolve `*.localhost` to your machine by themselves; Node (Playwright `request`, Lighthouse) may not on macOS
and some Linux setups. If e2e/Lighthouse fail with `ENOTFOUND app.localhost`, add
`127.0.0.1 app.localhost admin.localhost media.localhost` to `/etc/hosts` (CI does the same). The security scans
(gitleaks, Semgrep, osv-scanner, Trivy, hadolint, shellcheck, the VPS script tests) run in CI only.

## Environment

Every process validates its own variables at boot (`packages/shared/src/env.ts`) and refuses to start with a
missing value **or with a variable it must not have** (DECISIONS #7). [`.env.example`](.env.example) documents
every variable per process (`api-public`, `api-admin`, `worker`, `migrate`, client `VITE_PUBLIC_*`).
`pnpm setup:local` writes one file per process: `.env.local.api-public`, `.env.local.api-admin`,
`.env.local.worker`, `.env.local.migrate`, `.env.local.stack.*` (for `stack:up`), `.env.local.test`
(integration tests), `apps/*/.env.local` (public client values) and `.env.local.compose` (container passwords).
They are git-ignored and local-only; `pnpm setup:local --force` regenerates them. Real staging/production values
live only in env files on the VPS — never in the repository.

Client bundles may contain only `VITE_PUBLIC_*` values; the build fails on anything else and `pnpm scan:bundles`
checks the output.

## Commands

| Command                                     | What it does                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify:quick`                         | typecheck + lint + unit tests + Prettier — run before every commit                                                                                |
| `pnpm test` / `pnpm test:coverage`          | unit + component tests (Vitest) / with the coverage gates of `docs/10_TESTING.md` §2                                                              |
| `pnpm test:int`                             | integration tests against the Docker MongoDB/Redis (each file gets its own database / key prefix)                                                 |
| `pnpm test:e2e`                             | Playwright on Pixel 7 (Chromium) + iPhone 14 (WebKit) against `stack:up`; CSP guard + axe built in                                                |
| `pnpm test:perf`                            | motion performance traces (Chromium, 4× CPU throttle, one worker)                                                                                 |
| `pnpm i18n:check`                           | missing/extra keys, ICU syntax, placeholder parity in all four locales                                                                            |
| `pnpm size`                                 | bundle budgets (needs the production builds)                                                                                                      |
| `pnpm lhci`                                 | Lighthouse budgets (cold + warm) against the running stack                                                                                        |
| `pnpm check:dist` / `pnpm scan:bundles`     | no dev-only code / no secrets in the production builds                                                                                            |
| `pnpm check:image <image> [--expect-hooks]` | the shipped server image has no e2e test hooks                                                                                                    |
| `pnpm db:reset` / `pnpm db:migrate`         | local database: drop + users + all migrations / pending migrations only                                                                           |
| `pnpm bootstrap:super-admin --name "…"`     | local only: first Super Admin + one-time invite link (`--locale`, `--force-additional`); servers: `docs/runbooks/DEPLOY.md` §7                    |
| `pnpm verify`                               | everything CI runs except the Docker-image security scans — needs Docker, `pnpm stack:up` and `pnpm dev:app` (the dev-only showcase spec) running |

The showcase e2e spec runs against a Vite dev server: start `pnpm dev:app` before `pnpm test:e2e` locally.

## How work is done here

Read [`CLAUDE.md`](CLAUDE.md) first: privacy by architecture (musallis have no accounts), we never touch money,
never generate religious text (use the fixtures in `docs/10_TESTING.md` §5), security on every task, strict
TypeScript, i18n for every string, design tokens and motion presets only. Commits follow Conventional Commits; the
pre-commit hook runs gitleaks, Prettier and ESLint. CI (`.github/workflows/ci.yml`) must be green before anything
reaches `main`; deploys are described in [`docs/runbooks/DEPLOY.md`](docs/runbooks/DEPLOY.md).

## Troubleshooting

| Symptom                                                   | Fix                                                                                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Docker is not running` from `pnpm db:start` / `stack:up` | Start Docker Desktop (Windows: WSL 2 backend) and retry                                                                                                                |
| `Missing local setup files`                               | `pnpm setup:local`                                                                                                                                                     |
| A process exits at boot listing variable names            | Its env file is missing/invalid values or holds a variable it must not have — compare with `.env.example`                                                              |
| MongoDB port conflict                                     | The dev MongoDB uses host port **27018** on purpose (a local MongoDB service may own 27017)                                                                            |
| `https://app.localhost:8443` certificate warning          | Expected locally (Caddy internal CA); tests ignore it                                                                                                                  |
| Service worker missing in Chromium locally                | Chromium refuses service workers on untrusted certificates; the e2e Pixel 7 project starts it with `--ignore-certificate-errors`                                       |
| Lint error about an async `waitForFunction`               | Playwright does not await async predicates — use `expect.poll(() => page.evaluate(async () => …))`                                                                     |
| `ERR_PNPM_TRUST_DOWNGRADE` / release-age error on install | Supply-chain policy (`pnpm-workspace.yaml`, DECISIONS #49): wait 3 days for brand-new versions, or review the package and add an exact-version exclusion with a reason |
