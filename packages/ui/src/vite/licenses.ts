// The licenses page data (05 §10 `licenses`, PHASE_08 T8.6): generated at build from the app's production dependency
// tree, its workspace packages' dependencies included (`pnpm licenses list --prod --filter <app>...` — fonts, adhan,
// motion, …), plus what is not an npm package. Emitted as `/licenses.json` (served the same way in dev), read by the
// app's Licenses screen. Our own workspace packages are left out. A little over-inclusive (a workspace package's
// server-only dependency is listed too) rather than ever missing one.
import { execFileSync } from 'node:child_process';

import type { Plugin } from 'vite';

export interface LicenseEntry {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly homepage?: string;
}

/** Not npm packages, or worth naming separately. */
export const EXTRA_LICENSES: readonly LicenseEntry[] = [
  {
    name: 'Hadith, Ayah and Dua texts',
    version: '—',
    license: 'As shown with each text (source and licence recorded by the Content Library)',
  },
];

/**
 * Turns `pnpm licenses list --json` output (license → packages) into a sorted, de-duplicated list.
 *
 * @throws Error when the output is not the expected shape (the build fails rather than ship an empty page).
 */
export function licensesFromPnpm(json: string): LicenseEntry[] {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('licenses: unexpected pnpm output');
  const entries = new Map<string, LicenseEntry>();
  for (const [license, packages] of Object.entries(parsed)) {
    if (!Array.isArray(packages)) throw new Error('licenses: unexpected pnpm output');
    for (const item of packages as unknown[]) {
      if (typeof item !== 'object' || item === null) continue;
      const { name, versions, homepage } = item as { name?: unknown; versions?: unknown; homepage?: unknown };
      if (typeof name !== 'string' || name.startsWith('@mc/')) continue;
      const version = Array.isArray(versions) ? versions.map(String).join(', ') : '';
      entries.set(`${name}@${version}`, {
        name,
        version,
        license,
        ...(typeof homepage === 'string' && /^https:\/\//u.test(homepage) ? { homepage } : {}),
      });
    }
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Emits `licenses.json` for `pkg` (e.g. `@mc/app`) at build and serves it at `/licenses.json` in dev.
 *
 * @throws Error at build when `pnpm licenses` fails or finds no packages.
 */
export function mcLicenses(pkg: string): Plugin {
  let cached: string | undefined;
  const body = () => {
    if (cached) return cached;
    const output = execFileSync('pnpm', ['licenses', 'list', '--json', '--prod', '--filter', `${pkg}...`], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      shell: process.platform === 'win32', // pnpm is a .cmd shim on Windows
    });
    const packages = licensesFromPnpm(output);
    if (packages.length === 0) throw new Error(`licenses: no packages found for ${pkg}`);
    cached = JSON.stringify({ packages: [...packages, ...EXTRA_LICENSES] });
    return cached;
  };
  return {
    name: 'mc-licenses',
    configureServer(server) {
      server.middlewares.use('/licenses.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(body());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'licenses.json', source: body() });
    },
  };
}
