import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BRAND } from '@mc/shared/brand';
import { describe, expect, it } from 'vitest';

import { GENERATED } from '../scripts/generate.ts';
import { COLORS, TEXT_PAIRS } from '../src/tokens/tokens.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

/** WCAG 2.x relative luminance of a `#RRGGBB` color. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((value) =>
    value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

describe('generated CSS', () => {
  it.each(Object.entries(GENERATED))('%s is up to date (run `pnpm --filter @mc/ui generate`)', (file, build) => {
    const committed = readFileSync(`${root}${file}`, 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(build());
  });

  it('removes the default Tailwind palette so raw colors cannot be used', () => {
    const tokens = GENERATED['tokens.css']();
    for (const namespace of ['color', 'font', 'text', 'radius', 'shadow', 'ease', 'animate']) {
      expect(tokens).toContain(`--${namespace}-*: initial;`);
    }
  });
});

describe('color tokens (06 §2, PROGRESS F8)', () => {
  it.each(TEXT_PAIRS)('%s on %s passes WCAG AA (≥ 4.5:1)', (fg, bg) => {
    expect(contrast(COLORS[fg], COLORS[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('every token is a #RRGGBB hex value except the translucent overlay', () => {
    for (const [name, value] of Object.entries(COLORS)) {
      if (name === 'overlay') continue;
      expect(value, name).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('brand.ts colors (manifest, theme-color, brand mark) equal the tokens', () => {
    expect(BRAND.colors.background).toBe(COLORS.bg);
    expect(BRAND.colors.theme).toBe(COLORS.bg);
    expect(BRAND.colors.primary).toBe(COLORS['primary-700']);
    expect(BRAND.colors.onPrimary).toBe(COLORS['on-primary']);
  });
});
