// `pnpm --filter @mc/ui generate` — writes the generated CSS files from src/tokens and src/fonts.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { tokensCss, typeCss } from '../src/tokens/css.ts';
import { fontFallbacksCss, fontsCss } from './fonts-css.ts';

/** Generated file → content builder. The unit test uses the same table to detect stale files. */
export const GENERATED = {
  'tokens.css': tokensCss,
  'type.css': typeCss,
  'fonts.css': fontsCss,
  'font-fallbacks.css': fontFallbacksCss,
} as const;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const [file, build] of Object.entries(GENERATED)) {
    writeFileSync(`${root}${file}`, build());
    process.stdout.write(`wrote ${file}\n`);
  }
}
