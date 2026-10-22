// `node scripts/check-cdn-cache.mjs <app url>` — PHASE_02 T2.2 / 01 §5.2: Cloudflare must cache the versioned public
// API GETs (bundle, feed) — the second request of the same URL answers `cf-cache-status: HIT` — while unversioned
// requests redirect (302, short CDN TTL) and device-specific responses are never cached. Uses the seeded staging masjid
// (follow code TESTA001, kept fresh by the staging worker — DECISIONS #91). Exit 1 on any miss; prints only statuses.
const base = process.argv[2];
if (!base) {
  process.stderr.write('usage: node scripts/check-cdn-cache.mjs https://app-staging.<domain>\n');
  process.exit(2);
}
const api = `${new URL(base).origin}/api/v1`;
const failures = [];
const get = (url) => fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'mc-cdn-check' } });
const json = async (url) => {
  const response = await get(url);
  if (response.status !== 200) throw new Error(`${url} → ${String(response.status)}`);
  return response.json();
};

/** Requests `url` until Cloudflare answers HIT (the first request of a fresh URL is a MISS). */
async function expectHit(url, label) {
  const statuses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await get(url);
    await response.arrayBuffer();
    const status = response.headers.get('cf-cache-status') ?? '(none)';
    statuses.push(`${String(response.status)}/${status}`);
    if (response.status === 200 && status === 'HIT') {
      process.stdout.write(`ok   ${label}: ${statuses.join(' → ')}\n`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  failures.push(`${label}: never HIT (${statuses.join(' → ')})`);
}

const { masjid } = await json(`${api}/masjids/resolve/TESTA001`);
const versions = await json(`${api}/masjids/versions?ids=${masjid.id}`);
const v = versions[masjid.id]?.v;
if (!v) throw new Error('seed masjid has no version');

const unversioned = await get(`${api}/masjids/${masjid.id}/bundle`);
if (unversioned.status !== 302) failures.push(`bundle without v: expected 302, got ${String(unversioned.status)}`);
else process.stdout.write('ok   bundle without v → 302\n');

await expectHit(`${api}/masjids/${masjid.id}/bundle?v=${String(v)}`, 'bundle (versioned)');
await expectHit(`${api}/masjids/${masjid.id}/feed?v=${String(v)}&aud=brothers`, 'feed page (versioned)');

const config = await get(`${api}/config`);
await config.arrayBuffer();
process.stdout.write(`info config: cf-cache-status ${config.headers.get('cf-cache-status') ?? '(none)'}\n`);

if (failures.length > 0) {
  process.stderr.write(`${failures.map((line) => `FAIL ${line}`).join('\n')}\n`);
  process.exit(1);
}
