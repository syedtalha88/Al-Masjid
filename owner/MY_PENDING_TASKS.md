# My pending tasks (owner)

> Things only I can do. Tick them as I go and tell Claude Code "O<n> done".
> The same list is kept in `docs/PROGRESS.md` → "Waiting for the owner".
> Last updated: 15 Oct 2026.

## Done

- [x] **O1 — Release-signing key + GitHub `staging` environment** (15 Oct 2026)

---

## Quick answers (no computer work, just tell Claude Code)

### O4 — Show the component showcase on staging?
The showcase is the demo page I use for phone checks 0.3–0.5. Right now it exists only on the dev PC.
- **A (recommended):** yes. It's switched on only for staging and never for production.
- **B:** no. I'd do checks 0.3–0.5 on the PC's dev server, with the phone on the same Wi-Fi.
- **C:** a separate showcase website. More setup for no real gain.

➡️ Answer: **A**, **B** or **C**

### O5 — Web-font choice (F27)
On the second visit, the page lays itself out twice when the font finishes loading. That's about 15–20 ms on a real phone.
- **Keep as is.** The cost is small.
- **`font-display: optional`.** No second layout, but the very first visit may show a similar-looking backup font.
- **Smaller font file.** Less to load, more work.

➡️ Answer: **keep**, **optional** or **smaller**

---

## Server work (best done in a session with Claude Code)

### O2 — WireGuard tunnel + close public SSH (about 15 min) — must be done before T0.14 can be ticked
Until this is done, SSH on the server is open to the internet. It's key-only and protected by fail2ban.
Claude Code gives the exact commands in the session. Rough outline:
1. On the server, set up WireGuard (`provision.sh wireguard`).
2. On my PC, install the **WireGuard** app (wireguard.com/install) and create a tunnel with Address `10.66.0.2`.
3. Give the server my PC's **public** key (`provision.sh wg-peer talha-pc <PC public key> 10.66.0.2`).
4. Test `ssh talha@10.66.0.1` through the tunnel.
5. Close public SSH (`provision.sh lockdown`).
6. Optional: add my phone as a second tunnel.

⚠️ Do this **after** the first staging deploy. That's when Claude Code installs the scripts these commands use.

### O3 — Log-archive key (about 5 min)
The server keeps logs for 180 days (required by Indian law, CERT-In), encrypted so that only I can read them.
1. On my PC (PowerShell), install the tool `age`: `winget install FiloSottile.age`, then reopen PowerShell.
2. Create the key: `age-keygen -o masjid-logs.key`
   - It prints `Public key: age1…`. Copy that line's `age1…` part.
   - **`masjid-logs.key` is my private key.** Keep it somewhere safe and offline, such as a USB drive or a password manager. Never send it to anyone.
3. On the server:
   ```
   echo 'age1…paste-here…' | sudo tee /etc/masjid-connect/log-archive.pub
   ```
4. Tell Claude Code "O3 done" so it can check that the archive works.

---

## GitHub settings

### O6 — Owner checks 0.15–0.17 (about 15 min)
Full instructions are in `owner/PHASE_TESTING_GUIDE.md` → Phase 00.
- [ ] **0.15 Branch protection.** GitHub → repo → Settings → Rules → Rulesets → New branch ruleset. Follow the guide (6 required checks). Do this **after** Claude Code has merged the T0.14 work.
- [ ] **0.16 A failing PR gets blocked.** Ask Claude Code for a throw-away branch with one failing test, open a PR, and check that the Merge button is blocked.
- [ ] **0.17 Production needs my approval.** Settings → Environments → `production` (create it if it's missing):
  - **Required reviewers** → add myself
  - **Deployment branches and tags** → Selected branches → `main`
- [ ] *(Optional)* **0.18 Sentry error reporting.** Free account, 2 projects. Steps are in the guide.

---

## After staging is live

### O7 — Phone checks 0.1–0.14 (about 30 min)
On the iPhone and the Poco F7, using the staging links Claude Code gives me. Steps are in `owner/PHASE_TESTING_GUIDE.md` → Phase 00.
This includes **F17**: on the iPhone, check that swiping back from the left edge works smoothly, both in Safari and in the installed app, and doesn't animate twice.

---

## Before Phase 01

### F10 — MongoDB for staging: decide
The free MongoDB Atlas tier probably can't do the custom roles and views we need.
- **Paid Atlas tier for staging**, or
- **Run MongoDB ourselves on the VPS** for staging (free, but more work for Claude Code)

➡️ Ask Claude Code for the comparison when we get there.

### O8 — Accounts for later phases
- **Phase 01:** MongoDB Atlas project `mc-staging` (region Mumbai, ap-south-1) + DB users, and a real Cloudflare **Turnstile** widget.
- **Phase 03:** Cloudinary API keys (one for api-admin, one for worker).
- **Phase 03/08:** Cloudflare purge API token.
- **Before Phase 04:** back up the VAPID private key from the server (`worker.env`). It must never change.
