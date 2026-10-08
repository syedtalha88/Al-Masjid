# HANDOFF — Masjid Connect project context (paste this whole message into a new AI chat)

**To the AI reading this:** You are taking over an ongoing project-planning conversation. Read everything below; it contains the full context, all decisions already made with the owner, and what has already been produced. Continue as a senior full-stack developer / technical lead and Claude Code expert. **Do not restart the planning or re-ask questions already answered here.** If I (the owner) also attach a zip named `masjid-connect-claude-pack-v2.zip` (or files from it), treat those files as the **source of truth** (they are more detailed than this summary). Reply first with a short confirmation of your understanding and ask what I want to do next.

---

## 1. About me (the owner) and how I work
- Based in Hyderabad, India. I am not a mobile developer, so the app is a **PWA**. I will build it by "vibe coding" with **Claude Code**, using spec markdown files.
- This is a **free giveaway / community project**, not a business; I don't plan to register a company (I was advised to consider a Trust or Section 8 company to limit personal liability — undecided).
- My requirements: scalable (all-India), industry-standard best practices, no compromise on performance, proper testing and verification at every step/phase, super secure, compliant with Indian law, **premium modern UI with fluid Apple-like animations** on every navigation, tap, sheet and scroll; mobile-first; very easy for masjid admins who may have low literacy and little English.
- I will **host on a VPS** (my decision).
- I prefer direct, clear, practical answers.

## 2. The product (working name "Masjid Connect")
A free, ad-free, multilingual PWA connecting Indian Muslims with their local masjids. Distribution: QR posters at masjids across India.

