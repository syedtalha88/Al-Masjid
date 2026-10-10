# 05 — Legal Compliance: What the Software Must Do

> This doc lists the **product features** required so the owner can comply with Indian law. It is not legal advice. The owner's own (non-code) tasks are in `owner/LEGAL_THINGS_I_NEED_TO_DO_MYSELF.md`.
> Laws in scope: **Digital Personal Data Protection Act, 2023 + DPDP Rules, 2025** (phased; substantive obligations from 14 May 2027 — we build for them now); **IT Act, 2000 §79 + IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 as amended in Feb 2026** (3-hour takedown on court/government orders, faster grievance timelines); **CERT-In Directions (April 2022)** (6-hour incident reporting, 180-day logs, NTP-synced clocks); **Bharatiya Nyaya Sanhita** provisions on promoting enmity / outraging religious feelings (drives moderation features); copyright & trademarks.
> Any timeline in this doc is a **config value** (`packages/shared/src/compliance.ts`) so the owner can change it after legal review without code changes.

## 1. Data minimization (DPDP)
- Musallis: device record only (02 §2). No name/phone/email/location/IP stored in app collections. **Build-time test** enumerates all fields of the `devices`, `device_follows`, `ameens`, `reports` Zod schemas **and** the live validators, and fails if a new field is added without updating an allow-list reviewed in DECISIONS.
- Location for Qibla/prayer: computed on device; never sent. Lint/test asserts no API contract has lat/lng fields from the device.
- Admins: display name, optional phone (encrypted), ui locale, passkey public keys, session metadata (browser+OS summary only).
- Grievances: contact optional, encrypted.
- Dua requests: name optional, private by default (third-party health/death information). UI hint about family consent.

## 2. Notice & consent
- **Musalli privacy-at-a-glance** screen in onboarding (4 languages): what's stored on the phone, what's stored on our server (anonymous device id, language, brother/sister choice, followed masjids, notification token), why, how to delete (Settings → Clear all data), link to full privacy policy and grievance officer. Button "Continue". Store `privacy_version` accepted locally and on the device record (field `privacy_version`).
- **Notifications** are consent-based (system permission after soft-ask) and revocable.
- **Admin onboarding**: privacy notice for admin data + **Content Undertaking** (versioned). Must accept before any write. Text covers: content must be lawful, accurate, non-hateful, own/licensed media, consent for names in dua requests, donation responsibility lies with the masjid, cooperation with takedowns. Acceptance stored (`undertaking_version`, timestamp) + audit entry.
- Version bumps of privacy/terms/undertaking (in `app_settings`) prompt re-acceptance on next open.
- **Annual reminder** (IT Rules due diligence): once a year, show musallis a short in-app notice of the rules/terms (dismissible); admins re-accept undertaking yearly.

## 3. Moderation, takedown & grievance (IT Rules)
Configurable SLA constants (defaults reflect the Feb 2026 amendments; owner confirms with lawyer):

| Trigger | Ack | Action deadline | Feature |
|---|---|---|---|
| Court order / reasoned government notice (Rule 3(1)(d)) | – | **3 hours** from receipt | Legal Orders register with countdown, one-tap remove/disable, evidence upload |
| Complaint alleging non-consensual intimate imagery / impersonation / morphed content | – | **2 hours** | Report reason routes to "urgent" queue; Super Admin push alert immediately |
| Other content complaints (reports) | – | **36 hours** | Moderation queue with countdown |
| User grievance (contact form) | **24 hours** | resolve per configured SLA (default 72h; owner to confirm) | Grievance tracker with timers; acknowledgement shown with public reference number |

