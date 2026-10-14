# Phase 00 — review findings tracker (14 Oct 2026)

Sources: `security-reviewer` (S-…) and `phase-verifier` (V-…) runs on `ci/t0.14-staging@69ca205`. CLAUDE.md §5: every
HIGH/MEDIUM is fixed; LOW findings are fixed or justified in `PHASE_00_REPORT.md`. Status: `open` · `fixed <commit>` ·
`justified` · `owner` (needs an owner action — PROGRESS "Waiting for the owner").

## Security review

| ID | Sev | Finding | Status |
|---|---|---|---|
| S-H1 | HIGH | One shared `/opt/masjid-connect` checkout for both environments + root timers/bind mounts → a staging release (auto-signed from `main`) runs as root against production; checkout race between environments; no lock; compose file can request `privileged`/host mounts | open |
| S-H2 | HIGH | DOCKER-USER rule drops **container egress** to any :443 (no `-i` match) → Turnstile, push, Cloudinary, Sentry, purge would all fail from Phase 1 | open |
| S-H3 | HIGH | Container logs lost on every deploy (recreate deletes the `local` log store) and above 50 MB/day → CERT-In 180-day gap | open |
| S-M1 | MED | Old signed manifest can be replayed (downgrade); `created` never compared | open |
| S-M2 | MED | `make-env.sh production` writes the always-pass Turnstile test secret; no production guard for placeholders | open |
| S-M3 | MED | `make-env.sh --force` regenerates encryption key (same id), pepper, VAPID → unrecoverable data loss | open |
| S-M4 | MED | `staging`/`production` environments not restricted to `main` → any branch workflow can read the signing key; `deploy-prod` lacks an ancestor-of-main check | open (+ owner) |
| S-M5 | MED | 443 reachable from any IP between Docker start and the firewall unit (every boot / Docker restart) | open |
| S-L1 | LOW | `lockdown` reads `SSH_CONNECTION`, which `sudo` drops | open |
| S-L2 | LOW | Lock-out window if root session closes before `passwd <admin>` | open |
| S-L3 | LOW | `check.sh` flags :22 as public listener after lockdown | open |
| S-L4 | LOW | `provision.sh` trusts unpinned `main` | open |
| S-L5 | LOW | `env.ts`: `tls=false` passes the TLS check; other processes' Redis URLs not forbidden | open |
| S-L6 | LOW | Unknown `/assets/*` → `index.html` with `immutable` 1-year cache | open |
| S-L7 | LOW | HAProxy logs at `notice` drop tcplog; no Caddy access log; no VPS backup of logs as 05 claims | open |
| S-L8 | LOW | Containers can reach `169.254.169.254` | open |
| S-L9 | LOW | Edge networks not `internal` (web has egress); HAProxy healthcheck only validates config | open |
| S-L10 | LOW | Redis has no `maxmemory` under the 512m limit | open |
| S-L11 | LOW | Client-supplied `X-Request-Id` accepted (log correlation spoofable) | open |
| S-L12 | LOW | Node keep-alive 65 s < Caddy's 2 min idle → sporadic 502s | open |
| S-L13 | LOW | ZAP `-I` never fails; `workflow_dispatch` releases without green CI; deploy images not re-scanned; signing step shares the build job's write token | open |

## Phase verifier (FAIL items; PENDING-OWNER items are in PROGRESS)

| ID | Finding | Status |
|---|---|---|
| V-1 | No rolling replica restart in `deploy.sh` (both replicas recreated at once → 502s); no `lb_try_duration` in Caddy | open |
| V-2 | `tls-origin` (client-cert enforcement) never tested before the server | open |
| V-3 | Signing-key environments not limited to `main` (= S-M4) | open (+ owner) |
| V-4 | No post-deploy header check; ZAP can never fail (= S-L13) | open |
| V-5 | Turbo `test` cache not invalidated by dependency changes (false green locally) | open |
| V-6 | T0.10 visual comparison with the reference images not documented | open |
| V-7 | T0.9 screen-reader manual note missing | open |
| V-8 | 01 §9 font budgets not enforced | open |
| V-9 | DEPLOY.md: secret-change procedure, `--recreate`, AOP renewal, production signing key missing | open |
| V-10 | `pnpm infra:check` is a stub | open |
| V-11 | `pnpm verify` ≠ "everything CI runs" (CLAUDE.md §7 wording) | open |
| V-12 | Stale docs (T0.14 plan modes/secret step, Cloudflare boxes, env.test title "S3") | open |
| V-13 | README lacks the `*.localhost` hosts note | open |
| V-14 | Favicons contain hex colours (no-raw-colors skips `.svg`) — record exemption | open |
| V-15 | `Spinner` labelled path untested | open |
| V-16 | `media-staging` DNS/route has no Caddy site until Phase 3 | open |
| V-17 | `make-env.sh` output not tested against the env schemas in CI | open |
| V-18 | Urdu showcase screenshot shows a black offline bar without text — check | open |
