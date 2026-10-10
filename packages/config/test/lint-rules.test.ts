import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

import { createConfig } from '../src/eslint.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let eslint: ESLint;

beforeAll(async () => {
  eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: createConfig({ tsconfigRootDir: repoRoot, typeAware: false }),
  });
  // Warm-up: the first lint loads every plugin (several seconds when packages test in parallel); doing it
  // here keeps that cost out of the 5 s per-test timeout.
  await eslint.lintText('', { filePath: path.join(repoRoot, 'packages/shared/src/warm-up.ts') });
}, 60_000);

/** Lints `code` as if it lived at `relativePath` and returns the ids of the rules that fired. */
async function ruleIds(relativePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, relativePath) });
  if (!result) throw new Error('ESLint returned no result');
  const fatal = result.messages.find((message) => message.fatal);
  if (fatal) throw new Error(`Parse error in fixture: ${fatal.message}`);
  return result.messages.map((message) => message.ruleId ?? 'unknown');
}

describe('T0.1 acceptance: deliberate violations fail lint', () => {
  it('rejects `any`', async () => {
    expect(await ruleIds('packages/domain/src/sample.ts', 'export const parse = (value: any) => value;\n')).toContain(
      '@typescript-eslint/no-explicit-any',
    );
  });

  it('rejects console.log', async () => {
    expect(await ruleIds('packages/domain/src/sample.ts', "console.log('debug');\n")).toContain('no-console');
  });

  it('rejects a physical `ml-2` class', async () => {
    const code = 'export const Box = () => <div className="flex ml-2" />;\n';
    expect(await ruleIds('apps/app/src/features/home/Box.tsx', code)).toContain('mc/no-physical-direction');
  });

  it('rejects a systemScope import in packages/api/src/routes', async () => {
    const code = "import { systemScope } from '@mc/db';\nexport const scope = systemScope;\n";
    expect(await ruleIds('packages/api/src/routes/masjids.ts', code)).toContain('no-restricted-imports');
  });

  it('rejects a mongodb import in packages/api', async () => {
    const code = "import { MongoClient } from 'mongodb';\nexport const client = MongoClient;\n";
    expect(await ruleIds('packages/api/src/services/masjids.ts', code)).toContain('no-restricted-imports');
  });
});

describe('import bans: allowed areas', () => {
  const systemScopeImport = "import { systemScope } from '@mc/db';\nexport const scope = systemScope;\n";
  const hookScopeImport = "import { hookScope } from '@mc/db';\nexport const scope = hookScope;\n";
  const mongodbImport = "import { MongoClient } from 'mongodb';\nexport const client = MongoClient;\n";

  it('allows systemScope in packages/api/src/jobs and scripts', async () => {
    expect(await ruleIds('packages/api/src/jobs/retention.ts', systemScopeImport)).not.toContain(
      'no-restricted-imports',
    );
    expect(await ruleIds('scripts/seed-dev.ts', systemScopeImport)).not.toContain('no-restricted-imports');
  });

  it('rejects hookScope outside packages/api/src/hooks, allows it inside', async () => {
    expect(await ruleIds('packages/api/src/jobs/retention.ts', hookScopeImport)).toContain('no-restricted-imports');
    expect(await ruleIds('packages/api/src/hooks/example.ts', hookScopeImport)).not.toContain('no-restricted-imports');
  });

  it('rejects systemScope in webhooks', async () => {
    expect(await ruleIds('packages/api/src/hooks/example.ts', systemScopeImport)).toContain('no-restricted-imports');
  });

  it('rejects an aliased systemScope import from a @mc/db subpath', async () => {
    const code = "import { systemScope as s } from '@mc/db/scope';\nexport const scope = s;\n";
    expect(await ruleIds('packages/api/src/services/x.ts', code)).toContain('no-restricted-imports');
  });

  it('allows mongodb only inside packages/db', async () => {
    expect(await ruleIds('packages/db/src/client.ts', mongodbImport)).not.toContain('no-restricted-imports');
    expect(await ruleIds('apps/server/src/public.ts', mongodbImport)).toContain('no-restricted-imports');
  });

  it('rejects dynamic import / require of mongodb outside packages/db', async () => {
    expect(await ruleIds('packages/api/src/services/x.ts', "export const m = await import('mongodb');\n")).toContain(
      'no-restricted-syntax',
    );
  });
});

