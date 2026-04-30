/**
 * Shared TF-IDF primitives. Extracted verbatim from scripts/cross-link.ts
 * so the cross-link build and the wiki layer build operate on the same
 * IDF values. Pure functions, no I/O.
 *
 * Algorithm (preserved from cross-link.ts so existing cross-links.json
 * stays byte-identical after the refactor):
 *   - tf = raw count (no length normalization)
 *   - idf = log(N / df) (unsmoothed; terms in every doc drop to 0 weight)
 *   - weight = tf × idf
 *   - cosine = dot(a, b) / (norm_a × norm_b)
 *
 * Tokenization:
 *   - lowercase
 *   - split on `[^a-z']+` (the cross-link.ts regex — drops numbers, all
 *     non-Latin script, and hyphens)
 *   - drop tokens < 3 chars
 *   - drop English stopwords (~80-word list inherited from cross-link.ts)
 *
 * For language-aware tokenization that preserves diacritics + compounds
 * per design D5 (used by the wiki layer), see apps/mcp/lib/wiki/tokenize.ts.
 */

export const MIN_TOKENS = 50;
export const MIN_COSINE = 0.05;
export const DEFAULT_TOP_K = 5;

const STOPWORDS = new Set([
  "the", "and", "of", "to", "in", "that", "is", "was", "for",
  "it", "with", "as", "his", "be", "by", "on", "not", "this", "but",
  "are", "from", "or", "have", "an", "they", "which", "one", "you",
  "were", "her", "all", "she", "there", "would", "their", "we", "him",
  "been", "has", "when", "who", "will", "more", "no", "if", "out",
  "do", "what", "so", "up", "into", "your", "about", "just",
  "should", "could", "may", "might", "shall", "must",
  "had", "its", "our", "them", "than", "then", "where", "these", "those",
  "some", "any", "such", "only", "also", "now", "over", "very",
]);

export function tokenize(body: string): string[] {
  const lowered = body.toLowerCase();
  const raw = lowered.split(/[^a-z']+/);
  const out: string[] = [];
  for (const t of raw) {
    if (t.length < 3) continue;
    if (STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

/** TF-IDF result per doc: sparse weight map plus pre-computed L2 norm. */
export interface DocVector {
  vector: Map<string, number>;
  norm: number;
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/**
 * Build TF-IDF vectors + L2 norms for every input doc. tokenLists is
 * keyed by doc id (typically `<work_slug>/<chapter_slug>`).
 *
 * Uses raw count × log(N/df). Terms with df = N (in every doc) get
 * idf = 0 and are dropped from the weight map.
 */
export function buildTfIdf(
  tokenLists: Map<string, string[]>,
): Map<string, DocVector> {
  const N = tokenLists.size;
  const df = new Map<string, number>();
  for (const tokens of tokenLists.values()) {
    const seen = new Set<string>();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const out = new Map<string, DocVector>();
  for (const [key, tokens] of tokenLists) {
    const tf = termFrequency(tokens);
    const vector = new Map<string, number>();
    let sumSq = 0;
    for (const [term, count] of tf) {
      const dfTerm = df.get(term) ?? 1;
      const idf = Math.log(N / dfTerm);
      if (idf <= 0) continue;
      const w = count * idf;
      vector.set(term, w);
      sumSq += w * w;
    }
    out.set(key, { vector, norm: Math.sqrt(sumSq) });
  }
  return out;
}

/**
 * Cosine similarity over sparse maps. Iterates the smaller vector for the
 * dot product. Returns 0 when either norm is 0 (empty vector or all-idf=0).
 */
export function cosine(a: DocVector, b: DocVector): number {
  if (a.norm === 0 || b.norm === 0) return 0;
  const [small, large] =
    a.vector.size <= b.vector.size ? [a.vector, b.vector] : [b.vector, a.vector];
  let dot = 0;
  for (const [term, w] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += w * other;
  }
  return dot / (a.norm * b.norm);
}
