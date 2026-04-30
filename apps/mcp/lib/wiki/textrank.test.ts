import { describe, expect, test } from "bun:test";
import { textRank } from "./textrank";

describe("TextRank", () => {
  test("converges with default damping; scores normalized to sum 1", () => {
    const sim = [
      [1.0, 0.3, 0.2, 0.1],
      [0.3, 1.0, 0.4, 0.2],
      [0.2, 0.4, 1.0, 0.5],
      [0.1, 0.2, 0.5, 1.0],
    ];
    const { scores, iterations } = textRank(sim);
    expect(scores).toHaveLength(4);
    const sum = scores.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 2);
    expect(iterations).toBeLessThan(50);
  });

  test("uniform similarity matrix → near-uniform scores → confidence 'low' (D3)", () => {
    const sim = Array.from({ length: 6 }, () => Array(6).fill(0.5));
    for (let i = 0; i < 6; i++) sim[i]![i] = 1.0;
    const { scores, confidence } = textRank(sim);
    const variance =
      scores.reduce((s, x) => s + (x - 1 / 6) ** 2, 0) / scores.length;
    expect(variance).toBeLessThan(0.01);
    expect(confidence).toBe("low");
  });

  test("differentiated matrix → meaningful scores → confidence not 'low'", () => {
    // One central paragraph (idx 0) similar to everything; others isolated
    const sim = [
      [1.0, 0.9, 0.9, 0.9],
      [0.9, 1.0, 0.05, 0.05],
      [0.9, 0.05, 1.0, 0.05],
      [0.9, 0.05, 0.05, 1.0],
    ];
    const { scores, confidence } = textRank(sim);
    const maxIdx = scores.indexOf(Math.max(...scores));
    expect(maxIdx).toBe(0);
    expect(confidence).not.toBe("low");
  });

  test("threshold 0.1 drops weak edges (Mihalcea & Tarau)", () => {
    const sim = [
      [1.0, 0.05, 0.05],
      [0.05, 1.0, 0.5],
      [0.05, 0.5, 1.0],
    ];
    const { scores } = textRank(sim);
    // Node 0 nearly isolated; nodes 1, 2 dominate
    expect(scores[1]! + scores[2]!).toBeGreaterThan(scores[0]!);
  });

  test("empty matrix returns empty scores, confidence 'low'", () => {
    const { scores, confidence } = textRank([]);
    expect(scores).toEqual([]);
    expect(confidence).toBe("low");
  });

  test("single-node matrix returns [1.0], confidence 'low'", () => {
    const { scores, confidence } = textRank([[1.0]]);
    expect(scores).toEqual([1.0]);
    expect(confidence).toBe("low");
  });
});
