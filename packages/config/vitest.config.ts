import { mcVitest } from '@mc/config/vitest';

// Lint rules, test config and the perf-trace analyzer: a floor at today's level (fixtures run in e2e).
export default mcVitest({ coverage: { lines: 80 }, coverageInclude: ['src/**/*.js', 'src/playwright/trace.ts'] });
