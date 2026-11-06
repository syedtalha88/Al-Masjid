// Daily rotation (PHASE_03 T3.4, 07 B6 "Today's suggestion"): which of n candidates a masjid is offered today. A
// hash, not a random draw — the suggestion stays the same all day and on every phone of the masjid's admins.

/**
 * A stable index in 0 … n-1 for `seed` (the masjid) on `day` (an IST calendar date, "YYYY-MM-DD").
 *
 * @throws RangeError when `n` is not a positive integer.
 */
export function dailyIndex(seed: string, day: string, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('dailyIndex: n must be a positive integer');
  // FNV-1a (32-bit) over "seed|day", then mixed (murmur3 finalizer) so consecutive days do not land next to each other.
  let hash = 0x811c9dc5;
  const input = `${seed}|${day}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i); // UTF-16 code units — any stable byte-ish sequence does for a hash
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) % n;
}
