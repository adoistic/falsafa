/**
 * Stylometric primitives for the wiki layer.
 *
 *   typeTokenRatio: distinct types / total tokens
 *     1.0 = every token unique (poetic / topical breadth)
 *     low = repetitive (formulaic / refrain-heavy)
 *
 *   hapaxRatio: tokens-appearing-exactly-once / distinct types
 *     high = breadth, low = formulaic / repetitive
 *
 *   burrowsDelta: per-chapter z-score over the corpus's most frequent terms.
 *     Used in the full sheet to flag chapters that read "differently" from
 *     the rest of their work — mean of absolute z-scores, terms with
 *     zero stdev across the corpus excluded (no NaN). Higher = more outlier.
 */

export function typeTokenRatio(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  return new Set(tokens).size / tokens.length;
}

export function hapaxRatio(tokens: string[]): number {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (counts.size === 0) return 0;
  let hapax = 0;
  for (const c of counts.values()) if (c === 1) hapax += 1;
  return hapax / counts.size;
}

/**
 * Burrows' Delta. For chapter `target` vs a reference corpus of chapters,
 * compute mean absolute z-score over the corpus's top-K most frequent terms.
 *
 * Inputs are normalized term-frequency maps (term → fraction of tokens
 * matching that term in the chapter), so Delta is comparable across
 * chapters of different lengths.
 *
 * Terms with zero stdev across the reference corpus (uniform distribution)
 * are excluded — including them would produce NaN with no signal anyway.
 *
 * Default topK = 100. Tuning above ~200 wastes compute; below ~50 misses
 * function-word signal.
 */
export function burrowsDelta(
  target: Map<string, number>,
  corpus: Map<string, number>[],
  topK = 100,
): number {
  if (corpus.length === 0) return 0;
  // Top-K by combined corpus frequency.
  const corpusFreq = new Map<string, number>();
  for (const ch of corpus) {
    for (const [term, c] of ch) corpusFreq.set(term, (corpusFreq.get(term) ?? 0) + c);
  }
  const topTerms = [...corpusFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([t]) => t);
  if (topTerms.length === 0) return 0;

  let sumAbsZ = 0;
  let counted = 0;
  for (const term of topTerms) {
    const corpusVals = corpus.map((ch) => ch.get(term) ?? 0);
    const mean = corpusVals.reduce((a, b) => a + b, 0) / corpusVals.length;
    const variance =
      corpusVals.reduce((s, v) => s + (v - mean) ** 2, 0) / corpusVals.length;
    const stdev = Math.sqrt(variance);
    if (stdev <= 0) continue; // exclude uniform terms — no NaN
    const z = ((target.get(term) ?? 0) - mean) / stdev;
    sumAbsZ += Math.abs(z);
    counted += 1;
  }
  return counted > 0 ? sumAbsZ / counted : 0;
}