**Roles**
- **Musalli (public user):** no account at all. Scans a masjid's QR (or opens a share link, or types an 8-character follow code like `ABCD-EFGH`) to follow it. Can follow up to 20 masjids. Chooses language and **Brother/Sister** at onboarding (used only to filter bayan videos; stored on device + anonymous device record).
- **Masjid Admin** (imam/mutawalli/committee, 1–5 per masjid, roles owner/editor): logs in with **passkeys only** (phone's screen lock — PIN/pattern/face/fingerprint; no passwords, no SMS OTP — SMS in India needs DLT registration). Onboarded by single-use invite links from the Super Admin.
- **Super Admin (me):** verifies/onboards masjids, invites/revokes admins, approves UPI changes, moderation & takedowns, grievances, legal orders register, content library, templates, settings, audit log, printable QR posters.

**Features (all agreed)**
1. Prayer timings per masjid: Adhan (auto-calculated via adhan library with masjid coordinates/method/madhab, or manual) + Jamaat (fixed or "N minutes after adhan", e.g. Maghrib); Jumu'ah (1–3 jamaats); Special Dates (Eid, Taraweeh, etc.); **Ramadan mode** (Sehri/Iftar with precaution minutes); **Hijri date** (with offset for Indian moon sighting). Home strip shows **Jamaat** times with live countdown.
2. Daily **Hadith / Quran ayah** — admins pick only from a **curated, scholar-verified Content Library** that I import (free-typing hadith is not allowed; AI must never generate religious text).
3. **Announcements/notices** (categories general/event/facilities/timing, "Important" flag) — created mainly from **pre-translated templates in 4 languages** (e.g. "No water 10 AM–2 PM") so admins only tap pickers; free text also allowed.
4. **Dua requests** (illness / inteqal / other) with an attached dua from the library; person's name optional and private by default; musallis tap **Ameen** (count once per device).
5. **Donation campaigns**: target, progress bar, amount received **updated manually by admin** (labelled "Received (reported by masjid)" + last updated time), **Donate Now** (UPI deep link `upi://pay?...`) + **Show UPI QR** sheet (with save-to-gallery). We never touch money. **UPI change-lock:** any change to the masjid's UPI needs Super Admin approval + 24-hour hold + followers notified. Admin-uploaded QR images not accepted (VPA extracted by scanning). Business/merchant UPI IDs recommended.
6. **Weekly chanda** totals with a visibility toggle (shown only if the masjid wants) + 8-week chart.
7. **Bayan videos**: resumable upload from phone (Bunny Stream, HLS, 360/480/720p) or YouTube link; audience **Everyone / Brothers only / Sisters only**; per-masjid storage quota (default 20 GB).
8. **Push notifications** for all of the above (web push); per-masjid **mute** toggle; daily push quota per masjid.
9. **Qibla compass** (on-device location only; iOS motion permission; calibration; map fallback).
10. **4 languages:** English, Hindi, **Urdu (full RTL)**, Telugu.
11. Accepted improvements: Ramadan mode, Eid namaz timings, Hijri date, WhatsApp share link, "No ads, ever" promise, printable QR poster generator (4 languages).
12. **Rejected by me (do not build):** khutbah language field, janaza priority alerts, per-category notification preferences. (Per-masjid mute is still included.)
13. Also: report button on all content, grievance form, legal pages, "Clear all data", saved items, offline mode.

**Design:** I provided 3 reference sheets (12 screens: Home, My Masjids, Masjid Detail, Prayer Timings, Announcements ×2, Hadith & Quran ×2, Donation Detail, Donation Campaign, Updates timeline, Dua Requests). Style: warm off-white canvas `#F8F8F5`, deep emerald primary `#13543C`, mint surfaces `#ECF6EE`, white rounded cards (radius 16–20), very soft shadows, Inter font, Amiri for Arabic, bottom tab bar Home / My Masjids / **raised green center Scan button** / Updates / Settings, full-bleed hero image with overlapping white sheet on Masjid Detail, filled dark-green filter chips, underline tabs, timeline-style Updates. No third-party UPI app logos.

## 3. Key technical decisions — **Revision 2 (8 Oct 2026): React + Express + Node + MongoDB on a VPS**
(Revision 1 used Hono on Vercel + Supabase Postgres; I changed the stack before any code was written. All features, rules, phases, security and legal requirements stayed the same. Full record: `docs/DECISIONS.md` #19.)
- **PWA**, published to Google Play later as a Trusted Web Activity; code kept wrapper-agnostic (Capacitor possible later). iOS push requires "Add to Home Screen" from Safari (iOS 16.4+) → guided install. iOS Safari storage is separate from the installed app → in-app Scan is the primary follow path.
- **Frontend (unchanged):** two Vite + React 19 + TypeScript SPAs (`apps/app` musalli, `apps/admin` admin + super admin). Next.js re-evaluated and rejected (no SEO need, worse offline shell, extra server load). TanStack Router + TanStack Query (persisted to IndexedDB), Motion (`motion/react`, LazyMotion), Tailwind v4 with design tokens, vite-plugin-pwa (injectManifest), Phosphor icons, i18next + ICU.
- **Backend:** **Node.js + Express 5** (TypeScript) in `packages/api`, run as three Docker containers: `api-public` (app origin `/api/v1`), `api-admin` (admin origin `/api/admin`, `/api/super`, `/api/hooks`), `worker` (BullMQ jobs). Routes only via a typed `defineRoute()` helper (Zod validation + auth + rate limit + OpenAPI). helmet, pino logging, `query parser: 'simple'`.
- **Hosting:** **VPS in Mumbai** (Ubuntu LTS) with **Docker Compose + Caddy** (static SPAs + reverse proxy, same-origin APIs → first-party cookies, no CORS) behind **Cloudflare** (DNS, TLS Full-strict + Authenticated Origin Pulls, CDN cache of versioned API responses, WAF, DDoS, Under Attack mode). Origin firewall accepts only Cloudflare IPs. Hardening script + checklist (`infra/vps/`). GitHub Actions → GHCR images by digest → SSH deploy; prod deploys/migrations need manual approval.
- **Database:** **MongoDB Atlas, AWS ap-south-1 (Mumbai)**, replica set with transactions; prod M10+ with Continuous Cloud Backup (PITR); IP access list = VPS IP only. Official `mongodb` driver (no Mongoose). Zod document schemas are the source of truth → generated `$jsonSchema` validators; in-house migration runner creates collections, validators, indexes, views. UUID v4 `_id`s.
- **Authorization without RLS (DECISIONS #20):** (1) API checks + (2) a **policy layer** in `packages/db` that injects tenant filters/projections/field allow-lists into every query by typed Scope (public/device/masjidAdmin/superAdmin/hook/system), deny-by-default + (3) **separate MongoDB users per process** (`mc_public` reads only **views**, `mc_admin` no access to devices and append-only on audit/history, `mc_system` only in the worker) + (4) tests for every matrix cell and DB-privilege tests per user. What used to be triggers/SECURITY DEFINER functions are data-layer side effects and state functions inside transactions (version bump, follow/admin limits, counters, visibility mirrors, payment state machine).
- Passkeys via SimpleWebAuthn; `__Host-` HttpOnly SameSite=Strict session cookies; step-up re-auth for sensitive super-admin actions.
- **Caching for scale:** per-masjid `content_version`; clients poll a tiny versions endpoint and fetch immutable versioned bundles/feeds from the Cloudflare CDN; takedown = version bump + Cloudflare purge job.
- **Jobs & push:** **Redis on the VPS** (private network, ACL users per process) + **BullMQ**; MongoDB **outbox** (`notification_jobs`) + sweeper so no notification is lost; web-push (VAPID private key only in the worker). Rate limits with `rate-limiter-flexible`. Cloudflare **Turnstile** for device registration/reports/grievances; **Sentry** with PII scrubbing; no analytics SDKs.
- **Images:** sharp re-encode → **AWS S3 ap-south-1** public media bucket at `media.<domain>` via Cloudflare; separate private bucket (presigned 5-min URLs) for legal documents; logs archived to S3 ≥ 180 days (CERT-In).
- Musalli device record stores only: random id + hashed secret, locale, brother/sister, followed masjids + mute flags, push subscription, privacy version. No name/phone/email/location/IP in the database.
- Monorepo: pnpm + Turborepo; `apps/{app,admin,server}`, `packages/{api,db,domain,shared,ui,i18n,config}`, `infra/{docker,compose,caddy,mongo,cloudflare,vps}`.
- Performance budgets: initial JS ≤ 170 KB gz, LCP ≤ 2.5 s cold / ≤ 1 s warm on a ₹8k Android, 60 fps animations, "lite motion" mode for low-end phones, full reduced-motion support; API p95 ≤ 150 ms on cache miss.
- Security baseline OWASP ASVS L2 (L3 for auth & payment profile) + host/Docker hardening: strict CSP + Trusted Types, HSTS, NoSQL-injection controls, rate limits keyed by device/session (Indian CGNAT), upload re-encoding + EXIF stripping, append-only audit log, Trivy/hadolint/Semgrep/CodeQL in CI, kill switches (pause push, admin read-only).
- **Legal (India):** DPDP Act 2023 + DPDP Rules 2025 (notified 13–14 Nov 2025; main obligations from **14 May 2027**); IT Rules 2021 as amended Feb 2026 (**3-hour** takedown on court/government orders, **2-hour** for intimate/impersonation complaints, **36-hour** for other complaints, 24-hour grievance acknowledgement); CERT-In 2022 directions (**6-hour** incident reporting, **180-day** logs, NTP). App features: report button, moderation queue with SLA timers, removed content preserved privately 180 days, grievance officer + tracker, legal orders register, versioned privacy/terms/admin undertaking with re-acceptance, retention jobs, DRAFT legal texts blocked from production until lawyer review.

## 4. Build phases (each ends with automated gates + my manual phone checks)
- **00** Foundation: monorepo, CI, Express skeleton + Docker + Caddy, **staging VPS provisioning & hardening + Cloudflare**, security headers (A+), design tokens & components, 4 languages + RTL, motion & stack navigation, PWA baseline.
- **01** Database (Atlas, all collections + validators + indexes + views, DB users/roles, policy layer + full matrix and privilege tests), passkey auth & sessions, bootstrap super admin, admin shell, Super Admin masjid/admin onboarding, audit log.
- **02** Musalli core: onboarding, scan/code/link follow, Home, My Masjids, Masjid Detail, Prayer Timings, Updates, Announcements/Hadith/Dua read side + Ameen, Settings, offline (uses fake seed data).
- **03** Admin content tools: timings editor, special dates & Ramadan, content library import/verify, notice templates, notice/hadith/dua creators, image pipeline (S3), My Posts, preview & publish, real-person usability test.
- **04** Push notifications (subscription UX, service worker, BullMQ fan-out + outbox, quotas, mute, kill switch, 50k load test).
- **05** Donations & chanda + UPI change-lock (₹1 real-payment test).
- **06** Bayan videos (Bunny Stream resumable upload, webhook, YouTube option, player, audience filter, quotas).
- **07** Qibla compass.
- **08** Moderation, grievance, legal orders, legal pages, retention job, QR posters, kill switches.
- **09** Hardening (ASVS checklist, ZAP, load + resilience tests, a11y, Atlas restore drill + VPS rebuild drill, runbooks, monitoring), production setup, Google Play TWA, pilot with 2–3 masjids.

## 5. What has already been produced (the "Claude Code pack", v2)
A zip `masjid-connect-claude-pack-v2.zip` that I copy into my repository root:
- `CLAUDE.md` — binding rules for Claude Code (session protocol, task workflow, stop-and-ask conditions, phase completion protocol, coding standards, never generate religious text, Definition of Done, commands).
- `.claude/settings.json` (deny reading `.env*`/keys/server env files, ask before ssh/atlas/aws/push), `.claude/agents/security-reviewer.md`, `.claude/agents/phase-verifier.md`, `.claude/commands/start-phase.md`, `.claude/commands/finish-phase.md`.
- `docs/00_PRODUCT_SPEC.md`, `01_ARCHITECTURE.md`, `02_DATA_MODEL.md`, `03_API_SPEC.md`, `04_SECURITY.md`, `05_LEGAL_COMPLIANCE_IMPLEMENTATION.md`, `06_DESIGN_SYSTEM.md`, `07_SCREEN_SPECS.md`, `08_MOTION.md`, `09_I18N.md`, `10_TESTING.md`, `PROGRESS.md`, `DECISIONS.md` (26 accepted decisions), `design-references/` (my 3 images), `phases/PHASE_00…09_*.md` + `_REPORT_TEMPLATE.md`.
- `owner/START_HERE.md`, `owner/PHASE_TESTING_GUIDE.md` (my manual phone checks per phase + bug report template), `owner/LEGAL_THINGS_I_NEED_TO_DO_MYSELF.md` (lawyer questions, grievance officer, masjid authorization letter template, content licensing + scholar verification, CERT-In POC, Google Play account notes, incident playbooks, MFA/backup duties), and this handoff file.

Workflow: in Claude Code run `/start-phase 00` → it builds task by task → `/finish-phase 00` (full verification + the two reviewer subagents + phase report + deploy to the staging VPS) → I run the phase checks in `PHASE_TESTING_GUIDE.md` on Android + iPhone → I tell it "Phase 00 verified" → next phase in a fresh session (progress persists in `docs/PROGRESS.md`).

## 6. Current status (as of 8 Oct 2026)
- Planning and all spec files are **complete (Revision 2)**. **No code has been written yet.** Phase 00 has not started.
- My immediate next steps: copy the pack into a GitHub repo; get a domain onto Cloudflare and a Mumbai staging VPS; start Phase 00 in Claude Code; in parallel start legal Stage A (lawyer, trademark/domain check, account MFA) and sourcing a licensed, scholar-verified content library.

## 7. How you should help me from here
- Keep all decisions above unless I explicitly change them; if you recommend a change, explain the trade-off and tell me to record it in `docs/DECISIONS.md`.
- Likely requests: editing/adding spec or phase files, answering Claude Code's questions or OPEN decisions, reviewing Claude Code's phase reports, debugging issues I report, VPS/Cloudflare/Atlas setup help, refining design to match the references, legal/compliance clarifications (always note you're not a lawyer), and Google Play / launch help.
- When writing anything for Claude Code, be precise: tasks, acceptance criteria, tests, files — consistent with `CLAUDE.md`.
- Never write Quran ayat, hadith, duas or their translations yourself; use clearly fake placeholders and point me to licensed, scholar-verified sources.
