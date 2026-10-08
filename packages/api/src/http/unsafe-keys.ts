/**
 * NoSQL-injection guard (04 §6, R11): object keys starting with `$` or containing `.` are rejected
 * anywhere in parsed input, so operator objects (`{"$ne": …}`) or dotted paths can never reach a
 * MongoDB filter or update, even if a schema were too lax.
 *
 * @param value - parsed JSON body / query object.
 * @param maxDepth - recursion guard (JSON bodies are ≤ 32 kB, so 64 levels is generous).
 * @returns the dotted path of the first unsafe key, or `null` when the input is clean.
 */
export function findUnsafeKey(value: unknown, maxDepth = 64): string | null {
  const walk = (node: unknown, path: string, depth: number): string | null => {
    if (depth > maxDepth) return path || '(root)';
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) {
        const found = walk(item, `${path}[${String(index)}]`, depth + 1);
        if (found !== null) return found;
      }
      return null;
    }
    if (typeof node === 'object' && node !== null) {
      for (const [key, child] of Object.entries(node)) {
        const childPath = path ? `${path}.${key}` : key;
        if (key.startsWith('$') || key.includes('.')) return childPath;
        const found = walk(child, childPath, depth + 1);
        if (found !== null) return found;
      }
    }
    return null;
  };
  return walk(value, '', 0);
}
