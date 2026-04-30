import { describe, expect, test } from "bun:test";
import {
  buildTfIdf,
  cosine,
  tokenize,
  MIN_TOKENS,
  MIN_COSINE,
  DEFAULT_TOP_K,
} from "./tfidf";

describe("tfidf shared module", () => {
  test("re-exports the constants used by cross-link.ts", () => {
    expect(MIN_TOKENS).toBe(50);
    expect(MIN_COSINE).toBe(0.05);
    expect(DEFAULT_TOP_K).toBe(5);
  });

  test("tokenize splits English text on whitespace + punctuation, lowercases, drops 1-2 char tokens", () => {
    const out = tokenize("The Self-Existent Lord, undiscernible at first.");
    expect(out).toContain("self-existent"); // hyphenated compound preserved (D5)
    expect(out).toContain("undiscernible");
    expect(out).not.toContain("at"); // 2-char dropped
    expect(out).toContain("the"); // 3-char kept (no stopwords in shared tokenizer)
  });

  test("buildTfIdf produces vectors per chapter id with nonempty terms", () => {
    const docs = [
      { id: "ch1", tokens: ["dharma", "creation", "self-existent"] },
      { id: "ch2", tokens: ["dharma", "verse", "stanza"] },
    ];
    const { vectors, idf, N } = buildTfIdf(docs);
    expect(N).toBe(2);
    expect(vectors.get("ch1")).toBeDefined();
    expect(vectors.get("ch1")!.size).toBeGreaterThan(0);
    expect(idf.has("dharma")).toBe(true);
  });

  test("buildTfIdf: shared term has lower IDF than unique term", () => {
    const docs = [
      { id: "ch1", tokens: ["dharma", "alpha"] },
      { id: "ch2", tokens: ["dharma", "beta"] },
    ];
    const { idf } = buildTfIdf(docs);
    // dharma appears in both docs (high df, low IDF); alpha in only one (low df, high IDF)
    expect(idf.get("dharma")!).toBeLessThan(idf.get("alpha")!);
  });

  test("cosine of identical vectors is 1.0; orthogonal is 0.0", () => {
    const a = new Map([
      ["x", 0.5],
      ["y", 0.5],
    ]);
    const b = new Map([
      ["x", 0.5],
      ["y", 0.5],
    ]);
    const c = new Map([["z", 1.0]]);
    expect(cosine(a, b)).toBeCloseTo(1.0, 5);
    expect(cosine(a, c)).toBe(0);
  });

  test("cosine handles empty vectors without NaN", () => {
    const empty = new Map<string, number>();
    const v = new Map([["x", 1.0]]);
    expect(cosine(empty, v)).toBe(0);
    expect(cosine(empty, empty)).toBe(0);
  });
});
