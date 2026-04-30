/**
 * Shared TF-IDF primitives. Extracted from scripts/cross-link.ts so the
 * cross-link build and the wiki layer build operate on the same IDF
 * values. Pure functions, no I/O.
 *
 * Per spec D5: lowercases, splits on whitespace + most punctuation BUT
 * NOT on hyphens — hyphenated compounds ("self-existent", "varna-dharma",
 * "dil-e-naadan") stay as single tokens. Drops 1-2 character tokens.
 *
 * For language-aware stopword removal, see apps/mcp/lib/wiki/tokenize.ts
 * (built on top of these primitives).
 */

export const MIN_TOKENS = 50;
export const MIN_COSINE = 0.05;
export const DEFAULT_TOP_K = 5;

const TOKEN_RE = /[\s,.;:()\[\]{}<>"'!?—–…“”‘’]+/u;

export function tokenize(body: string): string[] {
  return body
    .toLowerCase()
    .split(TOKEN_RE)
    .filter((t) => t.length >= 3);
}

export interface TfIdfDoc {
  id: string;
  tokens: string[];
}

export interface TfIdfResult {
  vectors: Map<string, Map<string, number>>;
  idf: Map<string, number>;
  N: number;
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

export function buildTfIdf(docs: TfIdfDoc[]): TfIdfResult {
  const N = docs.length;
  const df = new Map<string, number>();
  const tfPerDoc = new Map<string, Map<string, number>>();
  for (const d of docs) {
    const tf = termFrequency(d.tokens);
    tfPerDoc.set(d.id, tf);
    for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, dfCount] of df) {
    idf.set(term, Math.log((N + 1) / (dfCount + 1)) + 1);
  }
  const vectors = new Map<string, Map<string, number>>();
  for (const [id, tf] of tfPerDoc) {
    const total = [...tf.values()].reduce((a, b) => a + b, 0);
    const v = new Map<string, number>();
    for (const [term, count] of tf) {
      const tfNorm = total > 0 ? count / total : 0;
      v.set(term, tfNorm * (idf.get(term) ?? 0));
    }
    vectors.set(id, v);
  }
  return { vectors, idf, N };
}

export function cosine(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let normA = 0;
  let normB = 0;
  for (const v of a.values()) normA += v * v;
  for (const v of b.values()) normB += v * v;
  if (normA === 0 || normB === 0) return 0;
  // Iterate the smaller map for fewer hash lookups
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  let dot = 0;
  for (const [k, v] of smaller) {
    const u = larger.get(k);
    if (u !== undefined) dot += v * u;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
