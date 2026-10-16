import { mcVitest } from '@mc/config/vitest';

// 10 §2: packages/db — ≥ 95% lines. Almost all of this package talks to MongoDB, so the gate is enforced on the
// integration run (`test:int --coverage`: unit + integration tests against the Docker MongoDB, CI integration job).
// The integration-test helpers (src/testing) are tooling, not product code.
export default mcVitest({ coverage: { lines: 95 }, coverageExclude: ['src/testing/**'], coverageRun: 'integration' });