describe('mc/no-physical-direction', () => {
  const file = 'packages/ui/src/components/Sample.tsx';

  it.each([
    ['pl-4'],
    ['mr-auto'],
    ['left-0'],
    ['-right-2'],
    ['hover:pr-3'],
    ['text-left'],
    ['border-l-2'],
    ['rounded-tr-lg'],
  ])('rejects %s', async (cls) => {
    expect(await ruleIds(file, `export const A = () => <div className="${cls}" />;\n`)).toContain(
      'mc/no-physical-direction',
    );
  });

  it.each([
    ['ms-2 me-4 ps-3 pe-1'],
    ['start-0 end-0'],
    ['text-start'],
    ['rounded-s-lg'],
    ['rtl:-scale-x-100'],
    ['inset-x-0'],
  ])('allows %s', async (cls) => {
    expect(await ruleIds(file, `export const A = () => <div className="${cls}" />;\n`)).not.toContain(
      'mc/no-physical-direction',
    );
  });

  it('checks cn()/clsx() arguments, conditionals and template literals exactly once', async () => {
    const code = [
      'declare function cn(...c: unknown[]): string;',
      'export const A = ({ on }: { on: boolean }) => (',
      "  <div className={cn('flex', on ? 'ml-2' : 'ms-2', `p-2 ${on ? 'pr-1' : ''}`)} />",
      ');',
      '',
    ].join('\n');
    const ids = await ruleIds(file, code);
    expect(ids.filter((id) => id === 'mc/no-physical-direction')).toHaveLength(2);
  });

  it('rejects physical properties in style objects', async () => {
    const code = 'export const A = () => <div style={{ marginLeft: 4, textAlign: "right" }} />;\n';
    expect((await ruleIds(file, code)).filter((id) => id === 'mc/no-physical-direction')).toHaveLength(2);
  });

  it('ignores ordinary strings that are not class lists', async () => {
    expect(await ruleIds(file, "export const side = 'left';\n")).not.toContain('mc/no-physical-direction');
  });

  it('does not apply to server code', async () => {
    expect(await ruleIds('packages/api/src/x.ts', "export const o = { className: 'ml-2' };\n")).not.toContain(
      'mc/no-physical-direction',
    );
  });
});

describe('mc/no-adhoc-motion', () => {
  const file = 'apps/app/src/features/home/Card.tsx';

  it('rejects numeric transition literals in JSX', async () => {
    const code = 'export const A = () => <m.div transition={{ duration: 0.3 }} />;\ndeclare const m: any;\n';
    expect(await ruleIds(file, code)).toContain('mc/no-adhoc-motion');
  });

  it('rejects numeric transitions in variants objects and animate() options', async () => {
    const variants = "export const v = { open: { x: 0, transition: { type: 'spring', bounce: 0.2 } } };\n";
    expect(await ruleIds(file, variants)).toContain('mc/no-adhoc-motion');
    const call = 'declare function animate(...a: unknown[]): void;\nanimate(0, 1, { ease: [0.2, 0, 0, 1] });\n';
    expect(await ruleIds(file, call)).toContain('mc/no-adhoc-motion');
  });

  it('rejects Tailwind timing utilities', async () => {
    const code =
      'export const A = () => <div className="transition-opacity duration-300 ease-[cubic-bezier(0,0,1,1)]" />;\n';
    expect((await ruleIds(file, code)).filter((id) => id === 'mc/no-adhoc-motion')).toHaveLength(2);
  });

  it('rejects hard-coded CSS timings in inline styles', async () => {
    const transition = "export const A = () => <div style={{ transition: 'opacity 300ms ease' }} />;\n";
    expect(await ruleIds(file, transition)).toContain('mc/no-adhoc-motion');
    const curve = "export const s = { animationTimingFunction: 'cubic-bezier(0.3, 0, 0, 1)' };\n";
    expect(await ruleIds(file, curve)).toContain('mc/no-adhoc-motion');
    const preset =
      "import { css } from '@mc/ui/motion';\nexport const s = { transition: css.ios.transition('opacity') };\n";
    expect(await ruleIds(file, preset)).not.toContain('mc/no-adhoc-motion');
  });

  it('allows presets referenced by name', async () => {
    const code =
      "import { spring } from '@mc/ui/motion';\nexport const A = () => <m.div transition={spring.smooth} />;\ndeclare const m: any;\n";
    expect(await ruleIds(file, code)).not.toContain('mc/no-adhoc-motion');
  });

  it('allows literals inside packages/ui/src/motion', async () => {
    const code =
      "export const spring = { smooth: { type: 'spring', visualDuration: 0.38, bounce: 0 } };\nexport const t = { transition: { duration: 0.18 } };\n";
    expect(await ruleIds('packages/ui/src/motion/tokens.ts', code)).not.toContain('mc/no-adhoc-motion');
  });
});

describe('mc/no-raw-routes', () => {
  it('rejects router.get / app.post / router.route in the API', async () => {
    const code = [
      'declare const router: { get(...a: unknown[]): void; route(p: string): void };',
      'declare const app: { post(...a: unknown[]): void };',
      "router.get('/x', () => undefined);",
      "app.post('/y', () => undefined);",
      "router.route('/z');",
      '',
    ].join('\n');
    expect(
      (await ruleIds('packages/api/src/routes/x.ts', code)).filter((id) => id === 'mc/no-raw-routes'),
    ).toHaveLength(3);
  });

  it("allows app.get('setting') and the defineRoute implementation", async () => {
    const read = "declare const app: { get(k: string): unknown };\nexport const proxy = app.get('trust proxy');\n";
    expect(await ruleIds('packages/api/src/app.ts', read)).not.toContain('mc/no-raw-routes');
    const register = "declare const router: { get(...a: unknown[]): void };\nrouter.get('/x', () => undefined);\n";
    expect(await ruleIds('packages/api/src/http/define-route.ts', register)).not.toContain('mc/no-raw-routes');
  });
});