Features:
- Report button on every item, video, dua request, campaign, masjid page (00 §4.7).
- Moderation queue (Super Admin): sorted by SLA due time; shows item preview exactly as users see it, masjid, admin who posted, report count/reasons, history. Actions: remove (reason required), restore, dismiss report, suspend masjid, revoke admin.
- **Removal is immediate everywhere**: status → removed, version bump, CDN purge of detail URL, push no longer references it (SW shows "This content is no longer available" if opened from an old notification).
- **Preservation**: removed content and associated records are retained (not visible) for **180 days** for investigation (Rule 3(1)(g)), then purged by retention job.
- Admin is told when their content is removed (admin app inbox + push) with the reason category.
- Repeat-violation tracking per masjid (count of removals in 90 days shown on masjid page in super admin).
- **Grievance Officer** details (name, email, postal address/city, response timelines) shown in Settings → Contact and on `<domain>/grievance`, loaded from `app_settings` so they can change without deploys.
- Public **Content Policy** page (prohibited content list in plain language, 4 languages).
- Legal Orders register: authority, reference, received time (entered by Super Admin), due time auto = +3h, linked targets, action log, document upload (private bucket, signed URLs only, Super Admin only).
- SLA alerting: push to Super Admin devices at 50%, 80%, 100% of any SLA; dashboard turns red.

## 4. Data principal rights
- Musalli: "Clear all data" deletes server device record (cascades) + local data; works offline-queued. Since musallis are anonymous, access requests are satisfied by "what we store" screen showing their device data (followed masjids, language, preference, push enabled y/n).
- Admin: "My data" screen (profile, masjids, sessions, passkeys, acceptance history) + "Request account deletion" → creates a Super Admin task (deletion must transfer masjid ownership first).
- Grievance form also used for privacy requests (category `privacy`).

## 5. Security safeguards & breach readiness (DPDP Rule on reasonable security + CERT-In)
- Everything in `04_SECURITY.md`.
- Logs (API access logs, auth events) retained **≥ 180 days** — encrypted daily archive on the Mumbai VPS kept 200 days and included in VPS backups (DECISIONS #40, replaces the S3 archive of #24); owner confirms acceptability with lawyer.
- Server clocks: the VPS runs NTP (chrony/systemd-timesyncd, checked by `infra/vps/check.sh`); MongoDB Atlas, Cloudflare and Cloudinary are NTP-synced by the providers — record this in the runbook.
- Incident tooling: kill switches (04 §13), audit export, ability to identify affected admins.
- Breach notification support: Super Admin can broadcast an in-app banner to all musallis and push to all admins.

## 6. Retention
Exactly as `02_DATA_MODEL.md §6`; constants in `compliance.ts`; retention job writes a summary row to audit log each run.

## 7. Children
- No age collection; no accounts; no behavioural tracking or targeted advertising (DPDP children's-data restrictions). Keep it that way — any future feature collecting identity must go through a DECISIONS entry and legal review.

## 8. Donations
- Copy everywhere: "Payments go directly to the masjid's verified UPI account. Masjid Connect does not receive, hold or manage any money." and "Amount received is reported by the masjid."
- No claims of tax deductibility (80G), no "guaranteed" language.
- Campaign creation requires undertaking acceptance and an active (approved) payment profile.

## 9. Intellectual property
- Content Library entries store `source_name` and `source_license`; import rejects rows without them. Attribution rendered under each hadith/ayah (small reference line).
- Videos: upload screen requires a checkbox "This bayan is ours or we have permission to share it" (stored with the item).
- Images: same checkbox for campaign/announcement images.
- No third-party trademarks (DECISIONS #18). Fonts are OFL (Inter, Noto, Amiri) — include licenses in `/licenses` page generated at build (also lists npm licenses of shipped code).

## 10. Legal pages (drafts by Claude Code, final text by owner + lawyer)
- `privacy`, `terms`, `content-policy`, `grievance`, `licenses` — markdown in `packages/i18n/legal/<locale>/`. Every draft starts with a visible banner `DRAFT — REQUIRES LEGAL REVIEW` that the build refuses to ship to production while present (CI check on production builds).
- Hindi/Urdu/Telugu versions must be human-translated; machine drafts are marked `DRAFT TRANSLATION`.
