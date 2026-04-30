/**
 * Sliding-window n-gram extraction. Generic over token type so the same
 * function works on string tokens, integers, etc.
 *
 * For unigrams (n=1) returns each token wrapped in a length-1 array, so
 * downstream code that joins with " " produces a consistent string form.
 *
 * Edge cases:
 *   n <= 0           → []
 *   n > tokens.length → []
 *   tokens empty     → []
 */
export function ngrams<T>(tokens: T[], n: number): T[][] {
  if (n <= 0 || tokens.length < n) return [];
  const out: T[][] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    out.push(tokens.slice(i, i + n));
  }
  return out;
}
