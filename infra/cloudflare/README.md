# Cloudflare settings — almasjids.com

> The settings Cloudflare must have, per 01 §2/§5.2, 04 §7/§9/§12 and DECISIONS #21, #42, #54. Applied by the owner
> in the dashboard during T0.14 (Free plan); an automated header/cache check against staging runs in CI later.
> Plan limits (number of cache / WAF / rate-limit rules) change over time — if a rule does not fit, note it here.
> Prepared 14 Oct 2026; tick each line when applied.

## 1. DNS (staging now, production in Phase 9)

| Type | Name                      | Content  | Proxy                      |
| ---- | ------------------------- | -------- | -------------------------- |
| A    | `app-staging`             | VPS IPv4 | **Proxied** (orange cloud) |
| A    | `admin-staging`           | VPS IPv4 | Proxied                    |
| A    | `media-staging`           | VPS IPv4 | Proxied                    |
| A    | `app` / `admin` / `media` | VPS IPv4 | Proxied — Phase 9          |

No record may be "DNS only" (grey cloud): the origin accepts only Cloudflare (firewall + client certificate).

## 2. SSL/TLS

- [ ] **Overview → Full (strict)**.
- [ ] **Origin Server → Create certificate** (RSA 2048 or ECC, hostnames `*.almasjids.com` + `almasjids.com`, 15 years).
      Save the certificate and key **only on the server**: `/etc/masjid-connect/staging/certs/origin.pem` and
      `origin-key.pem` (root, 600; the web container reads them read-only).
- [ ] **Origin Server → Authenticated Origin Pulls: On** (zone-level). Download Cloudflare's origin-pull CA to
      `/etc/masjid-connect/staging/certs/cloudflare-origin-pull-ca.pem` — Caddy rejects TLS without that client
      certificate (`CADDY_TLS=origin`, 04 §12.2).
- [ ] **Edge Certificates:** Always Use HTTPS **on**; Minimum TLS Version **1.2**; TLS 1.3 **on**; Automatic HTTPS
      Rewrites **on**; HSTS **off here** (the origin sends HSTS itself — DECISIONS #29).

## 3. Speed / scrape-free (CSP — 04 §7)

- [ ] Rocket Loader **off**.
- [ ] Email Address Obfuscation **off** (Scrape Shield).
- [ ] Web Analytics / RUM auto-injection **off** (no third-party analytics — DECISIONS #17).
- [ ] Any "Speed Brain" / HTML-rewriting optimisation **off** — Cloudflare must not change our HTML or inject scripts.
- [ ] Brotli on (default); HTTP/3 on.

## 4. Caching (01 §5.2, DECISIONS #8)

Cache Rules (Rules → Cache Rules), in this order:

| #   | When                                                                                                          | Then                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Host is `admin-staging.almasjids.com` (later also `admin.almasjids.com`) **and** URI path starts with `/api/` | **Bypass cache**                                                                                                                                                                                                       |
| 2   | Request method is not `GET`                                                                                   | **Bypass cache**                                                                                                                                                                                                       |
| 3   | Host is `app-staging.almasjids.com` **and** URI path starts with `/api/v1/` **and** method `GET`              | **Eligible for cache**; Edge TTL **"Use cache-control header if present, bypass cache if not"**; Browser TTL **respect origin**; Cache key: **include the full query string** (versioned URLs `?v=` are the cache key) |
| 4   | Host is `media-staging.almasjids.com`                                                                         | Eligible for cache; Edge TTL respect origin (`immutable`, 1 year) — Phase 3                                                                                                                                            |

Static assets (`/assets/*` with hashes) are cached by Cloudflare's defaults and our `Cache-Control: immutable`;
`index.html`, `sw.js`, `boot.js`, the manifest and `offline.html` are `no-cache` at the origin and must stay so.
Purge: the worker purges by cache tag / URL with a scoped API token (`CF_API_TOKEN_PURGE`, Phase 3/8).

## 5. Security / WAF (04 §9)

- [ ] **Managed rules on** (the Free managed ruleset).
- [ ] **Rate limiting rule** on `app-staging.almasjids.com` path `/api/` — coarse outer limit (e.g. 600 requests /
      1 min per IP → block 1 min). Our own per-device limits (03 §2) are the real ones; this only stops floods.
      Indian carrier CGNAT puts many users behind one IP — keep it generous.
- [ ] **Bot Fight Mode: off** until tested with the installed PWA and the service worker (04 §9 "evaluated for
      compatibility"); Turnstile protects the sensitive endpoints instead.
- [ ] **Security Level:** Medium. **"Under Attack" mode** is the incident switch (DEPLOY runbook §5) — off normally.
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
