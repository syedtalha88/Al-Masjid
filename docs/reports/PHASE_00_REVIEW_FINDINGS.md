# Phase 00 — review findings tracker (14 Oct 2026)

Sources: `security-reviewer` (S-…) and `phase-verifier` (V-…) runs on `ci/t0.14-staging@69ca205`. CLAUDE.md §5: every
HIGH/MEDIUM is fixed; LOW findings are fixed or justified in `PHASE_00_REPORT.md`. Status: `open` · `fixed <commit>` ·
`justified` · `owner` (needs an owner action — PROGRESS "Waiting for the owner").

## Security review

| ID | Sev | Finding | Status |
|---|---|---|---|
| S-H1 | HIGH | One shared `/opt/masjid-connect` checkout for both environments + root timers/bind mounts → a staging release (auto-signed from `main`) runs as root against production; checkout race between environments; no lock; compose file can request `privileged`/host mounts | fixed f0d8ed3 |
| S-H2 | HIGH | DOCKER-USER rule drops **container egress** to any :443 (no `-i` match) → Turnstile, push, Cloudinary, Sentry, purge would all fail from Phase 1 | fixed f0d8ed3 |
| S-H3 | HIGH | Container logs lost on every deploy (recreate deletes the `local` log store) and above 50 MB/day → CERT-In 180-day gap | fixed f0d8ed3 |
| S-M1 | MED | Old signed manifest can be replayed (downgrade); `created` never compared | fixed f0d8ed3 |
| S-M2 | MED | `make-env.sh production` writes the always-pass Turnstile test secret; no production guard for placeholders | fixed 1aa7333 |
| S-M3 | MED | `make-env.sh --force` regenerates encryption key (same id), pepper, VAPID → unrecoverable data loss | fixed 1aa7333 |
| S-M4 | MED | `staging`/`production` environments not restricted to `main` → any branch workflow can read the signing key; `deploy-prod` lacks an ancestor-of-main check | fixed 0a3e5ec (deploy-prod); environment branch rule  |
| S-M5 | MED | 443 reachable from any IP between Docker start and the firewall unit (every boot / Docker restart) | fixed f0d8ed3 |
| S-L1 | LOW | `lockdown` reads `SSH_CONNECTION`, which `sudo` drops | fixed f0d8ed3 |
| S-L2 | LOW | Lock-out window if root session closes before `passwd <admin>` | fixed f0d8ed3 |
| S-L3 | LOW | `check.sh` flags :22 as public listener after lockdown | fixed 0a3e5ec |
| S-L4 | LOW | `provision.sh` trusts unpinned `main` | fixed f0d8ed3 |
| S-L5 | LOW | `env.ts`: `tls=false` passes the TLS check; other processes' Redis URLs not forbidden | fixed 1aa7333 |
| S-L6 | LOW | Unknown `/assets/*` → `index.html` with `immutable` 1-year cache | fixed 0a3e5ec |
| S-L7 | LOW | HAProxy logs at `notice` drop tcplog; no Caddy access log; no VPS backup of logs as 05 claims | open |
| S-L8 | LOW | Containers can reach `169.254.169.254` | fixed f0d8ed3 |
| S-L9 | LOW | Edge networks not `internal` (web has egress); HAProxy healthcheck only validates config | open |
| S-L10 | LOW | Redis has no `maxmemory` under the 512m limit | fixed 0a3e5ec |
| S-L11 | LOW | Client-supplied `X-Request-Id` accepted (log correlation spoofable) | fixed 0a3e5ec |
| S-L12 | LOW | Node keep-alive 65 s < Caddy's 2 min idle → sporadic 502s | fixed 0a3e5ec |
| S-L13 | LOW | ZAP `-I` never fails; `workflow_dispatch` releases without green CI; deploy images not re-scanned; signing step shares the build job's write token | fixed (ZAP gate + per-target reports; no dispatch; nightly Trivy of the deployed digests; signing in its own job without packages:write) |

## Phase verifier (FAIL items; PENDING-OWNER items are in PROGRESS)

