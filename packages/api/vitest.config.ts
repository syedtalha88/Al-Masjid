import { mcVitest } from '@mc/config/vitest';

// 10 §2: packages/api — ≥ 90% lines, ≥ 85% branches. From T1.8 the auth/session layer is DB-backed, so (like
// packages/db) the gate is enforced on the integration run, which runs the unit tests too. The integration-test
// helpers (src/testing) are not counted.
export default mcVitest({
  coverage: { lines: 90, branches: 85 },
  coverageExclude: ['src/testing/**'],
  coverageRun: 'integration',
});
