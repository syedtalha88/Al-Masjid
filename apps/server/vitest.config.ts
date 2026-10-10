import { mcVitest } from '@mc/config/vitest';

// Process wiring: the lifecycle helpers are unit-tested; the entry files are composition, exercised by the
// stack smoke/e2e tests.
export default mcVitest({ coverage: { lines: 90 }, coverageInclude: ['src/lifecycle.ts', 'src/heartbeat.ts'] });
