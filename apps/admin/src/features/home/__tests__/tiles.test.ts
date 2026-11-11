import { describe, expect, it } from 'vitest';

import { CURRENT_PHASE, TILES, visibleTiles } from '../tiles.tsx';

// PHASE_03 T3.1: later phases' tiles are "Coming soon" in dev/staging builds and absent from production builds.

describe('Admin Home tiles', () => {
  it('production shows only tiles of phases built so far; dev/staging shows all, in order', () => {
    const production = visibleTiles(false).map((tile) => tile.key);
    expect(production).toContain('donation'); // T5.3
    expect(production).toContain('needy'); // T5.8
    expect(production).toContain('chanda'); // T5.5
    expect(production).toContain('prayerTimes');
    expect(visibleTiles(false).every((tile) => tile.phase <= CURRENT_PHASE && tile.route !== null)).toBe(true);
    expect(visibleTiles(true).map((tile) => tile.key)).toEqual(TILES.map((tile) => tile.key));
  });

  it('keys are unique (they name routes and strings)', () => {
    expect(new Set(TILES.map((tile) => tile.key)).size).toBe(TILES.length);
  });
});
