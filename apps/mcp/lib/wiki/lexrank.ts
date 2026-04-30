import { textRank, type TextRankResult } from "./textrank";

/**
 * LexRank (Erkan & Radev 2004). Same PageRank trick as TextRank but with:
 *   - threshold 0.2 (denser graph)
 *   - unweighted edges (binary above-threshold)
 *
 * Used as a cross-check in the wiki full-sheet renderer: if TextRank and
 * LexRank disagree on top-3, that's a flag worth surfacing.
 *
 * Implementation: binarize the similarity matrix at threshold 0.2, then
 * delegate to textRank with edgeThreshold=0.5 so the binarized 1.0
 * weights pass through. Reuses TextRank's confidence-flag logic.
 */
export function lexRank(similarity: number[][]): TextRankResult {
  const binarized = similarity.map((row) =>
    row.map((v) => (v >= 0.2 ? 1.0 : 0.0)),
  );
  return textRank(binarized, { edgeThreshold: 0.5 });
}
