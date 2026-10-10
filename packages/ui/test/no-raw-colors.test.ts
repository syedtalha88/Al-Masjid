import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// PHASE_00 T0.6 acceptance: "grep finds zero hex colors in apps/**" — colors come only from design tokens
// (CLAUDE.md §6 UI). Also forbids rgb()/hsl() literals and Tailwind arbitrary color values.
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', 'dev-dist', '.turbo', 'test-results']);
const SOURCE = /\.(tsx?|css|html|json|webmanifest)$/;
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|oklab)\(|\[(#|rgb|hsl)/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return SOURCE.test(name) ? [path] : [];
  });
}

describe('apps/** contain no raw colors', () => {
  it.each(['apps/app', 'apps/admin'])('%s', (app) => {
    const offenders = files(join(repo, app)).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => RAW_COLOR.test(line))
        .map(({ line, index }) => `${relative(repo, path)}:${String(index + 1)}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
