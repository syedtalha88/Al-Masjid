import { mcVitest } from '@mc/config/vitest';

// No 10 §2 figure for the component library (components are also covered by the showcase e2e): a floor at
// today's level so coverage cannot silently drop. The dev-only showcase is not product code.
export default mcVitest({ coverage: { lines: 70, branches: 60 }, coverageExclude: ['src/showcase/**'] });
