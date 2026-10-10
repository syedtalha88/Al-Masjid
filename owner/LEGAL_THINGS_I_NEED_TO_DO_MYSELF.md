# Legal Things I Need to Do Myself

> **For the project owner, not for Claude Code.** The software is being built to make compliance possible (see `docs/05_LEGAL_COMPLIANCE_IMPLEMENTATION.md`), but some things only a human can do: sign, register, appoint, review, respond.
>
> ⚠️ **This is not legal advice.** It is a practical checklist based on Indian laws as of October 2026 (DPDP Act 2023 + DPDP Rules 2025, IT Act 2000 + IT Rules 2021 as amended in February 2026, CERT-In Directions 2022, Bharatiya Nyaya Sanhita). Laws and timelines change. **Have a technology/privacy lawyer in India review this list and the app's legal texts before the pilot.**

---

## 0. The honest truth about "not registering"

You plan to run this as a free giveaway without registering a company. That is allowed, **but it does not exempt you from the law**:

- Under the DPDP Act, whoever decides why and how personal data is processed is the **Data Fiduciary**. If there is no company, that is **you personally**.
- Under the IT Act, a service that hosts other people's content (masjid posts, videos) is an **intermediary**. Again — **you personally**.
- If something goes wrong (breach, harmful post, fraud), notices, penalties and court cases would be addressed to **you**.

**What reduces your risk the most:**
1. The app's design already collects almost no personal data (no musalli accounts). Keep it that way.
2. Follow the moderation and takedown timelines strictly (the app gives you timers).
3. **Strongly consider a simple legal entity** — a registered **Trust** (state law) or a **Section 8 company** (non-profit under the Companies Act). It separates you from personal liability to a large extent, makes Google Play "organization" accounts possible, and looks trustworthy to masjid committees. Ask a CA/lawyer for exact cost and time in your state.

- [ ] Decide: proceed personally **or** set up a Trust / Section 8 company. Write down the decision and the date.

---

## Stage A — Now (while Phases 0–2 are being built)

### A1. Find a lawyer
- [ ] Find an Indian lawyer experienced in **IT law / data protection**. One consultation now, one review before the pilot.
- [ ] Questions to ask them:
  1. Should I operate personally, as a Trust, or a Section 8 company for this free app?
  2. Am I a "Significant Data Fiduciary" risk at 10 lakh devices? (Expected: no, but confirm.)
  3. Is a pseudonymous device ID + followed masjids "personal data"? What does that mean for my privacy notice?
  4. Do I need verifiable parental consent given that I don't collect age or identity at all?
  5. Grievance timelines: confirm 24h acknowledgement and resolution periods after the Feb 2026 IT Rules amendment; confirm the 2-hour and 3-hour takedown categories apply to me.
  6. Log retention: is 180 days of access logs (with IP addresses) required for me under CERT-In directions, and can the log storage be outside India?
  7. Retention periods I chose (see the retention table in `docs/02_DATA_MODEL.md §6`) — are grievance and legal-order retention (3 years) reasonable?
  8. Dua requests mention ill or deceased people — what consent wording should admins follow?
  9. Donations: any risk for me in displaying a masjid's UPI ID and "reported" amounts?
  10. Content risks: what should my content policy and admin undertaking say about hate speech and religious sensitivity (BNS provisions)?

### A2. Name, brand and domain
- [ ] Choose the final app name. Do a **trademark search** on the IP India public search website for the name and similar names in Class 9 (software) and Class 42/45. Avoid names already used by other Islamic apps.
- [ ] Buy the domain (and common misspellings if cheap). Turn on **WHOIS privacy** and **registrar MFA**.
- [ ] Give Claude Code the final name and domain (it only needs to change `packages/shared/src/brand.ts` and env vars).

