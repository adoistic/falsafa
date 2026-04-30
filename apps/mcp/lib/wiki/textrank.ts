/**
 * TextRank-on-paragraphs (Mihalcea & Tarau 2004).
 *
 * Build a similarity graph over paragraphs (caller provides the similarity
 * matrix), drop edges below threshold (default 0.1), run weighted PageRank
 * with damping 0.85 until convergence (Δ < 1e-6) or max 50 iterations.
 *
 * Per spec D3: emit a `confidence` flag based on PageRank score variance.
 * Low variance = ~uniform PageRank = arbitrary "central" pick on small or
 * homogeneous graphs (typical of single-poem chapters in Iqbal/Ghalib/Zauq).
 * The wiki card surfaces this flag in its frontmatter so consumers know
 * whether the "key passage" pick is meaningful or arbitrary.
 *
 *   variance < 0.005  → "low"     (arbitrary; downstream should hedge)
 *   variance < 0.02   → "medium"  (decent signal)
 *   else              → "high"    (clear winner)
 *
 * Thresholds are empirical defaults tuned for paragraph-count ~5-100;
 * tunable via opts for the wiki-build pipeline if a chapter-shape audit
 * shows we need different cutoffs per layout.
 */

export interface TextRankResult {
  /** PageRank scores, normalized to sum to 1. */
  scores: number[];
  /** Quality flag per D3. Low = pick may be arbitrary. */
  confidence: "low" | "medium" | "high";
  iterations: number;
}

export interface TextRankOpts {
  damping?: number;
  edgeThreshold?: number;
  maxIter?: number;
  convergence?: number;
  /** Variance below this → confidence "low". */
  lowVarianceThreshold?: number;
  /** Variance above this → confidence "high". Otherwise "medium". */
  highVarianceThreshold?: number;
}

export function textRank(
  similarity: number[][],
  opts: TextRankOpts = {},
): TextRankResult {
  const damping = opts.damping ?? 0.85;
  const threshold = opts.edgeThreshold ?? 0.1;
  const maxIter = opts.maxIter ?? 50;
  const convergence = opts.convergence ?? 1e-6;
  const lowVar = opts.lowVarianceThreshold ?? 0.005;
  const highVar = opts.highVarianceThreshold ?? 0.02;
  const N = similarity.length;
  if (N === 0) return { scores: [], confidence: "low", iterations: 0 };
  if (N === 1) return { scores: [1.0], confidence: "low", iterations: 0 };

  // Adjacency: zero out diagonal + sub-threshold edges.
  const adj: number[][] = similarity.map((row, i) =>
    row.map((v, j) => (i === j || v < threshold ? 0 : v)),
  );
  // Out-degree (row-sum) per node.
  const outDeg = adj.map((row) => row.reduce((a, b) => a + b, 0));

  let scores = Array<number>(N).fill(1 / N);
  let iter = 0;
  for (; iter < maxIter; iter++) {
    const next = Array<number>(N).fill((1 - damping) / N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (adj[i]![j] === 0 || outDeg[i] === 0) continue;
        next[j]! += damping * scores[i]! * (adj[i]![j]! / outDeg[i]!);
      }
    }
    let delta = 0;
    for (let i = 0; i < N; i++) delta += Math.abs(next[i]! - scores[i]!);
    scores = next;
    if (delta < convergence) {
      iter += 1;
      break;
    }
  }
  // Normalize so scores sum to 1.
  const total = scores.reduce((a, b) => a + b, 0);
  if (total > 0) scores = scores.map((s) => s / total);

  // Confidence from variance.
  const mean = 1 / N;
  const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / N;
  const confidence: "low" | "medium" | "high" =
    variance < lowVar ? "low" : variance < highVar ? "medium" : "high";

  return { scores, confidence, iterations: iter };
}
