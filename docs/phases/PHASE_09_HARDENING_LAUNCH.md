# PHASE 09 — Hardening, Production, Play Store & Pilot

## Goal
Prove the system is secure, fast and resilient at India scale; stand up production cleanly; publish the Android app on Google Play (Trusted Web Activity); and run a 2–3 masjid pilot with monitoring and runbooks in place.

## Read before starting
All docs. Especially `01_ARCHITECTURE.md` §8–11, `04_SECURITY.md` (all), `05_LEGAL_COMPLIANCE_IMPLEMENTATION.md` §5, `10_TESTING.md` §1 (Load, Security), and `owner/LEGAL_THINGS_I_NEED_TO_DO_MYSELF.md` (to know which owner items block launch).

## Owner prerequisites (launch blockers)
- Production accounts/projects: MongoDB Atlas project `mc-prod` (AWS Mumbai, **M10 or higher, Continuous Cloud Backup on**), a production VPS in Mumbai (≥ 4 vCPU / 8 GB RAM, static IPv4, provider snapshots on), Cloudflare production DNS for `app.`, `admin.`, `media.` and the root domain, a production Cloudinary product environment (Free plan unless usage requires otherwise — owner decides) with its own API keys, Turnstile prod keys, Sentry.
- Google Play developer account (see owner legal doc for account type implications) and a signing-key decision (Play App Signing recommended).
- Lawyer-reviewed legal texts + human-reviewed translations + verified Content Library + reviewed templates.
- Pilot masjids with signed paperwork.

---

## Tasks

### T9.1 — Security hardening & verification
**Do:** Walk the OWASP ASVS L2 checklist and produce `docs/security/ASVS_L2_CHECKLIST.md` (each requirement: applicable?, how met, evidence link/test). Manual abuse tests documented in `docs/security/ABUSE_TESTS.md` (IDOR on every admin route, replaying passkey responses, cookie tampering, oversize payloads, NoSQL operator injection in bodies/queries/headers, rate-limit bypass attempts with rotating device ids, QR code injection, UPI URI injection, push endpoint SSRF attempts, webhook replay, CSP bypass attempts, direct-to-origin requests bypassing Cloudflare, attempts to reach Redis/MongoDB from outside, container escape surface review — no docker.sock, non-root, read-only). ZAP full-scan against staging (authenticated admin context via test hook) — zero medium+. securityheaders.com + Observatory A+ on all origins. Dependency audit and Trivy image scan clean. `infra/vps/check.sh` all PASS on staging and production. `db:verify-roles` green on production Atlas. Atlas IP access list = production VPS IP only. Secrets rotation dry-run (except VAPID) — incl. rotating one MongoDB user password and one Redis ACL password with zero downtime (documented). MFA verified on all owner accounts (owner checklist).
**Acceptance:** [ ] Checklist complete; all findings fixed or accepted with DECISIONS entries signed off by the owner.

### T9.2 — Load & resilience tests
**Do:** k6 scripts (`load/`): (a) read mix at 2,000 rps for 10 min through the CDN (versions + bundles + feeds with realistic version churn), (b) cache-miss storm after a version bump on a 50k-follower masjid, (c) admin write burst, (d) push fan-out 50k (from Phase 4). (e) origin capacity: 300 rps of cache-miss traffic straight at the origin (temporary WAF/firewall allowance for the load generator), (f) resilience: restart a replica, restart Redis, restart the worker mid-fan-out — no lost notifications, no 5xx burst > 30 s. Measure Cloudflare cache hit ratio, p95/p99 latency, error rate, VPS CPU/memory/event-loop lag per container, Atlas CPU/connections/opcounters. `explain('executionStats')` for the 10 hottest queries recorded. Tune indexes/TTLs/pool sizes/replica counts.
**Acceptance:** [ ] CDN hit ratio ≥ 95% on (a); p95 API ≤ 150 ms on misses; error rate < 0.1%; MongoDB connections stay below pool/tier limits; (f) passes; report with graphs.

### T9.3 — Performance & motion pass
**Do:** Real-device profiling (owner provides a low-end Android for a remote session or uses Chrome remote debugging and shares traces); fix jank; verify budgets on production build; verify lite-motion triggers on the low-end device.
**Acceptance:** [ ] 01 §9 budgets met on production build; motion traces pass.

