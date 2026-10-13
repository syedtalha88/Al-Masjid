// Build entry for the e2e test-hook module (DECISIONS #31). tsdown emits it as dist/test-hooks.mjs (sharing the
// API chunks with the entrypoints, so classes such as ApiProblem are the same instances), then
// scripts/split-test-hooks.mjs moves it to dist-test/: only the `runtime-test` image copies it back into dist/.
export { TEST_HOOKS_MARKER, testHookRoutes } from '@mc/api/test-hooks';