### A3. Secure your own accounts (not legal, but the #1 real-world risk)
- [ ] Use a password manager.
- [ ] Turn on **MFA (authenticator app or security key, not SMS)** for: email, GitHub, your VPS provider, MongoDB Atlas, Cloudinary, YouTube/Google account of each masjid (advise admins), Cloudflare, Sentry, domain registrar, Google Play.
- [ ] Keep your **server SSH key** on your own laptop only (with a passphrase) plus one offline backup. Never send it to anyone, including Claude Code. Store every server env file, the VAPID private key and all recovery codes in a password manager.
- [ ] Store recovery codes offline (printed, in a safe place).
- [ ] Never share these logins. If you add helpers later, give them their own accounts with limited access.

---

## Stage B — Before the pilot (must be done before Phase 9 launch)

### B1. Appoint and publish a Grievance Officer
IT Rules require intermediaries to publish a Grievance Officer's details and respond to complaints within fixed times.
- [ ] Decide who it is (probably you). Add a **backup person** for when you're unavailable.
- [ ] Create a dedicated email (e.g., `grievance@<domain>`) that you check **every day**.
- [ ] Enter name, email and city/postal address in Super Admin → Settings (shown in the app and on the website).
- [ ] Turn on push alerts for the Super Admin app on **two** phones (yours and backup).
- [ ] Understand the clocks (the app shows timers, but you must act):
  - Court order / government notice to remove content: **3 hours**.
  - Complaints about intimate images, impersonation or morphed content: **2 hours**.
  - Other content complaints: **36 hours**.
  - Any grievance: **acknowledge within 24 hours**.

### B2. Legal texts
Claude Code writes drafts (Phase 8). You must:
- [ ] Get the lawyer to review and finalize: **Privacy Policy**, **Terms of Use**, **Content Policy**, **Masjid Admin Undertaking**, **Grievance page**.
- [ ] Get **human translations** into Hindi, Urdu and Telugu (not machine translation). Have a second person check each.
- [ ] Remove the DRAFT banners only after review (the production build refuses drafts on purpose).
- [ ] Record the version and date of each published text.

### B3. Masjid onboarding paperwork (for every masjid, before activating it)
This protects you if two groups both claim to run a masjid, or if a donation dispute happens.
- [ ] **Authorization letter** from the masjid committee / mutawalli on letterhead with seal and signature, naming the admin(s) allowed to use the app (template in Appendix 1).
- [ ] Admin's ID proof copy (keep securely; delete when they stop being admin).
- [ ] **Proof of UPI ownership**: screenshot from the UPI/bank app showing the payee name for the masjid's UPI ID, or a cancelled cheque / bank letter in the masjid's name. Prefer a **business/merchant UPI ID** linked to a masjid/trust bank account.
- [ ] Before approving any UPI change in the app: **phone the committee** (not the number in the request) to confirm.
- [ ] Store paperwork in an encrypted folder (e.g., an encrypted cloud drive with MFA). These are personal data too: keep only what's needed, delete when no longer needed.

### B4. Religious content library (very important)
The app will not let anyone type hadith or ayat freely; it only uses the verified library. You must supply that library.
- [ ] Choose sources for Arabic Quran text, Quran translations (English, Hindi, Urdu, Telugu), hadith collections and translations, and duas.
- [ ] **Check the license of every source.** Many translations and hadith websites are copyrighted and do not allow copying. Use sources that explicitly permit reuse, or get written permission from the publisher. Record the license for each entry (the import requires it).
- [ ] Get **scholar (alim/mufti) review** of every entry: correct text, correct reference, authenticity grading where relevant, correct translation. Record the reviewer's name (the app stores "verified by").
- [ ] Prepare the JSON file in the format Claude Code documents in `docs/content-library-format.md`, then import and verify inside Super Admin.

### B5. Notice templates and app text
- [ ] Have translators review all template texts and app strings (Claude Code exports `packages/i18n/review/<locale>.csv`).
- [ ] Mark each template "translation reviewed" in Super Admin only after review.

