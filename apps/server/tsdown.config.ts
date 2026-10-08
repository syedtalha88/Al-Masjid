import { defineConfig } from 'tsdown';

/**
 * Server build (DECISIONS #34): one ESM file per process. Workspace packages (`@mc/*`, TypeScript
 * sources) and their pure-JS dependencies (express, pino, zod, …) are bundled in. Packages listed in
 * this package's `dependencies` stay external — notably `bullmq`, which loads Lua scripts from its own
 * files at runtime — and are installed in the image by `pnpm deploy --prod`.
 */
export default defineConfig({
  entry: ['src/public.ts', 'src/admin.ts', 'src/worker.ts', 'src/migrate.ts', 'src/healthcheck.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  dts: false,
  // Source maps are generated for Sentry upload in CI (T0.13) and never shipped in the runtime image.
  sourcemap: true,
  minify: false,
  // Bundling express/pino/zod is intentional (see above), so the "detected dependencies" hint is disabled.
  deps: { alwaysBundle: [/^@mc\//], onlyBundle: false },
});
