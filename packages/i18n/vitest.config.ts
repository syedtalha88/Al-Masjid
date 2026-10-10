import { mcVitest } from '@mc/config/vitest';

// No 10 §2 figure for i18n: a floor at today's level so coverage cannot silently drop.
export default mcVitest({ coverage: { lines: 90, branches: 75 } });
