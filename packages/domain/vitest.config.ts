import { mcVitest } from '@mc/config/vitest';

// 10 §2: packages/domain — 100% lines & branches.
export default mcVitest({
  coverage: { lines: 100, branches: 100 },
  // Vendored ThumbHash (DECISIONS #45): verified byte-identical to upstream on 200 random images and pinned by
  // behaviour tests; its internal branches are upstream's, not ours to re-test line by line.
  coverageExclude: ['src/thumbhash.ts'],
});
