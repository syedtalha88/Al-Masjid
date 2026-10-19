# My pending tasks (owner)

> Things only I can do. Tick them as I go and tell Claude Code "O<n> done".
> The same list is kept in `docs/PROGRESS.md` → "Waiting for the owner".
> Last updated: 16 Oct 2026.
>
> **Safety rules for every step:** never paste a private key or password into chat or send one to anyone.
> Public keys (they start with `ssh-ed25519`, `age1…` or a WireGuard *public* key) are fine to share.

## Done

- [x] **O1** — Release-signing key + GitHub `staging` environment (15 Oct 2026)
- [x] **O4** — Showcase on staging: **yes** (15 Oct 2026)
- [x] **O5** — Web font: **keep as is** (15 Oct 2026). I'll judge the opening smoothness on the Poco F7 during O7.
- [x] **Server scripts** installed from the tested commit `9f664d3` (`provision.sh host`, fingerprint checked) (16 Oct 2026)
- [x] **O2** — WireGuard tunnel (`masjid-server` on my PC) + public SSH closed. To reach the server: activate the tunnel, then `ssh talha@10.66.0.1` (16 Oct 2026)
- [x] **First staging deploy**, reboot test, Cloudflare analytics off (16 Oct 2026)
- [x] **Phase 00 accepted** by me (16 Oct 2026) — the remaining review items are finished alongside Phase 01 (DECISIONS #62)
- [x] **F10 / DECISIONS #60** — MongoDB for staging: **Atlas M0 Free** (Mumbai); production M10 is decided in Phase 9
- [x] **Staging only from `main`** — GitHub → Environments → staging → deployment branch `main` (16 Oct 2026)
- [x] **Cloudflare Web Analytics** auto-injection disabled (16 Oct 2026)
- [x] **Atlas** — project `mc-staging`, free cluster in Mumbai, network access = server IP only; `atlas-users.sh staging` created the 4 database users; temporary service account and the wizard's user deleted (16 Oct 2026)
- [x] **Server scripts** updated to `a33610e` (16 Oct 2026)
- [x] **O7 (most of it)** — phone checks passed on iPhone + Poco F7, incl. the update prompt (0.12) and rollback (0.14) (16 Oct 2026)
- [x] **O3** — Log-archive key: created on my PC (`Documents\masjid-logs.key`, backed up), public key on the server; hourly archive runs (16 Oct 2026)

---

## Still to do (in this order)

| # | What | Time | Notes |
|---|---|---|---|
| 1 | **GitHub → Settings → Environments → production** → untick **"Allow administrators to bypass configured protection rules"** → Save | 1 min | security review L8 |
| 2 | **Latency test** on the server (O9) — the command is in `docs/PROGRESS.md` → O9; paste the 9 lines to Claude Code | 1 min | |
| 3 | **Cloudflare → Caching → Configuration → Browser Cache TTL → "Respect Existing Headers"** (O10) | 1 min | |
| 4 | **GitHub → Settings → Secrets and variables → Actions → Variables**: `STAGING_APP_URL` = `https://app-staging.almasjids.com`, `STAGING_ADMIN_URL` = `https://admin-staging.almasjids.com` (O11) | 2 min | turns on the nightly staging scan |
| 5 | **Design notes** from the phone checks → send to Claude Code (list or screenshots); is the thin black strip at the top gone now? | — | |
| 6 | **iPhone swipe-back (F17)**: in Safari *and* the installed app, does swiping back from the left edge slide back once, smoothly? yes/no | 2 min | |
| 7 | **Turnstile widget** (Cloudflare → Turnstile → Add widget, hostname `app-staging.almasjids.com`, Managed) — send the **site key** only, keep the secret | 3 min | needed from Phase 2 |
| 8 | **Super Admin passkey** on staging with my phone — when Claude Code says login is ready: on the server `sudo /usr/local/lib/masjid-connect/deploy.sh staging --bootstrap-super-admin --name "<my name>"`, open the printed link on my phone (keep it private; steps in `docs/runbooks/DEPLOY.md` §7) | 5 min | Phase 01 T1.9 (O12) |
| 9 | **O6 last:** GitHub branch ruleset (0.15) + the failing-PR test (0.16) — after this, `main` changes only through pull requests | 15 min | at the very end of Phase 01 work |
| ~~10~~ | ~~Push~~ — **done 19 Oct 2026**: standing permission to commit + push | – | |
| 11 | **Install the passkey library** — you allowed it, but Claude Code's permission check blocked the command. In the repo folder run `pnpm --filter @mc/api add --save-exact @simplewebauthn/server@14.0.3` (or approve the prompt next time) and tell Claude Code (O13) | 1 min | Phase 01 T1.8 |
| ~~12~~ | ~~Answer DECISIONS #70~~ — **done 19 Oct 2026** (option A) | – | |
| 13 | **Cloudflare "Network Error Logging" switch** — turn off if it exists (O15) | 2 min | |
| 14 | **Host-layer reinstall** (O17) — wait until Claude Code says CI on `main` is green (the 19 Oct pushes failed in CI; fix pushed 20 Oct), then it gives the sha + checksum; afterwards the one-time network step (DEPLOY.md §8) and send the `check.sh` output | 5 min | next session |
| 15 | **VPS backups** — check / enable the provider's backup feature; ask first if it costs money (O18) | 5 min | |
| 16 | **Screen-reader check** (O19): TalkBack on the Poco F7, VoiceOver on the iPhone — steps in `docs/PROGRESS.md` → O19 | 5 min | |
| — | **Low-end Android phone** (≈ ₹8,000) for the performance check (O16) | when available | Phase 2 |

---

## O2 — WireGuard tunnel + close public SSH (about 20 min)

**Why:** today anyone on the internet can *try* to SSH into the server. It's key-only and fail2ban blocks
repeated failures, but after this step the server only accepts SSH through a private tunnel from my PC.
**Needed before:** T0.14 can be ticked.
**Do it:** after the first staging deploy, with Claude Code in the session (it installs the scripts used below).

**A. On the server, start WireGuard**
1. Log in as usual: `ssh talha@<server IP>`
2. Run:
   ```
   sudo bash /usr/local/lib/masjid-connect/provision.sh wireguard
   ```
3. It prints `Server public key (put it in each device's WireGuard config): …`. **Copy that key** (it's public).

**B. On my Windows PC, create the tunnel**
1. Install the **WireGuard** app from **wireguard.com/install** (Windows installer).
2. Open it → arrow next to **Add Tunnel** → **Add empty tunnel…**
3. The app fills in a `PrivateKey` line itself and shows a **Public key** at the top. **Copy that public key**.
   (Never copy or share the `PrivateKey` line.)
4. Name: `masjid-server`. Below the `PrivateKey` line, the text box should end up looking like this:
   ```
   [Interface]
   PrivateKey = (already filled in by the app — leave it)
   Address = 10.66.0.2/32

   [Peer]
   PublicKey = <server public key from A.3>
   AllowedIPs = 10.66.0.1/32
   Endpoint = <server IP>:51820
   PersistentKeepalive = 25
   ```
5. Click **Save**. Don't activate it yet.

**C. On the server, allow my PC into the tunnel**
1. In the server terminal (replace with the public key from B.3):
   ```
   sudo bash /usr/local/lib/masjid-connect/provision.sh wg-peer talha-pc <PC public key> 10.66.0.2
   ```
   It prints `peer talha-pc (10.66.0.2) added`.

**D. Test the tunnel (keep the old terminal open!)**
1. In the WireGuard app, click **Activate**. It should show *Active*, with "Latest handshake" a few seconds ago.
   - No handshake? In the Hostinger panel check whether a VPS firewall is on. If it is, allow **UDP 51820**.
2. Open a **second** PowerShell window and run: `ssh talha@10.66.0.1`
3. On the server in that second window, run: `echo $SSH_CONNECTION`. It must **start with `10.66.0.2`**.
   If it doesn't, stop and tell Claude Code.

**E. Close public SSH**
1. Only in the **second** window (the tunnel one), run:
   ```
   sudo SSH_CONNECTION="$SSH_CONNECTION" bash /usr/local/lib/masjid-connect/provision.sh lockdown
   ```
   It prints the firewall rules. Port 22 should be allowed only on `wg0`.
2. Test in a **third** window: `ssh talha@<server IP>`. This must now **fail / time out**. That's correct.
3. `ssh talha@10.66.0.1` (with the tunnel active) must still work.
4. Now it's safe to close the old windows.

**From now on:** to reach the server, first **activate the tunnel** in the WireGuard app, then `ssh talha@10.66.0.1`.
**If I'm ever locked out:** the Hostinger panel has a **browser terminal / VNC console** that always works.

*(Optional)* My phone as a second way in: same steps B–C with the WireGuard phone app, Address `10.66.0.3/32`,
and name `talha-phone` in C.1.

Tell Claude Code "**O2 done**". It runs `check.sh`, and the 2 SSH/WireGuard FAILs should turn into PASS.

---

## O3 — Log-archive key (about 5 min)

**Why:** Indian law (CERT-In) needs the server's logs kept for 180 days. They are stored **encrypted** so that
only I can read them, using a key that never leaves my PC.

1. On my PC, open **PowerShell** and install the tool:
   ```
   winget install FiloSottile.age
   ```
   Then **close and reopen** PowerShell.
2. Go to a safe folder (for example `cd $HOME\Documents`) and create the key:
   ```
   age-keygen -o masjid-logs.key
   ```
   It prints `Public key: age1…`. **Copy the `age1…` text** (it's public).
3. **`masjid-logs.key` is my private key.** Copy it to a USB drive or a password manager as well.
   If it's lost, the archived logs can never be read. Never send it to anyone.
4. On the server (through the tunnel), with my own `age1…` key pasted in:
   ```
   echo 'age1...' | sudo tee /etc/masjid-connect/log-archive.pub
   ```
5. Tell Claude Code "**O3 done**". It checks that the hourly archive now runs.

---

## O6 — GitHub checks 0.15–0.17 (about 15 min)

Do these **after** Claude Code has merged the T0.14 work into `main`.

**0.15 — Branch protection**
1. Go to github.com/syedtalha88/Al-Masjid → **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset**.
2. **Ruleset name:** `main` · **Enforcement status:** **Active**.
3. **Target branches** → **Add target** → **Include default branch**.
4. Tick:
   - **Restrict deletions**
   - **Block force pushes**
   - **Require a pull request before merging** → required approvals **0** (fine while I work alone)
   - **Require status checks to pass** → **Add checks** → add these 6, typing each name:
     - `Typecheck · lint · format · i18n`
     - `Unit + component tests (coverage gates)`
     - `Security scans`
     - `Integration tests (MongoDB + Redis)`
     - `Build · budgets · images · e2e · Lighthouse`
     - `CodeQL (javascript-typescript)`
5. **Create**. ✅ The ruleset shows **Active**.

**0.16 — A failing change is blocked**
1. Tell Claude Code: "make the 0.16 test PR". It pushes a branch with one deliberately failing test.
2. On GitHub → **Pull requests** → open the PR it names.
3. ✅ CI shows a red ✗ and the **Merge** button is blocked.
4. Click **Close pull request**, then **Delete branch**.

**0.17 — Production needs my approval**
1. **Settings** → **Environments** → `production` (if it's missing: **New environment** → `production` → **Configure environment**).
2. Tick **Required reviewers** → add **syedtalha88** → **Save protection rules**.
3. **Deployment branches and tags** → **Selected branches and tags** → **Add deployment branch or tag rule** → `main` → **Add rule**.
4. ✅ Any production release will wait for my click.

**0.18 — Error reporting (optional, free)**
1. Create a free account at **sentry.io** and turn on 2-factor login.
2. Create 2 projects: `mc-web` (Browser JavaScript) and `mc-server` (Node.js).
3. In **each** project → **Settings** → **Security & Privacy**: turn ON *Prevent Storing of IP Addresses*,
   *Data Scrubber* and *Use Default Scrubbers*.
4. Give Claude Code the **org slug** and the **two DSNs** (not secret).
5. **Settings** → **Auth Tokens** → create a token with scope *project:releases* → paste it **only** into
   GitHub → Settings → Secrets and variables → Actions → **New repository secret** `SENTRY_AUTH_TOKEN`.

Tell Claude Code "**O6 done**" (and whether I did 0.18).

---

## O7 — Phone checks 0.1–0.14 (30–45 min)

**Needs:** the staging links from Claude Code (app, admin, and `/_dev/showcase` on both).
**Phones:** iPhone + Poco F7. **Mark each ✅ / ❌.** For every ❌, take a screen recording.

| # | Check | How | ✅ when |
|---|---|---|---|
| 0.1 | App opens | Open the staging app link on both phones | Opens fast, warm off-white background, no errors |
| 0.2 | Security grade | On the laptop, paste the app URL and then the admin URL into **securityheaders.com** | **A+** for both |
| 0.3 | Looks premium | Open `/_dev/showcase`, scroll everything | Same green, mint panels, rounded cards, clean fonts as the reference images |
| 0.4 | Languages | In the showcase switch English → हिन्दी → اردو → తెలుగు | All text changes; **Urdu flips the layout right-to-left**; no "□" boxes |
| 0.5 | Navigation | Open the demo screens; go forward and back; swipe from the left edge (from the right in Urdu) | iPhone-like slide; follows the finger; stopping halfway returns smoothly |
| 0.6 | Android back | Poco F7: system back button on a demo screen | Goes back one screen with animation; doesn't exit |
| 0.7 | Bottom sheets | Open the demo sheet; drag up/down; flick down | Moves with the finger, snaps, flick closes it |
| 0.8 | Tab bar | Tap each tab and the green centre Scan button | Active tab turns green; centre button presses and bounces back |
| 0.9 | Reduced motion | Poco: Settings → Accessibility → *Remove animations* ON. iPhone: Accessibility → Motion → *Reduce Motion*. Reopen the app | Screens **fade** instead of slide. Turn it **OFF** again afterwards |
| 0.10 | Install | Poco: Chrome menu ⋮ → *Install app*. iPhone: **Safari** → Share → *Add to Home Screen* | Icon on the home screen; opens full screen without the browser bar |
| 0.11 | Offline | Open the installed app → Airplane mode ON → close it fully → reopen | App opens with an offline message, not the browser's "no internet" page |
| 0.12 | Update | Tell Claude Code "ready for 0.12"; it deploys a tiny change; reopen the app | "Update available" appears; tapping it refreshes |
| 0.13 | Server locked | Read the `check.sh` result Claude Code gives me. Then on the laptop open `https://<server IP>` | All **PASS**; the IP address does **not** open the app |
| 0.14 | Rollback | Tell Claude Code "show me a rollback" | The previous version is back within minutes, then the latest is redeployed |

**Extra for the iPhone (F17):**
- In **Safari** and in the **installed app**, swipe back from the left edge on a demo screen.
  It must slide back **once**, smoothly, with no double animation.
- In the showcase, check that **bold text looks bold**, and that dragging a sheet and then scrolling inside it feels natural.

**Opening smoothness (O5):** open the installed app a few times on the Poco F7. If the text visibly jumps or
flickers as it opens, tell Claude Code.

Tell Claude Code "**O7 done**", with the ❌ list if there is one.

---

## F10 — MongoDB for staging (decide before Phase 01)

The free MongoDB Atlas tier probably can't do the custom roles and views the security design needs.
1. Ask Claude Code: "**give me the F10 comparison**". It checks current Atlas tiers and prices.
2. Choose one:
   - **Paid Atlas tier for staging** (monthly cost, matches production exactly), or
   - **MongoDB on our own VPS for staging** (free, more setup and maintenance work for Claude Code).

---

## O8 — Accounts for later phases (when Claude Code asks)

| When | What | Steps |
|---|---|---|
| Phase 01 | **MongoDB Atlas** project `mc-staging` (only if F10 = Atlas) | Claude Code gives click-by-click steps: region **Mumbai (ap-south-1)**, DB users, IP access |
| Phase 01 | **Cloudflare Turnstile** widget (the "I'm not a robot" check) | Cloudflare dashboard → Turnstile → Add widget → domains `admin-staging.almasjids.com`. Site key → Claude Code; secret key → server env file only |
| Phase 03 | **Cloudinary API keys** (2 keys: api-admin + worker) | Cloudinary → Settings → API Keys → Generate. They go only into the server env files |
| Phase 03/08 | **Cloudflare purge token** | Cloudflare → My Profile → API Tokens → Create → *Cache Purge* for almasjids.com only |
| Before Phase 04 | **Back up the VAPID private key** | Claude Code gives the command. Store it with the log key. It must never change once push goes live |
