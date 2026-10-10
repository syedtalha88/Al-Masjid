import { mcVitest } from '@mc/config/vitest';

// 10 §2: apps — feature hooks/utils ≥ 80% lines (components are covered by component + e2e tests).
export default mcVitest({
  coverage: { lines: 80 },
  coverageInclude: ['src/features/**/{hooks,utils,lib}/**/*.{ts,tsx}'],
});
