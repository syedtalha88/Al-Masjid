# Cloudflare settings — almasjids.com

> The settings Cloudflare must have, per 01 §2/§5.2, 04 §7/§9/§12 and DECISIONS #21, #42, #54. Applied by the owner
> in the dashboard during T0.14 (Free plan); an automated header/cache check against staging runs in CI later.
> Plan limits (number of cache / WAF / rate-limit rules) change over time — if a rule does not fit, note it here.
> Prepared 14 Oct 2026; sections 1–5 applied by the owner on 14 Oct 2026 (ticked); 6–7 follow in Phase 1 / at the
> first deploy.

## 1. DNS (staging now, production in Phase 9)

| Type | Name                      | Content  | Proxy                      |
| ---- | ------------------------- | -------- | -------------------------- |
| A    | `app-staging`             | VPS IPv4 | **Proxied** (orange cloud) |
| A    | `admin-staging`           | VPS IPv4 | Proxied                    |
| A    | `media-staging`           | VPS IPv4 | Proxied                    |
| A    | `app` / `admin` / `media` | VPS IPv4 | Proxied — Phase 9          |

No record may be "DNS only" (grey cloud): the origin accepts only Cloudflare (firewall + client certificate).
`media-staging` has no Caddy site until Phase 3 (Cloudinary-backed media origin): until then its requests fail the
TLS handshake at the origin (Cloudflare shows a 5xx) — expected, nothing links to it yet (verifier V-16).

## 2. SSL/TLS

- [x] **Overview → Full (strict)**.
- [x] **Origin Server → Create certificate** (RSA 2048 or ECC, hostnames `*.almasjids.com` + `almasjids.com`, 15 years).
      Save the certificate and key **only on the server**: `/etc/masjid-connect/staging/certs/origin.pem` and
      `origin-key.pem` (root:1000, 640 — Caddy runs as uid 1000 in the web container and reads them read-only).
- [x] **Authenticated Origin Pulls — zone-level, with our own CA** (DECISIONS #57; _not_ the global AOP certificate,
      which Cloudflare shares across all accounts). On the server, as root, in `/etc/masjid-connect/aop/` (700):
      a 10-year CA (`ca.key` stays here, root 600, for renewals) and a 2-year client certificate with
      `extendedKeyUsage=clientAuth`. Upload `leaf.crt` + `leaf.key` in **SSL/TLS → Origin Server → Authenticated
      Origin Pulls → Zone-level → Upload certificate**, then delete `leaf.key`/`leaf.csr` from the server; switch
      **Zone-level** on. Install `ca.crt` as `/etc/masjid-connect/staging/certs/cloudflare-origin-pull-ca.pem`
      (root:1000, 640) — Caddy rejects TLS without a client certificate from that CA (`CADDY_TLS=origin`,
      04 §12.2). Renewal: Cloudflare e-mails 30 and 14 days before expiry → sign a new leaf with `ca.key`, upload.
- [x] **Edge Certificates:** Always Use HTTPS **on**; Minimum TLS Version **1.2**; TLS 1.3 **on**; Automatic HTTPS
      Rewrites **on**; HSTS **off here** (the origin sends HSTS itself — DECISIONS #29).

## 3. Speed / scrape-free (CSP — 04 §7)

- [x] Rocket Loader **off**.
- [x] Email Address Obfuscation **off** (Scrape Shield).
- [x] Web Analytics / RUM auto-injection **off** (no third-party analytics — DECISIONS #17).
- [x] Any "Speed Brain" / HTML-rewriting optimisation **off** — Cloudflare must not change our HTML or inject scripts.
- [x] Brotli on (default); HTTP/3 on.

## 4. Caching (01 §5.2, DECISIONS #8)

Cache Rules (**Caching → Cache Rules**; when several rules match, the **last** matching rule wins for a setting —
Cloudflare docs, checked 14 Oct 2026):

| #   | Name               | When                                                                                                                    | Then                                                                                                                            |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | App API (origin)   | Hostname equals `app-staging.almasjids.com` **and** URI Path starts with `/api/v1/` **and** Request Method equals `GET` | **Eligible for cache**; Edge TTL **"Use cache-control header if present, bypass cache if not"**; Browser TTL **Respect origin** |
| 2   | Admin API (bypass) | Hostname equals `admin-staging.almasjids.com` **and** URI Path starts with `/api/`                                      | **Bypass cache** (last, so nothing can override it)                                                                             |
| –   | Media (Phase 3)    | Hostname equals `media-staging.almasjids.com`                                                                           | Eligible for cache; Edge TTL from origin (`immutable`, 1 year)                                                                  |

The default cache key already includes the full query string (versioned `?v=` URLs); query-string customisation is
not available on Free and not needed. Non-GET requests are never cached by Cloudflare. Static assets (`/assets/*`
with hashes) are cached by Cloudflare's defaults and our `Cache-Control: immutable`; `index.html`, `sw.js`,
`boot.js`, the manifest and `offline.html` are `no-cache` at the origin and must stay so. Purge: the worker purges
by URL with a scoped API token (`CF_API_TOKEN_PURGE`, Phase 3/8).

## 5. Security / WAF (04 §9)

- [x] **Managed rules:** the Free managed ruleset is deployed automatically — leave it on.
- [x] **Rate limiting rule** (Free plan, checked 14 Oct 2026: **1 rule, counting by IP, period 10 s, block 10 s,
      only Path / Verified Bot fields** — so it covers both hosts): **Security rules → Create rule → Rate limiting
      rules**, name `API flood guard`, URI Path starts with `/api/`, **100 requests / 10 s** per IP → **Block, 10 s**.
      Coarse outer limit only — our own per-device limits (03 §2) are the real ones; Indian carrier CGNAT puts many
      users behind one IP, so it stays generous.
- [x] **Bot Fight Mode: off** until tested with the installed PWA and the service worker (04 §9 "evaluated for
      compatibility"); Turnstile protects the sensitive endpoints instead.
- [x] **"Under Attack" mode** is the incident switch (DEPLOY runbook §5) — off normally. (Security Level, where the
      dashboard still shows it: default.)
- [ ] Block AI crawlers / verified bots? The admin origin is `noindex`; the app has no public content worth crawling
      — leave defaults, decide in Phase 9.

## 6. Turnstile (Phase 1)

Create a widget for `app-staging.almasjids.com` (later `app.`), mode **Managed/Invisible**. Site key → GitHub
environment variable `VITE_PUBLIC_TURNSTILE_SITE_KEY`; secret key → the `api-public.env` / `api-admin.env` files
on the server only.

## 7. Verification (T0.14 acceptance)

- [ ] `https://app-staging.almasjids.com` and `admin-staging.` load on a phone; securityheaders.com and Mozilla
      Observatory **A+** (owner guide 0.2).
- [ ] `curl -I https://<VPS IP>` from any network → connection refused / TLS failure (no Cloudflare client cert) —
      owner guide 0.13.
- [ ] `curl -I https://app-staging.almasjids.com/api/v1/health` twice → `cf-cache-status: BYPASS` or `DYNAMIC`
      (health is `no-store`); a versioned bundle URL (Phase 2) → `HIT` on the second request.
