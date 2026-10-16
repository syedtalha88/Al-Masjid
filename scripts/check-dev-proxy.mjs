// `pnpm dev` wiring check (Phase 00 re-review V-29): each PWA's Vite dev server must forward `/api` to the port its
// API process listens on in local dev (scripts/setup-local.mjs), keep the browser's Host and Origin (the admin API's
// Origin/CSRF guard and the `__Host-` session cookie depend on them), and pass the API's Set-Cookie through.
//   node scripts/check-dev-proxy.mjs        (stop `pnpm dev` first — it needs ports 5173/5174 and 8787/8788)
// A stub stands in for the API, so neither MongoDB nor Redis is needed.
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');
const setupLocal = readFileSync(join(root, 'scripts/setup-local.mjs'), 'utf8');

/** A value setup-local.mjs writes: PORT of one API env file, or an origin shared by all of them. */
function localValue(pattern, label) {
  const match = pattern.exec(setupLocal);
  if (!match?.[1]) throw new Error(`setup-local.mjs: ${label} not found`);
  return match[1];
}

const APPS = [
  {
    name: 'app',
    apiPort: Number(localValue(/'\.env\.local\.api-public'[\s\S]*?PORT: '(\d+)'/, 'api-public PORT')),
    origin: localValue(/APP_ORIGIN: '([^']+)'/, 'APP_ORIGIN'),
  },
  {
    name: 'admin',
    apiPort: Number(localValue(/'\.env\.local\.api-admin'[\s\S]*?PORT: '(\d+)'/, 'api-admin PORT')),
    origin: localValue(/ADMIN_ORIGIN: '([^']+)'/, 'ADMIN_ORIGIN'),
  },
];

let failures = 0;
const report = (ok, label) => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}\n`);
  if (!ok) failures += 1;
};

for (const app of APPS) {
  const dir = join(root, 'apps', app.name);
  const vitePath = createRequire(join(dir, 'package.json')).resolve('vite');
  /** @type {typeof import('vite')} */
  const vite = await import(pathToFileURL(vitePath).href);

  const seen = [];
  const stub = createHttpServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host, origin: req.headers.origin });
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'probe=1; Path=/; HttpOnly' });
    res.end('{"status":"ok"}');
  });
  await new Promise((resolve, reject) => {
    stub.once('error', (error) =>
      reject(new Error(`port ${app.apiPort} is busy — stop \`pnpm dev\` first (${error.message})`)),
    );
    stub.listen(app.apiPort, '127.0.0.1', resolve);
  });

  const server = await vite.createServer({ root: dir, configFile: join(dir, 'vite.config.ts'), logLevel: 'error' });
  try {
    await server.listen();
    const devOrigin = `http://localhost:${server.config.server.port}`;
    report(
      devOrigin === app.origin,
      `${app.name}: dev server ${devOrigin} is the origin the API allows (${app.origin})`,
    );

    const response = await fetch(`${devOrigin}/api/v1/health?probe=1`, { headers: { origin: devOrigin } });
    const body = await response.text();
    const forwarded = seen.at(-1);
    report(
      response.status === 200 && body === '{"status":"ok"}',
      `${app.name}: /api/v1/health answered by :${app.apiPort}`,
    );
    report(forwarded?.url === '/api/v1/health?probe=1', `${app.name}: path and query forwarded unchanged`);
    report(forwarded?.host === `localhost:${server.config.server.port}`, `${app.name}: Host kept (no changeOrigin)`);
    report(forwarded?.origin === devOrigin, `${app.name}: Origin kept for the CSRF guard`);
    report(
      response.headers.get('set-cookie')?.startsWith('probe=1') === true,
      `${app.name}: Set-Cookie passed through`,
    );

    const page = await fetch(`${devOrigin}/`);
    report(page.status === 200 && seen.length === 1, `${app.name}: the page itself is served by Vite, not proxied`);
  } finally {
    await server.close();
    await new Promise((resolve) => stub.close(resolve));
  }
}

if (failures > 0) {
  process.stdout.write(`${failures} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write('dev proxy wiring OK\n');
