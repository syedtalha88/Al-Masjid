// `@mc/config/vitest` — one Vitest setup for every package (10 §1–§3, PHASE_00 T0.12).
//   pnpm test           unit + component tests (`*.test.ts[x]`; never `*.int.test.ts`)
//   pnpm test:int       integration tests against the Docker MongoDB/Redis (`*.int.test.ts`)
//   pnpm test:coverage  unit tests with the package's coverage gate (10 §2) — CI fails below it
import { defineConfig, type ViteUserConfig } from 'vitest/config';

export type TestEnvironment = 'node' | 'jsdom';

/** Coverage gate in percent (10 §2). Omitted metrics are not gated. */
export interface CoverageGate {
  readonly lines?: number;
  readonly branches?: number;
  readonly functions?: number;
  readonly statements?: number;
}

export interface McVitestOptions {
  /** Default environment; single files can opt in with `// @vitest-environment jsdom`. */
  readonly environment?: TestEnvironment;
  /** The package's coverage gate. */
  readonly coverage?: CoverageGate;
  /** Files measured for coverage (default: every .ts/.tsx under src). */
  readonly coverageInclude?: readonly string[];
  /** Files left out of coverage, each with a reason in the package's config (e.g. vendored code). */
  readonly coverageExclude?: readonly string[];
  readonly setupFiles?: readonly string[];
  /**
   * Which run enforces the coverage gate: `unit` (default — `test:coverage`) or `integration` (`test:int --coverage`
   * runs unit + integration tests together). For packages whose code mostly needs MongoDB/Redis (packages/db).
   */
  readonly coverageRun?: 'unit' | 'integration';
}

const INTEGRATION = '**/*.int.test.{ts,tsx}';
const TESTS = ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'];

/** True when this run is `test:int` (set by the package scripts). */
export const isIntegrationRun = (): boolean => process.env['MC_TEST_KIND'] === 'integration';

/**
 * Builds a package's Vitest config: deterministic environment (TZ Asia/Kolkata — 10 §3), unit vs integration
 * file sets, and the coverage gate. Integration runs are serial per file pool-wide only where the package
 * needs it; each file isolates its own MongoDB database / Redis prefix (`@mc/db/testing`, `@mc/api/testing`).
 *
 * @returns a Vitest config for `vitest.config.ts`.
 */
export function mcVitest({
  environment = 'node',
  coverage,
  coverageInclude = ['src/**/*.{ts,tsx}'],
  coverageExclude = [],
  setupFiles = [],
  coverageRun = 'unit',
}: McVitestOptions = {}): ViteUserConfig {
  const integration = isIntegrationRun();
  const gated = integration === (coverageRun === 'integration');
  return defineConfig({
    test: {
      environment,
      env: { TZ: 'Asia/Kolkata' },
      include: integration ? (coverageRun === 'integration' ? [INTEGRATION, ...TESTS] : [INTEGRATION]) : TESTS,
      exclude: ['**/node_modules/**', '**/dist/**', ...(integration ? [] : [INTEGRATION])],
      setupFiles: [...setupFiles],
      // Integration files talk to shared services; give them time but never retry flakiness away.
      testTimeout: integration ? 30_000 : 10_000,
      passWithNoTests: true,
      restoreMocks: true,
      coverage: {
        provider: 'v8',
        include: [...coverageInclude],
        exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', ...coverageExclude],
        reporter: ['text-summary', 'json-summary', 'html'],
        reportsDirectory: 'coverage',
        ...(coverage && gated ? { thresholds: { ...coverage } } : {}),
      },
    },
  });
}
