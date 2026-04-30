import { describe, expect, test } from "bun:test";
import { ngrams } from "./ngrams";

describe("ngrams", () => {
  test("unigrams equal input tokens (wrapped in length-1 arrays)", () => {
    expect(ngrams(["a", "b", "c"], 1)).toEqual([["a"], ["b"], ["c"]]);
  });

  test("bigrams produce N-1 pairs", () => {
    expect(ngrams(["a", "b", "c"], 2)).toEqual([["a", "b"], ["b", "c"]]);
  });

  test("trigrams produce N-2 triples", () => {
    expect(ngrams(["a", "b", "c", "d"], 3)).toEqual([
      ["a", "b", "c"],
      ["b", "c", "d"],
    ]);
  });

  test("empty input → empty output for any n", () => {
    expect(ngrams([], 2)).toEqual([]);
    expect(ngrams([], 1)).toEqual([]);
  });

  test("n > tokens.length → empty output", () => {
    expect(ngrams(["a"], 3)).toEqual([]);
    expect(ngrams(["a", "b"], 3)).toEqual([]);
  });

  test("n=0 or negative → empty (edge case guard)", () => {
    expect(ngrams(["a", "b"], 0)).toEqual([]);
    expect(ngrams(["a", "b"], -1)).toEqual([]);
  });

  test("works on non-string types (generic)", () => {
    expect(ngrams([1, 2, 3], 2)).toEqual([[1, 2], [2, 3]]);
  });
});
