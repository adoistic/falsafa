import { describe, expect, test } from "bun:test";
import { typeTokenRatio, hapaxRatio, burrowsDelta } from "./stylometry";

describe("stylometry", () => {
  describe("typeTokenRatio", () => {
    test("all unique → 1.0", () => {
      expect(typeTokenRatio(["a", "b", "c"])).toBe(1.0);
    });
    test("all same → 1/N", () => {
      expect(typeTokenRatio(["a", "a", "a", "a"])).toBe(0.25);
    });
    test("empty → 0", () => {
      expect(typeTokenRatio([])).toBe(0);
    });
    test("realistic mix", () => {
      // [a, b, a, c] → 3 distinct / 4 total = 0.75
      expect(typeTokenRatio(["a", "b", "a", "c"])).toBe(0.75);
    });
  });

  describe("hapaxRatio", () => {
    test("all unique → 1.0", () => {
      expect(hapaxRatio(["a", "b", "c"])).toBe(1.0);
    });
    test("half duplicated → some hapax fraction", () => {
      // [a, a, b, c] → b and c are hapax; a is not → 2/3
      expect(hapaxRatio(["a", "a", "b", "c"])).toBeCloseTo(2 / 3, 5);
    });
    test("all same → 0", () => {
      // No hapax (a appears 4×, not 1×)
      expect(hapaxRatio(["a", "a", "a", "a"])).toBe(0);
    });
    test("empty → 0", () => {
      expect(hapaxRatio([])).toBe(0);
    });
  });

  describe("burrowsDelta", () => {
    test("identical-to-corpus chapter → delta close to 0", () => {
      const ch = new Map([["a", 0.1], ["b", 0.2]]);
      const corpus = [
        new Map([["a", 0.1], ["b", 0.2]]),
        new Map([["a", 0.1], ["b", 0.2]]),
      ];
      expect(burrowsDelta(ch, corpus)).toBeCloseTo(0, 5);
    });

    test("zero-stdev terms (uniform across corpus) excluded — no NaN", () => {
      // Both chapters have identical freqs → stdev=0 → term skipped
      // Delta should be 0 (or finite) not NaN
      const ch = new Map([["a", 0.5]]);
      const corpus = [new Map([["a", 0.5]])];
      const delta = burrowsDelta(ch, corpus);
      expect(Number.isFinite(delta)).toBe(true);
    });

    test("outlier chapter has higher delta than typical", () => {
      const corpus = [
        new Map([["the", 0.1], ["of", 0.05]]),
        new Map([["the", 0.11], ["of", 0.06]]),
        new Map([["the", 0.09], ["of", 0.04]]),
      ];
      // Same shape as corpus
      const typical = new Map([["the", 0.1], ["of", 0.05]]);
      // Way off from corpus distribution
      const outlier = new Map([["the", 0.5], ["of", 0.4]]);
      const dTypical = burrowsDelta(typical, corpus);
      const dOutlier = burrowsDelta(outlier, corpus);
      expect(dOutlier).toBeGreaterThan(dTypical);
    });

    test("empty corpus → 0", () => {
      expect(burrowsDelta(new Map([["a", 1]]), [])).toBe(0);
    });
  });
});