### B6. Vendors (processors)
For each service: read and accept their Data Processing Addendum (DPA) / terms, note the data region, enable MFA, and list them in the privacy policy.
- [ ] VPS provider (hosting, Mumbai) · [ ] MongoDB Atlas (database, AWS Mumbai) · [ ] Cloudinary (images; legal documents stored encrypted) · [ ] YouTube (bayans are hosted on each masjid's own channel; loaded only when a user taps Play) · [ ] Cloudflare (DNS, CDN, firewall, Turnstile) · [ ] Sentry (error reports) · [ ] Google (Play; push delivery via FCM) · [ ] Apple (push delivery via APNs) · [ ] Map tile provider (Phase 7 decision).
- [ ] Ask the lawyer whether any of these regions are a problem (DPDP allows cross-border transfer except to countries the government restricts).

### B7. CERT-In readiness
CERT-In's 2022 Directions require service providers to report certain cyber incidents **within 6 hours** of noticing them and to keep logs for 180 days.
- [ ] Designate a **Point of Contact** for CERT-In (you) and check with the lawyer whether/how to inform CERT-In of it.
- [ ] Save CERT-In's official incident-reporting contact details (from cert-in.org.in) into your phone and the incident runbook.
- [ ] Confirm the log sink chosen in Phase 9 keeps logs ≥ 180 days.

### B8. Google Play
- [ ] Decide account type:
  - **Personal** account: your name is shown as the developer; new personal accounts must run a **closed test with a minimum number of testers for a minimum period** before production (recently 12 testers for 14 days — check current Google policy). Line up testers from the pilot masjids.
  - **Organization** account: needs a registered entity and a D-U-N-S number (only possible with Stage 0 option 3).
- [ ] Pay the one-time developer fee; verify identity; turn on MFA.
- [ ] Use **Play App Signing**; keep the upload key backed up safely (Claude Code will explain in Phase 9).
- [ ] Fill the **Data safety** form using Claude Code's draft (it must match reality exactly).
- [ ] Add the privacy policy URL and a public contact email.

### B9. Donations — make responsibilities clear
- [ ] The undertaking (B2) must state the masjid is solely responsible for funds, their use, accounting, and its own compliance (for example, foreign contribution rules under FCRA if they receive foreign money, and Waqf Board rules where applicable).
- [ ] Never accept money for the app itself through a masjid campaign. If you ever want donations to cover running costs, do it only through a registered entity with proper accounts.
- [ ] Don't promise tax benefits (80G) anywhere.

### B10. Children
- [ ] Keep the app free of accounts, ads and tracking (the DPDP rules on children's data mostly concern tracking, targeted ads and data collection — we don't do these). Re-check with the lawyer before adding any feature that identifies users.

---

## Stage C — Ongoing duties after launch

| How often | What |
|---|---|
| **Daily** | Check Super Admin dashboard (SLA alerts, reports, grievances, pending UPI changes). Check the grievance email. |
| **Weekly** | Review new masjids and admin changes; look at removal counts per masjid; read Sentry error summary. |
| **Monthly** | Review the audit log for unusual admin activity; check storage/video costs; confirm backups exist. |
| **Every 3 months** | Remove admins who no longer serve; review vendor security notices; run a restore drill (Claude Code wrote the runbook). |
| **Yearly** | Re-review legal texts with the lawyer; the app automatically re-asks admins to accept the undertaking and reminds users of the terms; renew the domain; review this checklist. |
| **Early 2027** | DPDP's main obligations (consent notices, breach reporting, children's data, etc.) apply from **14 May 2027**. Book a lawyer review in early 2027 to confirm the app and policies meet them. |

Keep a simple **compliance register** (a spreadsheet): date, what happened, what you did, evidence link. It's your best defence if anyone asks later.

---

## Stage D — If something goes wrong (keep this page handy)

