import { mcVitest } from '@mc/config/vitest';

// 10 §2: packages/api — ≥ 90% lines, ≥ 85% branches. The integration-test helpers (src/testing) are
// exercised by `pnpm test:int`, not counted here.
export default mcVitest({ coverage: { lines: 90, branches: 85 }, coverageExclude: ['src/testing/**'] });
