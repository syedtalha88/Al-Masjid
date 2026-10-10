import { mcVitest } from '@mc/config/vitest';

// Lint rules and test config: a floor at today's level.
export default mcVitest({ coverage: { lines: 80 }, coverageInclude: ['src/**/*.js'] });