| ID | Finding | Status |
|---|---|---|
| V-1 | No rolling replica restart in `deploy.sh` (both replicas recreated at once → 502s); no `lb_try_duration` in Caddy | fixed 0a3e5ec |
| V-2 | `tls-origin` (client-cert enforcement) never tested before the server | fixed 36ea093 |
| V-3 | Signing-key environments not limited to `main` (= S-M4) | owner (environment branch rule, O1/O6) |
| V-4 | No post-deploy header check; ZAP can never fail (= S-L13) | fixed (nightly staging header check + ZAP medium+ gate) |
| V-5 | Turbo `test` cache not invalidated by dependency changes (false green locally) | fixed (turbo test dependsOn ^typecheck) |
| V-6 | T0.10 visual comparison with the reference images not documented | open |
| V-7 | T0.9 screen-reader manual note missing | open |
| V-8 | 01 §9 font budgets not enforced | open |
| V-9 | DEPLOY.md: secret-change procedure, `--recreate`, AOP renewal, production signing key missing | fixed (DEPLOY.md §4–5, deploy.sh --restart) |
| V-10 | `pnpm infra:check` is a stub | fixed |
| V-11 | `pnpm verify` ≠ "everything CI runs" (CLAUDE.md §7 wording) | fixed (verify builds, check:dist, scan:bundles, test:perf; README: scans CI-only) |
| V-12 | Stale docs (T0.14 plan modes/secret step, Cloudflare boxes, env.test title "S3") | fixed (T0.14 plan, Cloudflare ticks, env.test title) |
| V-13 | README lacks the `*.localhost` hosts note | fixed |
| V-14 | Favicons contain hex colours (no-raw-colors skips `.svg`) — record exemption | fixed (DECISIONS #46 exemption) |
| V-15 | `Spinner` labelled path untested | fixed |
| V-16 | `media-staging` DNS/route has no Caddy site until Phase 3 | fixed (documented in infra/cloudflare/README.md) |
| V-17 | `make-env.sh` output not tested against the env schemas in CI | fixed 1aa7333 |
| V-18 | Urdu showcase screenshot shows a black offline bar without text — check | fixed (screenshot artifact: capture beyond the viewport; banner hidden in captures; hidden offset now measured) |

## Re-review (16 Oct 2026, `security-reviewer` + `phase-verifier`)

Recorded here on 16 Oct 2026 (autopilot) from the review transcripts — the closure items of DECISIONS #62.
Security: the HIGH (H1) was fixed by DECISIONS #61; M1 is the owner's environment setting.

| Id | Sev | Finding | Status |
|---|---|---|---|
| L1 | LOW | "Re-run" of an old `main` CI run re-signs the old commit with a fresh `created` → downgrade accepted | fixed (sign job: first attempt only, release must be main's tip; first real run after the push) |
| L2 | LOW | Log gaps during deploy: worker/redis logs between archive and recreate; `up --remove-orphans` unarchived; `log-archive.sh` no lock, file-name collisions | open |
| L3 | LOW | Cloudflare Browser Cache TTL overrides `no-cache` on `/boot.js`, `/sw.js` | owner (O10) |
| L4 | LOW | Script injection by Cloudflare not detected (only inline scripts checked); NEL/Report-To headers | fixed (spec: same-origin `<script src>` only, no `cdn-cgi`/beacon); NEL/Report-To → DECISIONS #74 |
| L5 | LOW | Proxied API responses expose `via: 1.1 Caddy` (= V-30) | fixed (Caddy `header_down -Via`; spec forbids `via`) |
| L6 | LOW | `check.sh`: no live AOP probe, no log-archive freshness, no host-layer owner/mode/VERSION check; no `OnFailure=` alerts | open |
| L7 | LOW | ZAP gate passes with zero reports | fixed (one non-empty report per target required) |
| L8 | LOW | Production environment: admins can bypass the required reviewer | owner (O6) |
| L9 | LOW | `cloudflare-ips.sh` would accept very wide prefixes (e.g. 0.0.0.0/0) | fixed (IPv4 < /8, IPv6 < /20 refused; CI test) — host layer: owner reinstalls |
| V-6 | — | T0.10 visual comparison table with the reference images | open |
| V-8 | LOW-MED | 01 §9 font budgets not enforced | open |
| V-19 | MED | Offline banner black strip while online | fixed (owner check pending, O7) |
| V-20 | MED | Nightly staging job never runs (variables) and would fail on `Server: cloudflare` | fixed in the spec (only `Server: cloudflare` accepted behind Cloudflare — verified read-only against staging); owner sets the variables (O11) |
| V-21 | MED | VPS → ap-south-1 latency not measured | owner (O9) |
| V-22 | MED | Final `PHASE_00_REPORT.md` | open (last) |
| V-23 | MED | Host layer + `check.sh` output for the report | fixed (owner ran it 16 Oct, 100 PASS) |
| V-24 | LOW | Docker userns-remap WARN has no DECISIONS entry | justified (DECISIONS #74 — revisit Phase 9) |
| V-25 | LOW | Raw-route ban matches names only (`r.get`, `express.Router().get` pass) | fixed (type-aware rule + factory-only `express()`/`Router()`, ESLint + Semgrep) |
| V-26 | MED | Deferral entries for F13/F18/F20/F22/F31; F-table cleanup | fixed (DECISIONS #74; PROGRESS F-table updated) |
| V-27 | LOW | Stale docs (PROGRESS T0.14/O7/T0.15 lines, Cloudflare README §7 boxes, owner file path) | open |
| V-28 | LOW | S-L7, S-L9, S-L13 still open | open |
| V-29 | LOW | `pnpm dev` health through the Vite proxy has no automated check | open |
| V-30 | LOW | `Via` header; `X-Robots-Tag` twice on admin API responses | fixed (Caddy drops `Via` and the upstream robots header; spec checks both) |
| V-31 | MED | security-reviewer to re-run on the phase diff | open (with the phase close) |
