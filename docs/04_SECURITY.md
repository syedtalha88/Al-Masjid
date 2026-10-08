# 04 — Security

> Baseline: **OWASP ASVS 5.0 Level 2** for the whole system, Level 3 controls for authentication, session management and the payment-profile workflow. Also covers OWASP Top 10 (web), the OWASP Top 10 for APIs, and (new with the VPS) CIS-style host and Docker hardening.
> Every control below has an owner phase and a test. "We'll add it later" is not allowed.

## 1. What we protect (assets) and from whom

| Asset | Why it matters | Worst case |
|---|---|---|
| Masjid **UPI payment profile** | People send money to it | Attacker swaps VPA → donations stolen, community trust destroyed |
| Admin accounts (esp. Super Admin) | Can publish to thousands and change payment details | Mass misinformation, communal content, fraud |
| Published content integrity | Religious + community information | Fake hadith, hateful posts → legal exposure, real-world harm |
| Push channel | Reaches lakhs of phones | Spam / phishing notifications |
| Device records & follow graph | Pseudonymous religious-affiliation data | Profiling of people who follow certain masjids |
| Admin phone numbers, grievance contacts | Personal data | DPDP breach |
| The VPS and its secrets | Holds every credential for MongoDB, S3, Bunny, VAPID | Full compromise of data and push channel |
| Availability | Jumu'ah/Ramadan spikes | Outage at the moment people need timings |

Threat actors: opportunistic bots/scrapers, fraudsters targeting donations, communal trolls, a disgruntled ex-committee member, compromised admin phone, insider mistakes, supply-chain compromise, internet-wide scanners hitting the VPS.

## 2. Highest-risk scenarios and mandatory mitigations

