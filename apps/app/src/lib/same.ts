// Prop comparison for memoised lists: query hooks may hand out new arrays/maps with the same entries on every render
// (useQueries), which would defeat React.memo on long lists (08 §8 budgets).

/** Same length and the same entries (by identity) in the same order. */
export function sameElements<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((entry, index) => entry === b[index]));
}

/** Same keys mapped to the same values (by identity). */
export function sameMap<K, V>(a: ReadonlyMap<K, V> | undefined, b: ReadonlyMap<K, V> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}
