import { mcVitest } from '@mc/config/vitest';

// 10 §2: packages/db — ≥ 95% lines (policy-matrix and privilege completeness are separate checks, Phase 1).
// The integration-test helpers (src/testing) are exercised by `pnpm test:int`, not counted here.
export default mcVitest({ coverage: { lines: 95 }, coverageExclude: ['src/testing/**'] });
