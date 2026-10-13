// `pnpm scan:bundles` — 04 §11 / PROGRESS F2: built client bundles (apps/*/dist) may contain only VITE_PUBLIC_*
// configuration. Fails on (1) the name of any secret-bearing server variable from .env.example, (2) any
// non-public VITE_* name, (3) secret-shaped values (private keys, credentials inside connection strings, common
// token formats). `--self-test` plants each kind in a temp folder and requires every one to be caught.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const TEXT = /\.(?:js|mjs|css|html|json|webmanifest|map|txt|svg)$/;

/** Server variables whose name in a bundle means configuration leaked (or code that reads it got bundled). */
function secretVariableNames() {
  const names = [...readFileSync(join(root, '.env.example'), 'utf8').matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map(
    (match) => match[1] ?? '',
  );
  return names.filter(
    (name) => !name.startsWith('VITE_PUBLIC_') && /URI|URL|SECRET|KEY|TOKEN|PEPPER|PASSWORD/.test(name),
  );
}

const VALUE_PATTERNS = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['credentials in a MongoDB URI', /mongodb(?:\+srv)?:\/\/[^\s"'`/:@]+:[^\s"'`@]+@/],
  ['credentials in a Redis URL', /rediss?:\/\/[^\s"'`/:@]*:[^\s"'`@]+@/],
  ['Cloudinary URL with secret', /cloudinary:\/\/\d+:[^\s"'`@]+@/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/],
];

/** @param {string} dir */
function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (TEXT.test(entry)) yield path;
  }
}

/**
 * @param {readonly string[]} dirs
 * @returns {string[]} findings, one line each (names and file paths only — never the matched value)
 */
export function scan(dirs) {
  const names = secretVariableNames();
  const nameRegex = new RegExp(`\\b(${names.join('|')})\\b`);
  const viteRegex = /\bVITE_(?!PUBLIC_)[A-Z0-9_]+\b/;
  const findings = [];
  for (const dir of dirs) {
    for (const file of files(dir)) {
      const text = readFileSync(file, 'utf8');
      const where = relative(root, file);
      const name = nameRegex.exec(text);
      if (name) findings.push(`${where}: server variable name ${name[1] ?? ''}`);
      const vite = viteRegex.exec(text);
      if (vite) findings.push(`${where}: non-public client variable ${vite[0]}`);
      for (const [label, pattern] of VALUE_PATTERNS) if (pattern.test(text)) findings.push(`${where}: ${label}`);
    }
  }
  return findings;
}

if (process.argv.includes('--self-test')) {
  const dir = mkdtempSync(join(tmpdir(), 'mc-scan-'));
  try {
    const planted = {
      'name.js': 'const u = import.meta.env.MONGODB_URI_ADMIN;',
      'vite.js': 'const k = "VITE_SECRET_THING";',
      'pem.js': '"-----BEGIN PRIVATE KEY-----\\nabc"',
      'mongo.js': '"mongodb+srv://user:hunter2@cluster.example.net/db"',
      'redis.js': '"redis://worker:pa55@redis:6379"',
      'gh.js': `"ghp_${'a'.repeat(36)}"`,
      'clean.js': 'const api = import.meta.env.VITE_PUBLIC_API_BASE; const url = "mongodb://host:27017";',
    };
    for (const [file, content] of Object.entries(planted)) writeFileSync(join(dir, file), content);
    const found = scan([dir]);
    const missed = Object.keys(planted).filter(
      (file) => file !== 'clean.js' && !found.some((line) => line.includes(file)),
    );
    const falsePositive = found.filter((line) => line.includes('clean.js'));
    if (missed.length > 0 || falsePositive.length > 0) {
      process.stderr.write(
        `scan-bundles self-test FAILED — missed: ${missed.join(', ')}; false positives: ${falsePositive.join(', ')}\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`scan-bundles self-test: ${String(found.length)} planted leaks caught, clean file passes\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  const dirs = ['apps/app/dist', 'apps/admin/dist'].map((dir) => join(root, dir));
  for (const dir of dirs) {
    try {
      statSync(dir);
    } catch {
      process.stderr.write(`scan-bundles: ${relative(root, dir)} is missing — build the apps first\n`);
      process.exit(1);
    }
  }
  const findings = scan(dirs);
  if (findings.length > 0) {
    process.stderr.write(`scan-bundles: FAILED\n  ${findings.join('\n  ')}\n`);
    process.exit(1);
  }
  process.stdout.write('scan-bundles: client bundles contain no server variables or secrets\n');
}