| # | Scenario | Mitigations (all required) |
|---|---|---|
| R1 | VPA swap to steal donations | VPA change only via request → Super Admin step-up approval → **24h hold** → activation job; all followers get a "Payment details updated" notice when it goes live; payee name always shown; admin-uploaded QR images not accepted; history retained; audit log; Super Admin push alert on every request; `payment_profiles` writable only through the state-machine functions (02 §3) and partial unique indexes prevent two active/pending profiles |
| R2 | Admin phone stolen/unlocked | Passkey requires user verification (screen lock); sessions idle-expire; Super Admin can revoke sessions + passkeys instantly; push quota per masjid limits blast radius; edits limited to 24h |
| R3 | Invite link intercepted | Single-use, 72h expiry, hashed at rest, purpose-bound, shows masjid + admin name before use, Super Admin sees "used at" and can revoke; one unused invite per admin |
| R4 | Super Admin compromise | Multiple passkeys on separate devices registered, step-up for ★ actions, Super Admin sessions idle 30 min / absolute 12 h, alerts on new passkey registration, audit everything, break-glass procedure documented (owner) |
| R5 | Hateful / fake content | Library-only hadith/ayah; templates for notices; report button; moderation queue with SLAs; instant removal propagates via version bump + CDN purge; masjid suspension; admin undertaking |
| R6 | Scraping follow graph / enumerating masjids | No public "list all masjids" endpoint; follow codes 40-bit random; UUID v4 ids; uniform 404s; rate limits; the public DB user can read only views (no `devices` access beyond its own device through the policy layer); admins see only audience counts via a view without device ids; follower counts only to admins |
| R7 | Push spam | Only the `worker` holds the VAPID private key; jobs are not reachable over HTTP (internal BullMQ queues on a private network); quotas; Redis protected by password + ACL users |
| R8 | DoS at peak times | Cloudflare CDN serves immutable content; tiny versions endpoint; Cloudflare WAF rate rules + DDoS protection + documented "Under Attack" mode; origin firewall accepts only Cloudflare; per-container CPU/memory limits; graceful offline mode (app still shows cached + computed times) |
| R9 | Supply-chain | Lockfile, pinned versions, Renovate with review, `pnpm audit`/osv-scanner in CI, no install scripts from unknown packages (`pnpm` `onlyBuiltDependencies` allow-list), Docker base images pinned by digest and scanned with Trivy (fail on high/critical), images signed/pulled by digest, SRI not needed (no third-party script CDNs) |
| R10 | XSS → session theft in admin | No user HTML anywhere; React escaping; strict CSP + Trusted Types; HttpOnly cookies; admin app on separate origin |
| R11 | NoSQL injection / mass assignment | Express `query parser: 'simple'`; every input Zod-parsed with `.strict()` objects into primitives; repositories accept typed args only; `$`/`.`-key guard; policy-layer field allow-lists for every update; MongoDB `$jsonSchema` validators with `additionalProperties: false`; no `$where`/`$function`/`$accumulator`/server-side JS (Semgrep rule; Atlas server-side JS disabled where configurable) |
| R12 | VPS compromise | Hardened host (§12.2), SSH keys only + restricted source, no public ports except 80/443 from Cloudflare, containers non-root/read-only/cap-dropped, per-process credentials (a compromised `api-public` container still can't use admin/system credentials — DECISIONS #7), Atlas IP access list = VPS IP only, secrets files mode 600, automatic security updates, provider snapshots |

## 3. Authentication (admins)

- WebAuthn via SimpleWebAuthn. RP ID = `admin.<domain>`; expected origin exact match.
- Registration: `residentKey: 'required'`, `userVerification: 'required'`, `attestation: 'none'`, `pubKeyCredParams` ES256 (-7) + RS256 (-257), `excludeCredentials` = admin's existing creds.
- Authentication: discoverable (empty `allowCredentials`), `userVerification: 'required'`; verify `uv` flag is set; verify `rpIdHash`, origin, challenge.
- Challenges: 32 random bytes, stored in Redis with 5-minute TTL, **deleted on first use** (`GETDEL`), bound to purpose + invite/session.
- Sign counter: if stored > 0 and received ≤ stored → reject, mark credential `revoked_at`, alert Super Admin, audit (possible clone). Counter 0 (synced passkeys) is accepted.
- No username enumeration: login endpoints never reveal whether an admin exists.
- Recovery = new invite with purpose `recovery` (Super Admin only) → old passkeys optionally revoked at the same time.
- Bootstrap: `scripts/bootstrap-super-admin.ts` (run once by the owner on the VPS via `docker compose run --rm worker node dist/scripts/bootstrap-super-admin.js`, i.e. with the system DB user) creates the Super Admin and prints a one-time invite URL. Refuses to run if a super admin already exists unless `--force-additional`.

## 4. Sessions

- Token: 32 random bytes (base64url) → cookie `__Host-mc_sess`; DB stores `SHA-256(token || SESSION_PEPPER)`.
- Cookie attributes: `Secure; HttpOnly; SameSite=Strict; Path=/` (no `Domain`).
- Lifetimes: masjid admin idle 7 days / absolute 30 days; super admin idle 30 min / absolute 12 h; step-up window 5 min.
- Rotate on login and step-up; revoke all on passkey revocation; `last_seen_at` updated at most every 5 min.
- Logout clears cookie + revokes server document.
- Musalli devices: bearer token stored in IndexedDB (not localStorage). Rotation not required (low privilege); deletable.

## 5. Authorization (DECISIONS #20)

- **Four layers, always**: (1) API service checks (membership, role, ownership, state); (2) the **policy layer** in `packages/db` that injects tenant filters/projections/field allow-lists on every query (02 §4.1); (3) **MongoDB users with least-privilege custom roles** + public **views** (02 §4.2–4.3); (4) matrix + privilege tests. A test must show that bypassing the API check (calling the repository directly with another masjid's scope or a crafted id) still fails at the policy layer, and that the DB user itself cannot perform operations outside its role.
- Resource ids from the URL are always re-resolved under the caller's scope (the policy layer adds `masjid_id ∈ scope.masjidIds` to every admin query); never trust ids in bodies.
- Sensitive state changes only via the state functions in `packages/db/src/state/**` with explicit scope checks (02 §3) — no generic update method exists for `payment_profiles`, masjid `status`, item `removed` status, or invites.
- Field allow-lists (replacing Postgres column grants) prevent admins from changing quotas, status, verification, follow code, counters, `content_version`, `masjid_visible` — tested with crafted payloads.
- Super admin endpoints mounted on a separate Express router with a role guard at the router level + per-route step-up guard.
- `systemScope()` and the system DB user exist only in the `worker` container and one-off scripts; webhooks use the narrow `hookScope('bunny')`; ESLint + Semgrep enforce the import bans; the forbidden-env boot assertion (01 §7) enforces the credential split.

## 6. Input validation & output encoding

- Zod schemas: strict objects (`.strict()`), max lengths matching DB validators, enums, trimmed strings, Unicode NFC normalization, reject control characters except `\n`, collapse >2 consecutive newlines.
- **NoSQL safety** (R11): only primitives reach filters; ids validated as UUID strings then converted to BSON UUID; no user-controlled field names, sort keys or operators (sort/filter options are enums mapped to fixed fields); `$`/`.`-prefixed keys rejected anywhere in parsed input; Express `query parser: 'simple'`; aggregation pipelines are static code with parameter values only.
- Text rendering: React only; line breaks via CSS `white-space: pre-line`. Linkify only `https://` URLs with `rel="noopener noreferrer nofollow ugc"` and an interstitial "You are leaving the app" for non-allow-listed hosts.
- Legal markdown rendered at build/server time with a sanitizer (allow-list tags) — content is ours, still sanitized.
- Files: see 01 §5.4–5.5. Never serve user uploads from the app or admin origin; only from `media.<domain>` (S3 via Cloudflare), with `Content-Type` set by us and `X-Content-Type-Options: nosniff`; upload parsing via `busboy` with hard limits (one file, size, field count, field size) — never written to disk.
- QR scan results: parsed as URL; only `https://app.<domain>/m/<code>` (or a bare 8-char code) is accepted; anything else → "This QR is not a Masjid Connect code" (no navigation). Admin UPI-QR scan accepts only `upi://pay` URIs and extracts `pa`/`pn` through `packages/domain/upi`.
- YouTube: accept only `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `youtube.com/live/` → extract 11-char id with strict regex.
- Push subscription endpoint: https + host allow-list (`fcm.googleapis.com`, `*.push.apple.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`) to prevent SSRF via push sending.
- Outbound requests (Bunny, Turnstile, push, S3, Cloudflare API, Sentry) go only to fixed hosts; no user-controlled URLs are fetched server-side. Container egress is otherwise unrestricted only to the internet (not to the VPS host/metadata IPs — block `169.254.169.254` and the Docker host gateway from app containers via firewall rules).

## 7. HTTP security headers (all origins; set in Caddy for static files and `helmet` + custom middleware for API responses)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://challenges.cloudflare.com;
  style-src 'self';
  img-src 'self' data: blob: https://media.<domain> https://<bunny-cdn-host> https://i.ytimg.com;
  media-src 'self' blob: https://<bunny-cdn-host>;
  font-src 'self';
  connect-src 'self' https://<bunny-tus-host> https://<bunny-cdn-host> https://<sentry-ingest-host> https://challenges.cloudflare.com;
  frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com;
  worker-src 'self' blob:;
  manifest-src 'self';
  object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none';
  upgrade-insecure-requests;
  require-trusted-types-for 'script'; trusted-types default dompurify;
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self), microphone=(), payment=(), usb=(), bluetooth=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-site
X-Frame-Options: DENY
```
- Admin origin: same, minus YouTube/Turnstile entries where unused, plus `X-Robots-Tag: noindex, nofollow`.
- API JSON responses additionally: `Cache-Control` per 01 §5.2 (default `no-store`), `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.
- Caddy removes the `Server` header; Express `x-powered-by` disabled.
- No inline scripts/styles in `index.html` (Vite build config ensures this; theme-color via meta tag). If a hash is unavoidable, use a build-time computed hash, never `'unsafe-inline'`.
- Cloudflare must not inject scripts (Rocket Loader, Email Obfuscation, Web Analytics auto-inject, etc. **off**) — they would break CSP.
- Verify Motion/Tailwind/hls.js work under this CSP in Phase 0/6 (style attributes set via CSSOM are allowed; `style=""` in HTML strings is not).
- Target: securityheaders.com A+, Mozilla Observatory A+.

## 8. CSRF, CORS, clickjacking
- Admin: SameSite=Strict + `Origin` check + `X-MC-CSRF` header on all mutating requests.
- No CORS headers anywhere (same-origin APIs; no `cors` middleware installed). Preflight requests to API → 403.
- Framing denied everywhere.

## 9. Abuse controls
- Rate limits per 03 §2. Prefer device/session keys over IP (Indian carrier CGNAT).
- Turnstile on device registration, reports and grievances; server verifies with `remoteip` omitted (we don't store IPs).
- Push quota per masjid per IST day; Super Admin override.
- Upload quotas per masjid; video duration/size limits.
- Follow cap 20/device; Ameen idempotent.
- Cloudflare: WAF managed rules on, rate-limit rule on `/api/*` (coarse), Bot Fight Mode evaluated for compatibility with the PWA, a documented "Under Attack" toggle in the runbook.

## 10. Data protection
- In transit: TLS 1.2+ everywhere — Cloudflare edge (TLS 1.2 minimum, HSTS), Cloudflare → origin **Full (strict)** with Origin CA certificate + Authenticated Origin Pulls, Atlas (TLS required), S3/Bunny/push (HTTPS). Redis traffic stays on the private Docker network (no published port).
- At rest: provider encryption (Atlas encryption at rest, S3 SSE, VPS disk encryption where the provider offers it) + app-level AES-256-GCM for `admin_users.phone_enc` and `grievances.contact_enc` (random 96-bit IV per value, key id stored for rotation, key from env, never in DB).
- Secrets: only in per-process env files on the VPS (`/etc/masjid-connect/<env>/*.env`, root-owned, mode 600) and in GitHub **environment** secrets used by deploy jobs (SSH deploy key, registry token) — never in the repo, images, or logs; separate per environment; rotate VAPID? (no — rotating breaks subscriptions; protect it and back it up instead), rotate others yearly or on suspicion. `.env*` git-ignored; gitleaks in CI and pre-commit.
- Logging: allow-listed fields only; pino redaction; no request/response bodies for auth/device/grievance routes; Sentry `beforeSend` scrubber + server-side data scrubbing enabled.
- Backups: Atlas Continuous Cloud Backup (point-in-time restore) in production; monthly restore drill into a scratch cluster (Phase 9 runbook). VPS: provider snapshots weekly (config only — no DB data lives on the VPS except Redis, which is reconstructible).
- Least privilege for humans: only the owner has production access; MFA on email, GitHub, VPS provider, MongoDB Atlas, AWS (root account locked away; IAM users only), Cloudflare, Bunny, Sentry, domain registrar, Google Play.

## 11. Frontend security
- No secrets in bundles (CI scans `dist/` for key patterns and for env names that must not appear).
- Service worker: only same-origin, versioned caching rules; never caches admin API; validates push payload with Zod before showing; notification `data.url` must be a same-origin relative path.
- IndexedDB data validated on read (schemas versioned; migration or reset on mismatch).
- Third-party script inventory: Turnstile (app only), YouTube iframe after tap. Nothing else.
- Dependencies for the browser kept minimal (01 §4).

## 12. Infrastructure & CI/CD

### 12.1 Repository & pipeline
- `main` protected: required checks (CI), no force push, signed commits recommended.
- GitHub Actions: pinned action SHAs, `permissions: contents: read` default, `packages: write` only in the image job, secrets only in deployment **environments** (`staging`, `production`) with required reviewers for production.
- CodeQL (JS/TS), Semgrep (OWASP + custom rules: no `dangerouslySetInnerHTML`, no `systemScope` outside jobs/scripts, no `hookScope` outside hooks, no `mongodb` imports outside `packages/db`, no `$where`/`$function`, no `router.<verb>` outside `defineRoute`, no `console.log`), gitleaks, osv-scanner, `pnpm audit --prod` (fail on high/critical), **Trivy** image + config scan (fail on high/critical), `hadolint` for Dockerfiles.
- Nightly: OWASP ZAP baseline scan against staging (both origins), Lighthouse, dependency report, Trivy re-scan of deployed digests.
- Deploys: build once → push to GHCR → deploy by digest over SSH with a restricted deploy user (can only run the deploy script — `command=` in `authorized_keys`). Production deploys and DB migrations require manual approval.

### 12.2 VPS hardening (script in `infra/vps/`, idempotent; verified by a checklist test in Phase 0/9)
- Ubuntu LTS minimal; automatic security updates (`unattended-upgrades`) with reboot window; NTP (`chrony`/`timesyncd`) on (CERT-In).
- SSH: keys only (ed25519), `PermitRootLogin no`, `PasswordAuthentication no`, non-default admin user with sudo, `AllowUsers`, SSH reachable only from the owner's IP(s) or a WireGuard/Tailscale tunnel; `fail2ban` for sshd.
- Firewall (`ufw`/nftables): default deny incoming; 443 (and 80 for redirect) **only from Cloudflare IP ranges** (refreshed by a weekly systemd timer); SSH as above; Docker-published ports covered by the same rules (`DOCKER-USER` chain), because Docker otherwise bypasses ufw.
- Docker: daemon `live-restore`, `no-new-privileges` default, log rotation, user-namespace remapping or rootless mode where compatible; no `docker.sock` mounted into any container; no `privileged`; containers `read_only`, `cap_drop: ALL`, non-root `USER`, healthchecks, resource limits; images from GHCR pinned by digest.
- Redis: no published port, `requirepass` + ACL users per process (`rl_public` limited to `rl:pub:*`; `admin` limited to `rl:adm:*`, `chal:*`, `bull:*`; `worker` to `bull:*`, `push:*`, `alert:*`), dangerous commands disabled (`FLUSHALL`, `CONFIG`, `KEYS`, `DEBUG`), AOF on.
- Atlas: IP access list = VPS static IPs (+ CI runner only for the migrate step via a temporary entry, or run migrations from the VPS); database users per process (02 §4.3); Atlas alerts on; database auditing on (M10+) for auth failures and user/role changes.
- Origin certificate & Authenticated Origin Pulls: Caddy requires Cloudflare's client certificate on 443.
- File permissions: secrets env files 600 root; app directories owned by root, read-only to containers.
- Monitoring: disk/memory/CPU alerts; container restart-loop alerts; SSH login alerts to the owner.

## 13. Incident response (implementation hooks; procedure in owner docs)
- Kill switches (Super Admin): suspend masjid, revoke admin, global "pause all push" flag, maintenance banner, global read-only mode flag (admin writes return 503 with friendly message).
- Infrastructure switches (runbook): Cloudflare "Under Attack" mode, scale API replicas, stop `worker` (halts all pushes), rotate a process's DB password in Atlas (cuts that process off instantly).
- Alerting: Sentry error spike, job failure rate > 5%, push success < 90%, 5xx rate > 1%, SLA timers, Atlas alerts, VPS resource alerts → Super Admin push + email (via Sentry/uptime tool).
- Forensics: audit log + request ids + 180-day logs (S3 archive) + Atlas audit/access logs.
- Breach → owner follows `owner/LEGAL_THINGS_I_NEED_TO_DO_MYSELF.md §Incident` (CERT-In 6h, DPDP Board/principals).

## 14. Security test requirements (see 10_TESTING)
- **Policy matrix tests**: every (collection × scope × operation) cell allowed + denied; state functions reject unauthorized scopes; field allow-lists reject non-allowed fields; audit/history append-only.
- **DB privilege tests** (`pnpm db:test`, local MongoDB with auth; `db:verify-roles` against staging Atlas): each MongoDB user can do exactly what 02 §4.3 allows and gets `Unauthorized` for everything else; views expose only the listed fields.
- API integration: authz matrix (each admin endpoint × {no session, other masjid admin, editor, owner, super}); IDOR attempts; CSRF (missing header/origin); NoSQL-injection payloads (`{"$ne":…}`, `a[$gt]=`, `$where`) on every endpoint via fast-check; rate limits; invite reuse/expiry; challenge reuse; counter regression; step-up enforcement; payment state machine incl. hold period; quota enforcement; validation fuzzing (fast-check) on all schemas; forbidden-env boot assertion per process.
- E2E: CSP violations = test failure (listen to `securitypolicyviolation`); no mixed content; cookies flags asserted.
- Infra: VPS hardening checklist script output attached to Phase 0 and Phase 9 reports (open ports from outside = only 443/80 via Cloudflare; direct-to-origin request without Cloudflare client cert rejected); Trivy clean.
- Scans: ZAP baseline clean of medium+; headers A+.
