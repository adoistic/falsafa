/**
 * Normalized Pointwise Mutual Information (Bouma 2009) over docs of tokens.
 *
 *   NPMI(a, b) = log( P(a,b) / (P(a) × P(b)) ) / -log( P(a,b) )
 *
 * Range: [-1, 1]. Higher = stronger collocation.
 *   1   = perfectly correlated (always co-occur, never separately)
 *   0   = independent
 *   < 0 = anti-correlated (rarer than chance)
 *
 * Per spec: filter on minJointCount (default 3) to avoid sample noise from
 * rare co-occurrences. The corpus-level signal we want is "these terms
 * cluster together repeatedly," not "these terms happened to share one doc."
 *
 * Document = paragraph (or chapter, depending on caller). Pair counts are
 * type-level: a doc with [a, a, b, b] contributes ONE (a,b) joint
 * occurrence, not four. This matches Bouma's definition.
 */

export interface NPMIOpts {
  /** Minimum joint occurrence count to keep the pair. Default 3. */
  minJointCount?: number;
  /**
   * Cap unique terms per doc before generating pairs. Each doc with U unique
   * tokens produces O(U²) pair entries; a doc with 5K unique tokens produces
   * 12.5M pair entries — enough to OOM the JS heap when aggregated across
   * many docs. Default 500: pairs = 125K per doc, ~5M cross-doc max.
   * Pass Infinity to disable.
   */
  maxTermsPerDoc?: number;
}

export interface NPMIResult {
  a: string;
  b: string;
  npmi: number;
  joint_count: number;
}

export function computeNPMI(
  docs: string[][],
  opts: NPMIOpts = {},
): NPMIResult[] {
  const minJoint = opts.minJointCount ?? 3;
  const maxTerms = opts.maxTermsPerDoc ?? 500;
  if (docs.length === 0) return [];

  // Per-doc unique-term presence (type-level co-occurrence).
  const termCount = new Map<string, number>(); // # docs the term appears in
  const pairCount = new Map<string, number>(); // # docs the pair appears in
  let totalDocs = docs.length;

  for (const doc of docs) {
    // Cap each doc's vocabulary to the top-K most frequent tokens before
    // generating pairs. Without this, high-vocab docs (full chapters with
    // thousands of distinct tokens) explode the pair-count map quadratically
    // and OOM the heap. Top-K-by-frequency loses nothing meaningful — NPMI
    // signal lives in repeatedly co-occurring terms, which the cutoff keeps.
    const inDocCounts = new Map<string, number>();
    for (const t of doc) inDocCounts.set(t, (inDocCounts.get(t) ?? 0) + 1);
    const seen = new Set<string>(
      [...inDocCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, Number.isFinite(maxTerms) ? maxTerms : inDocCounts.size)
        .map(([t]) => t),
    );
    for (const t of seen) {
      termCount.set(t, (termCount.get(t) ?? 0) + 1);
    }
    const sorted = [...seen].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const k = `${sorted[i]}\0${sorted[j]}`;
        pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
      }
    }
  }

  const out: NPMIResult[] = [];
  for (const [key, joint] of pairCount) {
    if (joint < minJoint) continue;
    const [a, b] = key.split("\0") as [string, string];
    const pA = (termCount.get(a) ?? 0) / totalDocs;
    const pB = (termCount.get(b) ?? 0) / totalDocs;
    const pAB = joint / totalDocs;
    if (pAB <= 0 || pA <= 0 || pB <= 0) continue;
    const pmi = Math.log(pAB / (pA * pB));
    const denom = -Math.log(pAB);
    if (denom <= 0) continue;
    let npmi = pmi / denom;
    // Clamp tiny float overshoot at the boundaries (prevents test flakes
    // when a pair co-occurs in 100% of docs).
    if (npmi > 1) npmi = 1;
    if (npmi < -1) npmi = -1;
    out.push({ a, b, npmi, joint_count: joint });
  }
  out.sort((x, y) => y.npmi - x.npmi);
  return out;
}
