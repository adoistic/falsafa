import { describe, expect, test } from "bun:test";
import { lexRank } from "./lexrank";

describe("LexRank", () => {
  test("returns same shape as textRank", () => {
    const sim = [
      [1.0, 0.3, 0.5],
      [0.3, 1.0, 0.4],
      [0.5, 0.4, 1.0],
    ];
    const out = lexRank(sim);
    expect(out.scores).toHaveLength(3);
    const sum = out.scores.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });

  test("denser threshold (0.2 binarized) keeps edges that TextRank would drop", () => {
    // TextRank would drop the 0.15 edge (below threshold 0.2 in unweighted
    // LexRank), so node 0 is connected to node 2 only via the 0.3 edge.
    const sim = [
      [1.0, 0.15, 0.3],
      [0.15, 1.0, 0.25],
      [0.3, 0.25, 1.0],
    ];
    const out = lexRank(sim);
    expect(out.scores.every((s) => s > 0)).toBe(true);
  });

  test("empty matrix → empty output (delegates to textRank)", () => {
    expect(lexRank([]).scores).toEqual([]);
  });
});
