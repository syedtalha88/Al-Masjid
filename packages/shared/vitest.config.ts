import { mcVitest } from '@mc/config/vitest';

// 10 §2: packages/shared — ≥ 95% lines.
export default mcVitest({ coverage: { lines: 95 } });
