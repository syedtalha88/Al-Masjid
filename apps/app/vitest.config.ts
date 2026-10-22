import { mcVitest } from '@mc/config/vitest';

// 10 §2: apps — feature hooks/utils ≥ 80% lines (components are covered by component + e2e tests).
export default mcVitest({
  coverage: { lines: 80 },
  // Data layer (T2.3) + feature hooks/utils; React providers and components are covered by component and e2e tests.
  coverageInclude: ['src/features/**/{hooks,utils,lib}/**/*.{ts,tsx}', 'src/lib/**/*.ts'],
});