### D1. Suspected data breach or hack
1. **Contain**: use kill switches (Super Admin → Settings: pause push, admin read-only mode), revoke suspicious admin sessions/passkeys, rotate exposed keys (runbook).
2. **Within 6 hours of noticing**: report to CERT-In through its official channel (if the incident type is covered — when in doubt, report).
3. Call your lawyer the same day.
4. **DPDP**: inform affected people (admins can be contacted; musallis are anonymous — use the in-app banner) and the Data Protection Board as the rules require (the rules mention a detailed report within 72 hours — confirm current requirements with the lawyer).
5. Preserve evidence: don't delete logs; export the audit log.
6. Write everything in the compliance register.

### D2. Court order or government notice to remove content
1. Check it's genuine (call the issuing office on a number from its official website).
2. Enter it in Super Admin → Legal Orders (the 3-hour timer starts from when you received it).
3. Remove the content (★ Remove). The app hides it everywhere and keeps a private copy for 180 days, as required.
4. Reply to the authority confirming action. Inform your lawyer.

### D3. Police or agency asks for user information
- We hold almost nothing about musallis (no names, phones, emails, IPs in the app database). For admins we hold display name, optional phone, login records.
- Verify the request is genuine and lawful (lawyer). Provide only what is legally required. Log it in the compliance register.

### D4. Someone reports a fake or fraudulent donation / wrong UPI
1. Immediately suspend the campaign (remove) and, if serious, suspend the masjid.
2. Phone the masjid committee using the number from your paperwork.
3. Check the UPI change history in Super Admin.
4. Advise the reporter to contact their bank / cybercrime helpline **1930** and the National Cyber Crime Reporting Portal for any money lost.

### D5. Hateful, communal or misleading content
- Remove first within the timer, investigate second. Notify the masjid admin. Repeat offences → revoke the admin or suspend the masjid. Preserve evidence. If there is a threat of violence, contact the police.

### D6. Two groups claim the same masjid
- Freeze changes (suspend the masjid or set the app to read-only for it), ask both for documents, rely on Waqf Board / registered trust records, and decide in writing. Don't take sides based on who shouts louder.

---

## Appendix 1 — Authorization letter (template; have your lawyer adjust)

> **On masjid / committee letterhead**
>
> To: [Your name / entity], operator of the "[App name]" app
>
> Subject: Authorization to manage [Masjid name], [full address] on the [App name] app
>
> We, the managing committee / mutawalli of [Masjid name], authorize the following person(s) to manage our masjid's page on the [App name] app, including prayer timings, announcements, dua requests, donation campaigns, weekly chanda information and bayan videos:
>
> 1. Name: ________ · Role in masjid: ________ · Phone: ________
> 2. Name: ________ · Role in masjid: ________ · Phone: ________
>
> Our masjid's UPI ID for donations is: ____________@______ registered in the name of: ____________________ (proof attached).
>
> We confirm that: (a) all content we publish will be lawful, accurate and respectful; (b) we own or have permission for all photos and videos we upload; (c) we will share names in dua requests only with the family's consent; (d) all donations go directly to the above account and the masjid alone is responsible for receiving, using and accounting for them and for complying with all applicable laws; (e) we will inform you in writing if an authorized person changes; (f) we accept the app's Terms, Content Policy and Admin Undertaking.
>
> Signature: ________ Name: ________ Designation: ________ Date: ________ Seal:

## Appendix 2 — What the app stores (give this to your lawyer)

| Who | Stored on our server | Not stored |
|---|---|---|
| Musalli (public user) | Random device ID, hashed device secret, language, brother/sister choice, followed masjids + mute flags, push notification token (if enabled), "Ameen" taps (per item), reports they file (no identity), privacy version accepted, dates created/last seen | Name, phone, email, location, IP address (except in server access logs kept 180 days), contacts, photos |
| Masjid admin | Display name, optional phone (encrypted), language, masjids & role, passkey public keys (not fingerprints/biometrics — those never leave the phone), login sessions (browser + OS only), undertaking acceptance, everything they publish, audit log of their actions | Passwords (none exist), biometrics |
| Grievance sender | Category, description, optional contact (encrypted) | Anything else |
| Masjid | Name, address, coordinates, photos, timings, UPI ID + payee name, content | — |
