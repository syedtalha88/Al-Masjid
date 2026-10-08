import { describe, expect, it } from 'vitest';

import { BRAND } from './brand.ts';

describe('BRAND', () => {
  it('is the single source of the working name', () => {
    expect(BRAND.name).toBe('Masjid Connect');
  });

  it('keeps home-screen labels short enough not to be truncated on Android', () => {
    expect(BRAND.shortName.length).toBeLessThanOrEqual(12);
    expect(BRAND.adminShortName.length).toBeLessThanOrEqual(12);
  });

  it('uses 6-digit hex colours (manifests do not accept tokens)', () => {
    for (const color of Object.values(BRAND.colors)) expect(color).toMatch(/^#[0-9A-F]{6}$/);
  });
});
