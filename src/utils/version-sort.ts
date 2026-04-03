/**
 * Comparator for sorting legislation version labels.
 *
 * Sort order:
 *   1. First-version keywords (enacted, made, created, adopted)
 *   2. ISO date strings in chronological order
 *   3. "prospective"
 */

export const FIRST_VERSION_KEYWORDS = new Set(["enacted", "made", "created", "adopted"]);

function rank(version: string): number {
  if (FIRST_VERSION_KEYWORDS.has(version)) return 0;
  if (version === "prospective") return 2;
  return 1; // dates
}

export function compareVersions(a: string, b: string): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  // Within the same rank, sort lexicographically (ISO dates sort correctly this way)
  return a < b ? -1 : a > b ? 1 : 0;
}