### T9.4 — Accessibility pass
**Do:** TalkBack and VoiceOver smoke test scripts for 10 key flows; font scaling 200% (no clipping, layouts reflow); color contrast audit of every token pair in use; focus order; reduced motion.
**Acceptance:** [ ] Issues fixed; report lists results per flow.

### T9.5 — Backups, runbooks, monitoring
**Do:** Atlas Continuous Cloud Backup (PITR) enabled on prod; restore drill: restore a point-in-time snapshot into a scratch cluster, run migrations check + integrity checks (`counters-reconcile` dry run, document counts), document timings. **VPS disaster-recovery drill:** rebuild staging from a blank VPS using `provision.sh` + the owner's offline copy of env files + latest images, and time it (target < 1 hour). `docs/runbooks/`: incident response (with CERT-In 6 h and DPDP steps cross-referencing the owner doc), DDoS/attack mode, compromised admin, compromised super admin (break-glass), takedown/legal order, VPA fraud report, push outage, Cloudinary outage / credits exhausted, key rotation, deploy/rollback, data deletion request, VPS lost/compromised (rebuild + rotate every credential), Redis data loss (outbox recovery), disk full, Atlas outage (app keeps serving cached content; admin read-only banner). Uptime monitor on health endpoints (both apps, through Cloudflare), worker heartbeat alert, VPS resource alerts, Atlas alerts, alert routing to owner phone/email. VPS log archive with ≥ 180-day retention verified (DECISIONS #40), the owner's offline decryption key tested, plus a documented way for the owner to search logs for a date range.
**Acceptance:** [ ] Restore drill evidence. [ ] Each runbook has owner-executable steps (no code knowledge assumed).

### T9.6 — Production setup
**Do:** Provision + harden the production VPS (`provision.sh`, `check.sh`), Cloudflare production settings (Full strict, origin pulls, cache rules, WAF, scripts-injection features off), Cloudinary production settings (strict transformations, named transformations, two API keys, MFA). Separate prod env files and keys (generate new VAPID, session pepper, field key, MongoDB user passwords, Redis ACL passwords, Cloudinary API keys, log-archive key pair, Cloudflare purge token, Turnstile); apply migrations via the `deploy-prod` workflow with manual approval (never from a laptop); bootstrap prod Super Admin (owner registers 2 passkeys); production domains with HSTS preload submission (after verifying all subdomains are HTTPS); robots rules; final legal texts loaded; production smoke test checklist executed.
**Acceptance:** [ ] Smoke test checklist (in report) all green on production.

### T9.7 — Google Play (TWA)
**Do:** Bubblewrap (or the current recommended TWA tooling — verify) project in `android/` (no secrets committed): package name decided with owner, `assetlinks.json` served from the app origin, Play App Signing, splash/icons, target SDK per current Play policy, notification delegation for web push in TWA (verify current behaviour), deep links for `/m/*` and `/p/*`. Store listing assets: screenshots generated by Playwright at Play-required sizes in 4 languages, feature graphic, short/full descriptions (draft for owner review), privacy policy URL, Data safety form answers drafted from the actual data inventory (02) for the owner to submit. Internal testing track build.
**Acceptance:** [ ] App installs from internal testing; verified links open in-app; push works inside TWA; no URL bar shown (asset links verified).

### T9.8 — Pilot readiness
**Do:** Admin quick-start guide (1-page, 4 languages, picture-heavy) generated as a printable page from the admin app; in-app "What's new" sheet; feedback category in grievance form; Super Admin "pilot dashboard" filter for pilot masjids.
**Acceptance:** [ ] Owner reviews quick-start guide.

### T9.9 — Launch checklist
**Do:** `docs/LAUNCH_CHECKLIST.md` combining: all phases DONE, owner legal blockers cleared (owner signs), security sign-off, performance sign-off, backups verified, monitoring live, runbooks reviewed, Play listing approved, pilot feedback addressed.
**Acceptance:** [ ] Every box ticked before public launch; pilot can start once security + legal blockers are cleared.

---

## Phase exit criteria
Production live for pilot masjids; Play internal/closed testing live; checklists complete; phase-verifier PASS; security-reviewer clean on the full codebase (not just the diff).
