import { describe, expect, test } from "bun:test";
import {
  buildTfIdf,
  cosine,
  tokenize,
  MIN_TOKENS,
  MIN_COSINE,
  DEFAULT_TOP_K,
  type DocVector,
} from "./tfidf";

describe("tfidf shared module", () => {
  test("re-exports the constants used by cross-link.ts", () => {
    expect(MIN_TOKENS).toBe(50);
    expect(MIN_COSINE).toBe(0.05);
    expect(DEFAULT_TOP_K).toBe(5);
  });

  test("tokenize: lowercase, drop stopwords, drop tokens < 3 chars", () => {
    const out = tokenize("The dharma of the cosmos.");
    expect(out).toContain("dharma");
    expect(out).toContain("cosmos");
    expect(out).not.toContain("the"); // stopword
    expect(out).not.toContain("of"); // stopword
  });

  test("tokenize: splits on non-letter (cross-link.ts behavior — drops hyphens)", () => {
    // The cross-link tokenizer uses [^a-z']+, so hyphens, digits, and
    // non-Latin script all become token boundaries.
    const out = tokenize("self-existent");
    // "self" is a stopword? no — kept; "existent" stays.
    // Both come out as separate tokens because hyphen splits them.
    expect(out).toContain("self");
    expect(out).toContain("existent");
    // The hyphenated compound is NOT preserved by this tokenizer. The
    // language-aware tokenizer in apps/mcp/lib/wiki/tokenize.ts is the
    // one that preserves compounds (per D5).
  });

  test("buildTfIdf produces vectors per doc with nonempty terms", () => {
    const docs = new Map<string, string[]>([
      ["ch1", ["dharma", "creation", "alpha"]],
      ["ch2", ["dharma", "verse", "stanza"]],
    ]);
    const out = buildTfIdf(docs);
    expect(out.get("ch1")).toBeDefined();
    expect(out.get("ch1")!.vector.size).toBeGreaterThan(0);
    expect(out.get("ch1")!.norm).toBeGreaterThan(0);
  });

  test("buildTfIdf: term in every doc gets idf=0 and drops out", () => {
    // "shared" appears in both docs → df=N → idf=log(N/df)=0 → dropped
    const docs = new Map<string, string[]>([
      ["ch1", ["shared", "alpha"]],
      ["ch2", ["shared", "beta"]],
    ]);
    const out = buildTfIdf(docs);
    expect(out.get("ch1")!.vector.has("shared")).toBe(false);
    expect(out.get("ch1")!.vector.has("alpha")).toBe(true);
    expect(out.get("ch2")!.vector.has("shared")).toBe(false);
    expect(out.get("ch2")!.vector.has("beta")).toBe(true);
  });

  test("buildTfIdf: weight is raw count × idf (not length-normalized)", () => {
    const docs = new Map<string, string[]>([
      ["ch1", ["alpha", "alpha", "alpha", "shared"]], // alpha appears 3x
      ["ch2", ["beta", "shared"]], // beta appears 1x
    ]);
    const out = buildTfIdf(docs);
    // alpha is unique to ch1 (df=1, N=2) → idf = log(2/1) = ln(2)
    // weight = 3 × ln(2) ≈ 2.079
    expect(out.get("ch1")!.vector.get("alpha")!).toBeCloseTo(3 * Math.log(2), 5);
  });

  test("cosine of identical doc-vectors is 1.0 (with at least one unique term across the corpus)", () => {
    // Need a 3rd doc with unique terms so alpha/beta don't have df=N
    // (which would zero out IDF and produce empty vectors).
    const docs = new Map<string, string[]>([
      ["a", ["alpha", "beta"]],
      ["b", ["alpha", "beta"]],
      ["c", ["gamma", "delta"]],
    ]);
    const out = buildTfIdf(docs);
    expect(cosine(out.get("a")!, out.get("b")!)).toBeCloseTo(1.0, 5);
  });

  test("cosine returns 0 when both docs share only universal terms (idf=0 → empty vectors)", () => {
    // Edge case: every term appears in every doc → all vectors empty.
    // Cosine returns 0 (safe), not NaN.
    const docs = new Map<string, string[]>([
      ["a", ["alpha", "beta"]],
      ["b", ["alpha", "beta"]],
    ]);
    const out = buildTfIdf(docs);
    expect(out.get("a")!.vector.size).toBe(0);
    expect(cosine(out.get("a")!, out.get("b")!)).toBe(0);
  });

  test("cosine of orthogonal docs is 0", () => {
    const docs = new Map<string, string[]>([
      ["a", ["alpha", "beta"]],
      ["b", ["gamma", "delta"]],
    ]);
    const out = buildTfIdf(docs);
    // No shared terms → cosine = 0
    expect(cosine(out.get("a")!, out.get("b")!)).toBe(0);
  });

  test("cosine handles zero-norm vectors without NaN", () => {
    const empty: DocVector = { vector: new Map(), norm: 0 };
    const v: DocVector = { vector: new Map([["x", 1]]), norm: 1 };
    expect(cosine(empty, v)).toBe(0);
    expect(cosine(empty, empty)).toBe(0);
  });
});
